import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CityEngine } from "../src/engine.js";
import { Renderer3D } from "../src/render3d.js";
import { UI } from "../src/ui.js";

test("a secondary quay offers and focuses the actual other-district partner", () => {
  const engine = new CityEngine();
  engine.state.phase = 2;
  engine.state.unlocked.add("river_quay");
  engine.state.res.materials = 20;
  const primary = engine.place("river_quay", 2, 5);
  const secondary = engine.place("river_quay", 3, 5);
  const partner = engine.place("river_quay", 4, 6);
  for (const building of [primary, secondary, partner]) {
    assert.ok(building);
    building.activity = 1;
  }
  engine.computeDistricts();
  let focused = null;
  const renderer = Object.assign(Object.create(Renderer3D.prototype), {
    engine, setRiverSelection() {}, focusBuilding(building) { focused = building; },
  });
  const html = UI.prototype.renderQuayInspector.call({ engine, renderer }, secondary);
  const button = html.match(/<button[^>]*data-quay-partner[^>]*>/)?.[0];
  assert.ok(button && !button.includes("disabled"));
  assert.equal(renderer.focusQuayPartner(secondary), true);
  assert.equal(focused, partner);
  engine.removeAt(partner.c, partner.r);
  engine.computeDistricts();
  const withoutPartner = UI.prototype.renderQuayInspector.call({ engine, renderer }, secondary);
  assert.match(withoutPartner, /data-quay-partner disabled/);
  assert.equal(renderer.focusQuayPartner(secondary), false);
});

const assets = new URL("../art/diorama/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("asset-manifest.json", assets), "utf8"));
const models = new Map();
for (const file of ["river_barge.glb", "river_cargo_food.glb", "river_cargo_water.glb"]) {
  const bytes = readFileSync(new URL(file, assets));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  models.set(file, gltf.scene);
}

for (let count = 1; count <= 6; count++) {
  test(`${count} stationary cargo models fit inside one water tile without intersecting`, () => {
    const engine = new CityEngine();
    engine.state.buildings = [{ def: { id: "river_quay" }, c: 3, r: 5 }, { def: { id: "river_quay" }, c: 4, r: 6 }];
    engine.state.riverFlowTick = 28;
    // Geometry fixture up to the visual cap, not a claim of six actual trades on this map.
    engine.state.riverFlows = Array.from({ length: count }, (_, index) => ({
      resource: index % 2 ? "water" : "food", amount: count - index,
      sourceQuay: { c: 3, r: 5 }, destinationQuay: { c: 4, r: 6 }, path: [{ c: 4, r: 5 }],
    }));
    const renderer = Object.assign(Object.create(Renderer3D.prototype), {
      engine, manifest, _barges: [], bargeRoot: new THREE.Group(), _clone: file => models.get(file).clone(true),
    });
    renderer._syncBarges();
    assert.equal(renderer._barges.length, count);
    renderer._animateBarges(100);
    renderer.bargeRoot.updateMatrixWorld(true);
    const bounds = renderer._barges.map(record => new THREE.Box3().setFromObject(record.group));
    for (const box of bounds) {
      assert.ok(box.min.x >= -4 && box.max.x <= -3 && box.min.z >= -1 && box.max.z <= 0, "real hull and cargo must remain inside water tile(4,5)");
    }
    for (let first = 0; first < bounds.length; first++) {
      for (let second = first + 1; second < bounds.length; second++) {
        assert.equal(bounds[first].intersectsBox(bounds[second]), false, `models ${first} and ${second} overlap`);
      }
    }
  });
}
