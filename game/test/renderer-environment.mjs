import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { Renderer3D } from "../src/render3d.js";
import { environmentPlanForCell } from "../src/diorama-assets.js";
import { genTerrain } from "../src/data.js";

const ENVIRONMENT_KEYS = [
  "bank_straight", "bank_corner_inner", "bank_corner_outer", "quay_straight",
  "ground_path", "ground_soil", "ground_fertile", "ground_planted", "civic_plaza",
  "vegetation_reeds", "vegetation_flowers", "furniture_bench", "furniture_lamp", "furniture_planter",
];
const keys = plan => plan.map(module => module.key);
const DIRECTION_VECTORS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const DIRECTION_NAMES = Object.fromEntries(Object.entries(DIRECTION_VECTORS).map(([name, vector]) => [vector.join(","), name]));
const CANONICAL_INNER = [DIRECTION_VECTORS.S, DIRECTION_VECTORS.W];

function directionsAfterRotation(rotation, canonical) {
  const cosine = Math.round(Math.cos(rotation)), sine = Math.round(Math.sin(rotation));
  return canonical.map(([x, z]) => DIRECTION_NAMES[`${Math.round(x * cosine + z * sine)},${Math.round(-x * sine + z * cosine)}`]).sort();
}

function terrainForMask(mask) {
  const terrain = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const [name, [dc, dr]] of Object.entries(DIRECTION_VECTORS)) {
    if (mask & ({ N: 1, E: 2, S: 4, W: 8 })[name]) terrain[2 + dr][2 + dc] = 1;
  }
  return terrain;
}

test("environment banks use water-neighbor shapes and rotations", () => {
  const terrain = Array.from({ length: 5 }, () => Array(5).fill(0));
  terrain[2][2] = 1;
  assert.deepEqual(environmentPlanForCell(terrain, 2, 1).find(module => module.key === "bank_straight"), {
    key: "bank_straight", x: 0, y: 0, z: 0, rotation: 0,
  });
  const inner = Array.from({ length: 5 }, () => Array(5).fill(0));
  inner[1][2] = inner[2][1] = 1;
  assert.equal(environmentPlanForCell(inner, 1, 1).find(module => module.key === "bank_corner_inner")?.rotation, Math.PI / 2);
  const diagonal = Array.from({ length: 4 }, () => Array(4).fill(0));
  diagonal[2][2] = 1;
  assert.equal(environmentPlanForCell(diagonal, 1, 1).find(module => module.key === "bank_corner_outer")?.rotation, -Math.PI / 2);
});

test("inner-bank rotations cover the actual NE, ES, SW and WN water directions", () => {
  for (const [mask, expected] of [[3, ["E", "N"]], [6, ["E", "S"]], [12, ["S", "W"]], [9, ["N", "W"]]]) {
    const plan = environmentPlanForCell(terrainForMask(mask), 2, 2);
    const bank = plan.find(module => module.key === "bank_corner_inner");
    assert.ok(bank, `Inner bank missing for mask ${mask}`);
    assert.deepEqual(directionsAfterRotation(bank.rotation, CANONICAL_INNER), expected);
  }
  const real = environmentPlanForCell(genTerrain(), 8, 4).find(module => module.key === "bank_corner_inner");
  assert.equal(real.rotation, -Math.PI / 2);
  assert.deepEqual(directionsAfterRotation(real.rotation, CANONICAL_INNER), ["N", "W"]);
});

test("opposite, three- and four-sided masks keep original terrain without competing modules", () => {
  for (const mask of [5, 7, 10, 11, 13, 14, 15]) {
    assert.deepEqual(environmentPlanForCell(terrainForMask(mask), 2, 2), [], `mask ${mask} must not assemble bank, ground or decor`);
  }
  for (const [c, r] of [[9, 3], [6, 4], [12, 4]]) {
    assert.deepEqual(environmentPlanForCell(genTerrain(), c, r), [], `${c},${r} must keep original terrain`);
  }
});

