import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { LivingLayersBrowser, VIEWPORTS, machineInfo, validateArchitecture } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const docsDir = path.join(rootDir, "docs", "living-layers");
const capturesDir = path.join(docsDir, "captures");
const dist = path.join(rootDir, "dist", "palimpsity-mvp.html");
const distURL = pathToFileURL(dist).href;
const sampleFrames = Math.max(20, Number(process.env.LIVING_LAYERS_FRAMES) || 30);
mkdirSync(capturesDir, { recursive: true });

const exportBytes = readFileSync(dist);
let revision = "unknown";
try { revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim(); } catch {}
const report = {
  generatedAt: new Date().toISOString(),
  revision,
  machine: machineInfo(),
  conditions: {
    browserMode: "isolated temporary Chrome profile, new headless mode, offline network emulation",
    renderer: "SwiftShader requested with --use-angle=swiftshader; not a hardware-GPU benchmark",
    simulation: "paused for visual measurements; elevated/mixed/dense fixtures explicitly prepare phase 4, 5000 EUR and 500 materials; transformations and conversions use real public APIs; River Pact routes retain natural 600 EUR starts",
    sampleFrames,
    viewports: VIEWPORTS,
    note: "390 px is CSS viewport width; high profiles use DPR 2 and screenshots retain physical pixels.",
  },
  export: { file: dist, bytes: exportBytes.length, gzipBytes: gzipSync(exportBytes).length },
  scenarios: [],
  measurements: [],
  screenshots: [],
  diagnostics: {},
};
const browser = new LivingLayersBrowser({ dist, captures: capturesDir, frames: sampleFrames });
let ready = false;

class Blocked extends Error {}
const json = value => JSON.stringify(value, null, 2) + "\n";

