/* =====================================================================
   PALIMPSITY — RIVER PACT · a three-act city scenario (pure simulation)
   ---------------------------------------------------------------------
   Exports:
     PACT, CHARTERS    — immutable scenario constants (deep-frozen pieces).
     RiverCityEngine   — a CityEngine subclass carrying the announced
                         drought. The base engine, the BUILDINGS catalogue
                         and every shared profile stay untouched: during
                         turns 120-149 profileOf() returns per-call COPIES
                         whose water outputs are at 55%, only for
                         water-producing buildings (wells, water plants).
     RiverPact         — the scenario controller. Pure logic: no DOM, no
                         network, no storage, no dependency. It READS the
                         engine state after each real engine.tick() and
                         never advances time by itself.

   Time is counted in simulation turns: 1 turn = 0.6 s at speed ×1
   (600 ms, like the classic loop). Pausing is free — only real engine
   ticks count. The main loop guards ticking while a charter choice is
   pending (canAdvance === false) and will expose an "Advance 5 turns"
   button as ordinary gameplay input; duplicate or skipped update() calls
   never invent progress.

   Acts: 1 "A foothold" → civic charter choice → 2 "Two living districts"
   → 3 "Keep the river pact" (drought 120-149, then consolidation).
   Money grants are paid once per documented milestone; the Makers
   quarter's 40 materials are consumed once when act 2 completes (a
   disclosed civic delivery). No classical victory is claimed and the
   classic mode stays unaffected; this scenario keeps no persistence.
   ===================================================================== */

import { CityEngine } from "./engine.js";
import { districtOf } from "./data.js";

export const PACT = Object.freeze({
  id: "river-pact",
  title: "River Pact",
  tickMs: 600,          // one simulation turn lasts 0.6 s at speed ×1; pauses are free
  deadlineTicks: 240,   // absolute bound shared by every act
  drought: Object.freeze({ startsAt: 120, endsAt: 150, waterMultiplier: 0.55, holdTicks: 12 }),
  foothold: Object.freeze({ population: 24, ratio: 0.85, holdTicks: 4, grant: 200 }),
  districts: Object.freeze({ count: 2, housing: 12, coverage: 0.85, access: 0.8, holdTicks: 4, grant: 100 }),
  pact: Object.freeze({ droughtPopulation: 36, finalPopulation: 48, holdTicks: 12 }),
});

export const CHARTERS = Object.freeze({
  gardens: Object.freeze({
    id: "gardens", name: "Garden commons", grant: 100, parks: 2, wells: 2,
    summary: "Cooling and local provision: each living district keeps two active parks and at least two active wells.",
  }),
  workshops: Object.freeze({
    id: "workshops", name: "Makers quarter", grant: 200, workshops: 1, markets: 1, materialsDelivery: 40,
    summary: "Local making: each living district keeps an active workshop and a local market; the city gathers 40 materials, delivered once when the act completes.",
  }),
});

const STAGE_TITLES = Object.freeze(["A foothold", "Two living districts", "Keep the river pact"]);
const SHORT_DISTRICT = Object.freeze(["NW", "NE", "SW", "SE"]);
const pct = v => `${Math.round((v ?? 0) * 100)}%`;

/* ---------------------------------------------------------------------
   The announced drought. CityEngine increments state.tick AFTER the
   simulation step, so the outputs visible at turn T are produced while
   state.tick is still T - 1. tick() therefore tags the turn it is
   producing; profileOf() then applies the multiplier to exactly the
   announced window [120, 150) — the same window weather() reports.
   --------------------------------------------------------------------- */
export class RiverCityEngine extends CityEngine {
  weather() {
    const { startsAt, endsAt, waterMultiplier } = PACT.drought;
    const t = this.state.tick;
    const kind = t < startsAt ? "normal" : t < endsAt ? "drought" : "recovery";
    return { kind, multiplier: kind === "drought" ? waterMultiplier : 1, startsAt, endsAt };
  }
  tick() {
    this._producingTurn = this.state.tick + 1;
    try { super.tick(); } finally { this._producingTurn = null; }
  }
  profileOf(building) {
    const profile = super.profileOf(building);
    const water = profile?.outputs?.water;
    if (!water) return profile;
    const { startsAt, endsAt, waterMultiplier } = PACT.drought;
    const turn = this._producingTurn ?? this.state.tick;
    if (turn < startsAt || turn >= endsAt) return profile;
    return { ...profile, outputs: { ...profile.outputs, water: water * waterMultiplier } };
  }
}

