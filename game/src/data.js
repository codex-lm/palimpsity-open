/* =====================================================================
   PALIMPSITY — DONNÉES (data-driven)
   ---------------------------------------------------------------------
   Tout le contenu du jeu vit ici : grille, terrain, catalogue de bâtiments,
   tags systémiques, régimes. Le moteur (engine.js) ne fait QUE lire ces
   structures — on peut ajouter un bâtiment, un tag ou un régime sans
   toucher au code de simulation (exigence "data-driven" de la spec §21).

   Un bâtiment n'est pas "input -> output". Il est :
     input -> output + externalités + tags + modificateurs de régime
   Les `mods` (regime_modifiers) sont LE cœur : ils disent combien un
   bâtiment "vaut" dans chaque régime. Un puits vaut peu en production,
   beaucoup en logistique/chaleur — c'est ce qui fait qu'un vieux bâtiment
   redevient pertinent (pilier 2 de la spec).
   ===================================================================== */

export const COLS = 16, ROWS = 12;

// 4 districts = quadrants. La géographie est réelle : la chaleur et la
// distribution sont LOCALES, donc "où" on construit compte.
export function districtOf(c, r) {
  const dx = c < COLS / 2 ? 0 : 1;
  const dy = r < ROWS / 2 ? 0 : 1;
  return dy * 2 + dx; // 0=NO 1=NE 2=SO 3=SE
}
export const DISTRICT_NAMES = [
  "northwest district", "northeast district",
  "southwest district", "southeast district",
];

// Terrain "La Vallée" (spec §28) : rivière, plaine fertile, colline minière, forêt.
// 0 plaine · 1 rivière (eau, refroidit) · 2 fertile (bonus ferme) · 3 colline (industrie) · 4 forêt
export function genTerrain() {
  const terrain = [];
  for (let r = 0; r < ROWS; r++) { terrain[r] = []; for (let c = 0; c < COLS; c++) terrain[r][c] = 0; }
  for (let c = 0; c < COLS; c++) {
    const r = Math.round(2 + Math.sin(c * 0.5) * 1.4 + c * 0.15);
    if (r >= 0 && r < ROWS) { terrain[r][c] = 1; if (r + 1 < ROWS && c % 3) terrain[r + 1][c] = 1; }
  }
  for (let r = ROWS - 5; r < ROWS; r++) for (let c = 0; c < 6; c++) if (terrain[r][c] === 0) terrain[r][c] = 2;
  for (let r = 0; r < 4; r++) for (let c = COLS - 5; c < COLS; c++) if (terrain[r][c] === 0) terrain[r][c] = 3;
  for (let r = ROWS - 4; r < ROWS; r++) for (let c = COLS - 5; c < COLS; c++) if (terrain[r][c] === 0) terrain[r][c] = 4;
  return terrain;
}

/* ---------------------------------------------------------------------
   RÉGIMES (MVP : 4 — l'architecture en accepte plus, spec §6)
   Chaque régime valorise certains tags (spec §10). Utilisé pour les
   explications causales et l'UI ; la VALEUR effective passe par `mods`.
   --------------------------------------------------------------------- */
export const REGIMES = ["survival", "production", "logistics", "maintenance_heat"];
export const REGIME_META = {
  survival:        { lbl: "Survival",      col: "#7fb35a", q: "Produce enough?" },
  production:      { lbl: "Production",   col: "#f0a35d", q: "Produce more?" },
  logistics:       { lbl: "Logistics",  col: "#5aa0c9", q: "Deliver everywhere?" },
  maintenance_heat:{ lbl: "Entropy",    col: "#cf7a5d", q: "Maintain and cool?" },
};
// Tags valorisés par régime (spec §10) — sert aux explications ("ce bâtiment
// est précieux ici parce qu'il est local + redondant").
export const REGIME_TAG_BONUS = {
  production:       ["industrial", "high_output", "centralized", "high_energy"],
  logistics:        ["local", "decentralized", "storage", "distribution", "redundant"],
  maintenance_heat: ["repairable", "green", "low_heat", "low_energy", "redundant", "cooling", "heat_reuse"],
  survival:         ["local", "low_energy", "repairable"],
};

/* ---------------------------------------------------------------------
   RESSOURCES
   Visibles dès le départ (spec §13) : 6. Cachées, révélées progressivement.
   --------------------------------------------------------------------- */