async function installHelpers() {
  await browser.page(() => {
    const t = window.__livingLayers = {};
    t.district = (c, r) => (r >= PALIMPSITY.engine.terrain.length / 2 ? 2 : 0) + (c >= PALIMPSITY.engine.terrain[0].length / 2 ? 1 : 0);
    t.sync = () => { PALIMPSITY.renderer.sync(); PALIMPSITY.ui.update(); };
    t.summary = () => {
      const e = PALIMPSITY.engine;
      return { tick: e.state.tick, phase: e.state.phase, outcome: e.state.outcome, money: e.state.res.money,
        materials: e.state.res.materials, population: e.state.res.population, buildings: e.state.buildings.length };
    };
    t.freeCells = (id, district) => {
      const e = PALIMPSITY.engine, cells = [];
      for (let r = 0; r < e.terrain.length; r++) for (let c = 0; c < e.terrain[r].length; c++) {
        if (district != null && t.district(c, r) !== district) continue;
        if (!e.occ[r][c] && e.terrain[r][c] !== 1) cells.push({ c, r, preferred: id === "farm" && e.terrain[r][c] === 2 });
      }
      return cells.sort((a, b) => Number(b.preferred) - Number(a.preferred));
    };
    t.buy = (id, count, district = null) => {
      const e = PALIMPSITY.engine, placed = [];
      for (let n = 0; n < count; n++) {
        if (!e.state.unlocked.has(id)) throw new Error(`${id} is not naturally unlocked: ${JSON.stringify(t.summary())}`);
        let building = null;
        for (let waited = 0; waited <= 500 && !building; waited++) {
          const cells = t.freeCells(id, district);
          if (!cells.length) throw new Error(`No free site for ${id} in district ${district}`);
          const cell = cells.find(({ c, r }) => e.canPlace(id, c, r));
          if (cell) building = e.place(id, cell.c, cell.r);
          else {
            const reasons = [...new Set(cells.map(({ c, r }) => e.placeBlockReason(id, c, r)))];
            if (reasons.some(reason => reason !== "Not enough money.")) throw new Error(`${id}: ${reasons.join(" / ")}`);
            if (waited === 500 || e.state.outcome) throw new Error(`Cannot save for ${id}: ${JSON.stringify(t.summary())}`);
            e.tick();
          }
        }
        placed.push({ id, c: building.c, r: building.r });
      }
      t.sync();
      return placed;
    };
    t.transform = (cell, id) => {
      const e = PALIMPSITY.engine, b = e.occ[cell.r]?.[cell.c];
      if (!b) throw new Error(`No building at ${cell.c},${cell.r}`);
      let offer, reason;
      for (let waited = 0; waited <= 600; waited++) {
        offer = e.transformationOptions(b).find(option => option.id === id);
        if (!offer) throw new Error(`${id} is not offered for ${b.def.id}`);
        reason = e.transformationBlockReason(b, id);
        if (!reason) break;
        if (!/not enough|phase|turns old|back in service/i.test(reason) || waited === 600 || e.state.outcome) {
          throw new Error(`${id} remains blocked: ${reason}; ${JSON.stringify(t.summary())}`);
        }
        e.tick();
      }
      const money = e.state.res.money, materials = e.state.res.materials, historyLength = b.history?.length || 0;
      const before = JSON.stringify(offer.before), expected = JSON.stringify(offer.after.architecture);
      if (before === JSON.stringify(offer.after) || offer.before === offer.after || offer.before.architecture === offer.after.architecture) {
        throw new Error(`${id}: before/after must be distinct cloned profiles`);
      }
      if (!e.transformBuilding(b, id)) throw new Error(`${id}: atomic transformation returned false`);
      if (e.state.res.money !== money - offer.cost.money || e.state.res.materials !== materials - offer.cost.materials) {
        throw new Error(`${id}: transformation cost was not charged exactly once`);
      }
      if (JSON.stringify(b.architecture) !== expected) throw new Error(`${id}: resulting architecture differs from the offer`);
      if (!b.history?.some((event, index) => index >= historyLength && event.tick === e.state.tick && event.type === "transformation")) {
        throw new Error(`${id}: history event missing`);
      }
      t.sync();
      return { cell, id, before: offer.before, after: b.architecture, cost: offer.cost };
    };
    t.convert = (cell, id) => {
      const e = PALIMPSITY.engine, b = e.occ[cell.r]?.[cell.c];
      if (!b) throw new Error(`No building at ${cell.c},${cell.r}`);
      let offer, reason;
      for (let waited = 0; waited <= 800; waited++) {
        offer = e.conversionOptions(b).find(option => option.id === id);
        if (!offer) throw new Error(`${id} is not offered for ${b.def.id}`);
        reason = e.conversionBlockReason(b, id);
        if (!reason) break;
        if (!/not enough|phase|turns old|back in service/i.test(reason) || waited === 800 || e.state.outcome) {
          throw new Error(`${id} remains blocked: ${reason}; ${JSON.stringify(t.summary())}`);
        }
        e.tick();
      }
      const money = e.state.res.money, materials = e.state.res.materials;
      if (!e.convertBuilding(b, id)) throw new Error(`${id}: conversion returned false`);
      if (b.conversion !== id) throw new Error(`${id}: conversion marker missing`);
      if (e.state.res.money !== money - offer.cost.money || e.state.res.materials !== materials - offer.cost.materials) {
        throw new Error(`${id}: conversion cost was not charged exactly once`);
      }
      t.sync();
      return { cell, id, cost: offer.cost, conversion: b.conversion };
    };
    t.modularReadiness = () => {
      const e = PALIMPSITY.engine, manifest = PALIMPSITY.renderer.manifest || window.__PALIMPSITY_ASSET_MANIFEST;
      const missing = [];
      if (manifest?.layers?.floorHeight !== 0.48 || !manifest?.layers?.modules) missing.push("manifest.layers with floorHeight 0.48 and modules");
      for (const method of ["profileOf", "transformationOptions", "transformationBlockReason", "transformBuilding"]) {
        if (typeof e[method] !== "function") missing.push(`engine.${method}()`);
      }
      return { available: missing.length === 0, missing };
    };
    t.inspect = cell => {
      const b = PALIMPSITY.engine.occ[cell.r]?.[cell.c];
      PALIMPSITY.ui.showInspector(b || null);
      if (!b || !document.querySelector("#inspector.on")) throw new Error("Inspector did not open through its public UI API");
      return { c: b.c, r: b.r, architecture: b.architecture || null, conversion: b.conversion || null };
    };
    t.closeInspector = () => PALIMPSITY.ui.showInspector(null);
    t.architecture = cells => cells.map(cell => {
      const b = PALIMPSITY.engine.occ[cell.r]?.[cell.c];
      return { ...cell, architecture: b?.architecture || null, conversion: b?.conversion || null };
    });
  });
}

async function bootClassic() {
  await browser.boot(distURL);
  await installHelpers();
  assert.equal(await browser.evaluate("PALIMPSITY.mode"), "classic");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.money"), 600);
}

