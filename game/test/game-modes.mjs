import assert from "node:assert/strict";
import test from "node:test";
import { CityEngine } from "../src/engine.js";
import { BUILDINGS, INITIAL_UNLOCKED, COLS, ROWS } from "../src/data.js";
import { FirstNeighbourhood, BEST_STORAGE_KEY } from "../src/challenge.js";
import { RiverCityEngine, RiverPact, PACT } from "../src/river-pact.js";

function land(engine, predicate = () => true) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (engine.terrain[r][c] !== 1 && !engine.occ[r][c] && predicate(c, r)) return { c, r };
  }
  assert.fail("test requires a suitable empty land tile");
}
function place(engine, id) {
  const cell = land(engine, (c, r) => id !== "river_quay" || engine.waterSides(c, r).length);
  const building = engine.place(id, cell.c, cell.r);
  assert.ok(building, `${id}: ${engine.placeBlockReason(id, cell.c, cell.r)}`);
  return building;
}
function unchanged(engine, action, expected) {
  const before = JSON.stringify(engine.state);
  assert.equal(action(), expected);
  assert.equal(JSON.stringify(engine.state), before, "a refused operation must be atomic");
}
function finite(value, path = "state", seen = new Set()) {
  if (typeof value === "number") { assert.ok(Number.isFinite(value), `${path} must be finite`); return; }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) finite(item, `${path}.${key}`, seen);
}

test("classic remains the default; sandbox retains its normal opening budget and progression", () => {
  for (const mode of [undefined, "classic", "sandbox", "unknown"]) {
    const engine = new CityEngine(mode === undefined ? undefined : { mode });
    assert.equal(engine.creative, false);
    assert.equal(engine.endless, mode === "sandbox");
    assert.equal(engine.mode, mode === "sandbox" ? "sandbox" : "classic");
    assert.equal(engine.state.res.money, 600);
    assert.equal(engine.state.res.materials, 0);
    assert.equal(engine.state.phase, 1);
    assert.equal(engine.state.speed, 0);
    assert.deepEqual(engine.state.unlocked, new Set(INITIAL_UNLOCKED));
    const cell = land(engine);
    assert.match(engine.placeBlockReason("factory", cell.c, cell.r), /unlocked/);
  }
});

test("creative exposes every building without forcing the simulation into phase four", () => {
  const engine = new CityEngine({ mode: "creative" });
  assert.equal(engine.creative, true);
  assert.equal(engine.endless, true);
  assert.equal(engine.state.phase, 1);
  assert.deepEqual(engine.state.unlocked, new Set(Object.keys(BUILDINGS)));
  assert.equal(engine.state.res.money, 600);
  assert.equal(engine.state.res.materials, 0);
  assert.deepEqual(engine.state.events, { logisticsFired: false, heatFired: false, maintFired: false });
});

test("every creative building is free, even with a negative real balance, and demolition gives no money", () => {
  const engine = new CityEngine({ mode: "creative" });
  engine.state.res.money = -300;
  for (const id of Object.keys(BUILDINGS)) {
    const building = place(engine, id);
    assert.equal(building.investedMoney, 0, `${id} was not paid for`);
    assert.equal(engine.state.res.money, -300);
    assert.equal(engine.state.res.materials, 0);
  }
  for (const building of [...engine.state.buildings]) {
    assert.equal(engine.removeAt(building.c, building.r), true);
    assert.equal(engine.state.res.money, -300, "free buildings must not create demolition income");
  }
  assert.equal(engine.state.buildings.length, 0);
});

test("creative cost helpers expose actual charges without changing nominal shared definitions", () => {
  const engine = new CityEngine({ mode: "creative" });
  const before = JSON.stringify(BUILDINGS);
  const nominal = Object.freeze({ money: 120, materials: 25 });
  const balances = { ...engine.state.res };
  assert.deepEqual(engine.constructionCost(nominal), { money: 0, materials: 0 });
  assert.equal(engine.costBlockReason(nominal), null);
  assert.deepEqual(engine.payCost(nominal), { money: 0, materials: 0 });
  assert.deepEqual(engine.state.res, balances);
  assert.equal(JSON.stringify(BUILDINGS), before);
  assert.deepEqual(new CityEngine().constructionCost(nominal), nominal);
});

