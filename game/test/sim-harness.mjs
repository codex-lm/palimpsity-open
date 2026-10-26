/* =====================================================================
   HARNAIS HEADLESS — preuve du mécanisme central (sans rendu)
   ---------------------------------------------------------------------
   Lancer :  node test/sim-harness.mjs
   But : démontrer, en chiffres, que
     1) le vecteur de régime ÉVOLUE au cours de la partie (pas statique) ;
     2) un VIEUX bâtiment (puits, parc, marché) reprend de la valeur quand
        son régime monte — c'est le cœur "palimpseste" ;
     3) une ville INDUSTRIELLE CENTRALISÉE et une ville DISTRIBUÉE
        RÉSILIENTE divergent : chaleur, congestion, usure, confiance,
        et issue des crises dépendent de la STRUCTURE, pas du hasard.
   Sort un PASS/FAIL global.
   ===================================================================== */

import { CityEngine } from "../src/engine.js";
import { playSober, playIndustrial, summary } from "./playthrough-helpers.mjs";
import { BUILDINGS, COLS, ROWS } from "../src/data.js";

const fmt = (n, d = 2) => Number(n).toFixed(d);
const bar = (v, max, w = 16) => { const n = Math.round(clamp(v / max, 0, 1) * w); return "█".repeat(n) + "·".repeat(w - n); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let PASS = true;
const check = (label, cond) => { console.log(`   ${cond ? "✅" : "❌"} ${label}`); if (!cond) PASS = false; };

/* ---------- util : poser N bâtiments sur des cases libres d'une zone ---------- */
function buildArea(eng, id, n, { x0 = 0, x1 = COLS, y0 = 0, y1 = ROWS } = {}) {
  let placed = 0;
  for (let r = y0; r < y1 && placed < n; r++) {
    for (let c = x0; c < x1 && placed < n; c++) {
      if (eng.terrain[r][c] === 1) continue;       // rivière
      if (eng.occ[r][c]) continue;
      eng.place(id, c, r);
      if (eng.occ[r][c]) placed++;
    }
  }
  return placed;
}
function unlockAll(eng) { for (const id of Object.keys(BUILDINGS)) eng.state.unlocked.add(id); eng.state.res.money = 1e7; }
function run(eng, ticks) { for (let i = 0; i < ticks; i++) eng.tick(); }

/* ====================================================================
   1) DÉMONSTRATION STATIQUE : la valeur d'un bâtiment dépend du régime
   ==================================================================== */
console.log("\n=== 1. Un même bâtiment, des valeurs différentes selon le régime ===\n");
{
  const eng = new CityEngine();
  const sample = ["well", "market", "park", "farm", "workshop", "generator", "factory", "warehouse"];
  const scenarios = {
    "Survie":     { survival: 1.3, production: 0.2, logistics: 0.1, maintenance_heat: 0.1 },
    "Production": { survival: 0.2, production: 1.4, logistics: 0.3, maintenance_heat: 0.1 },
    "Logistique": { survival: 0.2, production: 0.4, logistics: 1.5, maintenance_heat: 0.3 },
    "Entropie":   { survival: 0.2, production: 0.3, logistics: 0.4, maintenance_heat: 1.5 },
  };
  const head = "bâtiment".padEnd(12) + Object.keys(scenarios).map(s => s.padStart(11)).join("");
  console.log("   " + head);
  const valOf = {};
  for (const id of sample) {
    let line = id.padEnd(12);
    valOf[id] = {};
    for (const [name, reg] of Object.entries(scenarios)) {
      eng.state.regime = reg;
      const v = eng.buildingValue({ def: BUILDINGS[id] });
      valOf[id][name] = v;
      line += fmt(v).padStart(11);
    }
    console.log("   " + line);
  }
  console.log("");
  check("le PUITS vaut plus en Logistique qu'en Production", valOf.well["Logistique"] > valOf.well["Production"] * 1.4);
  check("le PARC vaut beaucoup plus en Entropie/chaleur qu'en Production", valOf.park["Entropie"] > valOf.park["Production"] * 2);
  check("le MARCHÉ vaut plus en Logistique qu'en Production", valOf.market["Logistique"] > valOf.market["Production"] * 1.8);
  check("l'USINE vaut plus en Production qu'en Entropie", valOf.factory["Production"] > valOf.factory["Entropie"] * 2);
  check("≥3 vieux bâtiments sont nettement revalorisés (≥1.4) dans un régime tardif",
    [valOf.well, valOf.market, valOf.park, valOf.farm, valOf.workshop]
      .filter(v => Math.max(v["Logistique"], v["Entropie"]) >= 1.4).length >= 3);
}

/* ====================================================================
   2) DEUX VILLES — divergence structurelle
   ==================================================================== */
// These trajectories earn their construction budget and unlock each phase.
// The old fixtures placed an entire unlocked city before its first resident,
// bypassing the economy and local service contracts being measured.
let early;
const industrial = playIndustrial({ care: false, onFoundation(engine) {
  early = { well: engine.buildingValue({ def: BUILDINGS.well }), factory: engine.buildingValue({ def: BUILDINGS.factory }) };
} });
const resilient = playSober(true);
console.log("\n=== 2. Deux trajectoires depuis 600 euros et les déblocages initiaux ===\n");
console.log("Industrielle sans adaptation :", JSON.stringify(summary(industrial)));
console.log("Résiliente avec entretien :", JSON.stringify(summary(resilient)));

console.log("\n=== 3. La structure et les décisions changent le résultat ===\n");
check("la ville industrielle accumule plus de chaleur", industrial.state.res.heat > resilient.state.res.heat + 10);
check("l'industrialisation déclenche une crise chaleur", industrial.state.events.heatFired);
check("la ville sobre peut gagner sans crise chaleur", resilient.state.outcome === "victory" && !resilient.state.events.heatFired);
check("la résilience conserve une meilleure confiance", resilient.state.res.trust >= industrial.state.res.trust);
check("l'industrie est davantage centralisée", industrial.centralizationRatio() > resilient.centralizationRatio());
check("les deux villes ont réellement grandi", industrial.peakPop > 80 && resilient.peakPop > 80);
check("ignorer l'entretien ne donne pas la victoire", industrial.state.outcome !== "victory");
check("les phases ne sont pas restées au démarrage", industrial.state.phase === 4 && resilient.state.phase === 4);

console.log("\n=== 4. Revalorisation en cours de partie ===\n");
const late = { well: industrial.buildingValue({ def: BUILDINGS.well }), factory: industrial.buildingValue({ def: BUILDINGS.factory }) };
console.log("Tôt : usine " + fmt(early.factory) + " / puits " + fmt(early.well));
console.log("Tard : usine " + fmt(late.factory) + " / puits " + fmt(late.well));
check("tôt l'usine vaut plus que le puits", early.factory > early.well);
check("tard le puits dépasse l'usine", late.well > late.factory);
console.log(PASS ? "\nPASS — mécanisme central et trajectoires ordinaires validés." : "\nFAIL — une vérification a échoué.");
process.exit(PASS ? 0 : 1);