async function requireModules() {
  const readiness = await browser.evaluate("__livingLayers.modularReadiness()");
  if (!readiness.available) throw new Blocked(`Standalone build lacks ${readiness.missing.join(", ")}. Rebuild after the engine/assets lanes land.`);
}

async function home() {
  await browser.click("#camera-home");
  await browser.frames(5);
}

async function settleVisuals() {
  await browser.dismissReports();
  await browser.waitFor("!document.querySelector('#toast .toast-msg')", "transient notifications to clear", 60000);
  await browser.frames(3);
}

async function zoomIn(steps = 6) {
  const point = await browser.evaluate("({x:innerWidth/2,y:innerHeight/2})");
  for (let i = 0; i < steps; i++) {
    await browser.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: -120 });
    await browser.frames(2);
  }
}

async function foundation() {
  return browser.page(() => {
    const t = __livingLayers, placed = {};
    placed.houses = t.buy("house", 6, 2);
    placed.wells = t.buy("well", 3, 2);
    placed.farms = t.buy("farm", 2, 2);
    placed.workshops = t.buy("workshop", 1, 2);
    placed.markets = t.buy("market", 1, 2);
    placed.parks = t.buy("park", 1, 2);
    const e = PALIMPSITY.engine;
    for (let i = 0; i < 120 && e.state.phase < 2 && !e.state.outcome; i++) e.tick();
    if (e.state.phase < 2 || e.state.outcome) throw new Error(`Natural foundation failed: ${JSON.stringify(t.summary())}`);
    t.sync();
    return placed;
  });
}

async function prepareVisualScene() {
  await browser.page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer;
    e.state.phase = 4;
    e.state.res.money = 5000;
    e.state.res.materials = 500;
    r.setQuality("high");
    r.setReducedEffects(false);
    r.setPhotoMode(false);
    r.toggleRoof(true);
    PALIMPSITY.ui.showInspector(null);
    PALIMPSITY.ui.update();
  });
}

async function elevatedCity() {
  await browser.viewport(VIEWPORTS[0]);
  await bootClassic();
  await requireModules();
  const placed = await foundation();
  await prepareVisualScene();
  await browser.dismissReports();
  await home();
  await browser.screenshot("elevated-before-general", VIEWPORTS[0]);
  const actions = [];
  for (const [index, sequence] of [
    ["add_floor", "add_floor", "roof_garden", "family_gardens", "variant_1"],
    ["add_floor", "roof_garden", "family_works", "variant_2"],
    ["add_floor", "add_floor"],
  ].entries()) {
    for (const id of sequence) actions.push(await browser.page((cell, id) => __livingLayers.transform(cell, id), placed.houses[index], id));
  }
  const architecture = await browser.page(cells => __livingLayers.architecture(cells), placed.houses.slice(0, 3));
  for (const item of architecture) {
    assert.ok(validateArchitecture(item.architecture), `Invalid resulting architecture: ${JSON.stringify(item)}`);
    assert.ok(item.architecture.floors >= 2, "Elevated city must contain real added floors");
  }
  assert.deepEqual(architecture.map(item => item.architecture.floors), [3, 2, 3]);
  await settleVisuals();
  await home();
  await browser.screenshot("elevated-after-general", VIEWPORTS[0]);
  await zoomIn();
  await browser.page(cell => __livingLayers.inspect(cell), placed.houses[0]);
  await browser.screenshot("elevated-after-close-inspector", VIEWPORTS[0]);
  return { placed, actions, architecture, final: await browser.evaluate("__livingLayers.summary()") };
}

async function cameraAndInspection(cell) {
  const before = await browser.evaluate("__livingLayers.summary()");
  for (let iteration = 0; iteration < 3; iteration++) {
    await browser.page(() => __livingLayers.closeInspector());
    await home();
    const point = await browser.evaluate("({x:innerWidth/2,y:innerHeight/2})");
    await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 8; step++) {
      await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + step * 7, y: point.y + step * 2, button: "left", buttons: 1 });
    }
    await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 56, y: point.y + 16, button: "left", buttons: 0, clickCount: 1 });
    await browser.frames(4);
    await zoomIn(2);
    await browser.click('[data-projection="ortho"]');
    assert.equal(await browser.evaluate("PALIMPSITY.renderer.projectionMode"), "ortho");
    await browser.click('[data-projection="perspective"]');
    assert.equal(await browser.evaluate("PALIMPSITY.renderer.projectionMode"), "perspective");
    await home();
    await browser.page(cell => __livingLayers.inspect(cell), cell);
  }
  assert.deepEqual(await browser.evaluate("__livingLayers.summary()"), before, "Camera and inspection must not advance or alter the simulation");
}

