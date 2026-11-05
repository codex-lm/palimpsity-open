import test from 'node:test';
import assert from 'node:assert/strict';
import { CityEngine } from '../src/engine.js';
import { RiverCityEngine, RiverPact } from '../src/river-pact.js';
import { BUILDINGS, UPKEEP } from '../src/data.js';

function engine(Engine = CityEngine) {
  const e = new Engine();
  e.state.phase = 2;
  e.state.unlocked.add('river_quay');
  e.state.res.money = 10000;
  e.state.res.materials = 1000;
  return e;
}
function quay(e, c, r, activity = 1, target = null) {
  const b = e.place('river_quay', c, r, target ? { target } : {});
  assert.ok(b, e.placeBlockReason('river_quay', c, r));
  b.activity = activity;
  return b;
}
function resourceBuilding(e, c, r, { out = {}, need = {} } = {}) {
  const def = { ...BUILDINGS.farm, tags: [], inputs: { ...need }, outputs: { ...out }, ext: {} };
  const b = { def, c, r, age: 0, disabled: false, activity: 1, flowOutput: { ...out }, flowInput: { ...need }, grossMaintenance: 0 };
  e.state.buildings.push(b);
  e.occ[r][c] = b;
  return b;
}
function networkFixture({ food = 10, water = 10, needFood = 8, needWater = 8 } = {}) {
  const e = engine();
  const northwest = quay(e, 2, 5);
  const alternate = quay(e, 6, 5);
  const southwest = quay(e, 4, 6);
  resourceBuilding(e, 0, 6, { out: { food, water } });
  resourceBuilding(e, 0, 0, { need: { food: needFood, water: needWater } });
  e.computeDistricts(1);
  return { e, northwest, alternate, southwest };
}
function assertWaterPath(e, flow) {
  assert.ok(flow.path.length > 0);
  for (let i = 0; i < flow.path.length; i++) {
    const cell = flow.path[i];
    assert.equal(e.terrain[cell.r][cell.c], 1, 'Every path cell is water');
    if (i) assert.equal(Math.abs(cell.c - flow.path[i - 1].c) + Math.abs(cell.r - flow.path[i - 1].r), 1, 'BFS never uses a diagonal');
  }
}

test('quay placement is atomic, complete and refundable without floors or conversions', () => {
  const locked = new CityEngine();
  assert.equal(locked.place('river_quay', 2, 5), null);
  const e = engine();
  e.state.res.money = 60; e.state.res.materials = 4;
  const b = e.place('river_quay', 2, 5);
  assert.ok(b);
  assert.equal(e.state.res.money, 0);
  assert.equal(e.state.res.materials, 0);
  assert.deepEqual(b.quaySide, { c: 2, r: 4 });
  assert.deepEqual(e.profileOf(b).inputs, { workers: 2 });
  assert.deepEqual(e.profileOf(b).outputs, {});
  assert.equal(e.profileOf(b).ext.maintenance, 0.4);
  assert.equal(UPKEEP.river_quay, 0.5);
  assert.deepEqual(e.transformationOptions(b), []);
  assert.deepEqual(e.conversionOptions(b), []);
  e.tick();
  assert.equal(e.state.economy.upkeep, 0.5);
  assert.equal(b.flowOutput.money ?? 0, 0);
  assert.equal(b.flowOutput.food ?? 0, 0);
  assert.equal(b.flowOutput.water ?? 0, 0);
  const money = e.state.res.money, materials = e.state.res.materials, tick = e.state.tick;
  assert.equal(e.removeAt(b.c, b.r), true);
  assert.equal(e.state.res.money, money + 24);
  assert.equal(e.state.res.materials, materials);
  assert.equal(e.state.tick, tick);
});

test('water, inland, occupied, underfunded and invalid-target placements do not mutate the city', () => {
  const e = engine();
  const occupied = quay(e, 2, 5);
  for (const fixture of [
    { c: 2, r: 4, money: 1000, materials: 1000 },
    { c: 0, r: 0, money: 1000, materials: 1000 },
    { c: 2, r: 5, money: 1000, materials: 1000 },
    { c: 6, r: 5, money: 59, materials: 4 },
    { c: 6, r: 5, money: 60, materials: 3 },
    { c: 1, r: 2, money: 1000, materials: 1000, target: { c: 2, r: 4 } },
  ]) {
    e.state.res.money = fixture.money; e.state.res.materials = fixture.materials;
    const before = JSON.stringify(e.state);
    assert.equal(e.place('river_quay', fixture.c, fixture.r, fixture.target ? { target: fixture.target } : {}), null);
    assert.equal(JSON.stringify(e.state), before, `${fixture.c},${fixture.r}: refusal is atomic`);
  }
  assert.ok(occupied);
});

