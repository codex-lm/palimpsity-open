import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LivingLayersBrowser } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const captures = path.join(rootDir, "docs", "living-layers", "captures");
await mkdir(captures, { recursive: true });
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".glb": "model/gltf-binary", ".png": "image/png", ".css": "text/css; charset=utf-8" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(gameDir, pathname === "/" ? "index.html" : pathname.slice(1));
    if (file !== gameDir && !file.startsWith(gameDir + path.sep)) throw new Error("Outside game directory");
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    response.end(bytes);
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = new LivingLayersBrowser({ dist: path.join(rootDir, "dist", "palimpsity-mvp.html"), captures, frames: 20 });

async function activate(selector) {
  await browser.click(selector);
}

let cursor = { c: 8, r: 6 };
async function moveTo(c, r) {
  await browser.page(() => { document.getElementById("cv").focus({ preventScroll: true }); });
  const horizontal = c - cursor.c, vertical = r - cursor.r;
  for (let index = 0; index < Math.abs(horizontal); index++) await browser.key(horizontal > 0 ? "ArrowRight" : "ArrowLeft", horizontal > 0 ? "ArrowRight" : "ArrowLeft", horizontal > 0 ? 39 : 37);
  for (let index = 0; index < Math.abs(vertical); index++) await browser.key(vertical > 0 ? "ArrowDown" : "ArrowUp", vertical > 0 ? "ArrowDown" : "ArrowUp", vertical > 0 ? 40 : 38);
  cursor = { c, r };
}
async function placeAt(c, r) {
  await moveTo(c, r);
  await browser.key("Enter", "Enter", 13);
}