async function mixedCityAndMeasurements() {
  await browser.viewport(VIEWPORTS[0]);
  await bootClassic();
  await requireModules();
  const placed = await foundation();
  placed.warehouses = await browser.page(() => __livingLayers.buy("warehouse", 1, 2));
  await prepareVisualScene();
  await browser.dismissReports();
  await home();
  await browser.screenshot("mixed-before-general", VIEWPORTS[0]);
  const transformations = [];
  for (const [index, id] of [[0, "base_shop"], [1, "roof_garden"]]) {
    transformations.push(await browser.page((cell, id) => __livingLayers.transform(cell, id), placed.houses[index], id));
  }
  const conversions = [];
  conversions.push(await browser.page((cell, id) => __livingLayers.convert(cell, id), placed.workshops[0], "workshop_repair"));
  conversions.push(await browser.page((cell, id) => __livingLayers.convert(cell, id), placed.warehouses[0], "warehouse_hall"));
  await settleVisuals();
  await home();
  await browser.screenshot("mixed-after-general", VIEWPORTS[0]);
  for (const [name, cell] of [["workshop-repair", placed.workshops[0]], ["warehouse-hall", placed.warehouses[0]]]) {
    await browser.page(cell => {
      const b = PALIMPSITY.engine.occ[cell.r][cell.c];
      PALIMPSITY.ui.showInspector(b);
      PALIMPSITY.renderer.focusBuilding(b);
    }, cell);
    await browser.frames(10);
    await browser.screenshot(`mixed-${name}-close-inspector`, VIEWPORTS[0]);
  }
  await cameraAndInspection(placed.houses[0]);
  await zoomIn(5);
  await browser.screenshot("mixed-after-close-inspector", VIEWPORTS[0]);
  const measurements = [];
  for (const viewport of VIEWPORTS) {
    browser.scenario = `mixed city ${viewport.id}`;
    await browser.page(() => __livingLayers.closeInspector());
    await browser.viewport(viewport);
    await home();
    await browser.screenshot(`mixed-${viewport.id}-general`, viewport);
    measurements.push(await browser.measure(`mixed-${viewport.id}-general`, viewport));
    await zoomIn(viewport.width < 500 ? 3 : 5);
    await browser.page(cell => __livingLayers.inspect(cell), placed.houses[0]);
    await browser.screenshot(`mixed-${viewport.id}-close-inspector`, viewport);
  }
  report.measurements.push(...measurements);
  return { placed, transformations, conversions, measurements, final: await browser.evaluate("__livingLayers.summary()") };
}

async function denseCityHighLow() {
  await browser.viewport(VIEWPORTS[0]);
  await bootClassic();
  await requireModules();
  const placed = await foundation();
  await prepareVisualScene();
  placed.denseHouses = await browser.page(() => __livingLayers.buy("house", 12));
  const actions = [];
  for (const [index, cell] of placed.denseHouses.entries()) {
    for (let floor = 2; floor <= 4; floor++) actions.push(await browser.page((cell, id) => __livingLayers.transform(cell, id), cell, "add_floor"));
    actions.push(await browser.page((cell, id) => __livingLayers.transform(cell, id), cell, index % 2 ? "roof_garden" : "roof_productive"));
  }
  const architecture = await browser.page(cells => __livingLayers.architecture(cells), placed.denseHouses);
  assert.ok(architecture.every(item => item.architecture.floors === 4));
  await settleVisuals();
  await browser.viewport(VIEWPORTS[1]);
  await home();
  await browser.screenshot("dense-1920x1080-high-general", VIEWPORTS[1]);
  const high = await browser.measure("dense-1920x1080-high", VIEWPORTS[1], "high");
  await browser.page(() => {
    PALIMPSITY.renderer.setQuality("low");
    PALIMPSITY.renderer.setReducedEffects(false);
  });
  await browser.frames(10);
  await browser.screenshot("dense-1920x1080-low-general", VIEWPORTS[1]);
  const low = await browser.measure("dense-1920x1080-low", VIEWPORTS[1], "low");
  report.measurements.push(high, low);
  return { placed, actions, architecture, high, low, final: await browser.evaluate("__livingLayers.summary()") };
}

async function riverStep() {
  if (await browser.evaluate("document.querySelector('#modal').classList.contains('on')")) await browser.key("Escape", "Escape", 27);
  await browser.click("#river-step");
  return browser.evaluate("PALIMPSITY.ui.river.progress()");
}

