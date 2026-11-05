import test from 'node:test';
import assert from 'node:assert/strict';
import { CityEngine } from '../src/engine.js';
import { RiverCityEngine } from '../src/river-pact.js';
import { layerPlanForBuilding } from '../src/diorama-assets.js';
import { translate } from '../src/localization.js';
import { ARCHITECTURE_DEFAULTS, BUILDINGS, BUILDING_TRANSFORMATIONS } from '../src/data.js';
import { expectedModuleKeys } from './helpers-living-layers.mjs';

const layers = {
  floorHeight: 0.48,
  modules: Object.fromEntries(expectedModuleKeys().map(key => [key, { file: `layers/${key}.glb` }])),
};
const assembledModules = plan => [plan.baseKey,
  ...Array.from({ length: plan.floors - 1 }, () => plan.floorKey), plan.roofKey].filter(Boolean);
const modulesOf = building => assembledModules(layerPlanForBuilding(building, layers));
function assertFiniteNumbers(value, path = 'profile') {
  for (const [key, entry] of Object.entries(value || {})) {
    if (typeof entry === 'number') assert.ok(Number.isFinite(entry), `${path}.${key} must be finite`);
    else if (entry && typeof entry === 'object') assertFiniteNumbers(entry, `${path}.${key}`);
  }
}

function funded(phase = 4) {
  const engine = new CityEngine();
  engine.state.phase = phase;
  engine.state.res.money = 10000;
  engine.state.res.materials = 1000;
  return engine;
}

function snapshot(engine, building) {
  return JSON.stringify({ state: engine.state, building });
}

test('architecture is per instance, lazily initialized, and never mutates the catalogue or a neighbour', () => {
  const catalogue = JSON.stringify(BUILDINGS);
  const engine = funded(2);
  const first = engine.place('house', 0, 0);
  const neighbour = engine.place('house', 1, 0);
  assert.deepEqual(first.architecture, ARCHITECTURE_DEFAULTS.house);
  assert.deepEqual(engine.profileOf(first).inputs, BUILDINGS.house.inputs);
  assert.deepEqual(engine.profileOf(first).outputs, BUILDINGS.house.outputs);
  assert.equal(engine.transformBuilding(first, 'add_floor'), true);
  assert.equal(engine.profileOf(first).outputs.population, 12);
  assert.equal(engine.profileOf(neighbour).outputs.population, 6);
  assert.deepEqual(neighbour.architecture, { ...ARCHITECTURE_DEFAULTS.house, variant: 1 });
  assert.equal(JSON.stringify(BUILDINGS), catalogue);

  const legacy = { def: BUILDINGS.house, c: 2, r: 0, age: 17, disabled: false };
  engine.state.buildings.push(legacy);
  engine.occ[0][2] = legacy;
  assert.equal(legacy.architecture, undefined);
  assert.equal(engine.profileOf(legacy).outputs.population, 6);
  assert.deepEqual(legacy.architecture, ARCHITECTURE_DEFAULTS.house, 'Legacy instances keep their original appearance');
});

test('new houses use deterministic tile variants in a 3x3 block and after restart', () => {
  const buildBlock = () => {
    const engine = funded(1);
    const houses = [];
    for (let r = 6; r < 9; r++) for (let c = 0; c < 3; c++) houses.push(engine.place('house', c, r, { family: 'works' }));
    return { engine, houses };
  };
  const { engine, houses } = buildBlock();
  assert.equal(houses.length, 9);
  for (const house of houses) {
    assert.equal(house.architecture.family, 'works');
    assert.equal(house.architecture.variant, (house.c + 2 * house.r) % 3);
  }
  for (const variant of [0, 1, 2]) assert.equal(houses.filter(house => house.architecture.variant === variant).length, 3);
  const before = houses.map(house => ({ ...house.architecture }));
  engine.tick();
  assert.deepEqual(houses.map(house => ({ ...house.architecture })), before, 'Simulation time does not change appearance');
  assert.deepEqual(buildBlock().houses.map(house => ({ ...house.architecture })), before, 'Restart repeats the same appearance');
});

