import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CityEngine } from "../src/engine.js";
import { BUILDINGS } from "../src/data.js";
import { translate } from "../src/localization.js";
import { expectedModuleKeys, validateArchitecture } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(gameDir, "art", "diorama", "asset-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

test("Living Layers manifest exposes every composable module as a local GLB", () => {
  assert.equal(manifest.layers?.floorHeight, 0.48);
  assert.ok(manifest.layers?.modules && typeof manifest.layers.modules === "object");
  const modules = manifest.layers.modules;
  assert.deepEqual(Object.keys(modules).sort(), expectedModuleKeys());
  for (const [key, entry] of Object.entries(modules)) {
    assert.match(entry?.file || "", /\.glb$/i, `${key}: module file must be a GLB`);
    const file = path.resolve(path.dirname(manifestPath), entry.file);
    assert.ok(file.startsWith(path.dirname(manifestPath) + path.sep), `${key}: module must stay in the asset directory`);
    assert.ok(existsSync(file), `${key}: missing ${entry.file}`);
    const bytes = readFileSync(file);
    assert.equal(bytes.toString("ascii", 0, 4), "glTF", `${key}: invalid GLB header`);
  }
});

test("new buildings own a valid architecture and offers expose cloned bilingual profiles", () => {
  const engine = new CityEngine();
  const building = engine.place("house", 0, 6);
  assert.ok(building, "The ordinary house fixture must be placeable");
  assert.ok(validateArchitecture(building.architecture), "Placement must initialize per-instance architecture");
  assert.notEqual(building.architecture, BUILDINGS.house.architecture, "Instance data must not alias the catalogue");
  assert.equal(typeof engine.transformationOptions, "function");
  assert.equal(typeof engine.transformationBlockReason, "function");
  assert.equal(typeof engine.transformBuilding, "function");
  const options = engine.transformationOptions(building);
  assert.ok(options.length > 0, "A transformable house needs transformation offers");
  for (const offer of options) {
    assert.ok(offer.id && offer.name && offer.desc, `Incomplete offer: ${JSON.stringify(offer)}`);
    assert.ok(offer.cost && Number.isFinite(offer.cost.money) && Number.isFinite(offer.cost.materials));
    assert.ok(validateArchitecture(offer.before?.architecture), `${offer.id}: invalid before profile`);
    assert.ok(validateArchitecture(offer.after?.architecture), `${offer.id}: invalid after profile`);
    assert.notEqual(offer.before, offer.after, `${offer.id}: before/after must be cloned`);
    assert.notEqual(offer.before.architecture, building.architecture, `${offer.id}: before must not alias instance data`);
    assert.notEqual(offer.after.architecture, offer.before.architecture, `${offer.id}: architecture profiles must be cloned`);
    assert.equal(translate(offer.name, "en"), offer.name);
    assert.equal(translate(offer.desc, "en"), offer.desc);
    assert.notEqual(translate(offer.name, "fr"), offer.name, `${offer.id}: French name missing`);
    assert.notEqual(translate(offer.desc, "fr"), offer.desc, `${offer.id}: French description missing`);
    if (offer.reason) assert.notEqual(translate(offer.reason, "fr"), offer.reason, `${offer.id}: French blocking reason missing`);
  }
});

test("construction palette keeps a localized family choice and passes it to placement", () => {
  const ui = readFileSync(path.join(gameDir, "src", "ui.js"), "utf8");
  const main = readFileSync(path.join(gameDir, "src", "main.js"), "utf8");
  assert.match(ui, /this\.buildFamily = "banks"/);
  assert.match(ui, /button\.dataset\.family = family/);
  assert.match(ui, /this\.renderer\.setGhost\(this\.selected, \{ family: this\.buildFamily \}\)/);
  assert.match(main, /engine\.place\(selected, cr\.c, cr\.r, \{ family: ui\.buildFamily \}\)/);
  assert.equal(translate("House family", "en"), "House family");
  assert.equal(translate("House family", "fr"), "Famille des maisons");
  for (const [family, french] of [["Banks", "Rives"], ["Works", "Fabriques"], ["Gardens", "Jardins"]]) {
    assert.equal(translate(family, "fr"), french);
  }
});

test("native-high rendering keeps antialiasing, the native DPR and an unscaled canvas backing store", () => {
  const source = readFileSync(path.join(gameDir, "src", "render3d.js"), "utf8");
  assert.match(source, /antialias\s*:\s*true/);
  assert.match(source, /const\s+nativeRatio\s*=\s*globalThis\.devicePixelRatio\s*\|\|\s*1/);
  assert.match(source, /setPixelRatio\s*\(\s*this\.quality\s*===\s*["']high["']\s*\?\s*nativeRatio/, "High quality must preserve every native device pixel");
  assert.match(source, /setSize\s*\(\s*width\s*,\s*height\s*,\s*false\s*\)/, "CSS and drawing-buffer sizes must be controlled independently");
});