export class RiverPact {
  constructor(engine) {
    this.engine = engine;             // a fresh RiverCityEngine, created by the caller
    this.status = "running";          // "running" | "success" | "failed"
    this.stage = 0;                   // 0 "A foothold" · 1 "Two living districts" · 2 "Keep the river pact"
    this.charter = null;              // null | "gardens" | "workshops"
    this.awaitingCharter = false;     // true between act 1 completion and the charter choice
    this.finishedAtTick = null;
    this.failReason = null;           // null | "collapse" | "drought" | "deadline"
    this.streak = 0;                  // consecutive turns holding the current act's objective
    this.droughtStreak = 0;           // consecutive supplied turns inside the drought window
    this.droughtHeld = false;         // the 12-turn drought objective was achieved
    this.countedTick = -1;            // one update per real engine tick; tick 0 never counts
    this._paid = new Set();           // milestones already granted (money, civic delivery)
    this._announced = new Set();      // one-shot forecast toasts
  }

  get canAdvance() { return this.status === "running" && !this.awaitingCharter; }

  start() {
    this.engine.toast("River Pact: build the first district. The drought arrives on turn 120. Pauses are free.");
  }

  /* ---- civic charter ---- */
  chooseCharter(id) {
    if (this.status !== "running" || !this.awaitingCharter || this.stage !== 1 || this.charter !== null || !Object.hasOwn(CHARTERS, id)) return false;
    const charter = CHARTERS[id];
    if (!charter) return false;
    this.charter = id;
    this.awaitingCharter = false;
    this._grant(`charter:${id}`, charter.grant);
    this.engine.toast(`${charter.name} signed: +${charter.grant} €.`);
    return true;
  }

  /* ---- the loop hook: call once AFTER each real engine.tick() ---- */
  update() {
    if (this.status !== "running") return;               // terminal states are frozen
    const s = this.engine.state;
    if (!Number.isInteger(s.tick) || s.tick <= 0 || s.tick <= this.countedTick) return;
    if (s.tick !== this.countedTick + 1) {
      // A missed callback is not evidence that all intermediate turns held.
      this.streak = 0;
      this.droughtStreak = 0;
    }
    this.countedTick = s.tick;
    if (s.outcome === "defeat") return this._finish("failed", "collapse"); // engine defeat takes priority
    if (this.stage === 0) this._updateFoothold();
    else if (this.stage === 1) this._updateDistricts();
    else this._updatePact();
    if (this.status !== "running") return;               // success beats every timeout
    if (s.tick >= PACT.drought.endsAt && !this.droughtHeld) return this._finish("failed", "drought");
    if (s.tick >= PACT.deadlineTicks) this._finish("failed", "deadline");
  }

  _updateFoothold() {
    const goals = this._globalGoals();
    this.streak = Object.values(goals).every(Boolean) ? this.streak + 1 : 0;
    if (this.streak < PACT.foothold.holdTicks) return;
    this.stage = 1;
    this.streak = 0;
    this.awaitingCharter = true;
    this.engine.state.speed = 0;                         // the choice pauses the city; the main loop also guards ticking
    this._grant("act1", PACT.foothold.grant);
    this.engine.toast(`The council grants ${PACT.foothold.grant} €. Choose a civic charter.`);
  }

  _updateDistricts() {
    if (this.awaitingCharter) return;                    // the city waits for the charter; no progress
    const goals = this._act2Goals();
    const met = goals.districts && goals.materials && goals.money;
    this.streak = met ? this.streak + 1 : 0;
    if (this.streak < PACT.districts.holdTicks) return;
    this.stage = 2;
    this.streak = 0;                                     // the drought count starts fresh
    this._grant("act2", PACT.districts.grant);
    if (this.charter === "workshops" && !this._paid.has("delivery")) {
      this._paid.add("delivery");                        // consumed exactly once, disclosed on the charter row
      this.engine.state.res.materials -= CHARTERS.workshops.materialsDelivery;
      this.engine.toast(`Civic delivery: ${CHARTERS.workshops.materialsDelivery} materials consumed.`);
    }
    const d = PACT.drought;
    this.engine.toast(`Two living districts: +${PACT.districts.grant} €. Prepare for the drought on turn ${d.startsAt}.`);
  }