test('house families have identical economics and preserve deterministic details during later work', () => {
  const profiles = [];
  for (const family of ['banks', 'works', 'gardens']) {
    const engine = funded(2);
    const money = engine.state.res.money, materials = engine.state.res.materials;
    const house = engine.place('house', 0, 0, { family });
    assert.equal(engine.state.res.money, money - BUILDINGS.house.cost.money);
    assert.equal(engine.state.res.materials, materials);
    assert.equal(engine.transformBuilding(house, 'add_floor'), true);
    assert.equal(house.architecture.family, family);
    assert.equal(house.architecture.variant, 0);
    const { architecture, ...profile } = engine.profileOf(house);
    profiles.push(profile);
  }
  assert.deepEqual(profiles[0], profiles[1]);
  assert.deepEqual(profiles[1], profiles[2]);
  const engine = funded(2);
  const house = engine.place('house', 1, 0, { family: 'invalid' });
  assert.equal(house.architecture.family, 'banks', 'Invalid aesthetic input falls back to Banks');
  assert.equal(house.architecture.variant, 1);
  const money = engine.state.res.money, materials = engine.state.res.materials;
  assert.equal(engine.transformBuilding(house, 'family_works'), true);
  assert.equal(engine.state.res.money, money - 12);
  assert.equal(engine.state.res.materials, materials - 2);
  assert.equal(house.architecture.variant, 1, 'Aesthetic renovation does not alter the tile variant');
});

test('offers expose complete cloned profiles and exact progressive house costs', () => {
  const engine = funded(1);
  const house = engine.place('house', 0, 0);
  let offer = engine.transformationOptions(house).find(option => option.id === 'add_floor');
  assert.equal(offer.phase, 2);
  assert.deepEqual(offer.cost, { money: 30, materials: 4 });
  assert.equal(offer.before.outputs.population, 6);
  assert.equal(offer.after.outputs.population, 12);
  assert.notEqual(offer.before, offer.after);
  assert.notEqual(offer.before.outputs, offer.after.outputs);
  offer.before.outputs.population = 999;
  offer.after.architecture.floors = 4;
  assert.equal(engine.profileOf(house).outputs.population, 6);
  assert.equal(house.architecture.floors, 1);

  engine.state.phase = 2;
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  offer = engine.transformationOptions(house).find(option => option.id === 'add_floor');
  assert.equal(offer.phase, 3);
  assert.deepEqual(offer.cost, { money: 45, materials: 8 });
  engine.state.phase = 3;
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  offer = engine.transformationOptions(house).find(option => option.id === 'add_floor');
  assert.equal(offer.phase, 4);
  assert.deepEqual(offer.cost, { money: 70, materials: 14 });
});

test('locked, unaffordable, detached, duplicate and maximum-floor refusals are atomic', () => {
  const engine = funded(1);
  const house = engine.place('house', 0, 0);
  const refused = (id, pattern) => {
    const before = snapshot(engine, house);
    assert.match(engine.transformationBlockReason(house, id), pattern);
    assert.equal(engine.transformBuilding(house, id), false);
    assert.equal(snapshot(engine, house), before);
  };
  refused('add_floor', /phase 2/);
  refused('roof_garden', /phase 3/);
  refused('roof_productive', /phase 4/);
  refused('roof_traditional', /already applied/);
  refused('unknown', /not available/);
  const detached = { ...house };
  const beforeDetached = snapshot(engine, house);
  assert.equal(engine.transformBuilding(detached, 'add_floor'), false);
  assert.equal(snapshot(engine, house), beforeDetached);

  engine.state.phase = 2;
  engine.state.res.money = 29;
  refused('add_floor', /money/);
  engine.state.res.money = 100;
  engine.state.res.materials = 3;
  refused('add_floor', /materials/);
  engine.state.res.materials = 100;
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  house.disabled = true;
  refused('variant_1', /back in service/);
  house.disabled = false;
  house.architecture.floors = 4;
  refused('add_floor', /four floors/);
});

