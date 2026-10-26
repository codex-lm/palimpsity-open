/* =====================================================================
   PALIMPSITY — MOTEUR DE SIMULATION (renderer-agnostic, tourne en Node)
   ---------------------------------------------------------------------
   Aucune dépendance au DOM ni au rendu. Le moteur manipule des données et
   expose un état ; le rendu (render3d.js) et l'UI (ui.js) ne font que LIRE
   cet état. C'est ce qui permet de tester la simulation en headless
   (test/sim-harness.mjs) et de prouver le mécanisme central sans graphisme.

   Boucle (spec §22) :
     recomputeFields()  → diffuse chaleur/congestion LOCALEMENT
     simulateTick()     → prod/conso, ratios, stocks, population,
                          pressions de régime (continues), phases, crises
   Le cœur : buildingValue() = modificateurs de régime pondérés par la
   dominance des régimes courants. Un vieux bâtiment "remonte" quand son
   régime remonte — sans règle ad hoc, juste via ses tags/mods.
   ===================================================================== */

import {
  COLS, ROWS, districtOf, DISTRICT_NAMES, genTerrain,
  BUILDINGS, REGIMES, REGIME_TAG_BONUS, INITIAL_UNLOCKED, UPKEEP, BUILDING_CONVERSIONS,
} from "./data.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export { clamp };

export const VICTORY_POP = 180; // cible MVP (la spec vise 5000 pour le jeu complet ; ici calibré à l'échelle du moteur)

export class CityEngine {
  constructor() {
    this.terrain = genTerrain();
    this.heatField = []; this.congField = []; this.coolField = []; this.occ = [];
    for (let r = 0; r < ROWS; r++) {
      this.heatField[r] = new Array(COLS).fill(0);
      this.congField[r] = new Array(COLS).fill(0);
      this.coolField[r] = new Array(COLS).fill(0);
      this.occ[r] = new Array(COLS).fill(null);
    }
    this.logiSustain = 0; this.heatSustain = 0; this.maintSustain = 0;
    this.calmSustain = 0;          // ville sobre : déblocage tardif SANS crise chaleur
    this.victorySustain = 0;       // la victoire aussi exige un signal soutenu (spec §15)
    this.maxMaintRegime = 0;       // pic atteint par le régime tardif (voie de victoire sobre)
    this.advisorCooldown = 0;
    this.localStocks = Array.from({ length: 4 }, () => ({ food: 0, water: 0 }));
    // compteurs de fin de partie (défaite après signaux, jamais d'un coup — spec §20)
    this.bankruptTicks = 0; this.starveTicks = 0; this.peakPop = 0;
    this.crisisLog = []; // trace pour "survécu à la crise"

    this.state = {
      res: { money: 600, population: 0, food: 0, water: 0, energy: 0, materials: 0,
             heat: 0, maintenance: 0, congestion: 0, trust: 50 },
      flow: {}, flowNet: {}, ratios: {}, supply: 1, workerR: 1,
      buildings: [],                       // {def, c, r, age, localHeat, localCong, disabled}
      regime: { survival: 1.0, production: 0, logistics: 0, maintenance_heat: 0 },
      regimePrev: { survival: 1.0, production: 0, logistics: 0, maintenance_heat: 0 },
      phase: 1,
      unlocked: new Set(INITIAL_UNLOCKED),
      newlyUnlocked: [],                   // pour le flash de palette
      tick: 0, year: 0, season: 0,
      lens: "none", speed: 0,
      advisorCards: [{ who: "City planner", kind: "", text: "The valley is paused. Build houses, a well and a farm in the same district, then press ▶ when you are ready." }],
      toasts: [],                          // chaînes à afficher puis vider
      reports: [],                         // {id, title, body} — rapports d'époque
      reportsShown: new Set(),
      events: { logisticsFired: false, heatFired: false, maintFired: false },
      districts: [],                       // bilans par quartier (UI / explication)
      outcome: null,                       // "victory" | "defeat" | null
      outcomeInfo: null,
    };
  }

  /* ---- placement ---- */
  defAt(c, r) { const b = this.occ?.[r]?.[c]; return b ? b.def : null; }
  inBounds(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }

  canPlace(id, c, r) { return this.placeBlockReason(id, c, r) === null; }
  // pourquoi ce placement est refusé (null = autorisé) — pour le feedback UI
  placeBlockReason(id, c, r) {
    if (!this.inBounds(c, r)) return "Outside the map.";
    if (!this.state.unlocked.has(id)) return "Not unlocked yet.";
    if (this.occ[r][c]) return "This tile is already occupied.";
    if (this.terrain[r][c] === 1) return "You cannot build on the river.";
    const cost = BUILDINGS[id].cost?.money || 0;
    if (this.state.res.money < cost) return "Not enough money.";
    return null;
  }

  place(id, c, r) {
    if (!this.canPlace(id, c, r)) return null;
    const def = BUILDINGS[id];
    this.state.res.money -= (def.cost?.money || 0);
    const b = { def, c, r, age: 0, localHeat: 0, localCong: 0, disabled: false };
    this.state.buildings.push(b);
    this.occ[r][c] = b;
    this.recomputeFields();
    return b;
  }

  removeAt(c, r) {
    const b = this.occ?.[r]?.[c];
    if (!b) return false;
    this.state.buildings = this.state.buildings.filter(x => x !== b);
    this.occ[r][c] = null;
    this.state.res.money += (b.def.cost?.money || 0) * 0.4; // remboursement partiel
    this.recomputeFields();
    return true;
  }