  _updatePact() {
    const w = this.engine.weather();
    const d = PACT.drought;
    if (w.kind === "drought") {
      this._announce("drought", `Drought: water output is ${pct(d.waterMultiplier)} on turns ${d.startsAt}–${d.endsAt - 1}.`);
      const goals = this._act3Goals(PACT.pact.droughtPopulation);
      const met = goals.population && goals.districts && goals.money;
      this.droughtStreak = met ? this.droughtStreak + 1 : 0;
      if (this.droughtStreak >= d.holdTicks) this.droughtHeld = true;
      return;
    }
    if (w.kind === "recovery") {
      this._announce("recovery", `The river has recovered. Hold ${PACT.pact.finalPopulation} residents and both districts for ${PACT.pact.holdTicks} turns.`);
      const goals = this._act3Goals(PACT.pact.finalPopulation);
      const met = this.droughtHeld && goals.population && goals.districts && goals.money;
      this.streak = met ? this.streak + 1 : 0;
      if (this.streak >= PACT.pact.holdTicks) this._finish("success");
    }
    // "normal" weather before the drought is preparation time: nothing counts yet.
  }

  /* ---- goal evaluation ---- */
  _globalGoals() {
    const s = this.engine.state, R = s.ratios || {};
    return {
      population: s.res.population >= PACT.foothold.population,
      supply: (R.foodR ?? 0) >= PACT.foothold.ratio && (R.waterR ?? 0) >= PACT.foothold.ratio,
      money: s.res.money >= 0,
    };
  }
  _districtReports() {
    const s = this.engine.state, D = PACT.districts;
    const charter = this.charter ? CHARTERS[this.charter] : null;
    const reports = [];
    for (let id = 0; id < s.districts.length; id++) {
      const d = s.districts[id];
      const active = s.buildings.filter(b => !b.disabled && (b.activity ?? 1) > 0 && districtOf(b.c, b.r) === id);
      const count = bid => active.filter(b => b.def.id === bid).length;
      const r = {
        id, name: d.name, short: SHORT_DISTRICT[id] ?? `D${id}`,
        housing: d.demand,
        foodCoverage: d.foodCoverage ?? 0, waterCoverage: d.waterCoverage ?? 0, access: d.access ?? 0,
        parks: count("park"), wells: count("well"), workshops: count("workshop"), markets: count("market"),
      };
      r.inhabited = r.housing >= D.housing;
      r.supplied = r.inhabited && r.foodCoverage >= D.coverage && r.waterCoverage >= D.coverage && r.access >= D.access;
      r.charterKept = !charter || (this.charter === "gardens"
        ? r.parks >= charter.parks && r.wells >= charter.wells
        : r.workshops >= charter.workshops && r.markets >= charter.markets);
      r.qualifies = r.supplied && r.charterKept;
      reports.push(r);
    }
    return reports;
  }
  _act2Goals() {
    const s = this.engine.state;
    const reports = this._districtReports();
    const qualifying = reports.filter(r => r.qualifies);
    const materials = this.charter !== "workshops"
      || (s.res.materials ?? 0) >= CHARTERS.workshops.materialsDelivery;
    return { districts: qualifying.length >= PACT.districts.count, materials, money: s.res.money >= 0, reports, qualifying };
  }
  _act3Goals(population) {
    const s = this.engine.state;
    const reports = this._districtReports();
    const qualifying = reports.filter(r => r.qualifies);
    return {
      population: s.res.population >= population,
      districts: qualifying.length >= PACT.districts.count,
      money: s.res.money >= 0,
      reports, qualifying,
    };
  }

  /* ---- internals ---- */
  _grant(key, amount) {
    if (this._paid.has(key)) return false;
    this._paid.add(key);
    this.engine.state.res.money += amount;
    return true;
  }
  _announce(key, text) {
    if (this._announced.has(key)) return;
    this._announced.add(key);
    this.engine.toast(text);
  }
  _finish(status, failReason = null) {
    this.status = status;
    this.failReason = failReason;
    this.finishedAtTick = this.engine.state.tick;
    this.engine.state.speed = 0;
  }