test('four orthogonal water basins and an explicit single quay side prevent diagonal or multi-basin links', () => {
  const e = engine();
  assert.equal(e.waterBasins().length, 4);
  const multi = quay(e, 1, 2);
  assert.deepEqual(multi.quaySide, { c: 1, r: 3 }, 'N/E/S/W deterministic orientation');
  const tiny = quay(e, 0, 3, 1, { c: 0, r: 2 });
  e.computeDistricts(1);
  assert.notEqual(e.quayBasin(multi).id, e.quayBasin(tiny).id);
  assert.deepEqual(e.state.riverNetworks, []);
  const explicit = engine();
  const chosen = quay(explicit, 1, 2, 1, { c: 0, r: 2 });
  assert.deepEqual(chosen.quaySide, { c: 0, r: 2 });
  assert.equal(explicit.quayBasin(chosen).keys.has('0,2'), true);
  assert.equal(explicit.quayBasin(chosen).keys.has('1,3'), false);
});

test('one quay or two in one district waits for another district', () => {
  const e = engine();
  const first = quay(e, 2, 5), second = quay(e, 6, 5);
  e.computeDistricts(1);
  assert.deepEqual(e.state.riverNetworks, []);
  assert.equal(e.quayInfo(first).status, 'waiting');
  assert.equal(e.quayInfo(second).status, 'waiting');
});

test('one basin shares twelve units across resources and selects the best quay stably', () => {
  const { e, northwest, alternate, southwest } = networkFixture();
  assert.equal(e.state.riverNetworks.length, 1);
  const network = e.state.riverNetworks[0];
  assert.equal(network.nominalCapacity, 12);
  assert.equal(network.effectiveCapacity, 12);
  assert.equal(network.reductionReason, null);
  assert.equal(e.state.districts[0].networkCapacity, 12);
  assert.equal(e.state.districts[2].networkCapacity, 12);
  assert.equal(e.state.riverFlows.reduce((sum, flow) => sum + flow.amount, 0), 12);
  assert.equal(e.state.riverFlows.find(flow => flow.resource === 'food').amount, 8);
  assert.equal(e.state.riverFlows.find(flow => flow.resource === 'water').amount, 4);
  for (const flow of e.state.riverFlows) {
    assert.equal(flow.sourceQuay.c, southwest.c);
    assert.equal(flow.destinationQuay.c, northwest.c, 'Stable tie chooses the lowest coordinates, not extra capacity');
    assert.equal(flow.nominalCapacity, 12);
    assert.equal(flow.effectiveCapacity, 12);
    assertWaterPath(e, flow);
  }
  assert.equal(e.quayInfo(northwest).otherDistricts[0], 2);
  assert.equal(e.quayInfo(alternate).flows.length, 0);
  assert.equal(e.quayInfo(alternate).status, 'no_surplus');
});

test('the highest-activity quay represents its district without adding another basin capacity', () => {
  const { e, northwest, alternate } = networkFixture({ food: 20, water: 0, needFood: 20, needWater: 0 });
  northwest.activity = 0.5;
  alternate.activity = 1;
  e.computeDistricts(1);
  assert.equal(e.state.riverNetworks[0].effectiveCapacity, 12);
  assert.ok(e.state.riverFlows.every(flow => flow.destinationQuay.c === alternate.c));
  assert.equal(e.state.riverFlows.reduce((sum, flow) => sum + flow.amount, 0), 12);
  assert.deepEqual(engine().state.riverNetworks, [], 'A restart starts with no stale route');
  assert.deepEqual(engine().state.riverFlows, [], 'A restart starts with no stale cargo');
});

test('suspending an unselected duplicate preserves the active flow without a tick', () => {
  const { e, northwest, alternate } = networkFixture({ food: 1, water: 0, needFood: 1, needWater: 0 });
  const before = JSON.stringify(e.state.riverFlows), tick = e.state.tick;
  alternate.disabled = true;
  e.recomputeFields();
  assert.equal(e.state.tick, tick);
  assert.equal(e.state.riverNetworks.length, 1);
  assert.equal(JSON.stringify(e.state.riverFlows), before);
  assert.equal(e.quayInfo(northwest).status, 'active');
});

test('suspending another basin only invalidates that basin', () => {
  const { e } = networkFixture({ food: 1, water: 0, needFood: 1, needWater: 0 });
  quay(e, 7, 2);
  const other = quay(e, 9, 3);
  e.computeDistricts(1);
  assert.equal(e.state.riverNetworks.length, 2);
  const basin = e.state.riverFlows[0].basin, tick = e.state.tick;
  other.disabled = true;
  e.recomputeFields();
  assert.equal(e.state.tick, tick);
  assert.equal(e.state.riverNetworks.length, 1);
  assert.equal(e.state.riverNetworks[0].basin, basin);
  assert.equal(e.state.riverFlows.length, 1);
  assert.equal(e.state.riverFlows[0].amount, 1);
});

