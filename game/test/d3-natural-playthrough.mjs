import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const actions = [];

async function activate(selector) {
  const point = await browser.point(selector);
  const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
  const down = browser.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
  const up = browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
  await Promise.all([down, up]);
  await browser.frames(2);
}

async function step(count = 1) {
  for (let index = 0; index < count; index++) {
    await browser.page(() => {
      const engine = PALIMPSITY.engine;
      if (!PALIMPSITY.ui.river.canAdvance) throw new Error(`River cannot advance: ${JSON.stringify(PALIMPSITY.ui.river.progress())}`);
      engine.tick();
      PALIMPSITY.ui.river.update();
      PALIMPSITY.renderer.sync();
      PALIMPSITY.ui.update();
    });
    await browser.dismissReports();
  }
}

async function buy(id, count, district) {
  for (let index = 0; index < count; index++) {
    let placed;
    for (let attempt = 0; attempt < 400; attempt++) {
      placed = await browser.page(async (id, district) => {
        const engine = PALIMPSITY.engine;
        if (!engine.state.unlocked.has(id)) return { wait: true };
        const cells = [];
        for (let r = 0; r < engine.terrain.length; r++) for (let c = 0; c < engine.terrain[r].length; c++) {
          const dx = c < engine.terrain[r].length / 2 ? 0 : 1, dy = r < engine.terrain.length / 2 ? 0 : 1;
          if (dy * 2 + dx !== district) continue;
          if (engine.canPlace(id, c, r)) cells.push({ c, r, fertile: engine.terrain[r][c] === 2 });
        }
        cells.sort((a, b) => Number(b.fertile) - Number(a.fertile));
        if (!cells.length) return { wait: true };
        const { c, r } = cells[0];
        const building = engine.place(id, c, r);
        if (!building) return { wait: true };
        PALIMPSITY.renderer.sync(); PALIMPSITY.ui.update();
        return { building: { id, c, r }, cost: building.def.cost };
      }, id, district);
      if (!placed.wait) break;
      await step();
    }
    if (placed.wait) throw new Error(`${id}: no natural placement after 400 turns`);
    actions.push({ type: "place", id, district, tick: await browser.evaluate("PALIMPSITY.engine.state.tick"), ...placed.building, cost: placed.cost });
    await browser.dismissReports();
  }
}

async function transform(id) {
  browser.scenario = `D3 transform ${id}`;
  console.log(`D3 transform ${id} at tick ${await browser.evaluate("PALIMPSITY.engine.state.tick")}`);
  const group = id === "add_floor" ? "levels" : id.startsWith("base_") ? "use" : id.startsWith("roof_") ? "roof" : "appearance";
  await browser.page(group => { document.querySelector(`[data-layer-group-toggle="${group}"]`).click(); }, group);
  await browser.page(id => { document.querySelector(`[data-transform-preview="${id}"]`).click(); }, id);
  for (let attempt = 0; attempt < 200 && await browser.page(id => document.querySelector(`[data-transform-confirm="${id}"]`).disabled, id); attempt++) {
    await browser.page(() => { document.querySelector(".cancel-transform").click(); });
    await step();
    await browser.page(id => { document.querySelector(`[data-transform-preview="${id}"]`).click(); }, id);
  }
  if (await browser.page(id => document.querySelector(`[data-transform-confirm="${id}"]`).disabled, id)) throw new Error(`${id}: transformation stayed disabled for 200 turns`);
  console.log(`D3 transform ${id} allowed at tick ${await browser.evaluate("PALIMPSITY.engine.state.tick")}`);
  await browser.page(id => { document.querySelector(`[data-transform-confirm="${id}"]`).click(); }, id);
  const result = await browser.page(id => {
    const building = PALIMPSITY.ui.inspectBuilding;
    return { id, architecture: { ...building.architecture }, history: building.history.at(-1), money: PALIMPSITY.engine.state.res.money, materials: PALIMPSITY.engine.state.res.materials };
  }, id);
  assert.equal(result.history.type, "transformation", `${id}: UI transformation did not record history`);
  actions.push({ type: "transformation", id, tick: await browser.evaluate("PALIMPSITY.engine.state.tick"), architecture: result.architecture, money: result.money, materials: result.materials });
}