test("quays require built context and construction adapts rather than mutating the grid", () => {
  const terrain = Array.from({ length: 5 }, () => Array(5).fill(0));
  terrain[2][2] = 1;
  terrain[1][2] = 2;
  const original = JSON.stringify(terrain);
  const empty = environmentPlanForCell(terrain, 2, 1);
  assert.ok(keys(empty).includes("bank_straight"));
  assert.ok(!keys(empty).includes("quay_straight"));
  assert.ok(!keys(empty).includes("ground_fertile"));
  assert.ok(!keys(empty).includes("vegetation_flowers"));
  const house = { def: { id: "house" }, architecture: { base: "residential" } };
  const built = environmentPlanForCell(terrain, 2, 1, (c, r) => c === 2 && r === 1 ? house : null);
  assert.ok(keys(built).includes("quay_straight"));
  assert.ok(!keys(built).includes("ground_soil"));
  assert.ok(!keys(built).includes("vegetation_reeds"));
  assert.ok(!keys(built).includes("vegetation_flowers"));
  assert.equal(JSON.stringify(terrain), original);
  const path = environmentPlanForCell(terrain, 2, 1, (c, r) => c === 2 && r === 1 ? { def: { id: "path" } } : null);
  assert.ok(!keys(path).includes("ground_path"));
  assert.ok(!keys(path).includes("quay_straight"));
  const dryPath = environmentPlanForCell(Array.from({ length: 3 }, () => Array(3).fill(0)), 1, 1,
    (c, r) => c === 1 && r === 1 ? { def: { id: "path" } } : null);
  assert.ok(keys(dryPath).includes("ground_path"));
});

test("civic plaza is limited to the Commons cell", () => {
  const terrain = Array.from({ length: 3 }, () => Array(3).fill(0));
  const commons = { def: { id: "commons" }, architecture: { base: "civic" } };
  const occupied = (c, r) => c === 1 && r === 1 ? commons : null;
  assert.deepEqual(environmentPlanForCell(terrain, 1, 1, occupied), [{ key: "civic_plaza", x: 0, y: 0.01, z: 0, rotation: 0 }]);
  assert.ok(!keys(environmentPlanForCell(terrain, 0, 1, occupied)).includes("civic_plaza"));
});

test("bank cells never compose full ground, flowers or furniture over module water", () => {
  const terrain = genTerrain();
  for (const [c, r] of [[3, 6], [4, 6]]) {
    const plan = environmentPlanForCell(terrain, c, r);
    assert.ok(plan.some(module => module.key.startsWith("bank_") || module.key.startsWith("quay_")), `${c},${r} needs a bank`);
    assert.ok(!keys(plan).includes("ground_fertile"), `${c},${r} must not grow furrows through water`);
    assert.ok(!plan.some(module => module.key.startsWith("ground_")), `${c},${r} must not compose a competing full ground`);
    assert.ok(!keys(plan).includes("vegetation_flowers"));
    assert.ok(!plan.some(module => module.key.startsWith("furniture_")));
  }
});

function batchFixture() {
  const geometry = new THREE.BoxGeometry(0.2, 0.1, 0.2);
  const material = new THREE.MeshStandardMaterial({ name: "soil", color: 0x829b63 });
  const templates = new Map();
  for (const key of ENVIRONMENT_KEYS) {
    const template = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    template.add(mesh);
    templates.set(key, template);
  }
  return {
    manifest: { environment: { modules: Object.fromEntries(ENVIRONMENT_KEYS.map(key => [key, { file: `environment/${key}.glb` }])) } },
    _templatesByFile: templates,
    _environmentTemplateParts: Renderer3D.prototype._environmentTemplateParts,
    _environmentParts: Renderer3D.prototype._environmentParts,
    _rebuildEnvironmentBatch: Renderer3D.prototype._rebuildEnvironmentBatch,
    _makeLandscapeReactive: Renderer3D.prototype._makeLandscapeReactive,
    disposeObj: Renderer3D.prototype.disposeObj,
    _environmentBatches: new Map(), _environmentCellParts: new Map(), _environmentSignatures: new Map(), _environmentRebuiltCells: 0,
    environmentRoot: new THREE.Group(), _reactiveMaterials: [], _droughtLevel: 0,
    _dryColor: new THREE.Color(0xb09a68), _dryWaterColor: new THREE.Color(0x587673),
    _recordsByGroup: new WeakMap(), _records: new Set(), _halos: new Map(), meshByBuilding: new Map(), smokePuffs: [],
    _sharedGeometries: new WeakSet([geometry]), _sharedMaterials: new WeakSet([material]),
    _ownedGeometries: new Set([geometry]), _ownedMaterials: new Set([material]),
    _disposedGeometries: new WeakSet(), _disposedMaterials: new WeakSet(),
    geometry, material,
  };
}

