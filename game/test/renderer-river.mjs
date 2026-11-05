import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { Renderer3D } from "../src/render3d.js";
import { quayRotationForTarget, quayTargetForRotation, riverVisualFlows } from "../src/diorama-assets.js";

function waterTerrain() {
  const terrain = Array.from({ length: 4 }, () => Array(4).fill(0));
  terrain[1][1] = terrain[1][2] = terrain[1][3] = 1;
  return terrain;
}

function flow(amount = 1, resource = "food", path = [{ c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 }]) {
  return { amount, resource, sourceQuay: { c: 1, r: 0 }, destinationQuay: { c: 3, r: 0 }, path };
}

test("quay rotation follows canonical water south for all sides", () => {
  assert.equal(quayRotationForTarget(2, 2, { c: 2, r: 3 }), 0);
  assert.equal(quayRotationForTarget(2, 2, { c: 3, r: 2 }), Math.PI / 2);
  assert.equal(quayRotationForTarget(2, 2, { c: 2, r: 1 }), Math.PI);
  assert.equal(quayRotationForTarget(2, 2, { c: 1, r: 2 }), -Math.PI / 2);
});

test("ghost quay target uses placement rotation indices for two and three sides", () => {
  const two = [{ c: 3, r: 2 }, { c: 2, r: 3 }];
  assert.equal(quayTargetForRotation(two, 0), two[0]);
  assert.equal(quayTargetForRotation(two, Math.PI / 2), two[1]);
  assert.equal(quayTargetForRotation(two, Math.PI), two[0]);
  const three = [{ c: 2, r: 1 }, { c: 3, r: 2 }, { c: 2, r: 3 }];
  assert.equal(quayTargetForRotation(three, Math.PI), three[2]);
  assert.equal(quayTargetForRotation(three, Math.PI * 1.5), three[0]);
  assert.equal(quayTargetForRotation(three, -Math.PI / 2), three[0]);
});

test("river visual flows require positive executed flows and fully aquatic paths", () => {
  const state = {
    buildings: [{ def: { id: "river_quay" }, c: 1, r: 0 }, { def: { id: "river_quay" }, c: 3, r: 0 }],
    riverNetworks: [{ basin: 0 }], riverFlows: [],
  };
  assert.deepEqual(riverVisualFlows(state, waterTerrain()), []);
  const flows = [2, 9, 9, 1, 0, 7, 8, 6, 5, 4].map((amount, index) => flow(amount, index % 2 ? "water" : "food"));
  flows.push(flow(100, "materials"), flow(100, "food", [{ c: 0, r: 0 }, { c: 1, r: 1 }]), flow(100, "food", [{ c: 1, r: 1 }, { c: 3, r: 1 }]));
  state.riverFlows = flows;
  const plans = riverVisualFlows(state, waterTerrain());
  assert.equal(plans.length, 6);
  assert.deepEqual(plans.map(({ flow }) => flow.amount), [9, 9, 8, 7, 6, 5]);
  assert.equal(plans[0].flow.resource, "water");
  assert.ok(plans.every(({ flow }) => flow.path.every(cell => waterTerrain()[cell.r][cell.c] === 1)));
  state.buildings.pop();
  assert.deepEqual(riverVisualFlows(state, waterTerrain()), []);
});