test("creative still respects map, occupied tiles and exact river-quay targets", () => {
  const engine = new CityEngine({ mode: "creative" });
  unchanged(engine, () => engine.place("house", -1, 0), null);
  unchanged(engine, () => engine.place("house", COLS, 0), null);
  unchanged(engine, () => engine.place("missing", 0, 0), null);
  const building = place(engine, "house");
  unchanged(engine, () => engine.place("well", building.c, building.r), null);
  const waterRow = engine.terrain.findIndex(row => row.includes(1));
  const waterColumn = engine.terrain[waterRow].indexOf(1);
  unchanged(engine, () => engine.place("house", waterColumn, waterRow), null);
  const dry = land(engine, (c, r) => !engine.waterSides(c, r).length);
  unchanged(engine, () => engine.place("river_quay", dry.c, dry.r), null);
  const shore = land(engine, (c, r) => engine.waterSides(c, r).length > 0);
  unchanged(engine, () => engine.place("river_quay", shore.c, shore.r, { quaySide: { c: -1, r: -1 } }), null);
  const target = engine.waterSides(shore.c, shore.r).at(-1);
  const quay = engine.place("river_quay", shore.c, shore.r, { quaySide: target });
  assert.ok(quay);
  assert.deepEqual(quay.quaySide, target);
});

test("creative transforms immediately and for free but keeps four floors and structural restrictions", () => {
  const engine = new CityEngine({ mode: "creative" });
  engine.state.res.money = -20;
  const house = place(engine, "house");
  for (let floor = 2; floor <= 4; floor++) {
    assert.equal(engine.transformBuilding(house, "add_floor"), true);
    assert.equal(house.architecture.floors, floor);
  }
  assert.equal(engine.transformBuilding(house, "roof_productive"), true);
  assert.equal(engine.transformBuilding(house, "base_shop"), true);
  assert.equal(engine.transformBuilding(house, "family_gardens"), true);
  assert.equal(engine.state.phase, 1);
  assert.equal(engine.state.res.money, -20);
  assert.equal(engine.state.res.materials, 0);
  assert.equal(house.investedMoney, 0);
  unchanged(engine, () => engine.transformBuilding(house, "add_floor"), false);
  unchanged(engine, () => engine.transformBuilding(house, "roof_productive"), false);
  unchanged(engine, () => engine.transformBuilding({ ...house }, "roof_garden"), false);
  unchanged(engine, () => engine.transformBuilding(house, "missing"), false);
  const civic = place(engine, "commons");
  unchanged(engine, () => engine.transformBuilding(civic, "add_floor"), false);
  house.disabled = true;
  unchanged(engine, () => engine.transformBuilding(house, "roof_garden"), false);
  house.disabled = false;
  assert.equal(engine.removeAt(house.c, house.r), true);
  assert.equal(engine.state.res.money, -20);
});

test("creative conversions bypass age, phase and costs while retaining source and once-only rules", () => {
  const engine = new CityEngine({ mode: "creative" });
  for (const [source, conversion] of [["workshop", "workshop_repair"], ["warehouse", "warehouse_hall"]]) {
    const building = place(engine, source);
    assert.equal(building.age, 0);
    assert.equal(engine.state.phase, 1);
    assert.equal(engine.convertBuilding(building, conversion), true);
    assert.equal(building.investedMoney, 0);
    assert.equal(building.convertedAt, 0);
    assert.equal(engine.state.res.money, 600);
    assert.equal(engine.state.res.materials, 0);
    unchanged(engine, () => engine.convertBuilding(building, conversion), false);
    unchanged(engine, () => engine.transformBuilding(building, "add_floor"), false);
    engine.removeAt(building.c, building.r);
    assert.equal(engine.state.res.money, 600);
  }
  const house = place(engine, "house");
  unchanged(engine, () => engine.convertBuilding(house, "workshop_repair"), false);
  const workshop = place(engine, "workshop");
  workshop.disabled = true;
  unchanged(engine, () => engine.convertBuilding(workshop, "workshop_repair"), false);
});