async function riverBuy(id, count, district) {
  const placed = [];
  for (let n = 0; n < count; n++) {
    let result;
    for (let attempt = 0; attempt < 120; attempt++) {
      result = await browser.page((id, district) => {
        const e = PALIMPSITY.engine, t = __livingLayers;
        if (!e.state.unlocked.has(id)) throw new Error(`${id} is not naturally unlocked in River Pact`);
        const cell = t.freeCells(id, district)[0];
        if (!cell) throw new Error(`No River Pact site for ${id} in district ${district}`);
        const reason = e.placeBlockReason(id, cell.c, cell.r);
        if (reason) return { reason };
        const b = e.place(id, cell.c, cell.r);
        t.sync();
        return { id, c: b.c, r: b.r };
      }, id, district);
      if (!result.reason) break;
      if (result.reason !== "Not enough money.") throw new Error(`${id}: ${result.reason}`);
      const progress = await riverStep();
      if (!progress || progress.status !== "running") throw new Error(`River Pact stopped while saving for ${id}: ${json(progress)}`);
      result = null;
    }
    assert.ok(result, `Could not buy ${id} after 120 real River Pact batches`);
    placed.push(result);
  }
  return placed;
}

async function riverCharter(charter) {
  await browser.viewport(VIEWPORTS[0]);
  await bootClassic();
  await browser.click("#river-start");
  await browser.waitFor("PALIMPSITY.mode === 'river' && PALIMPSITY.ui.river", `River Pact ${charter} start`);
  const actions = [];
  actions.push(...await riverBuy("house", 5, 2));
  actions.push(...await riverBuy("well", 2, 2));
  actions.push(...await riverBuy("farm", 1, 2));
  actions.push(...await riverBuy("market", 1, 2));
  let progress;
  for (let attempt = 0; attempt < 40; attempt++) {
    progress = await riverStep();
    if (progress.awaitingCharter) break;
  }
  assert.ok(progress?.awaitingCharter, `Act I must request a charter: ${json(progress)}`);
  await browser.screenshot(`river-${charter}-before-charter`, VIEWPORTS[0]);
  await browser.click(`#river-${charter}`);
  assert.equal(await browser.evaluate("PALIMPSITY.ui.river.charter"), charter);
  assert.equal(await browser.evaluate("PALIMPSITY.ui.river.canAdvance"), true);
  await browser.screenshot(`river-${charter}-after-charter`, VIEWPORTS[0]);
  actions.push(...await riverBuy("well", 1, 2));
  actions.push(...await riverBuy("farm", 1, 2));
  actions.push(...await riverBuy("park", charter === "gardens" ? 2 : 1, 2));
  if (charter === "workshops") actions.push(...await riverBuy("workshop", 1, 2));
  actions.push(...await riverBuy("house", 5, 0));
  actions.push(...await riverBuy("well", 3, 0));
  actions.push(...await riverBuy("farm", 2, 0));
  actions.push(...await riverBuy("market", 1, 0));
  actions.push(...await riverBuy("park", charter === "gardens" ? 2 : 1, 0));
  if (charter === "workshops") actions.push(...await riverBuy("workshop", 1, 0));
  for (let attempt = 0; attempt < 55; attempt++) {
    progress = await riverStep();
    if (progress.status !== "running") break;
  }
  assert.equal(progress?.status, "success", `${charter} must survive the real drought: ${json(progress)}`);
  assert.equal(progress.droughtHeld, true);
  assert.equal(progress.finishedAtTick, 161);
  await browser.screenshot(`river-${charter}-success-dialog`, VIEWPORTS[0]);
  return { charter, actions, progress, final: await browser.evaluate("__livingLayers.summary()") };
}