async function convert(id) {
  browser.scenario = `D3 convert ${id}`;
  console.log(`D3 convert ${id} at tick ${await browser.evaluate("PALIMPSITY.engine.state.tick")}`);
  await browser.page(id => {
    const target = id === "workshop_repair" ? "workshop" : "warehouse";
    const building = PALIMPSITY.engine.state.buildings.find(item => item.def.id === target);
    PALIMPSITY.ui.showInspector(building);
  }, id);
  if (id === "workshop_repair") for (let attempt = 0; attempt < 100 && await browser.evaluate("PALIMPSITY.engine.state.res.materials < 32"); attempt++) await step();
  for (let attempt = 0; attempt < 400 && await browser.page(id => PALIMPSITY.engine.conversionBlockReason(PALIMPSITY.ui.inspectBuilding, id), id); attempt++) await step();
  if (await browser.page(id => PALIMPSITY.engine.conversionBlockReason(PALIMPSITY.ui.inspectBuilding, id), id)) throw new Error(`${id}: conversion stayed blocked for 400 turns`);
  await browser.page(() => { PALIMPSITY.ui.update(); });
  await browser.page(id => { document.querySelector(`[data-conversion="${id}"]`).click(); }, id);
  const result = await browser.page(() => ({ conversion: PALIMPSITY.ui.inspectBuilding.conversion, history: PALIMPSITY.ui.inspectBuilding.history.at(-1) }));
  assert.equal(result.conversion, id, `${id}: UI conversion failed`);
  actions.push({ type: "conversion", id, tick: await browser.evaluate("PALIMPSITY.engine.state.tick"), history: result.history });
}

async function inspectFirstHouse() {
  await browser.page(() => {
    const building = PALIMPSITY.engine.state.buildings.find(building => building.def.id === "house");
    PALIMPSITY.ui.showInspector(building);
  });
}

