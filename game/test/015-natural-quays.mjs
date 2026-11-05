import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LivingLayersBrowser, machineInfo, summarizeFrameIntervals } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const docsDir = path.join(rootDir, "docs", "living-layers");
const captures = path.join(docsDir, "captures");
const dist = path.join(rootDir, "dist", "palimpsity-mvp.html");
const url = pathToFileURL(dist).href;
const desktop = { width: 1280, height: 720, dpr: 1 };
const performanceViewport = { width: 1920, height: 1080, dpr: 2 };
mkdirSync(captures, { recursive: true });
const browser = new LivingLayersBrowser({ dist, captures, frames: 20 });
const actions = [], measurements = [], screenshots = [];
const result = { generatedAt: new Date().toISOString(), machine: machineInfo(), artifact: {}, route: {}, checks: {}, measurements, screenshots, errors: [] };

async function step() {
  await browser.page(() => {
    const e = PALIMPSITY.engine;
    if (!PALIMPSITY.ui.river.canAdvance) throw new Error(`River cannot advance: ${JSON.stringify(PALIMPSITY.ui.river.progress())}`);
    e.tick();
    PALIMPSITY.ui.river.update();
    PALIMPSITY.renderer.sync();
    PALIMPSITY.ui.update();
  });
  if (await browser.evaluate("PALIMPSITY.ui.river.awaitingCharter")) {
    await browser.click("#river-workshops");
    actions.push({ type: "charter", id: "workshops", tick: await browser.evaluate("PALIMPSITY.engine.state.tick") });
  }
  if (await browser.evaluate("document.querySelector('#modal').classList.contains('on')")) await browser.key("Escape", "Escape", 27);
}

async function advanceTo(target) {
  while (await browser.evaluate("PALIMPSITY.engine.state.tick") < target) {
    if (await browser.evaluate("PALIMPSITY.engine.state.outcome")) throw new Error(`Natural city ended before ${target}`);
    await step();
  }
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.tick"), target);
}

async function place(id, c, r) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const placed = await browser.page(({ id, c, r }) => {
      const e = PALIMPSITY.engine;
      if (!e.state.unlocked.has(id)) return { wait: true, reason: "locked" };
      const reason = e.placeBlockReason(id, c, r);
      if (reason && reason !== "Not enough money." && reason !== "Not enough materials.") throw new Error(`${id}@${c},${r}: ${reason}`);
      const b = reason ? null : e.place(id, c, r);
      if (!b) return { wait: true, reason };
      PALIMPSITY.renderer.sync(); PALIMPSITY.ui.update();
      return { building: { id, c: b.c, r: b.r }, cost: { ...b.def.cost } };
    }, { id, c, r });
    if (!placed.wait) {
      const action = { type: "place", ...placed.building, tick: await browser.evaluate("PALIMPSITY.engine.state.tick"), cost: placed.cost };
      actions.push(action);
      return action;
    }
    await step();
  }
  throw new Error(`${id}@${c},${r}: no natural placement after 500 turns`);
}

async function buyAny(id, count, district) {
  for (let index = 0; index < count; index++) {
    const cell = await browser.page(({ id, district }) => {
      const e = PALIMPSITY.engine;
      for (let r = 0; r < e.terrain.length; r++) for (let c = 0; c < e.terrain[r].length; c++) {
        const d = (r >= e.terrain.length / 2 ? 2 : 0) + (c >= e.terrain[r].length / 2 ? 1 : 0);
        if (d === district && !e.occ[r][c] && e.terrain[r][c] !== 1) return { c, r };
      }
      throw new Error(`No free cell for ${id} in district ${district}`);
    }, { id, district });
    await place(id, cell.c, cell.r);
  }
}

async function inspectQuay(c, r) {
  await browser.page(({ c, r }) => {
    const b = PALIMPSITY.engine.occ[r][c];
    PALIMPSITY.ui.showInspector(b);
    PALIMPSITY.ui.update();
  }, { c, r });
}

async function capture(name, viewport = desktop) {
  const shot = await browser.screenshot(name, viewport);
  screenshots.push({ name: `${name}.png`, width: shot.width, height: shot.height, bytes: shot.bytes });
}