function riverFixture(flows) {
  const templates = new Map();
  for (const key of ["barge", "cargoFood", "cargoWater"]) templates.set(key, new THREE.Group());
  return {
    manifest: { riverAssets: { barge: "barge.glb", cargoFood: "cargoFood.glb", cargoWater: "cargoWater.glb" } },
    _templatesByFile: templates,
    _clone: Renderer3D.prototype._clone,
    bargeRoot: new THREE.Group(), riverSelectionRoot: new THREE.Group(), _barges: [],
    _riverFlowSignature: null, _riverSelectionSignature: null, _selectedQuay: null,
    _clearBarges: Renderer3D.prototype._clearBarges,
    _positionBarge: Renderer3D.prototype._positionBarge,
    setRiverSelection: Renderer3D.prototype.setRiverSelection,
    _syncRiverSelection: Renderer3D.prototype._syncRiverSelection,
    _clearRiverSelectionVisuals: Renderer3D.prototype._clearRiverSelectionVisuals,
    engine: {
      terrain: waterTerrain(),
      state: {
        buildings: [{ def: { id: "river_quay" }, c: 1, r: 0 }, { def: { id: "river_quay" }, c: 3, r: 0 }, { def: { id: "river_quay" }, c: 11, r: 7 }],
        riverFlows: flows, riverFlowTick: 10,
        riverNetworks: [{ basin: 0, quays: [{ c: 2, r: 0 }, { c: 11, r: 7 }] }],
      },
      quayBasin: () => ({ id: 0, cells: [{ c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 }] }),
    },
    disposeObj(object) { object.removeFromParent(); },
    _keepGeometry(geometry) { return geometry; },
  };
}

test("barges preserve dated ledger, cargo resource and reducedEffects position", () => {
  const fixture = riverFixture([flow(2, "food"), flow(1, "water")]);
  Renderer3D.prototype._syncBarges.call(fixture);
  assert.equal(fixture._barges.length, 2);
  const first = fixture._barges[0], original = first.group.position.clone(), originalChildren = first.group.children.length;
  first.group.children[0].name = "barge";
  first.group.children[1].name = "cargoFood";
  assert.equal(originalChildren, 2);
  assert.equal(first.group.children[1].name, "cargoFood");
  fixture._riverFlowSignature = JSON.stringify([10, fixture.engine.state.riverFlows]);
  const same = first.group;
  Renderer3D.prototype._syncBarges.call(fixture);
  assert.equal(fixture._barges[0].group, same);
  Renderer3D.prototype._animateBarges.call(fixture, 1);
  assert.notDeepEqual(first.group.position, original);
  const frozen = first.group.position.clone();
  fixture.reducedEffects = true;
  Renderer3D.prototype._animateBarges.call(fixture, 2);
  assert.deepEqual(first.group.position, frozen);
});

test("stationary food and water stay separated on one water cell with cargo on deck", () => {
  const cell = [{ c: 2, r: 1 }];
  const fixture = riverFixture([flow(2, "food", cell), flow(1, "water", cell)]);
  Renderer3D.prototype._syncBarges.call(fixture);
  assert.equal(fixture._barges.length, 2);
  const [food, water] = fixture._barges;
  assert.equal(food.totalLength, 0);
  assert.equal(water.totalLength, 0);
  assert.ok(food.group.position.x < water.group.position.x);
  assert.equal(food.group.children[1].position.y, 0.11);
  assert.equal(water.group.children[1].position.y, 0.11);
  const before = food.group.position.clone();
  Renderer3D.prototype._animateBarges.call(fixture, 3);
  assert.deepEqual(food.group.position, before);
});

test("selection highlights the real basin and focus uses a current partner", () => {
  const selectedFlow = flow(2, "water");
  selectedFlow.destinationQuay.c = 11;
  selectedFlow.destinationQuay.r = 7;
  const fixture = riverFixture([selectedFlow]);
  const selected = fixture.engine.state.buildings[0];
  assert.equal(Renderer3D.prototype.setRiverSelection.call(fixture, selected), true);
  assert.ok(fixture.riverSelectionRoot.children.length >= 4);
  let focused = null;
  fixture.focusBuilding = building => { focused = building; };
  fixture.engine.state.riverNetworks[0].quays.shift();
  assert.equal(Renderer3D.prototype.focusQuayPartner.call(fixture, selected), true);
  assert.equal(focused, fixture.engine.state.buildings[2]);
  fixture.engine.state.riverNetworks = [];
  assert.equal(Renderer3D.prototype.focusQuayPartner.call(fixture, selected), false);
  Renderer3D.prototype.setRiverSelection.call(fixture, null);
  assert.equal(fixture.riverSelectionRoot.children.length, 0);
});