try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport({ width: 1280, height: 720, dpr: 1 });
  await browser.boot(url);
  await browser.page(() => {
    const engine = PALIMPSITY.engine;
    engine.state.phase = 2; engine.state.unlocked.add("river_quay"); engine.state.res.money = 10000; engine.state.res.materials = 1000;
    PALIMPSITY.ui.renderPalette();
    window.__riverSelections = [];
    window.__partnerFocus = [];
    window.__buildingFocus = [];
    if (PALIMPSITY.renderer.setRiverSelection) {
      const original = PALIMPSITY.renderer.setRiverSelection.bind(PALIMPSITY.renderer);
      PALIMPSITY.renderer.setRiverSelection = building => { window.__riverSelections.push(building); return original(building); };
    }
    if (PALIMPSITY.renderer.focusQuayPartner) {
      const original = PALIMPSITY.renderer.focusQuayPartner.bind(PALIMPSITY.renderer);
      PALIMPSITY.renderer.focusQuayPartner = building => { window.__partnerFocus.push(building); return original(building); };
    }
    const originalFocus = PALIMPSITY.renderer.focusBuilding.bind(PALIMPSITY.renderer);
    PALIMPSITY.renderer.focusBuilding = building => { window.__buildingFocus.push(building); return originalFocus(building); };
  });
  await activate('[data-id="river_quay"]');
  await moveTo(7, 2);
  assert.equal(await browser.evaluate("document.getElementById('placement-status').textContent"), "Place river quay · 60 € + 4 materials · Enter to confirm");
  await browser.key("Enter", "Enter", 13);
  const first = await browser.evaluate("PALIMPSITY.engine.state.buildings.at(-1)");
  const firstSide = await browser.evaluate("PALIMPSITY.engine.waterSides(PALIMPSITY.engine.state.buildings.at(-1).c, PALIMPSITY.engine.state.buildings.at(-1).r)[0]");
  assert.deepEqual(first.quaySide, firstSide, "First side is deterministic without rotation");
  await browser.key("r", "KeyR", 82);
  assert.equal(await browser.evaluate("PALIMPSITY.selectedRotation"), Math.PI / 2, "R rotates the ghost by one water side");
  await placeAt(11, 2);
  const second = await browser.evaluate("PALIMPSITY.engine.state.buildings.at(-1)");
  const secondSide = await browser.evaluate("PALIMPSITY.engine.waterSides(PALIMPSITY.engine.state.buildings.at(-1).c, PALIMPSITY.engine.state.buildings.at(-1).r)[1]");
  assert.deepEqual(second.quaySide, secondSide, "R selects the next valid water side");
  assert.equal(await browser.evaluate("PALIMPSITY.renderer.getBuildingRotation(PALIMPSITY.engine.state.buildings.at(-1))"), Math.PI / 2, "Placed model matches ghost rotation");
  await browser.key("Escape", "Escape", 27);
  await browser.page(async () => {
    const { BUILDINGS } = await import("./src/data.js");
    const e = PALIMPSITY.engine, outputDef = { ...BUILDINGS.farm, tags: [], inputs: {}, outputs: { food: 10, water: 10 }, ext: {} };
    e.state.buildings.push({ def: outputDef, c: 15, r: 0, age: 0, disabled: false, activity: 1, flowOutput: { food: 10, water: 10 }, flowInput: {}, grossMaintenance: 0 });
    e.occ[0][15] = e.state.buildings.at(-1);
    const needDef = { ...outputDef, inputs: { food: 8, water: 8 }, outputs: {} };
    e.state.buildings.push({ def: needDef, c: 0, r: 0, age: 0, disabled: false, activity: 1, flowOutput: {}, flowInput: { food: 8, water: 8 }, grossMaintenance: 0 });
    e.occ[0][0] = e.state.buildings.at(-1);
    for (const building of e.state.buildings) if (building.def.id === "river_quay") building.activity = 1;
    e.computeDistricts(1);
    PALIMPSITY.renderer.sync(); PALIMPSITY.ui.showInspector(e.state.buildings.find(b => b.def.id === "river_quay")); PALIMPSITY.ui.update();
  });
  assert.equal(await browser.evaluate("PALIMPSITY.engine.quayInfo(PALIMPSITY.ui.inspectBuilding).status"), "active");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.quayInfo(PALIMPSITY.ui.inspectBuilding).effectiveCapacity"), 12);
  assert.ok(await browser.evaluate("PALIMPSITY.engine.quayInfo(PALIMPSITY.ui.inspectBuilding).flowTick >= 1"));
  assert.match(await browser.evaluate("document.querySelector('.quay-flows').textContent"), /Import: 8 food/);
  assert.match(await browser.evaluate("document.querySelector('.quay-flows').textContent"), /Import: 4 water/);
  assert.match(await browser.evaluate("document.querySelector('.quay-info').textContent"), /Other districts/);
  assert.match(await browser.evaluate("document.querySelector('.quay-facts').textContent"), /0.5 €\/turn · 2 workers · 0.4 maintenance demand/);
  if (await browser.evaluate("typeof PALIMPSITY.renderer.focusQuayPartner === 'function'")) {
    assert.equal(await browser.evaluate("document.querySelector('[data-quay-partner]').disabled"), false, "A represented quay with another district enables focus");
    await activate("[data-quay-partner]");
    assert.equal(await browser.evaluate("__partnerFocus.length"), 1, "Focus partner calls renderer once");
    assert.equal(await browser.evaluate("__partnerFocus[0] === PALIMPSITY.ui.inspectBuilding"), true, "Focus partner receives the selected quay");
    assert.equal(await browser.evaluate("__buildingFocus.length"), 1, "Renderer focuses one partner building");
    const districts = await browser.page(async () => {
      const { districtOf } = await import("./src/data.js");
      return [districtOf(PALIMPSITY.ui.inspectBuilding.c, PALIMPSITY.ui.inspectBuilding.r), districtOf(__buildingFocus[0].c, __buildingFocus[0].r)];
    });
    assert.notEqual(districts[0], districts[1], "Renderer targets a partner in another district");
  }
  if (await browser.evaluate("typeof PALIMPSITY.renderer.setRiverSelection === 'function'")) {
    assert.equal(await browser.evaluate("__riverSelections.at(-1) === PALIMPSITY.ui.inspectBuilding"), true, "Inspector selects quay");
  }
  await browser.page(() => {
    const select = document.getElementById("language-select"); select.value = "fr"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.match(await browser.evaluate("document.querySelector('.quay-info').textContent"), /Réseau fluvial/);
  assert.match(await browser.evaluate("document.querySelector('.quay-facts').textContent"), /0.5 €\/tour · 2 travailleurs · 0.4 demande d’entretien/);
  assert.match(await browser.evaluate("document.querySelector('.quay-flows').textContent"), /Import : 8 nourriture/);
  assert.match(await browser.evaluate("document.querySelector('.quay-flows').textContent"), /Dernier tour terminé : 1/);
  assert.match(await browser.evaluate("document.querySelector('.quay-partner').textContent"), /Centrer sur le partenaire/);

  await browser.viewport({ width: 390, height: 844, dpr: 2 });
  const target = await browser.page(() => {
    const button = document.querySelector("[data-quay-partner]"), rect = button.getBoundingClientRect();
    return { height: rect.height, hit: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)) };
  });
  assert.ok(target.height >= 44, "Partner remains a 44px touch target");
  assert.equal(target.hit, true, "Partner is clickable at 390px");
  await browser.screenshot("lot015-quay-mobile", { width: 390, height: 844, dpr: 2 });
  await browser.key("Escape", "Escape", 27);
  if (await browser.evaluate("typeof PALIMPSITY.renderer.setRiverSelection === 'function'")) {
    assert.equal(await browser.evaluate("__riverSelections.at(-1)"), null, "Closing inspector clears river selection");
  }
  console.log("PASS LOT015 quay rotation, flows, partner, mobile and EN/FR");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