  /* ---- UI-facing explanation (canonical English; translations live elsewhere) ---- */
  _stageDescription() {
    const d = PACT.drought;
    if (this.stage === 0) {
      return `Act 1 of 3 — ${STAGE_TITLES[0]}. Reach ${PACT.foothold.population} residents with food and water at ${pct(PACT.foothold.ratio)} or better `
        + `and non-negative finances, held ${PACT.foothold.holdTicks} consecutive turns. Reward: +${PACT.foothold.grant} € and the civic charter choice.`;
    }
    if (this.stage === 1) {
      const base = `Act 2 of 3 — ${STAGE_TITLES[1]}. Raise ${PACT.districts.count} districts with housing for ${PACT.districts.housing}+ residents each, `
        + `with food and water coverage at ${pct(PACT.districts.coverage)}+, access at ${pct(PACT.districts.access)}+, held ${PACT.districts.holdTicks} consecutive turns. Reward: +${PACT.districts.grant} €.`;
      if (!this.charter) {
        return `${base} First sign a civic charter: Garden commons (+${CHARTERS.gardens.grant} € — ${CHARTERS.gardens.summary}) `
          + `or Makers quarter (+${CHARTERS.workshops.grant} € — ${CHARTERS.workshops.summary})`;
      }
      return `${base} Charter: ${CHARTERS[this.charter].name}. ${CHARTERS[this.charter].summary}`;
    }
    return `Act 3 of 3 — ${STAGE_TITLES[2]}. Drought at turns ${d.startsAt}–${d.endsAt - 1}: water output at ${pct(d.waterMultiplier)}. `
      + `Hold ${d.holdTicks} consecutive drought turns with ${PACT.pact.droughtPopulation}+ residents and both districts supplied, `
      + `then reach ${PACT.pact.finalPopulation} residents for ${PACT.pact.holdTicks} consecutive turns. Finish by turn ${PACT.deadlineTicks}.`;
  }
  _districtBits(reports) {
    const inhabited = reports.filter(r => r.housing > 0);
    if (!inhabited.length) return "no inhabited districts yet";
    return inhabited.map(r =>
      `${r.short} ${Math.round(r.housing)} places · food ${pct(r.foodCoverage)} · water ${pct(r.waterCoverage)} · access ${pct(r.access)}`
    ).join(" — ");
  }
  _charterRows(reports) {
    if (!this.charter) return [];
    const inhabited = reports.filter(r => r.inhabited);
    if (this.charter === "gardens") {
      const c = CHARTERS.gardens;
      return [
        { key: "charter-parks", label: `Garden commons: ${c.parks} active parks per district`,
          met: inhabited.filter(r => r.parks >= c.parks).length >= PACT.districts.count,
          detail: inhabited.map(r => `${r.short}: ${r.parks}/${c.parks}`).join(" · ") || "no living district yet" },
        { key: "charter-wells", label: `Garden commons: ${c.wells} active wells per district`,
          met: inhabited.filter(r => r.wells >= c.wells).length >= PACT.districts.count,
          detail: inhabited.map(r => `${r.short}: ${r.wells}/${c.wells}`).join(" · ") || "no living district yet" },
      ];
    }
    const c = CHARTERS.workshops;
    const rows = [
      { key: "charter-workshops", label: "Makers quarter: an active workshop per district",
        met: inhabited.filter(r => r.workshops >= c.workshops).length >= PACT.districts.count,
        detail: inhabited.map(r => `${r.short}: ${r.workshops}/${c.workshops}`).join(" · ") || "no living district yet" },
      { key: "charter-markets", label: "Makers quarter: a local market per district",
        met: inhabited.filter(r => r.markets >= c.markets).length >= PACT.districts.count,
        detail: inhabited.map(r => `${r.short}: ${r.markets}/${c.markets}`).join(" · ") || "no living district yet" },
    ];
    if (this.stage === 1) {
      const stock = Math.round(this.engine.state.res.materials ?? 0);
      rows.push({ key: "charter-materials", label: `Gather ${c.materialsDelivery} materials for the civic delivery`,
        met: (this.engine.state.res.materials ?? 0) >= c.materialsDelivery,
        detail: `${stock} / ${c.materialsDelivery} materials in stock · delivered once when the act completes` });
    }
    return rows;
  }
  _rows() {
    const s = this.engine.state, R = s.ratios || {};
    if (this.stage === 0) {
      const g = this._globalGoals();
      return [
        { key: "population", label: `Reach ${PACT.foothold.population} residents`, met: g.population,
          detail: `${Math.round(s.res.population)} / ${PACT.foothold.population} residents` },
        { key: "supply", label: `Keep food and water at ${pct(PACT.foothold.ratio)}+`, met: g.supply,
          detail: `Food ${pct(R.foodR)} · water ${pct(R.waterR)} · need ${pct(PACT.foothold.ratio)}` },
        { key: "money", label: "Keep finances non-negative", met: g.money,
          detail: `Balance ${Math.round(s.res.money)} €` },
        { key: "hold", label: `Hold every goal ${PACT.foothold.holdTicks} consecutive turns`, met: this.streak >= PACT.foothold.holdTicks,
          detail: `${this.streak} / ${PACT.foothold.holdTicks} consecutive turns · completing pays +${PACT.foothold.grant} €` },
      ];
    }
    if (this.stage === 1) {
      const goals = this._act2Goals();
      const rows = [
        { key: "charter", label: "Sign a civic charter", met: this.charter !== null,
          detail: this.charter
            ? `${CHARTERS[this.charter].name} signed · +${CHARTERS[this.charter].grant} € granted`
            : `Choose once: Garden commons +${CHARTERS.gardens.grant} € · Makers quarter +${CHARTERS.workshops.grant} €` },
        { key: "districts", label: `Raise ${PACT.districts.count} living districts`, met: goals.districts,
          detail: `${goals.qualifying.length} / ${PACT.districts.count} qualifying districts` },
        ...this._charterRows(goals.reports),
        { key: "money", label: "Keep finances non-negative", met: goals.money,
          detail: `Balance ${Math.round(s.res.money)} €` },
        { key: "hold", label: `Hold every goal ${PACT.districts.holdTicks} consecutive turns`, met: this.streak >= PACT.districts.holdTicks,
          detail: `${this.streak} / ${PACT.districts.holdTicks} consecutive turns · completing pays +${PACT.districts.grant} €` },
      ];
      return rows;
    }
    const goals = this._act3Goals(this.engine.weather().kind === "drought" ? PACT.pact.droughtPopulation : PACT.pact.finalPopulation);
    const d = PACT.drought;
    return [
      { key: "drought-hold", label: `Hold ${d.holdTicks} consecutive drought turns (turns ${d.startsAt}–${d.endsAt - 1})`, met: this.droughtHeld,
        detail: this.droughtHeld
          ? `Achieved — the city stayed supplied through the drought`
          : `${this.droughtStreak} / ${d.holdTicks} drought turns held · needs ${PACT.pact.droughtPopulation}+ residents, both districts supplied, charter standing` },
      { key: "population", label: `Reach ${PACT.pact.finalPopulation} residents after the drought`, met: this.engine.weather().kind === "recovery" && s.res.population >= PACT.pact.finalPopulation,
        detail: `${Math.round(s.res.population)} / ${PACT.pact.finalPopulation} residents` },
      { key: "districts", label: "Keep both districts supplied and the charter standing", met: goals.districts,
        detail: `${goals.qualifying.length} / ${PACT.districts.count} qualifying districts` },
      ...this._charterRows(goals.reports),
      { key: "money", label: "Keep finances non-negative", met: goals.money,
        detail: `Balance ${Math.round(s.res.money)} €` },
      { key: "hold", label: `Hold ${PACT.pact.holdTicks} consecutive turns after the drought`, met: this.streak >= PACT.pact.holdTicks,
        detail: `${this.streak} / ${PACT.pact.holdTicks} consecutive recovery turns` },
      { key: "deadline", label: `Finish by turn ${PACT.deadlineTicks}`, met: s.tick <= PACT.deadlineTicks,
        detail: `Turn ${s.tick} / ${PACT.deadlineTicks} · one turn is 0.6 s of simulation; pauses are free` },
    ];
  }

  progress() {
    const s = this.engine.state;
    const weather = this.engine.weather();
    return {
      stage: this.stage,
      stageTitle: STAGE_TITLES[this.stage],
      stageDescription: this._stageDescription(),
      status: this.status,
      charter: this.charter,
      awaitingCharter: this.awaitingCharter,
      weather,
      droughtHeld: this.droughtHeld,
      streak: this.stage === 2 && weather.kind === "drought" ? this.droughtStreak : this.streak,
      tick: s.tick,
      deadlineTicks: PACT.deadlineTicks,
      finishedAtTick: this.finishedAtTick,
      failReason: this.failReason,
      rows: this._rows(),
    };
  }
}