test("instanced environment batches update only affected parts and dispose cleanly", () => {
  const fixture = batchFixture();
  const terrain = Array.from({ length: 5 }, () => Array(5).fill(0));
  terrain[2][2] = 1;
  const first = environmentPlanForCell(terrain, 2, 1);
  Renderer3D.prototype._rebuildEnvironmentCell.call(fixture, 2, 1, first);
  assert.equal(fixture._environmentBatches.size, 1);
  assert.equal(fixture.environmentRoot.children.length, 1);
  assert.equal(fixture.environmentRoot.children[0].count, first.length);
  assert.equal(fixture._environmentRebuiltCells, 1);
  const other = environmentPlanForCell(terrain, 1, 1);
  Renderer3D.prototype._rebuildEnvironmentCell.call(fixture, 1, 1, other);
  assert.equal(fixture._environmentRebuiltCells, 2);
  const built = environmentPlanForCell(terrain, 2, 1, (c, r) => c === 2 && r === 1 ? { def: { id: "house" } } : null);
  Renderer3D.prototype._rebuildEnvironmentCell.call(fixture, 2, 1, built);
  assert.equal(fixture._environmentRebuiltCells, 3);
  assert.equal(fixture._environmentCellParts.get(1 * 16 + 1).size, 1);
  Renderer3D.prototype._clearEnvironment.call(fixture);
  assert.equal(fixture._environmentBatches.size, 0);
  assert.equal(fixture._environmentCellParts.size, 0);
  assert.equal(fixture.environmentRoot.children.length, 0);
  assert.ok(!fixture._disposedGeometries.has(fixture.geometry));
  assert.ok(!fixture._disposedMaterials.has(fixture.material));
});

test("reducedEffects freezes workshop, tram, smoke and resident motion", () => {
  const building = { c: 0, r: 0, activity: 1, occupancy: 1, disabled: false };
  const group = new THREE.Group();
  new THREE.Scene().add(group);
  const spin = new THREE.Group(), car = new THREE.Group();
  const rec = { b: building, group, spin, spinAxis: "y", car, carAnchor: [0.2, 0, 0], producesSmoke: true, smokeAt: [0, 0, 0] };
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.05), new THREE.MeshBasicMaterial());
  puff.userData = { rec, t: 0 };
  const person = new THREE.Group();
  person.visible = true;
  person.userData = { home: building, phase: 0 };
  const fixture = {
    _disposed: false, _contextLost: false, reducedEffects: true, _fps: 0,
    clock: { getDelta: () => 0.1, elapsedTime: 1 },
    meshByBuilding: new Map([[building, rec]]), _records: new Set([rec]),
    haloRoot: new THREE.Group(), smokePuffs: [puff], _people: [person],
    controls: { update() {} }, camera: {}, renderer: { render() {} },
    _syncHalo() {}, _animateDisabled() {}, _updateCameraTransition() {}, _updateLandscape() {},
    _updateGhost() {}, applyLens() {}, _updateFog() {},
    _activityOf: Renderer3D.prototype._activityOf, _occupancyOf: Renderer3D.prototype._occupancyOf,
  };
  Renderer3D.prototype.frame.call(fixture);
  assert.equal(spin.rotation.y, 0);
  assert.equal(car.position.x, 0.2);
  assert.equal(puff.visible, false);
  assert.equal(person.position.y, 0.02);
});