try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport({ width: 1280, height: 720, dpr: 1 });
  await browser.boot(url);
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.money"), 600, "Natural start must be 600 EUR");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.materials"), 0, "Natural start has no materials");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.buildings.length"), 0, "Natural start has no free buildings");
  await activate("#display-toggle");
  await activate('[data-quality="low"]');
  await activate("#reduced-effects");
  await activate("#display-close");
  await activate("#river-start");
  await browser.waitFor("PALIMPSITY.mode === 'river'", "River Pact starts");

  await buy("house", 5, 2);
  await buy("well", 2, 2);
  await buy("farm", 1, 2);
  await buy("market", 1, 2);
  for (let attempt = 0; attempt < 100 && !await browser.evaluate("PALIMPSITY.ui.river.awaitingCharter"); attempt++) await step();
  if (!await browser.evaluate("PALIMPSITY.ui.river.awaitingCharter")) throw new Error("Charter was not offered after 100 turns");
  await activate("#river-gardens");
  actions.push({ type: "charter", id: "gardens", tick: await browser.evaluate("PALIMPSITY.engine.state.tick") });
  await buy("well", 1, 2);
  await buy("farm", 1, 2);
  await buy("park", 2, 2);
  await buy("house", 5, 0);
  await buy("well", 3, 0);
  await buy("farm", 2, 0);
  await buy("market", 1, 0);
  await buy("park", 2, 0);
  browser.scenario = "D3 advanced natural expansion";
  console.log(`D3 natural Nilo base complete at tick ${await browser.evaluate("PALIMPSITY.engine.state.tick")}`);
  await buy("farm", 2, 0);
  await buy("well", 2, 0);
  await buy("market", 1, 0);
  await buy("farm", 2, 2);
  await buy("well", 2, 2);
  await buy("market", 1, 2);

  await buy("workshop", 1, 2);
  await buy("warehouse", 1, 2);
  await buy("house", 10, 0);
  await buy("farm", 2, 0);
  await buy("well", 2, 0);
  await buy("farm", 1, 2);
  await buy("well", 1, 2);
  assert.ok(await browser.evaluate("PALIMPSITY.engine.state.phase >= 2"), "Phase 2 must unlock naturally");
  await step(2);
  await inspectFirstHouse();
  const baseCapacity = await browser.evaluate("PALIMPSITY.ui.inspectBuilding.architecture.floors");
  assert.equal(baseCapacity, 1);
  await transform("add_floor");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.inspectBuilding.architecture.floors"), 2, "UI adds a floor");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.profileOf(PALIMPSITY.ui.inspectBuilding).outputs.population"), 12, "Added floor doubles housing");

  await transform("base_shop");
  await step(2);
  const withoutEnergy = await browser.page(() => {
    const building = PALIMPSITY.ui.inspectBuilding, profile = PALIMPSITY.engine.profileOf(building);
    return { floors: building.architecture.floors, population: profile.outputs.population, energyIn: profile.inputs.energy, sales: building.flowOutput.sales || 0, rent: building.flowOutput.rent || 0 };
  });
  assert.equal(withoutEnergy.floors, 2, "Shop preserves upper floor");
  assert.equal(withoutEnergy.population, 6, "Only ground-floor homes are replaced");
  assert.equal(withoutEnergy.energyIn, 1, "Shop really requires electricity");
  assert.equal(withoutEnergy.sales, 0, "Shop has no normal sales without electricity");
  assert.ok(withoutEnergy.rent > 0, "Upper-floor rent remains distinct from sales");

  await buy("generator", 1, 0);
  await step(2);
  const withEnergy = await browser.page(() => {
    const building = PALIMPSITY.ui.inspectBuilding, generator = PALIMPSITY.engine.state.buildings.find(item => item.def.id === "generator");
    return { energy: generator.flowOutput.energy || 0, sales: building.flowOutput.sales || 0, activity: building.activity };
  });
  assert.ok(withEnergy.energy > 0, "Generator provides actual electricity");
  assert.ok(withEnergy.sales > 0, "Shop sells once inputs exist");
  assert.ok(withEnergy.activity > 0, "Shop is active with inputs");

  await transform("add_floor");
  await transform("add_floor");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.inspectBuilding.architecture.floors"), 4, "House reaches four floors through UI");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.profileOf(PALIMPSITY.ui.inspectBuilding).outputs.population"), 18, "Four floors preserve eighteen mixed-use homes");
  await buy("commons", 1, 2);
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.buildings.filter(building => building.def.id === 'commons').length"), 1, "Commons is built with natural resources");
  for (let attempt = 0; attempt < 160 && !await browser.evaluate("PALIMPSITY.engine.state.unlocked.has('maint_center') || PALIMPSITY.engine.state.phase >= 4"); attempt++) await step();
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.phase"), 4, "Phase 4 must arrive naturally within 160 turns");
  await transform("roof_productive");
  await step(2);
  const roof = await browser.page(() => {
    const building = PALIMPSITY.ui.inspectBuilding, profile = PALIMPSITY.engine.profileOf(building), record = PALIMPSITY.renderer.meshByBuilding.get(building);
    return { architecture: { ...building.architecture }, food: profile.outputs.food, energy: profile.outputs.energy, actualFood: building.flowOutput.food, actualEnergy: building.flowOutput.energy, signature: record.layerSignature };
  });
  assert.equal(roof.architecture.floors, 4);
  assert.equal(roof.architecture.roof, "productive");
  assert.equal(roof.food, 5);
  assert.equal(roof.energy, 2);
  assert.ok(roof.actualFood > 0 && roof.actualEnergy > 0, "Productive roof really produces food and electricity");
  assert.match(roof.signature, /roof_productive/);

  await convert("workshop_repair");
  await convert("warehouse_hall");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.buildings.find(building => building.def.id === 'workshop').conversion"), "workshop_repair");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.buildings.find(building => building.def.id === 'warehouse').conversion"), "warehouse_hall");
  browser.scenario = "D3 victory and captures";
  console.log(`D3 advanced route complete at tick ${await browser.evaluate("PALIMPSITY.engine.state.tick")}`);

  await inspectFirstHouse();
  await browser.screenshot("d3-natural-inspector", { width: 1280, height: 720, dpr: 1 });
  await activate("#display-toggle");
  await activate("#photo-enter");
  await activate('[data-photo-time="golden"]');
  assert.equal(await browser.evaluate("PALIMPSITY.renderer.photoMode"), true);
  await browser.screenshot("d3-natural-photo-golden", { width: 1280, height: 720, dpr: 1 });
  await activate("#photo-exit");
  assert.equal(await browser.evaluate("PALIMPSITY.renderer.photoMode"), false);

  for (let attempt = 0; attempt < 240 && await browser.evaluate("PALIMPSITY.ui.river.status === 'running'"); attempt++) await step();
  if (await browser.evaluate("PALIMPSITY.ui.river.status === 'running'")) throw new Error("River Pact did not finish after 240 turns");
  const final = await browser.page(() => ({ tick: PALIMPSITY.engine.state.tick, status: PALIMPSITY.ui.river.status, finishedAtTick: PALIMPSITY.ui.river.finishedAtTick, droughtHeld: PALIMPSITY.ui.river.droughtHeld, population: PALIMPSITY.engine.state.res.population, money: PALIMPSITY.engine.state.res.money, materials: PALIMPSITY.engine.state.res.materials, phase: PALIMPSITY.engine.state.phase }));
  assert.equal(final.status, "success", JSON.stringify(final));
  assert.equal(final.finishedAtTick, 161, JSON.stringify(final));
  assert.equal(final.droughtHeld, true, "Drought must be held naturally");
  assert.ok(final.population >= 48, "Natural population objective");
  assert.equal(final.phase, 4, "Natural phase 4 is retained");
  await browser.screenshot("d3-natural-victory", { width: 1280, height: 720, dpr: 1 });
  await writeFile(path.join(rootDir, "docs", "living-layers", "d3-natural-results.json"), JSON.stringify({ route: "600 EUR natural, SW then NW, Gardens charter; public place/tick for acceleration; transformations and conversions through UI buttons", final, actions }, null, 2) + "\n");
  console.log(`PASS D3 natural playthrough: ${actions.length} public actions, victory at ${final.finishedAtTick}, ${actions.filter(action => action.type === "transformation").length} UI transformations and ${actions.filter(action => action.type === "conversion").length} UI conversions`);
} catch (error) {
  await browser.screenshot("d3-natural-failure", { width: 1280, height: 720, dpr: 1 }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