test('residential floors and a ground-floor shop change capacity, demand and local service', () => {
  const engine = funded(4);
  const house = engine.place('house', 0, 0);
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  let profile = engine.profileOf(house);
  assert.deepEqual(profile.outputs, { population: 18, workers: 9, money: 6 });
  assert.deepEqual(profile.inputs, { food: 3, water: 3 });
  assert.ok(profile.ext.maintenance > 0);
  assert.ok(profile.upkeep > BUILDINGS.house.cost.money / 160);

  assert.equal(engine.transformBuilding(house, 'base_shop'), true);
  profile = engine.profileOf(house);
  assert.equal(profile.outputs.population, 12, 'only the six ground-floor homes are lost');
  assert.equal(profile.outputs.workers, 6);
  assert.equal(profile.outputs.money, 10);
  assert.equal(profile.inputs.energy, 1);
  assert.equal(profile.inputs.workers, 2);
  assert.ok(profile.ext.distribution >= 4);
  assert.equal(engine.transformBuilding(house, 'base_residential'), true);
  assert.equal(engine.profileOf(house).outputs.population, 18);
});

test('shop congestion stays finite at every height, on return to housing and in River Pact', () => {
  for (let floors = 1; floors <= 4; floors++) {
    const engine = funded(4);
    const house = engine.place('house', 0, 0);
    for (let level = 1; level < floors; level++) assert.equal(engine.transformBuilding(house, 'add_floor'), true);
    assert.equal(engine.transformBuilding(house, 'base_shop'), true);
    const shop = engine.profileOf(house);
    assert.ok(Math.abs(shop.ext.congestion - (1 + 0.3 * (floors - 1))) < 1e-8);
    assertFiniteNumbers(shop, `shop floor ${floors}`);
    assert.equal(engine.transformBuilding(house, 'base_residential'), true);
    assertFiniteNumbers(engine.profileOf(house), `housing floor ${floors}`);
    assert.equal(engine.profileOf(house).outputs.population, floors * 6);
  }
  const river = new RiverCityEngine();
  river.state.phase = 4;
  river.state.res.materials = 100;
  const house = river.place('house', 0, 0);
  assert.equal(river.transformBuilding(house, 'base_shop'), true);
  river.state.tick = 120;
  river.tick();
  assertFiniteNumbers(river.profileOf(house), 'River shop');
  assert.ok(Number.isFinite(river.state.res.congestion));
  assert.ok(river.congField.flat().every(Number.isFinite));
  assert.equal(river.transformBuilding(house, 'base_residential'), true);
  assertFiniteNumbers(river.profileOf(house), 'River housing');
});

test('a shop has real consumption, sales income and district distribution in simulation', () => {
  const engine = funded(4);
  engine.state.unlocked.add('generator');
  const shop = engine.place('house', 0, 0);
  engine.place('house', 1, 0);
  engine.place('well', 2, 0);
  engine.place('farm', 3, 0);
  engine.place('generator', 4, 0);
  engine.place('market', 5, 0);
  assert.equal(engine.transformBuilding(shop, 'base_shop'), true);
  engine.state.res.population = 6;
  for (let i = 0; i < 12; i++) engine.tick();
  assert.ok(shop.activity > 0);
  assert.ok(shop.flowInput.food > 0 && shop.flowInput.water > 0 && shop.flowInput.energy > 0);
  assert.ok(shop.income > 0);
  assert.ok(engine.state.districts[0].distribution > 0);
});

test('a mixed-use shop gates sales and distribution on energy without suppressing homes or rent', () => {
  const engine = funded(4);
  const shop = engine.place('house', 0, 0);
  engine.place('well', 1, 0);
  engine.place('farm', 2, 0);
  assert.equal(engine.transformBuilding(shop, 'add_floor'), true);
  assert.equal(engine.transformBuilding(shop, 'base_shop'), true);
  assert.deepEqual(engine.profileOf(shop).outputs, { population: 6, workers: 3, money: 8 });
  engine.state.res.population = 6;
  engine.tick();
  assert.equal(shop.activity, 0, 'The shop cannot trade without energy');
  assert.equal(shop.flowOutput.sales, 0);
  assert.equal(engine.state.districts[0].distribution, 0);
  assert.ok(shop.flowOutput.population > 0, 'Upper homes remain available');
  assert.ok(shop.flowOutput.rent > 0 && shop.income > 0, 'Rent is not treated as commercial sales');
  engine.state.unlocked.add('generator');
  engine.place('generator', 3, 0);
  engine.tick();
  engine.tick();
  assert.ok(shop.activity > 0);
  assert.ok(shop.flowOutput.sales > 0);
  assert.ok(shop.flowOutput.rent > 0);
  assert.ok(engine.state.districts[0].distribution > 0);
});