export const RES_VISIBLE = ["population", "money", "food", "water", "energy", "materials"];
export const RES_HIDDEN  = ["heat", "maintenance", "congestion", "trust"];
export const RES_META = {
  population: { lbl: "Pop.",      col: "#e6edf3" }, money:       { lbl: "€",        col: "#e3b341" },
  food:       { lbl: "Food",    col: "#7fb35a" }, water:       { lbl: "Water",      col: "#5aa0c9" },
  energy:     { lbl: "Energy",   col: "#f0a35d" }, materials:   { lbl: "Materials",     col: "#a98c6b" },
  heat:       { lbl: "Heat",   col: "#ff5a3c" }, maintenance: { lbl: "Wear",    col: "#c98fb3" },
  congestion: { lbl: "Congestion",  col: "#cf7a5d" }, trust:       { lbl: "Trust",col: "#4ec9a0" },
};

/* ---------------------------------------------------------------------
   CATALOGUE DE BÂTIMENTS (18) — data-driven
   Champs : id, name, color, cost, tags, inputs, outputs, ext (externalités),
   mods (regime_modifiers), desc (player_description), phase, flags.
   Les 14 premiers reprennent les valeurs CALIBRÉES du POC validé ; les 4
   derniers (workshop, path, water_plant, tram) complètent la liste spec §11.
   --------------------------------------------------------------------- */
