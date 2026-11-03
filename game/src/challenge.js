/* =====================================================================
   FIRST NEIGHBOURHOOD — défi borné, séparé du mode ville classique.
   ---------------------------------------------------------------------
   Contrôleur pur (aucune dépendance DOM/rendu, testable en Node) : il LIT
   l'état d'un CityEngine frais (600 €, déblocages naturels) et suit un
   objectif simple à deadline bornée. La victoire classique "Thriving city"
   n'est ni modifiée ni revendiquée ici.

   Le temps compté est le temps de SIMULATION : un tour = 600 ms à vitesse
   normale. Mettre en pause (ou cacher l'onglet) n'avance ni le chrono ni la
   deadline — les pauses et la vitesse rapide restent honnêtes.

   Helpers de boucle partagés (les deux modes) :
     shouldAdvance(engine, hidden)  → la simulation peut-elle tourner ?
     applyHiddenPause(engine, clock, now) → pause nette quand l'onglet se
       cache : vitesse 0, accumulateur vidé, horloge réalignée. La reprise
       est manuelle (le joueur appuie sur ▶), sans rattrapage de ticks.
   ===================================================================== */

export const CHALLENGE = {
  id: "first-neighbourhood",
  title: "First Neighbourhood",
  targetPop: 24,       // habitants à accueillir
  minRatio: 0.85,      // nourriture ET eau couvertes à ≥ 85 %
  sustainTicks: 8,     // tous les objectifs tenus EN MÊME TEMPS, 8 tours de suite
  deadlineTicks: 120,  // deadline bornée : 120 tours de simulation (72 s à vitesse 1)
  tickMs: 600,         // durée d'un tour à vitesse normale (boucle de main.js)
};

export const BEST_STORAGE_KEY = "palimpsity.challenge.first-neighbourhood.best";

export function formatSimTime(ticks) {
  const seconds = Math.round(ticks * CHALLENGE.tickMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Le record local est un confort, jamais un point de panne : stockage absent,
// plein ou corrompu → pas de record, et le défi continue.
export function readBestTime(storage) {
  try {
    const raw = storage?.getItem(BEST_STORAGE_KEY);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= CHALLENGE.sustainTicks && value <= CHALLENGE.deadlineTicks ? value : null;
  } catch { return null; }
}
export function writeBestTime(storage, ticks) {
  if (!Number.isInteger(ticks) || ticks < CHALLENGE.sustainTicks || ticks > CHALLENGE.deadlineTicks) return false;
  try {
    if (typeof storage?.setItem !== "function") return false;
    storage.setItem(BEST_STORAGE_KEY, String(ticks));
    return true;
  }
  catch { return false; }
}

/* ---- helpers de boucle (purs) ---- */
export function shouldAdvance(engine, hidden, challenge = null) {
  return !hidden && engine.state.speed > 0 && !engine.state.outcome && (!challenge || challenge.status === "running");
}
export function applyHiddenPause(engine, clock, now) {
  const wasRunning = engine.state.speed > 0;
  engine.state.speed = 0;
  clock.acc = 0;
  clock.last = now;
  return wasRunning;
}

export class FirstNeighbourhood {
  constructor(engine, { storage = null } = {}) {
    this.engine = engine;          // un CityEngine FRAIS, créé par l'appelant
    this.storage = storage;
    this.status = "running";       // "running" | "success" | "failed"
    this.streak = 0;               // tours consécutifs avec tous les objectifs tenus
    this.countedTick = -1;         // un tour n'est compté qu'une fois (pause = rien)
    this.finishedAtTick = null;
    this.failReason = null;        // "deadline" | "collapse"
    this.newBest = false;
  }

  start() {
    this.engine.toast(`First Neighbourhood: reach ${CHALLENGE.targetPop} residents with healthy food, water and finances for ${CHALLENGE.sustainTicks} consecutive turns, before turn ${CHALLENGE.deadlineTicks}.`);
  }

  goalsMet() {
    const s = this.engine.state, R = s.ratios || {};
    return {
      population: s.res.population >= CHALLENGE.targetPop,
      supply: (R.foodR ?? 0) >= CHALLENGE.minRatio && (R.waterR ?? 0) >= CHALLENGE.minRatio,
      money: s.res.money >= 0,
    };
  }

  // Appelé après CHAQUE engine.tick(). Priorité au succès quand le dernier
  // tour de la deadline complète la série : on vérifie la victoire du défi
  // AVANT l'échéance.
  update() {
    if (this.status !== "running") return;
    const s = this.engine.state;
    if (s.tick === this.countedTick) return;
    this.countedTick = s.tick;
    if (s.outcome === "defeat") {
      this.status = "failed";
      this.failReason = "collapse";
      this.finishedAtTick = s.tick;
      return;
    }
    this.streak = Object.values(this.goalsMet()).every(Boolean) ? this.streak + 1 : 0;
    if (this.streak >= CHALLENGE.sustainTicks) {
      this.status = "success";
      this.finishedAtTick = s.tick;
      const best = readBestTime(this.storage);
      if (best == null || s.tick < best) this.newBest = writeBestTime(this.storage, s.tick);
      return;
    }
    if (s.tick >= CHALLENGE.deadlineTicks) {
      this.status = "failed";
      this.failReason = "deadline";
      this.finishedAtTick = s.tick;
    }
  }

  goalRows() {
    const s = this.engine.state, R = s.ratios || {}, met = this.goalsMet();
    return [
      { key: "population", label: "Reach 24 residents", met: met.population,
        detail: `${Math.round(s.res.population)} / ${CHALLENGE.targetPop} residents` },
      { key: "supply", label: "Keep food and water healthy", met: met.supply,
        detail: `Food ${Math.round((R.foodR ?? 0) * 100)}% · water ${Math.round((R.waterR ?? 0) * 100)}% · need ${Math.round(CHALLENGE.minRatio * 100)}%` },
      { key: "money", label: "Keep finances non-negative", met: met.money,
        detail: `Balance ${Math.round(s.res.money)} €` },
      { key: "streak", label: "Hold everything together", met: this.streak >= CHALLENGE.sustainTicks,
        detail: `${this.streak} / ${CHALLENGE.sustainTicks} consecutive turns` },
    ];
  }

  progress() {
    const s = this.engine.state, rows = this.goalRows();
    return {
      status: this.status,
      streak: this.streak,
      tick: s.tick,
      ticksRemaining: Math.max(0, CHALLENGE.deadlineTicks - s.tick),
      timeRemaining: formatSimTime(Math.max(0, CHALLENGE.deadlineTicks - s.tick)),
      metCount: rows.filter(row => row.met).length,
      rows,
      finishedAtTick: this.finishedAtTick,
      failReason: this.failReason,
      newBest: this.newBest,
      best: readBestTime(this.storage),
    };
  }
}