async function measurePresentState(label) {
  await browser.page(() => {
    const r = PALIMPSITY.renderer;
    r.setQuality("high");
    r.setReducedEffects(false);
    r.homeCamera(true);
    PALIMPSITY.ui.showInspector(null);
  });
  await browser.frames(5);
  const sample = await browser.page(async ({ warmupMs, sampleMs, minimumIntervals, maxSampleMs }) => {
    const r = PALIMPSITY.renderer, renderer = r.renderer, gl = renderer.getContext(), debug = gl.getExtension("WEBGL_debug_renderer_info");
    const warmupStart = performance.now();
    let warmupFrames = 0;
    while (performance.now() - warmupStart < warmupMs || warmupFrames < 5) { await new Promise(requestAnimationFrame); warmupFrames++; }
    const warmupDurationMs = performance.now() - warmupStart;
    const tickBefore = PALIMPSITY.engine.state.tick;
    const firstRafTimestamp = await new Promise(requestAnimationFrame);
    const rafIntervalsMs = [];
    let previous = firstRafTimestamp;
    while (true) {
      const elapsed = previous - firstRafTimestamp;
      if (elapsed >= sampleMs && rafIntervalsMs.length >= minimumIntervals) break;
      if (elapsed >= maxSampleMs) throw new Error(`Only ${rafIntervalsMs.length} intervals in ${maxSampleMs} ms`);
      const now = await new Promise(requestAnimationFrame);
      rafIntervalsMs.push(now - previous);
      previous = now;
    }
    return {
      warmupConfiguredMs: warmupMs, warmupDurationMs, firstRafTimestamp, lastRafTimestamp: previous, rafIntervalsMs,
      tickBefore, tickAfter: PALIMPSITY.engine.state.tick,
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      quality: r.quality, pixelRatio: renderer.getPixelRatio(),
      quayCount: PALIMPSITY.engine.state.buildings.filter(b => b.def.id === "river_quay").length,
      bargeCount: r._barges.length,
      webgl: { vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION) },
    };
  }, { warmupMs: 5000, sampleMs: 10000, minimumIntervals: 20, maxSampleMs: 60000 });
  Object.assign(sample, summarizeFrameIntervals(sample.rafIntervalsMs));
  assert.ok(sample.durationMs >= 10000 && sample.frames >= 20);
  assert.equal(sample.tickAfter, 120);
  assert.equal(sample.tickBefore, 120);
  const record = { label, viewport: performanceViewport, ...sample };
  measurements.push(record);
  return record;
}