export const BUILDINGS = {
  // === Phase 1 : fondation ===
  house: {
    id: "house", name: "House", color: "#c9a36b", cost: { money: 40 },
    tags: ["local", "low_energy", "repairable", "residential"],
    inputs: { food: 1, water: 1 }, outputs: { population: 6, workers: 3, money: 2 },
    ext: {},
    desc: "Homes for your residents. The foundation of the city, with low maintenance needs and little heat.",
    mods: { survival: 1.0, production: 1.0, logistics: 1.0, maintenance_heat: 1.0 },
    phase: 1,
  },
  well: {
    id: "well", name: "Well", color: "#5aa0c9", cost: { money: 30 },
    tags: ["local", "decentralized", "redundant", "low_energy", "repairable", "water"],
    inputs: {}, outputs: { water: 5 }, ext: { cooling: +1 },
    desc: "A local water source. Less efficient at scale, but more resilient than a central network when deliveries fail or infrastructure breaks down.",
    mods: { survival: 1.0, production: 0.6, logistics: 1.8, maintenance_heat: 1.5 },
    phase: 1,
  },
  farm: {
    id: "farm", name: "Farm", color: "#7fb35a", cost: { money: 50 },
    tags: ["local", "green", "low_energy", "repairable", "food"],
    inputs: { water: 2, workers: 1 }, outputs: { food: 8 }, ext: { ecology: +1 },
    desc: "Produces food with little heat and low reliance on logistics. More productive on fertile land.",
    mods: { survival: 1.0, production: 0.7, logistics: 1.3, maintenance_heat: 1.2 },
    phase: 1, prefer: [2],
  },
  workshop: {
    id: "workshop", name: "Workshop", color: "#b89b6a", cost: { money: 45 },
    tags: ["local", "repairable", "low_output", "human_scale"],
    inputs: { workers: 2 }, outputs: { materials: 4, money: 2 }, ext: {},
    desc: "Produces basic materials on a small scale. Modest output, but resilient when industrial supply chains become fragile or break down.",
    mods: { survival: 1.0, production: 0.6, logistics: 1.3, maintenance_heat: 1.7 },
    phase: 1,
  },
  market: {
    id: "market", name: "Local market", color: "#cf8fb3", cost: { money: 60 },
    tags: ["local", "social", "decentralized", "distribution", "redundant"],
    inputs: { food: 2, workers: 2 }, outputs: { money: 6, trust: 2 },
    ext: { distribution: +3, congestion: -3 },
    desc: "Distributes food and goods within its district. Supports dense districts, reduces local shortages and builds trust.",
    mods: { survival: 1.0, production: 0.55, logistics: 2.2, maintenance_heat: 1.1 },
    phase: 1,
  },
  path: {
    id: "path", name: "Path", color: "#9a8f7a", cost: { money: 8 },
    tags: ["local", "low_capacity", "low_maintenance", "distribution"],
    inputs: {}, outputs: {}, ext: { capacity: +0.5 },
    desc: "Connects nearby buildings. A continuous path carries surplus resources between districts; isolated pieces do not form a network.",
    mods: { survival: 1.0, production: 1.0, logistics: 1.0, maintenance_heat: 1.1 },
    phase: 1, road: true,
  },
  park: {
    id: "park", name: "Park", color: "#4ec9a0", cost: { money: 35 },
    tags: ["green", "low_heat", "social", "local", "cooling"],
    inputs: {}, outputs: { trust: 2 }, ext: { cooling: +8, ecology: +2 },
    desc: "Builds trust and cools dense districts. Easy to overlook early on, but essential when heat starts to rise.",
    mods: { survival: 0.9, production: 0.5, logistics: 1.1, maintenance_heat: 2.8 },
    phase: 1,
  },

  // === Phase 2 : croissance industrielle ===
  road: {
    id: "road", name: "Road", color: "#5a6472", cost: { money: 15 },
    tags: ["distribution", "medium_capacity", "maintenance"],
    inputs: {}, outputs: {}, ext: { capacity: +1 },
    desc: "Increases transport capacity. Heavy use can still cause congestion, and roads need maintenance.",
    mods: { survival: 1.0, production: 1.1, logistics: 1.0, maintenance_heat: 1.0 },
    phase: 2, road: true,
  },
  generator: {
    id: "generator", name: "Thermal power plant", color: "#b8593e", cost: { money: 120 },
    tags: ["industrial", "high_heat", "high_energy", "centralized"],
    inputs: {}, outputs: { energy: 30 }, ext: { heat: +8, centralization: +3 },
    desc: "Solves your energy shortage, but adds heat and dependence on centralized infrastructure. Today's solution becomes tomorrow's constraint.",
    mods: { survival: 1.0, production: 1.4, logistics: 0.9, maintenance_heat: 0.3 },
    phase: 2, smoke: true,
  },
  factory: {
    id: "factory", name: "Factory", color: "#8a7a52", cost: { money: 140 },
    tags: ["industrial", "high_output", "high_energy", "high_heat", "maintenance"],
    inputs: { energy: 8, workers: 5, water: 2 }, outputs: { materials: 14, money: 8 },
    ext: { heat: +5, congestion: +3, maintenance: +3 },
    desc: "Produces materials in bulk. Speeds up growth, but increases heat, maintenance needs and pressure on logistics.",
    mods: { survival: 0.9, production: 1.5, logistics: 0.7, maintenance_heat: 0.4 },
    phase: 2, smoke: true, prefer: [3],
  },
  warehouse: {
    id: "warehouse", name: "Central warehouse", color: "#6b7b8a", cost: { money: 90 },
    tags: ["centralized", "storage", "efficient", "fragile", "distribution"],
    inputs: { workers: 2 }, outputs: {}, ext: { capacity: +4, distribution: +5, centralization: +4, congestion: +2 },
    desc: "Stores and distributes goods. Efficient during early industrial growth, but creates dependence on a single vulnerable hub.",
    mods: { survival: 1.0, production: 1.3, logistics: 0.7, maintenance_heat: 1.0 },
    phase: 2,
  },
  water_plant: {
    id: "water_plant", name: "Water treatment plant", color: "#4a8fb0", cost: { money: 100 },
    tags: ["infrastructure", "maintenance", "centralized", "high_capacity"],
    inputs: { energy: 4, workers: 3 }, outputs: { water: 22 }, ext: { pollution: -2, centralization: +2 },
    desc: "Supplies water efficiently at scale, but relies on energy and central infrastructure. Old wells become vital again during outages and crises.",
    mods: { survival: 1.0, production: 1.1, logistics: 0.7, maintenance_heat: 0.7 },
    phase: 2,
  },
  tower: {
    id: "tower", name: "Apartment building", color: "#a98c6b", cost: { money: 110 },
    tags: ["dense", "centralized", "maintenance", "high_capacity", "residential"],
    inputs: { food: 3, water: 3, energy: 4 }, outputs: { population: 24, workers: 12, money: 6 },
    ext: { heat: +3, congestion: +2, density: +4, maintenance: +2 },
    desc: "Houses many residents in a small space, but adds heat, local demand and pressure on services.",
    mods: { survival: 0.9, production: 1.1, logistics: 0.8, maintenance_heat: 0.6 },
    phase: 2,
  },

  // === Phase 3 : révélation logistique ===
  depot: {
    id: "depot", name: "Local depot", color: "#7a93a8", cost: { money: 55 },
    tags: ["decentralized", "storage", "redundant", "distribution", "local"],
    inputs: { workers: 1 }, outputs: {}, ext: { capacity: +3, distribution: +3, congestion: -5 },
    desc: "District storage. Less efficient than a central warehouse, but reduces local shortages and helps the district withstand logistics crises.",
    mods: { survival: 1.0, production: 0.7, logistics: 2.0, maintenance_heat: 1.1 },
    phase: 3,
  },
  tram: {
    id: "tram", name: "Tram", color: "#cf9d5d", cost: { money: 95 },
    tags: ["distribution", "medium_energy", "social", "reduces_congestion"],
    inputs: { energy: 3, workers: 2 }, outputs: { trust: 1 }, ext: { capacity: +3, congestion: -6 },
    desc: "Carries residents and workers. Reduces congestion and improves access to services, at the cost of energy and maintenance.",
    mods: { survival: 0.9, production: 0.9, logistics: 1.9, maintenance_heat: 1.1 },
    phase: 3,
  },

  // === Phase 4 : révélation maintenance / chaleur ===
  maint_center: {
    id: "maint_center", name: "Maintenance center", color: "#9a7ec9", cost: { money: 80 },
    tags: ["maintenance", "repairable", "local_service"],
    inputs: { workers: 3, money: 4 }, outputs: { trust: 2 }, ext: { maintenance: -10 },
    desc: "Reduces wear and breakdowns in its district. Turns money and labor into reliability as the city ages.",
    mods: { survival: 1.0, production: 0.8, logistics: 1.0, maintenance_heat: 1.8 },
    phase: 4,
  },
  greenhouse: {
    id: "greenhouse", name: "Heated greenhouse", color: "#5fc97f", cost: { money: 75 },
    tags: ["green", "heat_reuse", "food", "local", "cooling"],
    // PAS d'ext heat/cooling : la serre refroidit en CONSOMMANT la chaleur ambiante
    // (prélevée du champ dans recomputeFields, APRÈS mesure de son carburant —
    // sinon elle éteint elle-même la chaleur dont elle vit et ne produit jamais).
    inputs: { workers: 2, heat: 4 }, outputs: { food: 12 }, ext: {},
    desc: "Produces food using local heat. Turns an unwanted side effect into a useful resource — the central idea of Palimpsity.",
    mods: { survival: 1.0, production: 1.0, logistics: 1.2, maintenance_heat: 2.4 },
    phase: 4, needsHeat: true,
  },
  recycler: {
    id: "recycler", name: "Recycling center", color: "#5fb0c9", cost: { money: 85 },
    tags: ["green", "circular", "maintenance", "industrial_light"],
    inputs: { workers: 3 }, outputs: { materials: 8 }, ext: {},
    desc: "Produces recovered materials. Light industry that gains value as entropy rises. Pollution is not yet a simulated resource.",
    mods: { survival: 1.0, production: 1.0, logistics: 1.1, maintenance_heat: 1.6 },
    phase: 4,
  },
};

