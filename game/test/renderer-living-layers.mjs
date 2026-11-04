import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Renderer3D } from "../src/render3d.js";
import { layerPlanForBuilding } from "../src/diorama-assets.js";
import { expectedModuleKeys } from "./helpers-living-layers.mjs";

const layers = {
  floorHeight: 0.48,
  modules: Object.fromEntries(expectedModuleKeys().map(key => [key, { file: `layers/${key}.glb` }])),
};

function modularFixture() {
  const templates = new Map();
  const levelGeometry = new THREE.BoxGeometry(0.8, 0.48, 0.8).translate(0, 0.24, 0);
  const roofGeometry = new THREE.BoxGeometry(0.9, 0.4, 0.8).translate(0, 0.2, 0);
  const material = new THREE.MeshStandardMaterial({ name: "mist", color: 0xa7c4d2 });
  for (const key of expectedModuleKeys()) {
    const template = new THREE.Group();
    template.add(new THREE.Mesh(key.startsWith("roof_") ? roofGeometry : levelGeometry, material));
    templates.set(key, template);
  }
  return {
    manifest: { layers, models: { house: { file: "house.glb", height: 1 } } },
    _templatesByFile: templates,
    _clone: Renderer3D.prototype._clone,
    _setRoofPickable: Renderer3D.prototype._setRoofPickable,
    roofsVisible: true,
  };
}

function architecture(base, extra = {}) {
  return { base, floors: 2, roof: "traditional", family: "banks", variant: 0, ...extra };
}

test("civic stays standalone in placed meshes and the placement ghost", () => {
  const fixture = modularFixture();
  const building = { def: { id: "commons" }, architecture: architecture("civic", { floors: 4, roof: "garden", family: "gardens", variant: 2 }) };
  const plan = layerPlanForBuilding(building, layers);
  assert.equal(plan.signature, "base_civic|standalone");
  assert.equal(plan.floors, 1);
  assert.equal(plan.roofKey, null);
  const rec = Renderer3D.prototype.buildLayerMesh.call(fixture, building, plan);
  assert.equal(rec.model.children.length, 1);
  assert.equal(rec.roof, null);
  assert.equal(rec.height, 1.08);

  Object.assign(fixture, {
    _loaded: true, _disposed: false, ghostId: "commons", hover: null,
    ghost: null, ghostMats: [], ghostRotation: 0, _ghostFile: null,
    scene: new THREE.Scene(), buildLayerMesh: Renderer3D.prototype.buildLayerMesh,
    _clearGhost: Renderer3D.prototype._clearGhost,
    disposeObj(object) { object.removeFromParent(); },
  });
  Renderer3D.prototype._updateGhost.call(fixture);
  assert.equal(fixture.ghost.children[0].children[0].children.length, 1);
});

test("a hidden roof is excluded from raycasts and becomes pickable again when shown", () => {
  const fixture = modularFixture();
  const building = { def: { id: "house" }, architecture: architecture("residential") };
  const plan = layerPlanForBuilding(building, layers);
  const rec = Renderer3D.prototype.buildLayerMesh.call(fixture, building, plan);
  fixture.meshByBuilding = new Map([[building, rec]]);
  fixture.toggleRoof = Renderer3D.prototype.toggleRoof;
  const scene = new THREE.Scene();
  scene.add(rec.group);
  scene.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const aim = () => {
    const origin = new THREE.Vector3(0, 3, 3);
    const target = rec.roof.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.2, 0));
    raycaster.set(origin, target.sub(origin).normalize());
    scene.updateMatrixWorld(true);
    return raycaster.intersectObject(rec.roof, true);
  };
  assert.ok(aim().length > 0);
  assert.equal(fixture.toggleRoof(false), false);
  assert.equal(rec.roof.visible, false);
  assert.equal(aim().length, 0);
  assert.equal(fixture.toggleRoof(true), true);
  assert.ok(aim().length > 0);
});

test("only physical Works workshop vents produce smoke, at the vent outlet", () => {
  const fixture = modularFixture();
  for (const family of ["banks", "works", "gardens"]) {
    const building = { def: { id: "workshop" }, architecture: architecture("workshop", { family }) };
    const rec = Renderer3D.prototype.buildLayerMesh.call(fixture, building, layerPlanForBuilding(building, layers));
    assert.equal(rec.producesSmoke, family === "works");
    assert.deepEqual(rec.smokeAt, family === "works" ? [0.29, 0.48, -0.16] : null);
  }
  const converted = { def: { id: "workshop" }, conversion: "workshop_repair", architecture: architecture("workshop", { family: "works" }) };
  const rec = Renderer3D.prototype.buildLayerMesh.call(fixture, converted, layerPlanForBuilding(converted, layers));
  assert.equal(rec.producesSmoke, false);
  assert.equal(rec.smokeAt, null);
});