test('suspending the selected quay recomputes only the current route and invalidates its dated cargo', () => {
  const { e, northwest, alternate } = networkFixture({ food: 1, water: 0, needFood: 1, needWater: 0 });
  const tick = e.state.tick;
  northwest.disabled = true;
  e.recomputeFields();
  assert.equal(e.state.tick, tick);
  assert.equal(e.state.riverNetworks.length, 1);
  assert.deepEqual(e.state.riverFlows, [], 'No replacement cargo is invented before the next tick');
  assert.equal(e.state.riverNetworks[0].quays.find(quay => quay.district === 0).c, alternate.c);
  assert.equal(e.state.districts[0].foodImports, 1);
  assert.equal(e.state.districts[2].foodExports, 1);
  assert.equal(e.quayInfo(northwest).status, 'suspended');
  assert.equal(e.quayInfo(alternate).status, 'no_surplus');
  assert.equal(e.quayInfo(alternate).flowTick, 1);
});

test('crew shortage reduces the shared basin and zero crew or suspension invalidates it immediately', () => {
  const { e, northwest, southwest } = networkFixture({ food: 20, water: 0, needFood: 20, needWater: 0 });
  southwest.activity = 0.5;
  e.computeDistricts(1);
  assert.equal(e.state.riverNetworks[0].effectiveCapacity, 6);
  assert.equal(e.state.riverNetworks[0].reductionReason, 'crew');
  assert.equal(e.state.riverFlows[0].amount, 6);
  assert.equal(e.quayInfo(southwest).status, 'crew');
  southwest.activity = 0;
  e.computeDistricts(1);
  assert.deepEqual(e.state.riverNetworks, []);
  assert.equal(e.quayInfo(southwest).status, 'crew');
  assert.equal(e.quayInfo(northwest).status, 'waiting');
  southwest.activity = 1;
  e.computeDistricts(1);
  assert.equal(e.state.riverFlows.length, 1);
  const tick = e.state.tick;
  southwest.disabled = true;
  e.recomputeFields();
  assert.deepEqual(e.state.riverNetworks, []);
  assert.deepEqual(e.state.riverFlows, []);
  assert.equal(e.quayInfo(southwest).status, 'suspended');
  assert.equal(e.state.tick, tick);
});

test('demolition invalidates routes immediately without an economic tick', () => {
  const { e, southwest } = networkFixture();
  assert.ok(e.state.riverFlows.length > 0);
  const tick = e.state.tick;
  assert.equal(e.removeAt(southwest.c, southwest.r), true);
  assert.equal(e.state.tick, tick);
  assert.deepEqual(e.state.riverNetworks, []);
  assert.deepEqual(e.state.riverFlows, []);
  assert.equal(e.quayInfo(southwest), null);
});

test('land transport consumes surplus first and a river basin never doubles it', () => {
  const { e } = networkFixture({ food: 20, water: 0, needFood: 20, needWater: 0 });
  e.transportNetworks = () => [{ districts: [0, 2], capacity: 5, nodes: [] }];
  e.computeDistricts(1);
  assert.equal(e.state.riverFlows.reduce((sum, flow) => sum + flow.amount, 0), 12);
  assert.equal(e.state.districts[2].foodExports, 17);
  assert.equal(e.state.districts[0].foodImports, 17);
  assert.equal(e.state.districts[0].networkCapacity, 17);
  assert.equal(e.state.districts[2].networkCapacity, 17);
});

test('an operational basin without available surplus or deficit reports no_surplus and no flow', () => {
  const e = engine();
  const first = quay(e, 2, 5), second = quay(e, 4, 6);
  e.computeDistricts(1);
  assert.equal(e.state.riverNetworks.length, 1);
  assert.deepEqual(e.state.riverFlows, []);
  assert.equal(e.quayInfo(first).status, 'no_surplus');
  assert.equal(e.quayInfo(second).status, 'no_surplus');
  resourceBuilding(e, 0, 6, { out: { food: 20 } });
  e.computeDistricts(1);
  assert.deepEqual(e.state.riverFlows, [], 'A surplus without any deficit is not transported');
});