for (const mode of ["classic", "sandbox"]) {
  test(`${mode} still charges placement and transformation costs and refunds actual investment`, () => {
    const engine = new CityEngine({ mode });
    const house = place(engine, "house");
    assert.equal(engine.state.res.money, 560);
    unchanged(engine, () => engine.transformBuilding(house, "add_floor"), false);
    engine.state.phase = 4; // Rule fixture, not a claim of natural progression.
    unchanged(engine, () => engine.transformBuilding(house, "add_floor"), false);
    engine.state.res.materials = 20;
    assert.equal(engine.transformBuilding(house, "add_floor"), true);
    assert.equal(engine.state.res.money, 530);
    assert.equal(engine.state.res.materials, 16);
    assert.equal(engine.transformBuilding(house, "roof_productive"), true);
    assert.equal(engine.state.res.money, 450);
    assert.equal(engine.state.res.materials, 0);
    assert.equal(house.investedMoney, 150);
    assert.equal(engine.removeAt(house.c, house.r), true);
    assert.equal(engine.state.res.money, 510);
    engine.state.res.money = 0;
    const cell = land(engine);
    unchanged(engine, () => engine.place("well", cell.c, cell.r), null);
  });

  test(`${mode} keeps conversion phase, age, resource costs and demolition accounting`, () => {
    const engine = new CityEngine({ mode });
    const workshop = place(engine, "workshop");
    unchanged(engine, () => engine.convertBuilding(workshop, "workshop_repair"), false);
    engine.state.phase = 3;
    unchanged(engine, () => engine.convertBuilding(workshop, "workshop_repair"), false);
    workshop.age = 24;
    unchanged(engine, () => engine.convertBuilding(workshop, "workshop_repair"), false);
    engine.state.res.materials = 20;
    assert.equal(engine.convertBuilding(workshop, "workshop_repair"), true);
    assert.equal(engine.state.res.money, 490);
    assert.equal(engine.state.res.materials, 0);
    assert.equal(workshop.investedMoney, 110);
    assert.equal(engine.removeAt(workshop.c, workshop.r), true);
    assert.equal(engine.state.res.money, 534);
  });
}

test("sandbox and creative remain playable after insolvency, shortages, collapse or winning conditions", () => {
  for (const mode of ["sandbox", "creative"]) {
    const engine = new CityEngine({ mode });
    engine.state.res.money = -300;
    engine.bankruptTicks = 100;
    engine.starveTicks = 100;
    engine.peakPop = 100;
    engine.checkEndStates(0, 0, 0);
    assert.equal(engine.state.outcome, null);
    engine.victoryProgress = () => [{ key: "population", met: true }];
    engine.victorySustain = 8;
    engine.checkEndStates(0, 1, 1);
    engine.endGame("victory", "must not stop an endless city");
    engine.endGame("defeat", "must not stop an endless city");
    assert.equal(engine.state.outcome, null);
    assert.equal(engine.state.outcomeInfo, null);
    engine.tick();
    assert.equal(engine.state.tick, 1);
  }
  const classic = new CityEngine();
  classic.state.res.money = -300;
  classic.bankruptTicks = 19;
  classic.checkEndStates(0, 1, 1);
  assert.equal(classic.state.outcome, "defeat");
});