test('variant offers and transactions match the modules actually assembled', () => {
  const reason = 'This variant assembles the same building modules.';
  assert.notEqual(translate(reason, 'fr'), reason, 'The no-op refusal is localized');
  const check = (engine, building, id, visible) => {
    const option = engine.transformationOptions(building).find(offer => offer.id === id);
    const before = modulesOf(building);
    const after = assembledModules(layerPlanForBuilding({ ...building, architecture: option.after.architecture }, layers));
    if (!visible) {
      assert.deepEqual(after, before, `${id}: fixture must represent identical modules`);
      assert.equal(option.reason, reason);
      const state = snapshot(engine, building);
      assert.equal(engine.transformBuilding(building, id), false);
      assert.equal(snapshot(engine, building), state, `${id}: refusal is atomic`);
    } else {
      assert.notDeepEqual(after, before, `${id}: accepted variant changes assembled modules`);
      assert.equal(option.reason, null);
      assert.equal(engine.transformBuilding(building, id), true);
      assert.notDeepEqual(modulesOf(building), before);
    }
  };

  let engine = funded(4), building = engine.place('workshop', 0, 0);
  check(engine, building, 'variant_2', false);
  check(engine, building, 'variant_1', true);

  engine = funded(4);
  engine.state.unlocked.add('warehouse');
  building = engine.place('warehouse', 0, 0);
  check(engine, building, 'variant_2', false);
  check(engine, building, 'variant_1', true);

  for (const type of ['warehouse', 'shop']) for (const roof of ['garden', 'productive']) {
    engine = funded(4);
    engine.state.unlocked.add('warehouse');
    building = engine.place(type === 'shop' ? 'house' : 'warehouse', 0, 0);
    if (type === 'shop') assert.equal(engine.transformBuilding(building, 'base_shop'), true);
    assert.equal(engine.transformBuilding(building, `roof_${roof}`), true);
    check(engine, building, 'variant_1', false);
    check(engine, building, 'variant_2', false);
  }

  engine = funded(4);
  engine.state.unlocked.add('warehouse');
  building = engine.place('warehouse', 0, 0);
  assert.equal(engine.transformBuilding(building, 'add_floor'), true);
  assert.equal(engine.transformBuilding(building, 'roof_garden'), true);
  check(engine, building, 'variant_2', true);
  check(engine, building, 'variant_1', true);

  engine = funded(4);
  building = engine.place('workshop', 0, 0);
  assert.equal(engine.transformBuilding(building, 'add_floor'), true);
  check(engine, building, 'variant_2', true);

  engine = funded(4);
  building = engine.place('house', 0, 0);
  check(engine, building, 'variant_2', true);
});

test('garden and productive roofs have distinct real effects and gardens are not parks', () => {
  const engine = funded(3);
  const house = engine.place('house', 0, 0);
  assert.equal(engine.transformBuilding(house, 'roof_garden'), true);
  let profile = engine.profileOf(house);
  assert.equal(profile.inputs.water, 2);
  assert.ok(profile.ext.cooling >= 4);
  assert.ok(profile.outputs.trust > 0);
  assert.equal(engine.byId('park'), 0);
  assert.ok(engine.coolField[0][0] >= 4);
  assert.equal(engine.transformBuilding(house, 'roof_traditional'), true);
  assert.equal(engine.profileOf(house).outputs.food ?? 0, 0);
  assert.equal(engine.transformBuilding(house, 'roof_productive'), false, 'productive roofs remain locked in phase 3');
  engine.state.phase = 4;
  assert.equal(engine.transformBuilding(house, 'roof_productive'), true);
  profile = engine.profileOf(house);
  assert.equal(profile.inputs.water, 3);
  assert.equal(profile.outputs.food, 5);
  assert.equal(profile.outputs.energy, 2);
  engine.tick();
  assert.equal(house.flowOutput.food, 0, 'A dry productive roof grows no food');
  assert.equal(house.flowOutput.energy, 0, 'A dry productive annex generates no energy');
  assert.ok(house.flowOutput.population > 0, 'Water control does not remove housing capacity');
  engine.place('well', 1, 0);
  engine.tick();
  engine.tick();
  assert.ok(house.flowOutput.food > 0);
  assert.ok(house.flowOutput.energy > 0);
  assert.ok(house.flowInput.water > 0);
});