test("farm, park and garden-roof vegetation dries and recovers without mutating shared materials", () => {
  const shared = new THREE.MeshStandardMaterial({ name: "pine", color: 0x50784f });
  const sharedHex = shared.color.getHex();
  const makeRoot = () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), shared));
    return root;
  };
  const farm = makeRoot(), garden = makeRoot(), other = makeRoot();
  const fixture = {
    _reactiveMaterials: [], _droughtLevel: 0, _droughtTarget: 0,
    _dryColor: new THREE.Color(0xb09a68), _dryWaterColor: new THREE.Color(0x587673),
    _makeLandscapeReactive: Renderer3D.prototype._makeLandscapeReactive,
  };
  Renderer3D.prototype._makeBuildingReactive.call(fixture, { def: { id: "farm" } }, { visual: farm, roof: null });
  Renderer3D.prototype._makeBuildingReactive.call(fixture, { def: { id: "park" } }, { visual: makeRoot(), roof: null });
  Renderer3D.prototype._makeBuildingReactive.call(fixture, { def: { id: "house" }, architecture: architecture("residential", { roof: "garden" }) }, { visual: new THREE.Group(), roof: garden });
  const farmMaterial = farm.children[0].material, gardenMaterial = garden.children[0].material;
  assert.notEqual(farmMaterial, shared);
  assert.notEqual(gardenMaterial, shared);
  assert.equal(other.children[0].material, shared);
  fixture._droughtTarget = 1;
  Renderer3D.prototype._updateLandscape.call(fixture, 1);
  assert.notEqual(farmMaterial.color.getHex(), sharedHex);
  assert.notEqual(gardenMaterial.color.getHex(), sharedHex);
  assert.equal(shared.color.getHex(), sharedHex);
  fixture._droughtTarget = 0;
  Renderer3D.prototype._updateLandscape.call(fixture, 1);
  assert.equal(farmMaterial.color.getHex(), sharedHex);
  assert.equal(gardenMaterial.color.getHex(), sharedHex);
  assert.equal(shared.color.getHex(), sharedHex);
});

test("decorative residents follow residential occupancy rather than production activity", () => {
  const house = { def: { id: "house" }, c: 0, r: 0, disabled: false, activity: 1, occupancy: 0, architecture: architecture("residential") };
  const fixture = {
    engine: { state: { res: { population: 10 }, buildings: [house] } },
    _people: [new THREE.Group(), new THREE.Group()], quality: "high", reducedEffects: false,
    _occupancyOf: Renderer3D.prototype._occupancyOf,
  };
  Renderer3D.prototype._syncPeople.call(fixture);
  assert.ok(fixture._people.every(person => !person.visible));
  house.activity = 0;
  house.occupancy = 1;
  Renderer3D.prototype._syncPeople.call(fixture);
  assert.ok(fixture._people.every(person => person.visible));
});

test("dispose during asset loading releases late GLBs without re-registering resources", async () => {
  const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(path.join(gameDir, "art", "diorama", "asset-manifest.json"), "utf8"));
  const previousWindow = globalThis.window;
  const originalLoadAsync = GLTFLoader.prototype.loadAsync;
  const pending = [];
  let disposedLateScenes = 0;
  globalThis.window = { __PALIMPSITY_ASSET_MANIFEST: manifest, __PALIMPSITY_ASSETS: {} };
  GLTFLoader.prototype.loadAsync = function loadAsync() {
    return new Promise(resolve => pending.push(resolve));
  };
  const fixture = {
    _disposed: false, _loaded: false,
    _sharedGeometries: new WeakSet(), _ownedGeometries: new Set(),
    _sharedMaterials: new WeakSet(), _ownedMaterials: new Set(),
    glbTemplates: new Map(), terrainRoot: new THREE.Group(),
    _clone: Renderer3D.prototype._clone,
    sync() {}, getDebugInfo() { return {}; },
  };
  try {
    const loading = Renderer3D.prototype._loadAssets.call(fixture);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(pending.length > 0);
    fixture._disposed = true;
    fixture._ownedGeometries.clear();
    fixture._ownedMaterials.clear();
    for (const resolve of pending) {
      const scene = new THREE.Scene();
      const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const material = new THREE.MeshStandardMaterial();
      geometry.addEventListener("dispose", () => { disposedLateScenes++; });
      scene.add(new THREE.Mesh(geometry, material));
      resolve({ scene });
    }
    await assert.rejects(loading, /renderer disposed/);
    assert.equal(fixture._ownedGeometries.size, 0);
    assert.equal(fixture._ownedMaterials.size, 0);
    assert.equal(disposedLateScenes, pending.length);
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoadAsync;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