  profileOf(b) { return BUILDING_CONVERSIONS[b?.conversion]?.profile || b?.def; }
  conversionBlockReason(b, id) {
    const c = BUILDING_CONVERSIONS[id];
    if (!b || !this.state.buildings.includes(b)) return "This building no longer exists.";
    if (!c || b.def.id !== c.source) return "This conversion is not available for this building.";
    if (this.state.outcome) return "The game has ended.";
    if (b.conversion) return "This building has already been converted.";
    if (b.disabled) return "Wait until the building is back in service.";
    if (this.state.phase < c.phase) return `Available in phase ${c.phase}.`;
    if (b.age < c.minAge) return `The workshop must be at least ${c.minAge} turns old (${b.age}/${c.minAge}).`;
    if (this.state.res.money < c.cost.money) return "Not enough money.";
    if (this.state.res.materials < c.cost.materials) return "Not enough materials.";
    return null;
  }
  conversionOptions(b) {
    return Object.values(BUILDING_CONVERSIONS).filter(c => c.source === b?.def.id)
      .map(({ profile, ...c }) => ({ ...c, reason: this.conversionBlockReason(b, c.id) }));
  }
  convertBuilding(b, id) {
    if (this.conversionBlockReason(b, id)) return false;
    const c = BUILDING_CONVERSIONS[id];
    this.state.res.money -= c.cost.money;
    this.state.res.materials -= c.cost.materials;
    b.conversion = id;
    b.convertedAt = this.state.tick;
    this.recomputeFields();
    this.toast(`${c.name}: the old building now maintains its district.`);
    return true;
  }

  /* ---- cœur : valeur d'un bâtiment selon le régime ---- */
  buildingValue(b) {
    const m = this.profileOf(b).mods, w = this.state.regime;
    const wsum = w.survival + w.production + w.logistics + w.maintenance_heat + 1e-6;
    return (m.survival * w.survival + m.production * w.production
          + m.logistics * w.logistics + m.maintenance_heat * w.maintenance_heat) / wsum;
  }
  dominantRegime() {
    const w = this.state.regime; let best = "survival", bv = -1;
    for (const k of REGIMES) if (w[k] > bv) { bv = w[k]; best = k; }
    return { key: best, val: bv };
  }
  // le halo "palimpseste" : un VIEUX bâtiment qui REPREND de la valeur après une bascule.
  // jamais en survie (l'état de base) — sinon ce serait un décor permanent, pas un moment.
  // et jamais pour un bâtiment NATIF du régime en cours (l'usine en production, le dépôt
  // en logistique) : la solution du jour qui brille n'est pas un moment palimpseste.
  belongsToDominant(b) {
    const dom = this.dominantRegime();
    if (dom.key === "survival") return false;
    const REGIME_ERA = { production: 2, logistics: 3, maintenance_heat: 4 };
    if ((b.def.phase || 1) >= (REGIME_ERA[dom.key] || 1)) return false;
    return dom.val > 0.9 && (b.def.mods[dom.key] || 1) >= 1.5;
  }
  // tags du bâtiment valorisés par le régime dominant (pour l'explication causale)
  tagBonusFor(b) {
    const dom = this.dominantRegime();
    const bonus = REGIME_TAG_BONUS[dom.key] || [];
    return (this.profileOf(b).tags || []).filter(t => bonus.includes(t));
  }