test('pause construction preserves the dated cargo ledger until the next economic tick', () => {
  const e = new RiverCityEngine(), pact = new RiverPact(e);
  for (const [c, r] of [[0, 6], [1, 6], [2, 6], [3, 6], [6, 6], [7, 6], [0, 8]]) assert.ok(e.place('house', c, r));
  assert.ok(e.place('well', 6, 7)); assert.ok(e.place('well', 5, 7));
  assert.ok(e.place('farm', 4, 7)); assert.ok(e.place('workshop', 3, 7)); assert.ok(e.place('market', 2, 7));
  const advanceTo = target => {
    while (e.state.tick < target) {
      e.tick(); pact.update();
      if (pact.awaitingCharter) assert.equal(pact.chooseCharter('workshops'), true);
    }
  };
  advanceTo(7);
  for (const [c, r] of [[0, 0], [1, 0]]) assert.ok(e.place('house', c, r));
  assert.ok(e.place('well', 5, 0)); assert.ok(e.place('market', 3, 0)); assert.ok(e.place('workshop', 4, 0));
  advanceTo(17);
  assert.ok(e.place('farm', 1, 7));
  advanceTo(27);
  const northwest = e.place('river_quay', 2, 5), southwest = e.place('river_quay', 4, 6);
  assert.ok(northwest && southwest);
  advanceTo(28);
  const food = e.state.riverFlows.find(flow => flow.resource === 'food');
  const water = e.state.riverFlows.find(flow => flow.resource === 'water');
  assert.equal(food.amount, 4);
  assert.ok(Math.abs(water.amount - 1.7496597908508473) < 1e-9);
  assert.equal(e.state.riverFlowTick, 28);
  assert.ok(e.place('house', 2, 0));
  const pausedHouse = JSON.stringify({ flows: e.state.riverFlows, tick: e.state.riverFlowTick });
  const duplicate = e.place('river_quay', 6, 5);
  assert.ok(duplicate);
  assert.equal(JSON.stringify({ flows: e.state.riverFlows, tick: e.state.riverFlowTick }), pausedHouse);
  assert.equal(e.state.tick, 28);
  assert.equal(e.quayInfo(northwest).flowTick, 28);
  e.tick(); pact.update();
  assert.equal(e.state.tick, 29);
  assert.equal(e.state.riverFlowTick, 29);
  assert.notEqual(JSON.stringify(e.state.riverFlows), pausedHouse);
  assert.equal(e.state.riverFlows.find(flow => flow.resource === 'food').amount, 5);
  const nextWater = e.state.riverFlows.find(flow => flow.resource === 'water').amount;
  assert.ok(Number.isFinite(nextWater) && nextWater > 0 && nextWater !== water.amount);
});

test('a real tick computes crews before replacing the flow record and transferring shared capacity', () => {
  const e = engine();
  quay(e, 2, 5); quay(e, 4, 6);
  assert.deepEqual(e.state.riverNetworks, [], 'Placement alone does not invent a crew');
  resourceBuilding(e, 0, 6, { out: { food: 10, water: 10 } });
  resourceBuilding(e, 0, 0, { need: { food: 8, water: 8 } });
  resourceBuilding(e, 1, 0, { out: { workers: 100 } });
  e.tick();
  assert.equal(e.state.riverNetworks[0].effectiveCapacity, 12);
  assert.equal(e.state.riverFlows.reduce((sum, flow) => sum + flow.amount, 0), 12);
  assert.equal(e.state.riverFlows.find(flow => flow.resource === 'food').amount, 8);
  assert.equal(e.state.riverFlows.find(flow => flow.resource === 'water').amount, 4);
  const records = e.state.riverFlows;
  e.computeDistricts(1);
  assert.equal(e.state.riverFlows.length, records.length, 'Recomputation replaces rather than accumulates flows');
  assert.equal(e.state.riverFlows.reduce((sum, flow) => sum + flow.amount, 0), 12);
});

test('River transport is exactly halved on turns 120-149 and full otherwise', () => {
  for (const turn of [119, 120, 149, 150]) {
    const e = engine(RiverCityEngine);
    const first = quay(e, 2, 5);
    quay(e, 4, 6);
    resourceBuilding(e, 0, 0, { out: { workers: 100 } });
    e.state.tick = turn - 1;
    e.tick();
    const expected = turn >= 120 && turn < 150 ? 6 : 12;
    assert.equal(e.state.riverNetworks[0].effectiveCapacity, expected, `turn ${turn}`);
    assert.equal(e.state.riverNetworks[0].weatherMultiplier, turn >= 120 && turn < 150 ? 0.5 : 1);
    assert.equal(e.quayInfo(first).status, turn >= 120 && turn < 150 ? 'drought' : 'no_surplus');
  }
  const classic = engine();
  quay(classic, 2, 5); quay(classic, 4, 6);
  resourceBuilding(classic, 0, 0, { out: { workers: 100 } });
  classic.state.tick = 119;
  classic.tick();
  assert.equal(classic.state.riverNetworks[0].effectiveCapacity, 12);
});
