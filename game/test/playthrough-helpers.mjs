/* Shared normal-budget playthroughs. No unlocked content or resources are injected. */
import assert from 'node:assert/strict';
import { CityEngine } from '../src/engine.js';
import { BUILDINGS, COLS, ROWS, districtOf } from '../src/data.js';

export const run = (e, ticks) => { for (let i = 0; i < ticks && !e.state.outcome; i++) e.tick(); };
export const places = (e, id, cells) => cells.map(([c, r]) => {
  const b = e.place(id, c, r);
  assert.ok(b, `${id} at ${c},${r}: ${e.placeBlockReason(id, c, r)}`);
  return b;
});
export const summary = e => ({ tick: e.state.tick, outcome: e.state.outcome, population: +e.state.res.population.toFixed(2), money: +e.state.res.money.toFixed(2), phase: e.state.phase, heat: +e.state.res.heat.toFixed(2), maintenance: +e.state.res.maintenance.toFixed(2), crises: e.crisisLog.map(x => x.type), net: e.state.flowNet, service: e.state.districts.filter(d => d.demand > 0).map(d => [d.name, d.access]) });
export function buy(e, id, n = 1, options = {}) {
  const made = [];
  for (let i = 0; i < n && !e.state.outcome; i++) {
    assert.ok(e.state.unlocked.has(id), `${id} must unlock naturally before purchase: ${JSON.stringify(summary(e))}`);
    for (let waited = 0; e.state.res.money < BUILDINGS[id].cost.money && waited < 400 && !e.state.outcome; waited++) e.tick();
    assert.ok(!e.state.outcome, `City failed while saving for ${id}: ${JSON.stringify(summary(e))}`);
    let cells = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if ((options.district == null || districtOf(c, r) === options.district) && e.canPlace(id, c, r)) cells.push([c, r]);
    }
    if (id === 'farm') cells.sort((a, b) => Number(e.terrain[b[1]][b[0]] === 2) - Number(e.terrain[a[1]][a[0]] === 2));
    if (options.near) cells.sort((a, b) => Math.hypot(a[0] - options.near[0], a[1] - options.near[1]) - Math.hypot(b[0] - options.near[0], b[1] - options.near[1]));
    assert.ok(cells.length, `No affordable free site for ${id}: ${JSON.stringify(summary(e))}`);
    made.push(places(e, id, [cells[0]])[0]);
  }
  return made;
}

export function foundation() {
  const e = new CityEngine();
  assert.equal(e.state.res.money, 600);
  buy(e, 'house', 6, { district: 2 });
  buy(e, 'well', 3, { district: 2 });
  buy(e, 'farm', 2, { district: 2 });
  const workshop = buy(e, 'workshop', 1, { district: 2 })[0];
  buy(e, 'market', 1, { district: 2 });
  buy(e, 'park', 1, { district: 2 });
  for (let t = 0; e.state.phase < 2 && t < 100 && !e.state.outcome; t++) e.tick();
  assert.ok(e.state.phase >= 2, `Foundation must reach phase 2: ${JSON.stringify(summary(e))}`);
  return { e, workshop };
}

export function settle(e, district, housing = 'house', housingN = 11) {
  buy(e, 'well', 1, { district });
  buy(e, 'farm', 1, { district });
  buy(e, housing, Math.min(2, housingN), { district });
  buy(e, 'market', 1, { district });
  buy(e, 'park', 1, { district });
  buy(e, 'well', 4, { district });
  buy(e, 'farm', 2, { district });
  // Dense districts need several local service points, not just a larger stock.
  buy(e, 'market', housing === 'tower' ? Math.max(0, housingN - 2) : 1, { district });
  buy(e, housing, housingN - Math.min(2, housingN), { district });
}

export function reinforceMaintenance(e) {
  for (let attempt = 0; attempt < 15 && !e.state.outcome; attempt++) {
    run(e, 20);
    if (e.state.outcome) break;
    if (e.state.res.maintenance < 55) continue;
    const worst = [...e.state.districts].sort((a, b) => b.remainingMaintenance - a.remainingMaintenance)[0];
    if (worst.remainingMaintenance < 0.5) continue;
    buy(e, 'maint_center', 1, { district: e.state.districts.indexOf(worst) });
  }
}

export function playSober(careEarly) {
  const { e, workshop } = foundation();
  buy(e, 'well', 2, { district: 2 });
  buy(e, 'farm', 1, { district: 2 });
  buy(e, 'house', 5, { district: 2 });
  buy(e, 'market', 1, { district: 2 });
  settle(e, 0);
  for (let t = 0; e.state.phase < 4 && t < 160 && !e.state.outcome; t++) e.tick();
  assert.ok(e.state.phase >= 4, `A genuinely sober city must unlock maturity: ${JSON.stringify(summary(e))}`);
  assert.equal(e.state.events.heatFired, false);
  const care = () => {
    for (let t = 0; (e.state.res.money < 65 || e.state.res.materials < 20) && t < 300; t++) e.tick();
    assert.equal(e.convertBuilding(workshop, 'workshop_repair'), true, e.conversionBlockReason(workshop, 'workshop_repair'));
    buy(e, 'maint_center', 1, { district: 0 });
    buy(e, 'recycler', 1, { district: 2 });
  };
  if (!e.state.outcome) {
    if (careEarly) care();
    settle(e, 3);
    if (!careEarly) { run(e, 100); care(); }
    buy(e, 'maint_center', 1, { district: 3 });
    reinforceMaintenance(e);
    run(e, 400);
  }
  return e;
}

export function playIndustrial({ care = true, onFoundation } = {}) {
  const { e } = foundation();
  onFoundation?.(e);
  buy(e, 'generator', 1, { district: 1 });
  buy(e, 'well', 2, { district: 1 });
  buy(e, 'factory', 1, { district: 1 });
  buy(e, 'generator', 1, { district: 1 });
  settle(e, 0, 'tower', 4);
  settle(e, 3, 'tower', 3);
  for (let t = 0; e.state.phase < 4 && t < 160 && !e.state.outcome; t++) e.tick();
  assert.ok(e.state.phase >= 4, `Late industrial tools unlock naturally: ${JSON.stringify(summary(e))}`);
  if (!care) { run(e, 500); return e; }
  buy(e, 'maint_center', 1, { district: 0 });
  buy(e, 'maint_center', 1, { district: 3 });
  buy(e, 'maint_center', 1, { district: 1 });
  buy(e, 'depot', 1, { district: 0 });
  buy(e, 'depot', 1, { district: 3 });
  buy(e, 'recycler', 1, { district: 2 });
  buy(e, 'park', 3, { district: 1 });
  buy(e, 'house', 2, { district: 0 });
  buy(e, 'house', 2, { district: 3 });
  reinforceMaintenance(e);
  run(e, 500);
  return e;
}