// Ordre d'affichage dans la palette.
export const ORDER = [
  "house", "well", "farm", "workshop", "market", "path", "park",
  "road", "generator", "factory", "warehouse", "water_plant", "tower",
  "depot", "tram", "maint_center", "greenhouse", "recycler",
];

// Débloqués dès le départ (phase 1).
export const INITIAL_UNLOCKED = ["house", "well", "farm", "workshop", "market", "path", "park"];

// Charges par tour : les logements occupés financent les services. Une ville
// vide ne gagne plus de l'argent simplement parce que ses maisons existent.
export const UPKEEP = {
  house: 0.25, well: 0.15, farm: 0.3, workshop: 0.4, market: 0.4,
  path: 0.015, park: 0.15, road: 0.035, generator: 2.5, factory: 2.3,
  warehouse: 1.2, water_plant: 1.4, tower: 1.5, depot: 0.6, tram: 1,
  maint_center: 0, greenhouse: 0.5, recycler: 0.6,
};

// Une reconversion conserve le bâtiment et son modèle 3D. Son profil effectif
// est propre à l'instance ; BUILDINGS n'est jamais modifié en cours de partie.
export const BUILDING_CONVERSIONS = {
  workshop_repair: {
    id: "workshop_repair", source: "workshop", name: "Maintenance workshop",
    desc: "Repurposes an old workshop to maintain its district, replacing its material production and sales revenue.",
    phase: 3, minAge: 24, cost: { money: 65, materials: 20 },
    profile: {
      ...BUILDINGS.workshop, name: "Maintenance workshop",
      tags: ["local", "repairable", "maintenance", "local_service", "reconverted"],
      inputs: { workers: 2, money: 1 }, outputs: { trust: 1 },
      ext: { maintenance: -6 },
      desc: "This old workshop now maintains its district. It no longer produces materials or sales revenue.",
    },
  },
};