try {
  await browser.connect();
  await browser.viewport(desktop);
  await browser.boot(url);
  await browser.click("#river-start");
  await browser.waitFor("PALIMPSITY.mode === 'river' && PALIMPSITY.ui.river", "015 natural River Pact");
  const initial = await browser.page(() => ({ money: PALIMPSITY.engine.state.res.money, materials: PALIMPSITY.engine.state.res.materials, population: PALIMPSITY.engine.state.res.population, phase: PALIMPSITY.engine.state.phase, buildings: PALIMPSITY.engine.state.buildings.length }));
  assert.deepEqual(initial, { money: 600, materials: 0, population: 0, phase: 1, buildings: 0 });
  result.route.initial = initial;

  for (const [c, r] of [[0, 6], [1, 6], [2, 6], [3, 6], [6, 6], [7, 6], [0, 8]]) await place("house", c, r);
  await place("well", 6, 7); await place("well", 5, 7); await place("farm", 4, 7); await place("workshop", 3, 7); await place("market", 2, 7);
  await advanceTo(7);
  for (const [c, r] of [[0, 0], [1, 0]]) await place("house", c, r);
  await place("well", 5, 0); await place("market", 3, 0); await place("workshop", 4, 0);
  await advanceTo(17); await place("farm", 1, 7);
  await advanceTo(27);
  await place("river_quay", 2, 5); await place("river_quay", 4, 6);
  assert.equal(actions.filter(action => action.id === "river_quay" && action.tick === 27).length, 2);
  await advanceTo(28);
  const flow28 = await browser.page(() => ({ tick: PALIMPSITY.engine.state.riverFlowTick, flows: PALIMPSITY.engine.state.riverFlows.map(flow => ({ resource: flow.resource, amount: flow.amount, sourceDistrict: flow.sourceDistrict, destinationDistrict: flow.destinationDistrict })), barges: PALIMPSITY.renderer._barges.map(rec => ({ resource: rec.flow.resource, amount: rec.flow.amount })) }));
  assert.equal(flow28.tick, 28);
  assert.equal(flow28.flows.find(flow => flow.resource === "food").amount, 4);
  assert.ok(Math.abs(flow28.flows.find(flow => flow.resource === "water").amount - 1.7496597908508473) < 1e-9);
  assert.equal(flow28.barges.length, 2);
  assert.deepEqual(flow28.barges, flow28.flows.map(({ resource, amount }) => ({ resource, amount })));
  result.route.flow28 = flow28;

  await inspectQuay(2, 5);
  const inspector28 = await browser.evaluate("document.querySelector('.quay-flows').textContent");
  assert.match(inspector28, /Import: 4 food/);
  assert.match(inspector28, /Export: 1.7 water/);
  await capture("015-natural-t28-inspector");

  await place("house", 2, 0);
  const beforeSecondary = await browser.evaluate("JSON.stringify({flows:PALIMPSITY.engine.state.riverFlows,tick:PALIMPSITY.engine.state.riverFlowTick,capacity:PALIMPSITY.engine.state.riverNetworks[0].effectiveCapacity})");
  await place("river_quay", 6, 5);
  const afterSecondary = await browser.evaluate("JSON.stringify({flows:PALIMPSITY.engine.state.riverFlows,tick:PALIMPSITY.engine.state.riverFlowTick,capacity:PALIMPSITY.engine.state.riverNetworks[0].effectiveCapacity})");
  assert.equal(afterSecondary, beforeSecondary, "Secondary quay must not add capacity or fabricate a new dated flow");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.quayInfo(PALIMPSITY.engine.occ[5][6]).flows.length"), 0);
  result.checks.secondaryQuay = true;

  await inspectQuay(2, 5);
  assert.equal(await browser.evaluate("document.querySelector('[data-quay-partner]').disabled"), false);
  await browser.click("[data-quay-partner]");
  assert.equal(await browser.evaluate("PALIMPSITY.renderer.cameraScale"), "building");
  assert.equal(await browser.evaluate("PALIMPSITY.renderer._selectedQuay === PALIMPSITY.engine.occ[5][2]"), true);
  result.checks.partnerFocus = true;

  await browser.page(() => { const select = document.getElementById("language-select"); select.value = "fr"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await inspectQuay(2, 5);
  await browser.viewport({ width: 390, height: 844, dpr: 2 });
  assert.match(await browser.evaluate("document.querySelector('.quay-info').textContent"), /Réseau fluvial/);
  assert.match(await browser.evaluate("document.querySelector('.quay-flows').textContent"), /Import : 4 nourriture/);
  assert.ok(await browser.evaluate("document.querySelector('[data-quay-partner]').getBoundingClientRect().height >= 44"));
  await capture("015-natural-mobile-fr", { width: 390, height: 844, dpr: 2 });
  await browser.page(() => { const select = document.getElementById("language-select"); select.value = "en"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await browser.viewport(desktop);

  await place("park", 5, 6); await place("house", 6, 0); await place("house", 7, 0);
  await place("well", 6, 1); await place("well", 7, 1); await place("farm", 0, 1); await place("farm", 1, 1); await place("park", 5, 1);
  await buyAny("house", 12, 0); await buyAny("well", 2, 0);
  for (const [c, r] of [[0, 10], [1, 10], [2, 10]]) await place("well", c, r);
  await advanceTo(120);
  const flow120 = await browser.page(() => ({ tick: PALIMPSITY.engine.state.riverFlowTick, networks: PALIMPSITY.engine.state.riverNetworks, flows: PALIMPSITY.engine.state.riverFlows.map(flow => ({ resource: flow.resource, amount: flow.amount })), backupWells: [PALIMPSITY.engine.occ[10][0], PALIMPSITY.engine.occ[10][1], PALIMPSITY.engine.occ[10][2]].filter(Boolean).length }));
  assert.equal(flow120.tick, 120);
  assert.equal(flow120.networks.length, 1);
  assert.equal(flow120.networks[0].effectiveCapacity, 6);
  assert.ok(Math.abs(flow120.flows.reduce((sum, flow) => sum + flow.amount, 0) - 6) < 1e-9);
  assert.equal(flow120.backupWells, 3);
  result.route.flow120 = flow120;
  await inspectQuay(2, 5);
  await capture("015-natural-t120-saturated");

  await browser.viewport(performanceViewport);
  const present = await measurePresentState("quays-barges-present");
  await capture("015-quays-barges-present", performanceViewport);
  const removed = await browser.page(() => {
    const e = PALIMPSITY.engine, removed = [];
    for (const b of [...e.state.buildings]) if (b.def.id === "river_quay") { removed.push({ c: b.c, r: b.r }); e.removeAt(b.c, b.r); }
    PALIMPSITY.renderer.sync(); PALIMPSITY.ui.update();
    return removed;
  });
  assert.equal(removed.length, 3);
  const absent = await measurePresentState("quays-barges-absent");
  assert.equal(absent.quayCount, 0); assert.equal(absent.bargeCount, 0);
  await capture("015-quays-barges-absent", performanceViewport);
  result.graphicDelta = {
    additionalP95Ms: present.p95FrameMs - absent.p95FrameMs,
    additionalP95Percent: (present.p95FrameMs - absent.p95FrameMs) / absent.p95FrameMs * 100,
    additionalDrawCalls: present.drawCalls - absent.drawCalls,
    additionalTriangles: present.triangles - absent.triangles,
  };
  await place("river_quay", 2, 5); await place("river_quay", 4, 6);
  await browser.viewport(desktop);

  await buyAny("farm", 1, 0); await buyAny("well", 2, 0);
  while (await browser.evaluate("PALIMPSITY.ui.river.status === 'running' && PALIMPSITY.engine.state.tick < 240")) await step();
  const final = await browser.page(() => ({ tick: PALIMPSITY.engine.state.tick, status: PALIMPSITY.ui.river.status, finishedAtTick: PALIMPSITY.ui.river.finishedAtTick, droughtHeld: PALIMPSITY.ui.river.droughtHeld, population: PALIMPSITY.engine.state.res.population, money: PALIMPSITY.engine.state.res.money, materials: PALIMPSITY.engine.state.res.materials, phase: PALIMPSITY.engine.state.phase, outcome: PALIMPSITY.engine.state.outcome }));
  assert.equal(final.status, "success", JSON.stringify(final));
  assert.equal(final.finishedAtTick, 161);
  assert.equal(final.droughtHeld, true);
  assert.equal(final.phase, 4);
  result.route.final = final;
  await capture("015-natural-victory");

  const bytes = readFileSync(dist);
  result.artifact = { file: dist, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  result.browser = browser.browserInfo;
  result.errors = [...browser.exceptions, ...browser.pageErrors];
  assert.deepEqual(result.errors, []);
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.errors.push(error.stack || String(error));
  await capture("015-natural-failure", desktop).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  try { await browser.close(); } catch (error) { result.errors.push(`Cleanup: ${error.message}`); process.exitCode = 1; }
  result.browserClosed = browser.exited || !browser.child;
  result.actions = actions;
  writeFileSync(path.join(docsDir, "015-natural-results.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(path.join(docsDir, "015-natural-summary.md"), `# 015 — route naturelle quais et barges\n\n- Statut : **${result.status === "passed" ? "PASS" : "FAIL"}**.\n- Départ : ${JSON.stringify(result.route.initial)}.\n- t28 : ${JSON.stringify(result.route.flow28)}.\n- t120 : ${JSON.stringify(result.route.flow120)}.\n- Final : ${JSON.stringify(result.route.final)}.\n- Delta graphique présent/absent : ${JSON.stringify(result.graphicDelta)}.\n- Captures : ${screenshots.map(shot => `[${shot.name}](captures/${shot.name})`).join(" · ")}.\n\nLes intervalles RAF bruts et toutes les actions sont dans \`015-natural-results.json\`.\n`);
  console.log(`015 report: ${path.join(docsDir, "015-natural-summary.md")}`);
}