  /* ---- champs locaux : chaleur & congestion diffusées, refroidies localement ---- */
  recomputeFields() {
    const { heatField, congField, coolField, terrain } = this;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { heatField[r][c] = 0; congField[r][c] = 0; coolField[r][c] = 0; }
    for (const b of this.state.buildings) {
      if (b.disabled) continue;
      const e = this.profileOf(b).ext || {};
      if (e.heat) heatField[b.r][b.c] += e.heat;
      if (e.cooling) coolField[b.r][b.c] += e.cooling;
      if (e.congestion) congField[b.r][b.c] += e.congestion;
    }
    // NB calibrage : ces coefficients (0.55 + 4×0.22 = 1.43/passe) NE conservent PAS
    // la masse — un générateur de 8 pèse ~16 dans le champ après 2 passes. Tout le
    // tuning (seuils de crise 22, notMelting 180, netHeat 0.35) est calé là-dessus :
    // ne change pas le nombre de passes ou les coefficients sans tout recalibrer.
    for (let pass = 0; pass < 2; pass++) {
      const h2 = [], g2 = [];
      for (let r = 0; r < ROWS; r++) { h2[r] = []; g2[r] = []; for (let c = 0; c < COLS; c++) {
        let hs = heatField[r][c] * 0.55, gs = congField[r][c] * 0.6;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) { hs += heatField[rr][cc] * 0.22; gs += congField[rr][cc] * 0.2; } }
        h2[r][c] = hs; g2[r][c] = gs;
      } }
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { heatField[r][c] = h2[r][c]; congField[r][c] = g2[r][c]; }
    }
    // la congestion ne devient jamais négative (le soulagement dépôt/marché sature à 0,
    // sinon la lentille logistique extrapole des couleurs absurdes autour d'eux)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) congField[r][c] = Math.max(0, congField[r][c]);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      let cool = coolField[r][c];
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) cool += coolField[rr][cc] * 0.4; }
      if (terrain[r][c] === 1) cool += 1.5;               // la rivière refroidit
      if (terrain[r][c] === 4) cool += 0.6;               // la forêt aussi (sinon le terrain 4 n'aurait aucun effet)
      heatField[r][c] = Math.max(0, heatField[r][c] - cool);
    }
    // les serres consomment la chaleur AMBIANTE : carburant mesuré sur le champ
    // (avant leur prélèvement), puis prélevé — l'externalité devient ressource
    // pour de vrai, et la serre refroidit sa case de ce qu'elle consomme.
    for (const b of this.state.buildings) {
      if (b.disabled || !b.def.needsHeat) continue;
      const need = (b.def.inputs && b.def.inputs.heat) || 4;
      const lh = heatField[b.r][b.c];
      b.heatFuelLh = lh;
      heatField[b.r][b.c] = Math.max(0, lh - need);
    }
  }
  localHeatAt(c, r) { return this.heatField[r][c] || 0; }
  localCongAt(c, r) { return this.congField[r][c] || 0; }

  /* ---- helpers moteur ---- */
  countTag(t) { let n = 0; for (const b of this.state.buildings) if (this.profileOf(b).tags.includes(t)) n++; return n; }
  // compte les bâtiments portant AU MOINS UN des tags (sans double comptage)
  countAnyTag(tags) { let n = 0; for (const b of this.state.buildings) if (tags.some(t => this.profileOf(b).tags.includes(t))) n++; return n; }
  // un bâtiment portant decentralized ET redundant (puits, marché, dépôt) ne compte
  // qu'UNE fois côté décentralisé — sinon deux dépôts suffisent à rendre la cascade
  // de pannes inatteignable (double comptage).
  centralizationRatio() {
    let cen = 0, dec = 0;
    for (const b of this.state.buildings) {
      const t = this.profileOf(b).tags;
      if (t.includes("centralized")) cen++;
      if (t.includes("decentralized") || t.includes("redundant")) dec++;
    }
    return clamp(cen / (cen + dec + 1), 0, 1);
  }
  // pondération par habitant : une tour (24 hab) doit peser PLUS de pression
  // urbaine par tête qu'une maison (6 hab), pas moins — d'où dense×5, pas ×2.
  density() { return clamp((this.countTag("dense") * 5 + this.countTag("residential")) / (this.state.buildings.length + 1), 0, 1); }
  heatedTilesGE(n) { let c = 0; for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) { if (this.heatField[r][cc] > 2.5) { c++; if (c >= n) return true; } } return false; }

  /* ---- LA boucle ---- */
  tick() {
    if (this.state.outcome) return;
    const s = this.state, r = s.res;
    this.reenableHubs();
    this.recomputeFields();
    if (!s.districts.length) this.computeDistricts();
    const prod = { food: 0, water: 0, energy: 0, materials: 0, money: 0, trust: 0, population: 0 };
    const cons = { food: 0, water: 0, energy: 0, materials: 0, money: 0 };
    const previousRatios = s.ratios;
    let housingPotential = 0, workersPotential = 0, workersDemand = 0, upkeep = 0, totalCong = 0;
    for (const b of s.buildings) {
      const p = this.profileOf(b);
      upkeep += UPKEEP[b.def.id] || 0;
      if (b.disabled) continue;
      housingPotential += p.outputs?.population || 0;
      workersPotential += p.outputs?.workers || 0;
      workersDemand += p.inputs?.workers || 0;
    }
    const occupied = clamp(r.population / Math.max(1, housingPotential), 0, 1);
    // Quelques pionniers peuvent mettre en marche la première ferme. Cet
    // amorçage ne touche jamais les recettes et n'augmente pas avec une ville vide.
    const pioneerWorkers = Math.min(4, workersPotential * 0.2);
    const workersAvail = Math.max(workersPotential * occupied, pioneerWorkers);
    const workerR = workersDemand ? clamp(workersAvail / workersDemand, 0, 1) : 1;
    s.workerR = workerR;

    for (const b of s.buildings) {
      b.age++;
      const p = this.profileOf(b), inp = p.inputs || {}, out = p.outputs || {}, ext = p.ext || {};
      b.flowOutput = {}; b.flowInput = {}; b.activity = 0; b.grossMaintenance = 0;
      if (b.disabled) continue;
      const eff = clamp(this.buildingValue(b), 0.3, 2.4);
      const lh = this.localHeatAt(b.c, b.r);
      const heatPenalty = p.tags.includes("low_heat") || p.needsHeat ? 1 : clamp(1 - lh * 0.06, 0.5, 1);
      const heatFuel = p.needsHeat ? clamp((b.heatFuelLh || 0) / (inp.heat || 4), 0, 1) : 1;
      const terrBonus = (p.prefer || []).includes(this.terrain[b.r][b.c]) ? 1.25 : 1;
      const labor = inp.workers ? workerR : 1;
      // Une usine privée d'électricité ne continue plus à vendre normalement.
      let inputsAvailable = 1;
      for (const key of ["food", "water", "energy"]) if (inp[key] && !out.population) {
        const sourceExists = s.buildings.some(source => !source.disabled && (this.profileOf(source).outputs?.[key] || 0) > 0);
        inputsAvailable = Math.min(inputsAvailable, clamp(previousRatios[key + "R"] ?? (sourceExists ? 1 : 0), 0, 1));
        if (key !== "energy") {
          const local = s.districts[districtOf(b.c, b.r)];
          inputsAvailable = Math.min(inputsAvailable, clamp(local[key + "Coverage"], 0, 1));
        }
      }
      b.activity = labor * inputsAvailable * heatPenalty * heatFuel;
      for (const [key, value] of Object.entries(out)) if (key in prod) {
        const amount = value * eff * b.activity * terrBonus;
        b.flowOutput[key] = amount;
        if (key !== "money") prod[key] += amount;
      }
      for (const [key, value] of Object.entries(inp)) if (key in cons) {
        const use = value * (out.population ? Math.max(0.2, occupied) : labor);
        b.flowInput[key] = use;
        cons[key] += use;
      }
      if (ext.congestion) totalCong += ext.congestion * labor;
      b.localHeat = lh; b.localCong = this.localCongAt(b.c, b.r);
      b.grossMaintenance = Math.max(0, ext.maintenance || 0)
        + Math.max(0, Math.min(b.age - 30, 80)) * 0.02 * (p.tags.includes("repairable") ? 0.4 : 1);
    }
    cons.money += upkeep;
    this.computeDistricts();

    let storageN = 0;
    for (const b of s.buildings) if (!b.disabled && this.profileOf(b).tags.includes("storage")) storageN++;
    const stockCap = 60 + 25 * Math.min(4, storageN);
    const ratio = key => {
      const need = cons[key];
      if (need <= 0.001) return prod[key] > 0 ? 2 : 1;
      const draw = Math.max(0, Math.min(r[key] || 0, need - prod[key]));
      return clamp((prod[key] + draw) / need, 0, 2);
    };
    const foodR = ratio("food"), waterR = ratio("water"), energyR = ratio("energy");
    const essential = clamp(Math.min(foodR, waterR), 0, 1);
    const energyStrain = cons.energy > 0.5 ? clamp(energyR, 0.4, 1) : 1;
    const housing = prod.population;
    let servedHousing = 0;
    for (const b of s.buildings) {
      b.served = clamp(s.districts[districtOf(b.c, b.r)].access, 0, 1);
      servedHousing += (b.flowOutput.population || 0) * b.served;
    }
    const accessR = housing ? servedHousing / housing : 1;
    const supply = essential * (0.6 + 0.4 * energyStrain) * accessR;
    const trustK = 0.92 + 0.16 * ((r.trust || 0) / 100);
    const targetPop = housing * supply * trustK;
    r.population += (targetPop - r.population) * 0.25;
    const pop = r.population;
    this.peakPop = Math.max(this.peakPop, pop);

    // Les ventes et impôts suivent les ménages réellement installés et servis.
    // Les dépenses restent dues même lorsqu'un équipement est sous-utilisé.
    const occupancy = clamp(pop / Math.max(1, housing), 0, 1);
    const servedOccupancy = clamp(pop / Math.max(1, servedHousing), 0, 1);
    const customers = clamp(pop / 36, 0, 1);
    for (const b of s.buildings) {
      const p = this.profileOf(b);
      const sales = b.flowOutput.money || 0;
      b.occupancy = p.outputs?.population ? servedOccupancy * b.served : 0;
      const incomeFlow = sales * essential * (p.outputs?.population ? b.occupancy : b.served * customers);
      b.income = incomeFlow * 0.6;
      prod.money += incomeFlow;
    }
    s.flowNet = {
      food: prod.food - cons.food, water: prod.water - cons.water, energy: prod.energy - cons.energy,
      materials: prod.materials - cons.materials, money: prod.money - cons.money,
    };
    for (const key of ["food", "water", "energy"]) r[key] = clamp((r[key] || 0) + s.flowNet[key] * 0.5, 0, stockCap);
    this.storeDistrictSurpluses(stockCap);
    r.materials = clamp((r.materials || 0) + s.flowNet.materials * 0.5, 0, 400);
    r.money = clamp(r.money + s.flowNet.money * 0.6, -300, 999999);
    s.economy = { income: prod.money, expenses: cons.money, upkeep, balance: s.flowNet.money, occupancy,
      cashIncome: prod.money * 0.6, cashExpenses: cons.money * 0.6, cashBalance: s.flowNet.money * 0.6 };

    const goodsFlow = this.countTag("high_output") + this.countTag("storage") * 0.5;
    let capacity = (s.transportNetworks || []).reduce((sum, network) => sum + network.capacity, 0);
    for (const b of s.buildings) {
      const p = this.profileOf(b);
      if (!b.disabled && !p.road && b.def.id !== "tram") capacity += (p.ext?.capacity || 0) * b.activity;
    }
    const flowDemand = Math.max(0, pop * 0.03 + goodsFlow * 2.2);
    const congestionPressure = Math.max(0, flowDemand - capacity * 0.7);
    totalCong += congestionPressure;
    let totalMaint = s.districts.reduce((sum, d) => sum + d.remainingMaintenance, 0);
    const repair = Math.max(0, Math.min((r.materials || 0) * 0.06, totalMaint * 0.5));
    totalMaint -= repair; r.materials -= repair;
    let fieldHeat = 0;
    for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) fieldHeat += this.heatField[rr][cc];
    r.heat = clamp(r.heat * 0.85 + fieldHeat * 0.35 * 0.5, 0, 200);
    r.maintenance = clamp(r.maintenance * 0.88 + totalMaint * 0.5, 0, 200);
    r.congestion = clamp(r.congestion * 0.72 + totalCong * 0.5, 0, 200);
    r.trust = clamp(r.trust + prod.trust * 0.1 - (r.congestion > 12 ? 0.4 : 0) - (r.heat > 40 ? 0.3 : 0) + (supply > 0.95 ? 0.1 : -0.3), 0, 100);
    s.flow = { ...prod, population: housing };
    s.supply = supply; s.ratios = { foodR, waterR, energyR, accessR };

    const greenN = this.countTag("green");
    const survivalPressure = clamp(Math.max(0, 1 - foodR) * 0.9 + Math.max(0, 1 - waterR) * 0.9
      + Math.max(0, 1 - accessR) * 0.4 + (cons.energy > 0.5 ? Math.max(0, 1 - energyR) * 0.7 : 0)
      + (pop < 25 ? 0.4 : 0) + 0.15, 0, 1.5);
    const productionPressure = clamp(0.25 + this.countTag("industrial") * 0.22 + Math.min(r.materials / 50, 0.4) + Math.min(pop / 250, 0.5), 0, 1.5);
    const logisticsPressure = clamp(pop * 0.0022 + this.countTag("centralized") * 0.12 + this.centralizationRatio() * 0.6
      + (r.congestion > 14 ? 0.35 : 0) + congestionPressure * 0.05 + (1 - accessR) * 0.4, 0, 1.6);
    const hotResidential = s.buildings.filter(b => this.profileOf(b).tags.includes("residential") && b.localHeat > 2.5).length;
    const maintHeatPressure = clamp(r.heat * 0.011 + r.maintenance * 0.011 + this.density() * 0.4 + this.countTag("high_heat") * 0.08 - greenN * 0.06, 0, 1.6);
    s.regimePrev = { ...s.regime };
    const lerp = (a, b, t) => a + (b - a) * t;
    s.regime.survival = lerp(s.regime.survival, Math.max(0.15, survivalPressure), 0.08);
    s.regime.production = lerp(s.regime.production, productionPressure, 0.08);
    s.regime.logistics = lerp(s.regime.logistics, logisticsPressure, 0.06);
    s.regime.maintenance_heat = lerp(s.regime.maintenance_heat, maintHeatPressure, 0.05);
    this.maxMaintRegime = Math.max(this.maxMaintRegime, s.regime.maintenance_heat);
    s.metrics = { congestionPressure, maintHeatPressure, hotResidential, foodR, waterR, energyR, accessR };
    this.progressPhases(pop, hotResidential, congestionPressure, maintHeatPressure);
    this.updateAdvisors(s.metrics);
    this.checkEndStates(pop, foodR, waterR);
    s.tick++;
    if (s.tick % 6 === 0) { s.year++; s.season = (s.season + 1) % 4; }
  }

  transportNetworks() {
    const paths = new Map(), seen = new Set(), networks = [];
    for (const b of this.state.buildings) {
      const p = this.profileOf(b);
      if (!b.disabled && (p.road || b.def.id === "tram")) paths.set(`${b.c},${b.r}`, b);
    }
    for (const [key, first] of paths) {
      if (seen.has(key)) continue;
      const tram = first.def.id === "tram", nodes = [], queue = [first], touching = new Set();
      seen.add(key);
      for (let i = 0; i < queue.length; i++) {
        const b = queue[i]; nodes.push(b);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = b.c + dc, r = b.r + dr, k = `${c},${r}`, next = paths.get(k);
          if (next && (next.def.id === "tram") === tram && !seen.has(k)) { seen.add(k); queue.push(next); }
          const neighbour = this.occ[r]?.[c];
          if (neighbour && !neighbour.disabled && !paths.has(k)) {
            const p = this.profileOf(neighbour), out = p.outputs || {};
            if (out.food || out.water || out.population || p.ext?.distribution) touching.add(neighbour);
          }
        }
      }
      if (nodes.length < 2 || touching.size < 2) continue;
      const districts = [...new Set([...touching].map(b => districtOf(b.c, b.r)))];
      const capacity = Math.min(...nodes.map(b => this.profileOf(b).ext?.capacity || 0.5)) * Math.sqrt(nodes.length) * 3;
      networks.push({ districts, capacity, nodes: nodes.map(b => ({ c: b.c, r: b.r })) });
    }
    return networks;
  }

  computeDistricts() {
    const districts = Array.from({ length: 4 }, (_, id) => ({
      name: DISTRICT_NAMES[id], pop: 0, foodOut: 0, waterOut: 0, distribution: 0, demand: 0, count: 0,
      foodNeed: 0, waterNeed: 0, foodUse: 0, waterUse: 0,
      foodImports: 0, waterImports: 0, foodExports: 0, waterExports: 0,
      hasLocalFood: false, hasMarket: false, heat: 0, networkCapacity: 0,
      maintenanceNeed: 0, maintenanceCapacity: 0, maintenanceCovered: 1, remainingMaintenance: 0,
    }));
    for (const b of this.state.buildings) {
      const d = districts[districtOf(b.c, b.r)], p = this.profileOf(b), out = p.outputs || {}, inp = p.inputs || {};
      d.count++;
      if (b.disabled) continue;
      const activity = b.activity ?? 1;
      const produced = b.flowOutput || out;
      d.pop += out.population || 0;
      d.demand += out.population || 0;
      d.foodOut += produced.food || 0; d.waterOut += produced.water || 0;
      d.foodNeed += out.population ? (inp.food || 0) : (b.flowInput?.food ?? inp.food ?? 0);
      d.waterNeed += out.population ? (inp.water || 0) : (b.flowInput?.water ?? inp.water ?? 0);
      d.foodUse += b.flowInput?.food ?? inp.food ?? 0;
      d.waterUse += b.flowInput?.water ?? inp.water ?? 0;
      d.distribution += (p.ext?.distribution || 0) * activity;
      d.hasLocalFood ||= !!produced.food;
      d.hasMarket ||= !!p.ext?.distribution;
      d.heat += this.localHeatAt(b.c, b.r);
      d.maintenanceNeed += b.grossMaintenance || 0;
      d.maintenanceCapacity += Math.max(0, -(p.ext?.maintenance || 0)) * activity;
    }
    const networks = this.transportNetworks();
    this.state.transportNetworks = networks;
    for (const network of networks) for (const id of network.districts) districts[id].networkCapacity += network.capacity;
    // Importer déplace un surplus disponible ; il n'est jamais compté deux fois,
    // même si deux routes relient les mêmes quartiers.
    for (const network of networks) {
      let remaining = network.capacity;
      for (const resource of ["food", "water"]) {
        const available = d => d[resource + "Out"] + d[resource + "Imports"] - d[resource + "Exports"];
        const destinations = network.districts.map(id => districts[id]).sort((a, b) =>
          available(a) / Math.max(1, a[resource + "Need"]) - available(b) / Math.max(1, b[resource + "Need"]));
        for (const destination of destinations) for (const id of network.districts) {
          const source = districts[id];
          if (source === destination || remaining <= 0) continue;
          const surplus = Math.max(0, available(source) - source[resource + "Need"]);
          const deficit = Math.max(0, destination[resource + "Need"] - available(destination));
          const sent = Math.min(surplus, deficit, remaining);
          source[resource + "Exports"] += sent; destination[resource + "Imports"] += sent; remaining -= sent;
        }
      }
    }
    for (const [id, d] of districts.entries()) {
      d.distributionCapacity = 36 + d.distribution * 8 + d.networkCapacity * 8;
      d.distributionEfficiency = clamp(d.distributionCapacity / Math.max(36, d.demand), 0.2, 1);
      for (const key of ["food", "water"]) {
        const delivered = d[key + "Out"] + d[key + "Imports"] - d[key + "Exports"];
        const stored = this.localStocks[id][key];
        d[key + "Stored"] = stored;
        const accessible = delivered + Math.min(stored, Math.max(0, d[key + "Need"] - delivered));
        d[key + "Coverage"] = d[key + "Need"] ? accessible / d[key + "Need"] : 1.5;
      }
      d.access = clamp(Math.min(1, d.foodCoverage, d.waterCoverage) * d.distributionEfficiency, 0, 1);
      d.maintenanceCovered = d.maintenanceNeed ? clamp(d.maintenanceCapacity / d.maintenanceNeed, 0, 1) : 1;
      d.remainingMaintenance = Math.max(0, d.maintenanceNeed - d.maintenanceCapacity);
    }
    this.state.districts = districts;
  }

  storeDistrictSurpluses(stockCap) {
    // Les greniers de quartier amortissent une panne courte, mais ne livrent
    // jamais une autre rive sans liaison. Leur somme reste bornée par le stock
    // réellement affiché : pas de duplication entre tampon global et local.
    for (const key of ["food", "water"]) {
      for (const [id, d] of this.state.districts.entries()) {
        const flow = d[key + "Out"] + d[key + "Imports"] - d[key + "Exports"] - d[key + "Use"];
        this.localStocks[id][key] = clamp(this.localStocks[id][key] + flow * 0.5, 0, stockCap);
      }
      const total = this.localStocks.reduce((sum, stock) => sum + stock[key], 0);
      const factor = total > this.state.res[key] && total > 0 ? this.state.res[key] / total : 1;
      for (const [id, stock] of this.localStocks.entries()) {
        stock[key] *= factor;
        this.state.districts[id][key + "Stored"] = stock[key];
      }
    }
  }

  worstDistrict() {
    let worst = null;
    for (const dd of this.state.districts) {
      if (dd.demand < 6) continue;                       // ignore les quartiers quasi vides
      if (!worst || dd.access < worst.access) worst = dd;
    }
    return worst;
  }

  /* ---- phases & crises (signaux SOUTENUS, jamais un pic d'un tick — spec §15) ---- */
  progressPhases(pop, hotResidential, congestionPressure, maintHeatPressure) {
    const s = this.state;
    if (s.phase === 1 && pop >= 35) this.enterPhase(2);

    if (s.phase >= 2 && !s.events.logisticsFired) {
      if (s.res.congestion > 12 || congestionPressure > 2.5 || (s.ratios.accessR ?? 1) < 0.75) this.logiSustain++; else this.logiSustain = Math.max(0, this.logiSustain - 1);
      if (this.logiSustain >= 4) this.fireLogisticsCrisis();
    }
    if (s.phase >= 2 && !s.events.heatFired && s.tick > 30) {
      const hot = (s.res.heat > 22 && maintHeatPressure > 0.8);
      const localBonus = (hotResidential >= 1 || this.heatedTilesGE(2));
      if (hot && (localBonus || maintHeatPressure > 1.0)) this.heatSustain++; else this.heatSustain = Math.max(0, this.heatSustain - 1);
      if (this.heatSustain >= 3) this.fireHeatCrisis();
    }
    // ville sobre : si la crise chaleur n'arrive jamais (peu d'industrie, verdure),
    // l'ingénierie tardive se débloque quand même avec la maturité — sinon une
    // ville verte reste en limbo à vie, sans accès aux bâtiments exigés par la
    // victoire ("on ne punit pas le bon jeu", spec §19).
    // Une ville mixte bien refroidie peut aussi mûrir sans crise. La prévention
    // se mesure par son état réel, pas par l'interdiction d'une famille de bâtiments.
    if (s.phase >= 2 && s.phase < 4 && !s.events.heatFired && pop >= 100
        && s.res.heat < 15 && (s.ratios.accessR ?? 0) >= 0.8
        && (s.ratios.foodR ?? 0) >= 0.85 && (s.ratios.waterR ?? 0) >= 0.85) {
      this.calmSustain++;
      if (this.calmSustain >= 12) {
        s.phase = 4;
        const calmUnlocks = ["maint_center", "greenhouse", "recycler"];
        if (!s.events.logisticsFired) calmUnlocks.push("depot", "tram");
        this.unlock(calmUnlocks);
        this.advisor("City planner", "Your city has matured without overheating. Maintenance, greenhouses and recycling are now available — resilience can grow without a crisis.", "");
        this.report("calm", "Year " + s.year + " — Urban maturity",
          "No heat wave this time: your city grew while keeping heat under control. Advanced maintenance, greenhouses and recycling are now available. Age will still bring wear, so prepare for it.");
      }
    } else this.calmSustain = Math.max(0, this.calmSustain - 1);
    // 3e événement : pannes en chaîne (entropie + centralisation soutenues) — spec §15 évén.3
    if (s.events.heatFired && !s.events.maintFired) {
      const fragile = (s.res.maintenance > 35 && this.centralizationRatio() > 0.5);
      if (fragile) this.maintSustain++; else this.maintSustain = Math.max(0, this.maintSustain - 1);
      if (this.maintSustain >= 4) this.fireMaintenanceCascade();
    }
  }
  enterPhase(p) {
    const s = this.state;
    s.phase = p;
    if (p === 2) {
      this.unlock(["road", "generator", "factory", "warehouse", "water_plant", "tower"]);
      this.advisor("City planner", "Your city is viable. You can now build power plants, factories, warehouses and apartment buildings. Producing more will bring new kinds of problems.", "");
      this.report("p2", "Year " + s.year + " — Foundations established",
        "Your village has its foundations: water, food, energy and homes. You are entering the industrial era. Remember: every solution you build will change the problems you face next.");
    }
  }
  fireLogisticsCrisis() {
    const s = this.state;
    s.events.logisticsFired = true;
    s.phase = Math.max(s.phase, 3);
    this.unlock(["depot", "tram"]);
    this.advisor("Logistics adviser", "Growth is putting distribution under pressure. Check water, food and delivery capacity in every inhabited district.", "warn");
    this.toast("Logistics crisis: producing goods is not the same as delivering them.");
    this.report("logi", "Year " + s.year + " — Logistics revealed",
      "The city is growing faster than its distribution system. Local farms and wells meet nearby needs; markets and depots serve dense districts. A continuous path or road can also bring in a neighboring district's surplus. The city's older buildings matter again.");
    s.res.congestion += 15;
    this.crisisLog.push({ type: "logistics", tick: s.tick, popAt: s.res.population });
  }
  fireHeatCrisis() {
    const s = this.state;
    s.events.heatFired = true;
    if (s.phase < 4) s.phase = 4;
    const heatUnlocks = ["maint_center", "greenhouse", "recycler"];
    if (!s.events.logisticsFired) heatUnlocks.push("depot", "tram");
    this.unlock(heatUnlocks);
    this.advisor("Public health adviser", "Heat wave. Dense districts without parks suffer most. Heat is more than a number: it is a local side effect of industry.", "bad");
    this.toast("Heat wave: older green buildings are gaining value again.");
    this.report("heat", "Year " + s.year + " — Heat and maintenance revealed",
      "Your city faces more than resource shortages: heat and wear are building up. Green districts cope better. Parks and wells provide cooling; greenhouses use industrial heat. Old workshops can be converted to maintain their district.");
    s.res.heat += 20;
    this.crisisLog.push({ type: "heat", tick: s.tick, popAt: s.res.population });
  }
  fireMaintenanceCascade() {
    const s = this.state;
    s.events.maintFired = true;
    // panne temporaire : on désactive le hub centralisé LE PLUS SOUS PRESSION
    // (congestion locale + poids de centralisation), pas le premier posé.
    let hub = null, hubScore = -1;
    for (const b of this.state.buildings) {
      if (!b.def.tags.includes("centralized")) continue;
      if (b.def.id !== "generator" && b.def.id !== "warehouse" && b.def.id !== "water_plant") continue;
      const score = this.localCongAt(b.c, b.r) + (b.def.ext?.centralization || 0);
      if (score > hubScore) { hubScore = score; hub = b; }
    }
    if (hub) { hub.disabled = true; hub._reenableAt = s.tick + 5; }
    this.advisor("Civil engineer", "Cascading failures. A city without backup systems is fragile: a central hub has failed, disrupting what depends on it. Local workshops, wells and depots help absorb this kind of shock.", "bad");
    this.toast("Cascading failures: local backup systems could have softened the impact.");
    this.report("maint", "Year " + s.year + " — Cascading failures",
      "Dependence on a central hub and a lack of backup systems have amplified an outage. Repairable, decentralized buildings — workshops, wells and depots — are your safety net.");
    // (pas de réduction d'usure ici : la crise est one-shot via events.maintFired,
    // et une panne qui "répare" son propre déclencheur n'a pas de sens)
    this.crisisLog.push({ type: "maintenance", tick: s.tick, popAt: s.res.population });
  }
  // ré-active les hubs tombés (appelé en début de tick via age, mais on le fait ici simple)
  reenableHubs() {
    for (const b of this.state.buildings) if (b.disabled && b._reenableAt && this.state.tick >= b._reenableAt) { b.disabled = false; b._reenableAt = null; }
  }

  unlock(ids) {
    for (const id of ids) if (!this.state.unlocked.has(id)) { this.state.unlocked.add(id); this.state.newlyUnlocked.push(id); }
  }

  /* ---- conseillers (templates déterministes, langage naturel — spec §14) ---- */
  advisor(who, text, kind) {
    if (this.state.advisorCards[0] && this.state.advisorCards[0].text === text) return;
    this.state.advisorCards.unshift({ who, text, kind });
    if (this.state.advisorCards.length > 3) this.state.advisorCards.pop();
  }
  toast(t) { this.state.toasts.push(t); }
  report(id, title, body) { if (!this.state.reportsShown.has(id)) { this.state.reports.push({ id, title, body }); this.state.reportsShown.add(id); } }

  updateAdvisors(m) {
    if (this.advisorCooldown > 0) { this.advisorCooldown--; return; }
    const s = this.state, R = s.ratios || {};
    if (R.energyR !== undefined && R.energyR < 0.6 && s.res.population > 5) { this.advisor("Civil engineer", "Energy is running short: your apartment buildings and factories use more than you produce. Build a power plant or scale back industry.", "bad"); this.advisorCooldown = 5; return; }
    if (R.waterR !== undefined && R.waterR < 0.7) { this.advisor("Civil engineer", "Water supply does not cover demand. Add wells in underserved districts, or a water treatment plant if you have enough energy.", "warn"); this.advisorCooldown = 5; return; }
    if (R.foodR !== undefined && R.foodR < 0.7) { this.advisor("Logistics adviser", "Food is running short. Add farms with a water supply, or a continuous link to a district that produces a surplus.", "warn"); this.advisorCooldown = 5; return; }
    if (s.res.money < 0) { this.advisor("City planner", "Spending exceeds income. Occupied, well-served homes fund services; empty and underused buildings still have upkeep costs.", "bad"); this.advisorCooldown = 6; return; }
    if (s.phase === 2 && m.congestionPressure > 1.5 && m.congestionPressure <= 3 && !s.events.logisticsFired) { this.advisor("Logistics adviser", "Some deliveries are starting to arrive late. Your main routes are getting busy.", "warn"); this.advisorCooldown = 4; return; }
    if (s.phase >= 2 && s.res.heat > 18 && s.res.heat <= 30 && !s.events.heatFired) { this.advisor("Civil engineer", "The industrial district is hotter than the rest of the city. Watch dense areas with little green space.", "warn"); this.advisorCooldown = 4; return; }
    if (s.regime.logistics > 0.8 && this.countTag("decentralized") >= 2) { this.advisor("City planner", "Your local markets and depots make deliveries more resilient, even when they bring in little income on their own.", ""); this.advisorCooldown = 8; }
  }

  /* ---- explication causale (spec §23) : pourquoi le problème principal arrive ---- */
  explain() {
    const s = this.state, R = s.ratios || {}, causes = [], helpful = [], actions = [];
    let problem = "The city is stable.";
    const worst = this.worstDistrict();
    if (R.waterR < 0.85) { problem = "Water shortage."; causes.push(`water supply covers ${Math.round((R.waterR||0)*100)}% of demand`); actions.push("add resilient wells or a water treatment plant"); }
    else if (R.foodR < 0.85) { problem = "Food shortage."; causes.push(`food supply covers ${Math.round((R.foodR||0)*100)}% of demand`); actions.push("farms on fertile land", "connect to a district with surplus food"); }
    else if (R.energyR < 0.8 && s.flow && this.countTag("industrial") > 0) { problem = "Energy supply under strain."; causes.push("industry uses more energy than the city produces"); actions.push("thermal power plant, which adds heat", "scale back industry"); }
    else if (s.res.congestion > 14 || (worst && worst.access < 0.7)) {
      problem = worst ? `Unreliable distribution in the ${worst.name}.` : "Logistics congestion.";
      if (worst) {
        causes.push(`${worst.name}: service covers ${Math.round(worst.access*100)}% of needs`);
        if (worst.foodCoverage < 1) { causes.push("not enough local or imported food"); actions.push("a farm in this district or a link to surplus food"); }
        if (worst.waterCoverage < 1) { causes.push("not enough local or imported water"); actions.push("a well in this district or a link to surplus water"); }
        if (worst.distributionEfficiency < 1) { causes.push(`distribution capacity for ${Math.round(worst.distributionCapacity)} of ${Math.round(worst.demand)} residents`); actions.push("a market or depot in this district", "a continuous network next to buildings"); }
      }
      if (s.res.congestion > 14) causes.push("deliveries exceed the capacity of links and depots");
      if (this.centralizationRatio() > 0.5) causes.push(`dependence on centralized infrastructure: ${Math.round(this.centralizationRatio()*100)}%`);
    }
    else if (s.res.heat > 30) { problem = "High urban heat."; causes.push("dense industry with little green space"); actions.push("parks for cooling", "a greenhouse to reuse heat", "move industry away from homes"); }
    else if (s.res.maintenance > 35) { problem = "Wear and risk of breakdowns."; causes.push("aging buildings and insufficient local maintenance"); actions.push("a maintenance center in the affected district", "convert an old workshop", "produce materials for repairs"); }

    // facteurs qui aident (les vieux bâtiments qui amortissent)
    const green = this.countTag("green");
    if (this.byId("well") > 0) helpful.push(`Wells providing backup water: ${this.byId("well")}`);
    if (this.byId("market") + this.byId("depot") > 0) helpful.push(`local markets and depots reduce shortages`);
    if (green > 0) helpful.push(`Green buildings helping limit heat: ${green}`);
    const repaired = s.buildings.filter(b => b.conversion && !b.disabled).length;
    if (repaired) helpful.push(`Converted workshops maintaining their district: ${repaired}`);
    if (this.byId("workshop") > repaired) helpful.push("production workshops supply materials for repairs");

    return { problem, causes, helpful, actions };
  }
  byId(id) { let n = 0; for (const b of this.state.buildings) if (b.def.id === id) n++; return n; }

  /* ---- victoire / défaite (spec §19-20) ---- */
  victoryProgress() {
    const s = this.state, r = s.res, ratios = s.ratios;
    const inhabited = s.districts.filter(d => d.demand >= 6);
    const worstAccess = inhabited.length ? Math.min(...inhabited.map(d => d.access)) : 0;
    const repairServices = s.buildings.filter(b => !b.disabled && (this.profileOf(b).ext?.maintenance || 0) < 0).length;
    const green = this.byId("park") + this.byId("greenhouse");
    const maintainedDistricts = inhabited.filter(d => d.maintenanceCapacity > 0).length;
    const resourceOk = (ratios.foodR ?? 0) >= 0.85 && (ratios.waterR ?? 0) >= 0.85 && (ratios.energyR ?? 1) >= 0.65
      && (s.flowNet.food ?? -1) >= -0.2 && (s.flowNet.water ?? -1) >= -0.2;
    const progress = [
      { key: "population", label: "Welcome 180 residents", met: r.population >= VICTORY_POP, detail: `${Math.round(r.population)} / ${VICTORY_POP} residents` },
      { key: "maturity", label: "Reach urban maturity", met: s.phase >= 4, detail: `Phase ${s.phase} / 4 · crises are not required` },
      { key: "resources", label: "Keep the city supplied", met: resourceOk, detail: "Sufficient food and water, no supply deficit, and enough energy for current needs" },
      { key: "distribution", label: "Serve every inhabited district", met: worstAccess >= 0.8 && r.congestion <= 12, detail: `Least-served district: ${Math.round(worstAccess * 100)}% / 80% · congestion ${Math.round(r.congestion)} / 12` },
      { key: "resilience", label: "Maintain the city and add green space", met: repairServices >= 2 && green >= 3 && maintainedDistricts === inhabited.length && r.maintenance <= 65,
        detail: `${repairServices} / 2 maintenance services · ${maintainedDistricts} / ${inhabited.length} districts maintained · ${green} / 3 parks or greenhouses · wear ${Math.round(r.maintenance)} / 65` },
      { key: "heat", label: "Keep heat under control", met: r.heat <= 80, detail: `Heat ${Math.round(r.heat)} / 80` },
      { key: "economy", label: "Fund city services", met: r.money >= 0 && (s.flowNet.money ?? 0) >= -0.2, detail: `Cash balance per turn: ${((s.flowNet.money ?? 0) * 0.6).toFixed(1)} €` },
    ];
    progress.push({ key: "stability", label: "Keep the city stable", met: this.victorySustain >= 8, detail: `${this.victorySustain} / 8 consecutive turns` });
    return progress;
  }

  checkEndStates(pop, foodR, waterR) {
    const s = this.state;
    if (s.res.money <= -250) this.bankruptTicks++; else this.bankruptTicks = Math.max(0, this.bankruptTicks - 2);
    const settled = pop > 10 || s.districts.reduce((sum, d) => sum + d.demand, 0) >= 30;
    if ((foodR < 0.5 || waterR < 0.5 || (s.ratios.accessR ?? 1) < 0.1) && settled) this.starveTicks++;
    else this.starveTicks = Math.max(0, this.starveTicks - 1);
    const collapse = this.peakPop > 60 && pop < this.peakPop * 0.3 && pop < 25;
    if (this.bankruptTicks > 18) return this.endGame("defeat", "Prolonged bankruptcy: city activities can no longer fund its services.");
    if (this.starveTicks > 16) return this.endGame("defeat", "Essential supply crisis: food or water is not reaching residents.");
    if (collapse) return this.endGame("defeat", "Population collapse: the city has lost most of its residents since its peak.");
    // Prévenir les crises est une réussite : aucune condition ne réclame d'avoir
    // laissé monter l'usure ou d'avoir subi une catastrophe avant de gagner.
    const ready = this.victoryProgress().filter(p => p.key !== "stability").every(p => p.met);
    this.victorySustain = ready ? this.victorySustain + 1 : 0;
    if (this.victorySustain >= 8) this.endGame("victory", `Population ${Math.round(pop)} reached: every district is served, the city is maintained and its services are funded.`);
  }
  endGame(outcome, reason) {
    if (this.state.outcome) return;
    this.state.outcome = outcome;
    this.state.outcomeInfo = { reason, trajectory: this.classifyCity(), year: this.state.year };
  }

  /* ---- classification de trajectoire (spec §19 : pas de "bonne" ville unique) ---- */
  classifyCity() {
    const ind = this.countTag("industrial"), cen = this.centralizationRatio(), green = this.countTag("green"),
          dec = this.countAnyTag(["decentralized", "redundant"]), money = this.state.res.money,
          total = Math.max(1, this.state.buildings.length), dens = this.density();
    let label, desc;
    if (cen > 0.45 && ind >= 3) { label = "Centralized industrial city"; desc = "Efficient and productive, but fragile: everything depends on a few hubs."; }
    else if (dec >= 5 && green >= 3) { label = "Resilient decentralized city"; desc = "Less optimized, but able to withstand crises without collapsing."; }
    else if (green / total > 0.35 && ind <= 2) { label = "Slow-growing green city"; desc = "Resource-conscious and resilient to heat, but with limited growth."; }
    else if (money > 1500 && dec < 3) { label = "Wealthy but fragile city"; desc = "Plenty of money, few backup systems: a crisis could overturn everything."; }
    else if (money < 200 && this.state.outcome !== "defeat") { label = "Modest but stable city"; desc = "Limited means, but a structure that holds together."; }
    else { label = "Balanced city"; desc = "A balance between production, distribution and resilience."; }
    return { label, desc, metrics: { industrial: ind, centralization: +cen.toFixed(2), green, decentralized: dec, density: +dens.toFixed(2) } };
  }
}
