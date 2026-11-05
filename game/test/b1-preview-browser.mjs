import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LivingLayersBrowser } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const captures = path.join(rootDir, "docs", "living-layers", "captures");
const capturePrefix = process.env.CAPTURE_PREFIX || "b1-preview";
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

async function mouseClick(selector) {
  if (selector.includes("data-layer-group-toggle") || selector.includes("data-transform-preview")) {
    await browser.page(selector => { document.querySelector(selector).click(); }, selector);
    await browser.frames(2);
    return;
  }
  const point = await browser.point(selector);
  const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
  const down = browser.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
  const up = browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
  await Promise.all([down, up]);
  await browser.frames(2);
}

async function keyboardActivate(selector) {
  await browser.page(selector => { document.querySelector(selector).focus(); }, selector);
  const down = browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  const up = browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await Promise.all([down, up]);
  await browser.frames(2);
}

async function cameraTarget() { return browser.evaluate("PALIMPSITY.renderer.controls.target.toArray()"); }

async function stateSnapshot() {
  return browser.page(() => ({
    group: PALIMPSITY.ui.layerGroup,
    option: PALIMPSITY.ui.transformPreview?.id || null,
    money: PALIMPSITY.engine.state.res.money,
    materials: PALIMPSITY.engine.state.res.materials,
    architecture: PALIMPSITY.ui.inspectBuilding?.architecture ? { ...PALIMPSITY.ui.inspectBuilding.architecture } : null,
    camera: PALIMPSITY.renderer.controls.target.toArray(),
  }));
}

async function checkVisiblePreview(label) {
  const result = await browser.page(() => {
    const preview = document.querySelector(".transform-preview");
    const title = preview?.querySelector("[data-transform-title]");
    const apply = preview?.querySelector("[data-transform-confirm]");
    const cancel = preview?.querySelector("[data-transform-cancel]");
    const inspector = document.getElementById("inspector");
    if (!preview || !title || !apply || !cancel) return { missing: true };
    const rect = element => element.getBoundingClientRect();
    const visible = element => {
      const r = rect(element), i = rect(inspector);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.width > 0 && r.height > 0 && r.top >= i.top - 1 && r.bottom <= i.bottom + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && element.contains(hit);
    };
    return {
      count: document.querySelectorAll(".transform-preview").length,
      titleFocused: document.activeElement === title,
      titleVisible: visible(title), applyVisible: visible(apply), cancelVisible: visible(cancel),
      previewInsideOffer: preview.parentElement.classList.contains("transformation-offer"),
      outerOverflow: getComputedStyle(document.querySelector(".inspector-scroll")).overflowY,
      innerOverflow: getComputedStyle(document.querySelector(".preview-scroll")).overflowY,
      sideWidth: document.getElementById("side").getBoundingClientRect().width,
    };
  });
  assert.ok(!result.missing, `${label}: preview missing`);
  assert.equal(result.count, 1, `${label}: one preview`);
  for (const key of ["titleFocused", "titleVisible", "applyVisible", "cancelVisible", "previewInsideOffer"]) assert.equal(result[key], true, `${label}: ${key}`);
  assert.equal(result.outerOverflow, "hidden", `${label}: outer inspector must not scroll during preview`);
  assert.equal(result.innerOverflow, "auto", `${label}: preview body is the only scrolling content`);
  return result;
}

