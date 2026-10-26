/* Behavioural regression checks for the playable rules.
 * Run: node test/gameplay-regressions.mjs
 * The two full playthroughs use only place/tick/convertBuilding, the initial
 * 600 EUR and natural unlocks. Small conversion fixtures explicitly seed an
 * age/phase to isolate validation; they are not evidence of progression.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CityEngine, VICTORY_POP } from '../src/engine.js';
import { run, places, buy, summary, foundation, settle, playSober, playIndustrial } from './playthrough-helpers.mjs';

test('les logements privés de services ne sont pas une rente sans risque', () => {
  const e = new CityEngine();
  places(e, 'house', [[0, 0], [1, 0]]);
  const afterBuild = e.state.res.money;
  run(e, 400);
  assert.ok(e.state.res.money <= afterBuild, `Unserved houses earned ${e.state.res.money - afterBuild} EUR`);
  assert.ok((e.state.flowNet.money ?? 0) <= 0, 'No recurring revenue without water or food');
});

test('la position du marché change la desserte et la population de son quartier', () => {
  function town(localMarket) {
    const e = new CityEngine();
    places(e, 'house', [[0, 7], [1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [0, 8], [1, 8]]);
    places(e, 'farm', [[2, 8], [3, 8]]);
    places(e, 'well', [[4, 8], [5, 8], [6, 8], [7, 8]]);
    places(e, 'market', [localMarket ? [6, 7] : [12, 0]]);
    run(e, 100);
    return e;
  }
  const local = town(true), remote = town(false);
  assert.ok(local.state.districts[2].access > remote.state.districts[2].access + 0.05, 'A remote market must not serve the same district');
  assert.ok(local.state.res.population > remote.state.res.population + 1, 'District service must affect real occupancy');
});

test('une liaison continue importe des ressources, trois chemins isolés ne le font pas', () => {
  function town(linked) {
    const e = new CityEngine();
    places(e, 'house', [[4, 8], [5, 8], [10, 7], [10, 8]]);
    places(e, 'well', [[4, 7], [6, 7]]);
    places(e, 'farm', [[5, 7]]);
    places(e, 'path', linked ? [[7, 7], [8, 7], [9, 7]] : [[0, 11], [3, 11], [15, 11]]);
    run(e, 80);
    return e;
  }
  const linked = town(true), isolated = town(false);
  assert.ok(linked.state.districts[3].access > isolated.state.districts[3].access + 0.05, 'Connected districts must receive imports');
  assert.ok(linked.state.res.population > isolated.state.res.population + 0.5, 'Transport must affect actual inhabitants, not only a diagnostic');
  const suppliedAccess = linked.state.districts[3].access;
  assert.equal(linked.removeAt(8, 7), true);
  run(linked, 20);
  assert.ok(linked.state.districts[3].access < suppliedAccess - 0.05, 'Removing the linking cell cuts the import rather than leaving a cached connection');
});

test('une ferme privée d’eau locale ne fabrique pas de nourriture grâce au stock d’un autre quartier', () => {
  function farmTown(localWater) {
    const e = new CityEngine();
    places(e, 'house', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
    places(e, 'well', [localWater ? [1, 8] : [12, 7]]);
    places(e, 'farm', [[0, 8]]);
    run(e, 10);
    return e;
  }
  const supplied = farmTown(true), dry = farmTown(false);
  assert.ok(supplied.state.flow.food > 1, 'Local water and initial workforce can start farming');
  assert.ok(dry.state.flow.food < supplied.state.flow.food * 0.1, 'An unconnected district cannot consume another district’s water');
});

test('deux liaisons ne doublent pas le surplus exporté et la panne du producteur coupe les livraisons', () => {
  const e = new CityEngine();
  places(e, 'house', [[4, 8], [5, 9], [10, 7], [10, 8], [11, 8], [10, 10], [11, 10], [12, 10]]);
  const sourceWells = places(e, 'well', [[6, 7], [6, 10]]);
  places(e, 'well', [[12, 8], [13, 8]]);
  places(e, 'farm', [[5, 8]]);
  places(e, 'path', [[7, 7], [8, 7], [9, 7], [7, 10], [8, 10], [9, 10]]);
  run(e, 20);
  assert.equal(e.state.transportNetworks.length, 2);
  assert.ok(e.state.districts[3].foodImports > 0);
  for (const resource of ['food', 'water']) {
    const imports = e.state.districts.reduce((sum, d) => sum + d[resource + 'Imports'], 0);
    const exports = e.state.districts.reduce((sum, d) => sum + d[resource + 'Exports'], 0);
    assert.ok(Math.abs(imports - exports) < 1e-8, `${resource} is transferred, not created`);
    for (const d of e.state.districts) assert.ok(d[resource + 'Exports'] <= Math.max(0, d[resource + 'Out'] + d[resource + 'Imports'] - d[resource + 'Need']) + 1e-8, 'A second route cannot sell the same surplus twice');
  }
  const before = e.state.districts[3].foodImports;
  // Explicit failure fixture, equivalent to unavailable water infrastructure.
  for (const well of sourceWells) well.disabled = true;
  run(e, 5);
  assert.ok(e.state.districts[3].foodImports < before * 0.1, 'A dry farm cannot keep exporting cached production');
});

test('la croissance sans eau ni nourriture conduit toujours à une défaite explicable', () => {
  const e = new CityEngine();
  buy(e, 'house', 15);
  run(e, 300);
  assert.equal(e.state.outcome, 'defeat');
  assert.match(e.state.outcomeInfo.reason, /water|food|vital|essential/i);
});

test('le démarrage normal passe en phase 2 sans argent ni travailleurs injectés', () => {
  const { e } = foundation();
  assert.ok(e.state.res.population >= 35);
  assert.ok(e.state.unlocked.has('generator'));
  assert.ok(e.state.res.money >= 0);
});

test('les stocks locaux amortissent une rupture puis s’épuisent réellement', () => {
  const { e } = foundation();
  run(e, 60);
  const beforePopulation = e.state.res.population;
  const beforeFood = e.state.res.food;
  assert.ok(beforeFood > 20, 'The town has filled its food reserve');
  for (const farm of e.state.buildings.filter(b => b.def.id === 'farm')) assert.equal(e.removeAt(farm.c, farm.r), true);
  run(e, 1);
  assert.ok(e.state.ratios.foodR >= 0.99, 'A temporary interruption uses the local reserve');
  assert.ok(e.state.res.population > beforePopulation * 0.9, 'Residents do not flee with food still available');
  assert.ok(e.state.res.food < beforeFood, 'The buffer is really consumed');
  assert.ok(Math.abs(e.localStocks.reduce((sum, s) => sum + s.food, 0) - e.state.res.food) < 1e-8, 'HUD stock equals the sum of local reserves');
  run(e, 120);
  assert.equal(e.state.outcome, 'defeat', 'The reserve cannot feed the city forever');
  assert.ok(e.state.res.food < 1);
});

test('une centrale bien refroidie ne bloque pas la maturité d’une ville préventive', () => {
  const { e } = foundation();
  const generator = buy(e, 'generator', 1, { district: 1 })[0];
  buy(e, 'park', 4, { district: 1, near: [generator.c, generator.r] });
  buy(e, 'well', 2, { district: 2 });
  buy(e, 'farm', 1, { district: 2 });
  buy(e, 'house', 5, { district: 2 });
  buy(e, 'market', 1, { district: 2 });
  settle(e, 0);
  run(e, 60);
  assert.equal(e.state.events.heatFired, false);
  assert.ok(e.state.phase >= 4, 'Maturity depends on healthy growth, not on deleting every generator');
});

function conversionFixture() {
  const e = new CityEngine();
  // Isolated rule fixture: phase and budget deliberately seeded, not a playthrough.
  e.state.phase = 3;
  e.state.res.money = 1000;
  e.state.res.materials = 100;
  const b = places(e, 'workshop', [[2, 7]])[0];
  b.age = 24;
  return { e, b };
}

test('la reconversion respecte phase, âge, ressources, identité et refus atomiques', () => {
  const { e, b } = conversionFixture();
  assert.equal(typeof e.convertBuilding, 'function');
  const id = 'workshop_repair';
  assert.ok(e.conversionOptions(b).some(option => option.id === id), 'The offered action names the supported conversion');
  assert.equal(e.convertBuilding({ ...b }, id), false, 'A detached copy is not an owned city building');
  assert.equal(e.convertBuilding(b, 'unknown_conversion'), false);
  const unchangedAfter = mutate => {
    mutate();
    const before = JSON.stringify({ state: e.state, b });
    assert.equal(e.convertBuilding(b, id), false);
    assert.equal(JSON.stringify({ state: e.state, b }), before, 'A refused conversion must not consume anything or alter state');
  };
  unchangedAfter(() => { e.state.phase = 2; });
  unchangedAfter(() => { e.state.phase = 3; b.age = 23; });
  unchangedAfter(() => { b.age = 24; e.state.res.money = 64; });
  unchangedAfter(() => { e.state.res.money = 1000; e.state.res.materials = 19; });
  e.state.res.materials = 100;
  unchangedAfter(() => { b.disabled = true; });
  b.disabled = false;
  const originalDef = b.def, originalAge = b.age, originalPosition = [b.c, b.r], originalCount = e.state.buildings.length;
  const beforeMoney = e.state.res.money, beforeMaterials = e.state.res.materials;
  assert.equal(e.conversionBlockReason(b, id), null);
  assert.equal(e.convertBuilding(b, id), true);
  assert.equal(e.state.res.money, beforeMoney - 65);
  assert.equal(e.state.res.materials, beforeMaterials - 20);
  assert.equal(b.def, originalDef, 'The original model key and footprint stay intact');
  assert.equal(b.age, originalAge);
  assert.deepEqual([b.c, b.r], originalPosition);
  assert.equal(e.state.buildings.length, originalCount);
  assert.equal(e.profileOf(b).outputs.materials ?? 0, 0, 'A repair workshop gives up material production');
  assert.equal(e.profileOf(b).outputs.money ?? 0, 0, 'Conversion does not retain the old commercial revenue');
  assert.ok((e.profileOf(b).ext.maintenance ?? 0) < 0);
  const after = JSON.stringify({ state: e.state, b });
  assert.equal(e.convertBuilding(b, id), false, 'Cannot pay twice for the same conversion');
  assert.equal(JSON.stringify({ state: e.state, b }), after);
});

test('la reconversion fournit réellement de l’entretien dans son quartier et sacrifie sa production', () => {
  function fixture(converted) {
    const { e, b } = conversionFixture();
    places(e, 'house', [[0, 7], [1, 7], [3, 7], [4, 7], [5, 7], [6, 7], [0, 0], [1, 0]]);
    places(e, 'well', [[0, 8], [1, 8], [4, 8], [0, 1], [1, 1]]);
    places(e, 'farm', [[2, 8], [3, 8], [2, 0]]);
    places(e, 'market', [[5, 8]]);
    run(e, 45);
    if (converted) assert.equal(e.convertBuilding(b, 'workshop_repair'), true);
    run(e, 1);
    return e;
  }
  const producer = fixture(false), converted = fixture(true);
  assert.ok(converted.state.districts[2].maintenanceCapacity > producer.state.districts[2].maintenanceCapacity, 'Repair services reach the workshop district');
  assert.equal(converted.state.districts[0].maintenanceCapacity, producer.state.districts[0].maintenanceCapacity, 'A workshop does not repair a distant district for free');
  assert.ok(converted.state.flow.materials < producer.state.flow.materials, 'The loss of material production is applied in the actual simulation');
});

test('la victoire sobre récompense un entretien anticipé et des quartiers desservis', () => {
  const e = playSober(true);
  assert.equal(e.state.outcome, 'victory', JSON.stringify({ ...summary(e), objectives: e.victoryProgress() }));
  assert.ok(e.state.res.population >= VICTORY_POP);
  assert.equal(e.state.events.heatFired, false, 'No heat crisis is required to win');
  assert.ok(e.state.districts.filter(d => d.pop > 1).every(d => d.access >= 0.8), 'Victory cannot ignore an inhabited, unserved district');
  assert.ok(e.victoryProgress().every(item => item.met), 'The player-facing objectives agree with the actual victory');
  console.log('normal sober playthrough', JSON.stringify(summary(e)));
});

test('entretenir après le vieillissement reste viable sans rendre la prévention obligatoire', () => {
  const e = playSober(false);
  assert.equal(e.state.outcome, 'victory', JSON.stringify(summary(e)));
  assert.equal(e.state.events.heatFired, false);
  assert.ok(e.state.res.population >= VICTORY_POP);
  console.log('normal late-care playthrough', JSON.stringify(summary(e)));
});

test('une trajectoire industrielle normale reste viable avec services et entretien', () => {
  const e = playIndustrial();
  assert.equal(e.state.outcome, 'victory', JSON.stringify({ ...summary(e), objectives: e.victoryProgress() }));
  assert.ok(e.state.res.population >= VICTORY_POP);
  assert.ok(e.byId('factory') > 0 && e.byId('generator') > 0);
  assert.ok(e.state.districts.filter(d => d.pop > 1).every(d => d.access >= 0.8));
  assert.ok(e.victoryProgress().every(item => item.met));
  console.log('normal industrial playthrough', JSON.stringify(summary(e)));
});