test('warehouse hall gives up central storage and provides staffed local services', () => {
  const engine = funded(3);
  engine.state.unlocked.add('warehouse');
  const warehouse = engine.place('warehouse', 0, 0);
  warehouse.age = 18;
  engine.place('house', 1, 0);
  engine.place('well', 2, 0);
  engine.place('farm', 3, 0);
  assert.equal(engine.profileOf(warehouse).ext.capacity, 4);
  const age = warehouse.age;
  assert.equal(engine.convertBuilding(warehouse, 'warehouse_hall'), true);
  const profile = engine.profileOf(warehouse);
  assert.equal(warehouse.conversion, 'warehouse_hall');
  assert.equal(warehouse.age, age);
  assert.equal(profile.ext.capacity ?? 0, 0);
  assert.equal(profile.ext.centralization ?? 0, 0);
  assert.equal(profile.tags.includes('storage'), false);
  assert.equal(profile.tags.includes('centralized'), false);
  assert.ok(profile.ext.distribution > 0);
  assert.deepEqual(engine.transformationOptions(warehouse), []);
  const convertedSnapshot = snapshot(engine, warehouse);
  assert.equal(engine.transformBuilding(warehouse, 'roof_garden'), false);
  assert.equal(snapshot(engine, warehouse), convertedSnapshot);
  engine.state.res.population = 6;
  for (let i = 0; i < 8; i++) engine.tick();
  assert.ok(warehouse.flowOutput.trust > 0);
  assert.ok(warehouse.flowInput.food > 0);
  assert.ok(engine.state.districts[0].distribution > 0);
  const beforeDemolition = engine.state.res.money;
  assert.equal(engine.removeAt(warehouse.c, warehouse.r), true);
  assert.ok(Math.abs(engine.state.res.money - beforeDemolition - 64) < 1e-8, '40% of the 90 € purchase and 70 € conversion');
});

test('maintenance cascade never targets a reconverted neighborhood hall', () => {
  const engine = funded(4);
  engine.state.unlocked.add('warehouse');
  engine.state.unlocked.add('generator');
  const hall = engine.place('warehouse', 0, 0);
  const generator = engine.place('generator', 1, 0);
  hall.age = 18;
  assert.equal(engine.convertBuilding(hall, 'warehouse_hall'), true);
  engine.congField[0][0] = 100;
  engine.fireMaintenanceCascade();
  assert.equal(hall.disabled, false, 'The hall no longer has a centralized profile');
  assert.equal(generator.disabled, true, 'The remaining centralized hub takes the outage');
});

test('commons unlock in phase 3, charge their full cost and provide real services', () => {
  const engine = new CityEngine();
  engine.fireLogisticsCrisis();
  assert.equal(engine.state.unlocked.has('commons'), true);
  assert.equal(engine.place('commons', 0, 0), null, 'the material cost is enforced');
  engine.state.res.money = 1000;
  engine.state.res.materials = 20;
  const commons = engine.place('commons', 0, 0);
  assert.ok(commons);
  assert.equal(engine.state.res.money, 895);
  assert.equal(engine.state.res.materials, 12);
  engine.place('house', 1, 0);
  engine.place('well', 2, 0);
  engine.place('farm', 3, 0);
  engine.state.res.population = 6;
  for (let i = 0; i < 8; i++) engine.tick();
  assert.ok(commons.flowOutput.trust > 0);
  assert.ok(commons.flowInput.water > 0);
  assert.ok(engine.state.districts[0].maintenanceCapacity > 0);
  assert.ok(engine.state.districts[0].distribution > 0);
});