try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport({ width: 1280, height: 720, dpr: 1 });
  await browser.boot(url);
  await browser.page(() => {
    const engine = PALIMPSITY.engine;
    engine.state.phase = 4; engine.state.res.money = 1000; engine.state.res.materials = 100;
    const building = engine.place("house", 0, 0);
    PALIMPSITY.renderer.sync();
    PALIMPSITY.ui.showInspector(building);
    const original = PALIMPSITY.renderer.renderArchitectureComparison.bind(PALIMPSITY.renderer);
    window.__b1ComparisonCalls = [];
    PALIMPSITY.renderer.renderArchitectureComparison = (...args) => {
      window.__b1ComparisonCalls.push(args.slice(1));
      return original(...args);
    };
  });

  assert.equal(await browser.evaluate("document.querySelectorAll('.transformation-group').length"), 4, "Four groups");
  assert.equal(await browser.evaluate("document.querySelectorAll('.transformation-group.active').length"), 1, "One group open");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.layerGroup"), "levels");
  await browser.page(() => { document.querySelector('[data-layer-group-toggle="use"]').click(); });
  assert.equal(await browser.evaluate("PALIMPSITY.ui.layerGroup"), "use", "Use fixture opens");
  assert.equal(await browser.evaluate("document.querySelectorAll('.transformation-group.active').length"), 1);
  assert.equal(await browser.evaluate("document.querySelector('[data-layer-group=\"use\"] .offer-icon svg') !== null"), true, "Offers have illustrations before preview");
  assert.match(await browser.evaluate("document.querySelector('[data-transform-preview=\"base_residential\"]').closest('article').querySelector('.offer-state').textContent"), /Current/);
  assert.match(await browser.evaluate("document.querySelector('[data-transform-preview=\"base_shop\"]').closest('article').querySelector('.offer-heading').textContent"), /35 € \+ 6 materials/);

  const beforeUse = await stateSnapshot();
  await browser.page(() => { document.querySelector('[data-transform-preview="base_shop"]').click(); });
  await checkVisiblePreview("desktop Use");
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-architecture-comparison]').length"), 0, "Use has no architecture canvases");
  assert.deepEqual(await stateSnapshot(), { ...beforeUse, group: "use", option: "base_shop" }, "Opening Use only changes UI state");
  await mouseClick(".cancel-transform");
  assert.equal(await browser.evaluate("document.querySelectorAll('.transform-preview').length"), 0);
  assert.equal(await browser.evaluate("PALIMPSITY.ui.layerGroup"), "use", "Cancel preserves group");
  assert.deepEqual(await cameraTarget(), beforeUse.camera, "Cancel does not recenter");

  await keyboardActivate('[data-layer-group-toggle="levels"]');
  assert.equal(await browser.evaluate("PALIMPSITY.ui.layerGroup"), "levels", "Keyboard opens Levels");
  await keyboardActivate('[data-transform-preview="add_floor"]');
  await checkVisiblePreview("desktop Levels");
  assert.deepEqual(await stateSnapshot(), { ...beforeUse, group: "levels", option: "add_floor" }, "Architecture comparison does not mutate game or camera");
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-architecture-comparison] canvas').length"), 2, "Levels has before/after canvases");
  assert.equal(await browser.evaluate("document.querySelector('[data-architecture-comparison]').dataset.rendered"), "true", "Renderer drew the comparison");
  assert.equal(await browser.evaluate("document.querySelector('.unchanged-details')?.open ?? false"), false, "Unchanged values are collapsed when present");
  assert.match(await browser.evaluate("document.querySelector('.preview-scroll').textContent"), /Potential income \(€ \/ turn\)/);
  const canvasSizes = await browser.evaluate("[...document.querySelectorAll('[data-architecture-comparison] canvas')].map(canvas => [canvas.width, canvas.height])");
  assert.deepEqual(canvasSizes[0], canvasSizes[1], "Canvases share backing size and framing inputs");
  assert.equal(await browser.evaluate("document.getElementById('side').getBoundingClientRect().width <= 380 && document.getElementById('side').getBoundingClientRect().width <= innerWidth * .35"), true, "Desktop inspector width cap");
  await browser.page(() => {
    const scroll = document.querySelector(".preview-scroll"), comparison = document.querySelector(".architecture-comparison");
    scroll.scrollTop = comparison.offsetTop - scroll.offsetTop - 6;
  });
  await browser.frames(2);
  assert.equal(await browser.evaluate("document.querySelector('.architecture-comparison').getBoundingClientRect().top >= document.querySelector('.preview-scroll').getBoundingClientRect().top"), true, "Desktop capture shows the architecture comparison");
  await browser.screenshot(`${capturePrefix}-desktop`, { width: 1280, height: 720, dpr: 1 });

  await browser.page(() => { document.querySelector(".preview-scroll").scrollTop = 65; });
  const beforeRefresh = await stateSnapshot();
  const scrollBefore = await browser.evaluate("document.querySelector('.preview-scroll').scrollTop");
  const callsBeforeRefresh = await browser.evaluate("__b1ComparisonCalls.length");
  await browser.page(() => { PALIMPSITY.engine.tick(); PALIMPSITY.renderer.sync(); PALIMPSITY.ui.update(); });
  assert.equal(await browser.evaluate("PALIMPSITY.ui.layerGroup"), beforeRefresh.group, "Refresh preserves group");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.transformPreview.id"), beforeRefresh.option, "Refresh preserves offer");
  assert.equal(await browser.evaluate("document.querySelector('.preview-scroll').scrollTop"), scrollBefore, "Refresh preserves preview scroll");
  assert.equal(await browser.evaluate("document.activeElement.hasAttribute('data-transform-title')"), true, "Refresh preserves title focus");
  assert.deepEqual(await cameraTarget(), beforeRefresh.camera, "Simulation refresh does not move camera");
  const callsAfterRefresh = await browser.evaluate("__b1ComparisonCalls.length");
  await browser.frames(10);
  assert.equal(await browser.evaluate("__b1ComparisonCalls.length"), callsAfterRefresh, "No per-card animation loop");
  assert.ok(callsAfterRefresh - callsBeforeRefresh <= 2, "Refresh redraws at most once plus initial observer");
  await keyboardActivate(".cancel-transform");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.layerGroup"), "levels", "Keyboard cancel preserves group");
  assert.deepEqual(await cameraTarget(), beforeRefresh.camera, "Keyboard cancel does not recenter");

  await mouseClick('[data-layer-group-toggle="roof"]');
  await mouseClick('[data-transform-preview="roof_traditional"]');
  await checkVisiblePreview("current roof");
  assert.equal(await browser.evaluate("document.querySelector('[data-transform-confirm=\"roof_traditional\"]').disabled"), true, "Current has no paid confirmation");
  assert.match(await browser.evaluate("document.querySelector('[data-transform-preview=\"roof_traditional\"]').closest('article').querySelector('.offer-state').textContent"), /Current/);
  await mouseClick(".cancel-transform");

  await browser.viewport({ width: 390, height: 844, dpr: 2 });
  await mouseClick('[data-layer-group-toggle="appearance"]');
  await mouseClick('[data-transform-preview="variant_1"]');
  await checkVisiblePreview("mobile Appearance");
  assert.equal(await browser.evaluate("document.querySelector('[data-architecture-comparison]').dataset.rendered"), "true");
  const mobileLayout = await browser.page(() => {
    const side = document.getElementById("side").getBoundingClientRect();
    const palette = document.getElementById("palette").getBoundingClientRect();
    const resources = document.getElementById("hud-res").getBoundingClientRect();
    const targets = [...document.querySelectorAll("#side button:not([hidden]), #side-toggle, #palette button")].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
    return {
      sideHeight: side.height, limit: innerHeight * .6,
      resourcesVisible: resources.height > 0 && resources.top >= 0 && resources.bottom < side.top,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      paletteOverlap: !(side.bottom <= palette.top || side.top >= palette.bottom),
      smallTargets: targets.map(element => ({ html: element.outerHTML.slice(0, 80), rect: element.getBoundingClientRect().toJSON() })).filter(item => item.rect.width < 44 || item.rect.height < 44),
      hint: document.getElementById("palette-hint").textContent,
    };
  });
  assert.ok(mobileLayout.sideHeight <= mobileLayout.limit + 1, `Mobile panel exceeds 60vh: ${JSON.stringify(mobileLayout)}`);
  assert.equal(mobileLayout.resourcesVisible, true, "Resources and the city remain visible above the bottom panel");
  assert.equal(mobileLayout.horizontalOverflow, 0, "No horizontal page scroll");
  assert.equal(mobileLayout.paletteOverlap, false, "Panel and catalogue do not overlap");
  assert.deepEqual(mobileLayout.smallTargets, [], "All visible touch targets are at least 44px");
  assert.match(mobileLayout.hint, /of|buildings/);
  await browser.page(() => {
    const select = document.getElementById("language-select");
    select.value = "fr"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await browser.frames(2);
  assert.equal(await browser.evaluate("document.querySelector('[data-layer-group-toggle=\"appearance\"] span').textContent"), "Apparence");
  assert.equal(await browser.evaluate("document.querySelector('[data-transform-confirm=\"variant_1\"]').textContent"), "Appliquer les modifications");
  assert.match(await browser.evaluate("document.querySelector('.unchanged-details summary').textContent"), /Valeurs inchangées/);
  assert.match(await browser.evaluate("document.getElementById('palette-hint').textContent"), /sur|bâtiments/);
  await browser.screenshot(`${capturePrefix}-mobile`, { width: 390, height: 844, dpr: 2 });
  const mobileBeforeRefresh = await stateSnapshot();
  await browser.page(() => { PALIMPSITY.engine.tick(); PALIMPSITY.renderer.sync(); PALIMPSITY.ui.update(); });
  assert.equal(await browser.evaluate("PALIMPSITY.ui.layerGroup"), mobileBeforeRefresh.group);
  assert.equal(await browser.evaluate("PALIMPSITY.ui.transformPreview.id"), mobileBeforeRefresh.option);
  assert.equal(await browser.evaluate("document.activeElement.hasAttribute('data-transform-title')"), true);
  assert.deepEqual(await cameraTarget(), mobileBeforeRefresh.camera);
  await mouseClick(".cancel-transform");
  assert.deepEqual(await cameraTarget(), mobileBeforeRefresh.camera);

  await browser.page(() => { document.getElementById("river-start").click(); });
  await browser.waitFor("PALIMPSITY.mode === 'river'", "River mode");
  await browser.page(() => {
    const building = PALIMPSITY.engine.place("house", 0, 6);
    PALIMPSITY.renderer.sync(); PALIMPSITY.ui.showInspector(building); PALIMPSITY.ui.update();
  });
  assert.equal(await browser.evaluate("document.getElementById('river-panel').classList.contains('river-compact')"), true, "River is compact during inspection");
  assert.equal(await browser.evaluate("document.getElementById('river-objectives').open"), false, "River full objectives start collapsed");
  await mouseClick("#river-objectives summary");
  assert.equal(await browser.evaluate("document.getElementById('river-objectives').open"), true, "Full River objectives remain accessible");
  assert.ok(await browser.evaluate("document.querySelectorAll('#river-objectives .river-goals li').length > 0"));
  await browser.page(() => { PALIMPSITY.ui.showInspector(null); PALIMPSITY.ui.update(); });
  assert.equal(await browser.evaluate("document.getElementById('river-objectives').open"), true, "River objectives restore after inspection");

  console.log("PASS B1/B3 preview browser: groups, keyboard/mouse, refresh, renderer canvases, River, EN/FR, captures");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