async function scenario(name, fn) {
  browser.scenario = name;
  const started = Date.now();
  try {
    const details = await fn();
    report.scenarios.push({ name, status: "passed", durationMs: Date.now() - started, details });
    console.log(`PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } catch (error) {
    const status = error instanceof Blocked ? "blocked" : "failed";
    report.scenarios.push({ name, status, durationMs: Date.now() - started, error: error.stack || String(error) });
    console.error(`${status.toUpperCase()} ${name}: ${error.message}`);
    if (ready) {
      try { await browser.screenshot(`failure-${name.replace(/[^a-z0-9]+/gi, "-")}`); } catch {}
    }
  }
}

function markdown() {
  const lines = ["# Living Layers — observed browser results", "", `Generated: ${report.generatedAt}`, `Revision: ${report.revision}`, "",
    `- Machine: ${report.machine.platform}/${report.machine.architecture}, ${report.machine.processor}, ${report.machine.logicalProcessors} logical processors, ${report.machine.totalMemoryBytes} bytes RAM.`,
    `- Runtime: Node ${report.machine.node}; ${report.browser?.product || "browser unavailable"}.`,
    `- Conditions: ${report.conditions.renderer}; ${report.conditions.browserMode}.`,
    `- Standalone export: ${report.export.bytes} bytes (${report.export.gzipBytes} bytes gzip).`,
    `- Frame samples: ${report.conditions.sampleFrames} measured requestAnimationFrame intervals after 15 warm-up frames, simulation paused.`, "",
    "## Scenarios", ""];
  for (const item of report.scenarios) {
    lines.push(`- **${item.status.toUpperCase()} — ${item.name}** (${item.durationMs} ms)${item.error ? `: ${item.error.split("\n")[0]}` : ""}`);
  }
  lines.push("", "## Measurements", "");
  if (!report.measurements.length) lines.push("No performance measurement was collected; the modular city scenario was not available.");
  else {
    lines.push("All values below are observations from this run, not targets or hardware-GPU claims.", "",
      "| View | FPS | mean ms | p95 ms | draw calls | triangles | JS heap bytes | DPR / renderer ratio | drawing buffer |", 
      "|---|---:|---:|---:|---:|---:|---:|---|---|");
    for (const m of report.measurements) lines.push(`| ${m.label} | ${m.fps.toFixed(2)} | ${m.meanFrameMs.toFixed(2)} | ${m.p95FrameMs.toFixed(2)} | ${m.drawCalls} | ${m.triangles} | ${m.jsHeap?.usedBytes ?? "unavailable"} | ${m.devicePixelRatio} / ${m.rendererPixelRatio} | ${m.drawingBuffer.width}×${m.drawingBuffer.height} |`);
  }
  lines.push("", "## Captures", "");
  if (!browser.screenshots.length) lines.push("No capture was produced.");
  for (const shot of browser.screenshots) lines.push(`- \`captures/${path.basename(shot.file)}\` — ${shot.width}×${shot.height} physical pixels, ${shot.bytes} bytes.`);
  lines.push("", "The JSON report contains full actions, architecture/conversion evidence, CDP memory metrics and errors.");
  return lines.join("\n") + "\n";
}

try {
  await browser.connect();
  report.browser = browser.browserInfo;
  await browser.viewport(VIEWPORTS[0]);
  ready = true;
  await scenario("elevated city", elevatedCity);
  await scenario("mixed city, two conversions, camera and native viewports", mixedCityAndMeasurements);
  await scenario("dense city — high and low quality", denseCityHighLow);
  await scenario("River Pact — Garden commons", () => riverCharter("gardens"));
  await scenario("River Pact — Makers quarter", () => riverCharter("workshops"));
  if (ready) {
    report.diagnostics = {
      exceptions: browser.exceptions,
      pageErrors: await browser.evaluate("window.__livingLayersPageErrors || []").catch(error => [error.message]),
      cdpInterceptionErrors: browser.pageErrors,
      blockedRequests: browser.blocked,
      unexpectedRequests: browser.requests.filter(url => url !== distURL && !/^(data|blob):$/.test(url)),
    };
  }
} catch (error) {
  report.scenarios.push({ name: "browser bootstrap", status: "failed", error: error.stack || String(error) });
  console.error(error);
} finally {
  report.screenshots = browser.screenshots.map(shot => ({ ...shot, file: path.relative(docsDir, shot.file).replaceAll("\\", "/") }));
  report.diagnostics.chromeStderrTail = browser.stderr;
  const finished = report.scenarios.length === 5 && report.scenarios.every(item => item.status === "passed")
    && Object.values(report.diagnostics).every(value => Array.isArray(value) && value.length === 0 || !Array.isArray(value));
  report.status = finished ? "passed" : "incomplete";
  writeFileSync(path.join(docsDir, "results.json"), json(report));
  writeFileSync(path.join(docsDir, "observed-results.md"), markdown());
  try { await browser.close(); } catch (error) { console.error(`Browser cleanup: ${error.message}`); process.exitCode = 1; }
  if (!finished) process.exitCode = 1;
  console.log(`Living Layers report: ${path.join(docsDir, "observed-results.md")}`);
}