test("creative production and needs remain real and all numerical state stays finite for 160 turns", () => {
  const engine = new CityEngine({ mode: "creative" });
  const house = place(engine, "house");
  place(engine, "workshop");
  engine.tick();
  assert.equal(engine.state.flowNet.food < 0, true, "free construction does not supply food");
  assert.equal(engine.state.flowNet.water < 0, true, "free construction does not supply water");
  assert.ok(engine.state.ratios.foodR < 0.85 && engine.state.ratios.waterR < 0.85);
  assert.ok(engine.state.flowNet.materials > 0, "the workshop still produces finite real materials");
  assert.ok(engine.state.flowNet.money < 0, "operating losses remain observable without imposing a budget");
  assert.ok(house.served < 1, "district services are not fabricated by creative mode");
  for (let turn = 1; turn < 160; turn++) {
    engine.tick();
    finite(engine.state);
    assert.equal(engine.state.res.money, 600, "creative operations do not spend the finite financial anchor");
  }
  assert.equal(engine.state.tick, 160);
  assert.equal(engine.state.outcome, null);
  assert.ok(engine.state.res.materials <= 400);
  assert.equal(engine.state.res.money, 600);
});

test("creative income also leaves the finite money anchor unchanged", () => {
  const engine = new CityEngine({ mode: "creative" });
  for (const id of ["house", "house", "house", "house", "house", "well", "well", "farm", "market"]) {
    const cell = land(engine, (c, r) => c < COLS / 2 && r < ROWS / 2);
    assert.ok(engine.place(id, cell.c, cell.r));
  }
  let profitable = false;
  for (let turn = 0; turn < 50; turn++) {
    engine.tick();
    profitable ||= engine.state.flowNet.money > 0;
    assert.equal(engine.state.res.money, 600);
  }
  assert.equal(profitable, true, "real occupied housing produces income");
});

test("a fresh normal city after creative has no free construction or inherited unlocks", () => {
  const creative = new CityEngine({ mode: "creative" });
  place(creative, "factory");
  const normal = new CityEngine();
  assert.equal(normal.creative, false);
  assert.equal(normal.endless, false);
  assert.equal(normal.state.phase, 1);
  assert.equal(normal.state.res.money, 600);
  assert.deepEqual(normal.state.unlocked, new Set(INITIAL_UNLOCKED));
  assert.equal(normal.state.buildings.length, 0);
  place(normal, "house");
  assert.equal(normal.state.res.money, 560);
  assert.equal(creative.state.res.money, 600);
});

test("First Neighbourhood and River Pact retain normal budgets, scoring and scenario engine rules", () => {
  const writes = new Map();
  const storage = { getItem: key => writes.get(key) ?? null, setItem: (key, value) => writes.set(key, value) };
  const classic = new CityEngine();
  const challenge = new FirstNeighbourhood(classic, { storage });
  assert.equal(classic.endless, false);
  assert.equal(classic.creative, false);
  assert.equal(classic.state.res.money, 600);
  // Controller-only success fixture checks the unchanged record key and timing.
  classic.state.res.population = 24;
  classic.state.ratios = { foodR: 1, waterR: 1 };
  for (let tick = 1; tick <= 8; tick++) { classic.state.tick = tick; challenge.update(); }
  assert.equal(challenge.status, "success");
  assert.equal(writes.get(BEST_STORAGE_KEY), "8");
  const river = new RiverCityEngine();
  const pact = new RiverPact(river);
  assert.equal(river.creative, false);
  assert.equal(river.endless, false);
  assert.equal(river.state.res.money, 600);
  assert.deepEqual(river.state.unlocked, new Set(INITIAL_UNLOCKED));
  river.state.tick = PACT.drought.startsAt;
  assert.equal(river.weather().kind, "drought");
  river.endGame("victory", "classic victory is not a River Pact result");
  assert.equal(river.state.outcome, null);
  river.endGame("defeat", "collapse");
  assert.equal(river.state.outcome, "defeat");
  pact.update();
  assert.equal(pact.status, "failed");
  assert.equal(pact.failReason, "collapse");
});