test('standalone Commons rejects every transformation family atomically and keeps its civic layer plan', () => {
  const engine = funded(4);
  engine.state.unlocked.add('commons');
  const commons = engine.place('commons', 0, 0);
  const layers = { floorHeight: 0.48, modules: { base_civic: { file: 'layers/base_civic.glb' } } };
  const planBefore = layerPlanForBuilding(commons, layers);
  assert.equal(planBefore.signature, 'base_civic|standalone');
  assert.equal(planBefore.floors, 1);
  assert.equal(planBefore.roofKey, null);
  assert.deepEqual(engine.transformationOptions(commons), []);
  for (const id of Object.keys(BUILDING_TRANSFORMATIONS)) {
    const before = snapshot(engine, commons);
    const profileBefore = JSON.stringify(engine.profileOf(commons));
    assert.equal(engine.transformationBlockReason(commons, id), 'This civic building cannot be expanded.', id);
    assert.equal(engine.transformBuilding(commons, id), false, id);
    assert.equal(snapshot(engine, commons), before, `${id}: money, materials, architecture, investment and history stay unchanged`);
    assert.equal(JSON.stringify(engine.profileOf(commons)), profileBefore, `${id}: economic profile stays unchanged`);
  }
  assert.deepEqual(commons.architecture, ARCHITECTURE_DEFAULTS.commons);
  assert.equal(commons.investedMoney, BUILDINGS.commons.cost.money);
  assert.deepEqual(commons.history, []);
  assert.equal(layerPlanForBuilding(commons, layers).signature, planBefore.signature);
});

test('houses, workshops, warehouses and their conversions retain transformation rights', () => {
  const engine = funded(4);
  engine.state.unlocked.add('warehouse');
  const house = engine.place('house', 0, 0);
  const workshop = engine.place('workshop', 1, 0);
  const warehouse = engine.place('warehouse', 2, 0);
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  assert.equal(engine.transformBuilding(workshop, 'family_gardens'), true);
  assert.equal(engine.transformBuilding(warehouse, 'roof_garden'), true);
  workshop.age = 24;
  warehouse.age = 18;
  assert.equal(engine.convertBuilding(workshop, 'workshop_repair'), true);
  assert.equal(engine.convertBuilding(warehouse, 'warehouse_hall'), true);
  assert.equal(workshop.conversion, 'workshop_repair');
  assert.equal(warehouse.conversion, 'warehouse_hall');
});

test('history preserves age and demolition refunds forty percent of all invested money', () => {
  const engine = funded(3);
  const house = engine.place('house', 0, 0);
  house.age = 37;
  engine.state.tick = 50;
  const createdAt = house.createdAt;
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  engine.state.tick = 51;
  assert.equal(engine.transformBuilding(house, 'roof_garden'), true);
  assert.equal(house.age, 37);
  assert.equal(house.createdAt, createdAt);
  assert.equal(house.investedMoney, 125);
  assert.deepEqual(house.history.map(event => event.type), ['transformation', 'transformation']);
  assert.deepEqual(house.history.map(event => event.tick), [50, 51]);
  for (const event of house.history) assert.deepEqual(Object.keys(event).sort(), ['label', 'tick', 'type']);
  const before = engine.state.res.money;
  assert.equal(engine.removeAt(0, 0), true);
  assert.ok(Math.abs(engine.state.res.money - before - 50) < 1e-8);
});

test('River Pact drought wraps transformed profiles without changing their demand or the base catalogue', () => {
  const catalogue = JSON.stringify(BUILDINGS);
  const engine = new RiverCityEngine();
  engine.state.phase = 4;
  engine.state.res.money = 1000;
  engine.state.res.materials = 100;
  const house = engine.place('house', 0, 0);
  const well = engine.place('well', 1, 0);
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  assert.equal(engine.transformBuilding(house, 'roof_productive'), true);
  engine.state.tick = 120;
  const profile = engine.profileOf(house);
  assert.equal(profile.inputs.water, 5);
  assert.equal(profile.outputs.food, 5);
  assert.equal(profile.outputs.population, 18);
  assert.equal(engine.profileOf(well).outputs.water, BUILDINGS.well.outputs.water * 0.55);
  assert.equal(JSON.stringify(BUILDINGS), catalogue);
});
