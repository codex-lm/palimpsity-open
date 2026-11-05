import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LivingLayersBrowser } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const captures = path.join(rootDir, "docs", "living-layers", "captures");
const url = process.env.ARCHITECTURE_PREVIEW_URL || "http://127.0.0.1:5173/index.html";
const viewport = { id: "1280x720-dpr2", width: 1280, height: 720, dpr: 2 };
const browser = new LivingLayersBrowser({ dist: path.join(rootDir, "dist", "palimpsity-mvp.html"), captures, frames: 10 });
const result = { url, checks: [], screenshots: [] };

function saveDataUrl(name, dataUrl) {
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  const file = path.join(captures, `${name}.png`);
  writeFileSync(file, bytes);
  return { name, file, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport(viewport);
  await browser.boot(url);
  await browser.page(() => {
    const e = PALIMPSITY.engine;
    e.state.phase = 4;
    e.state.res.money = 5000;
    e.state.res.materials = 500;
    let house = null;
    const cells = [];
    for (let r = 0; r < e.terrain.length; r++) for (let c = 0; c < e.terrain[0].length; c++) {
      if (e.terrain[r][c] !== 1) cells.push({ c, r, score: Math.hypot(c - 7.5, r - 5.5) });
    }
    cells.sort((a, b) => a.score - b.score);
    for (const cell of cells) if ((house = e.place("house", cell.c, cell.r))) break;
    if (!house) throw new Error("No house site");
    PALIMPSITY.renderer.sync();
    PALIMPSITY.ui.showInspector(house);
    PALIMPSITY.ui.update();
    window.__previewHouse = house;
    window.__previewCitySnapshot = () => JSON.stringify({
      architecture: house.architecture, history: house.history, resources: e.state.res,
      tick: e.state.tick, buildings: e.state.buildings.map(building => [building.def.id, building.c, building.r]),
    });
    window.__previewCityBefore = __previewCitySnapshot();
    window.__previewMainRec = PALIMPSITY.renderer.meshByBuilding.get(house);
    window.__previewCameraBefore = JSON.stringify([
      ...PALIMPSITY.renderer.camera.position.toArray(), ...PALIMPSITY.renderer.controls.target.toArray(),
    ]);
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    window.__previewWebGLRequests = 0;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (this !== PALIMPSITY.renderer.canvas && /^webgl/.test(type)) window.__previewWebGLRequests++;
      return nativeGetContext.call(this, type, ...args);
    };
  });
  await browser.click('[data-transform-preview="add_floor"]');
  await browser.page(() => {
    const fixture = document.createElement("div");
    fixture.id = "architecture-preview-fixture";
    fixture.style.cssText = "position:fixed;z-index:30;left:32px;top:108px;display:flex;gap:14px;padding:14px;background:#fff8ed;border-radius:16px;box-shadow:0 8px 30px #0003;font:14px system-ui";
    for (const [id, label] of [["before", "Before · 1 floor"], ["after", "After · 2 floors"]]) {
      const figure = document.createElement("figure");
      figure.style.margin = "0";
      const canvas = document.createElement("canvas");
      canvas.id = `architecture-preview-${id}`;
      canvas.style.cssText = "width:300px;height:210px;display:block;border-radius:10px";
      const caption = document.createElement("figcaption");
      caption.textContent = label;
      caption.style.cssText = "padding:7px 2px 0;color:#4a3a2a";
      figure.append(canvas, caption);
      fixture.append(figure);
    }
    document.body.append(fixture);
    window.__previewCanvases = [document.getElementById("architecture-preview-before"), document.getElementById("architecture-preview-after")];
  });
  const first = await browser.page(() => {
    const [before, after] = __previewCanvases;
    const ok = PALIMPSITY.renderer.renderArchitectureComparison(__previewHouse, "add_floor", before, after);
    const hash = canvas => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let value = 2166136261;
      for (let i = 0; i < data.length; i += 401) value = Math.imul(value ^ data[i], 16777619) >>> 0;
      return value;
    };
    window.__previewGL = PALIMPSITY.renderer._architecturePreview?.renderer.getContext();
    window.__previewImages = { before: before.toDataURL("image/png"), after: after.toDataURL("image/png") };
    return { ok, before: [before.width, before.height], after: [after.width, after.height], hashes: [hash(before), hash(after)], contexts: __previewWebGLRequests };
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first.before, [600, 420]);
  assert.deepEqual(first.after, [600, 420]);
  assert.notEqual(first.hashes[0], first.hashes[1]);
  assert.equal(first.contexts, 1);
  result.checks.push({ name: "native DPR and distinct pixels", ...first });

  const reused = await browser.page(() => {
    const [before, after] = __previewCanvases;
    const ok = PALIMPSITY.renderer.renderArchitectureComparison(__previewHouse, "family_works", before, after);
    return {
      ok,
      sameGL: __previewGL === PALIMPSITY.renderer._architecturePreview.renderer.getContext(),
      contexts: __previewWebGLRequests,
      cityUnchanged: __previewCityBefore === __previewCitySnapshot(),
      sameRecord: __previewMainRec === PALIMPSITY.renderer.meshByBuilding.get(__previewHouse),
      cameraUnchanged: __previewCameraBefore === JSON.stringify([
        ...PALIMPSITY.renderer.camera.position.toArray(), ...PALIMPSITY.renderer.controls.target.toArray(),
      ]),
      debugContexts: PALIMPSITY.renderer.getDebugInfo().previewContextCount,
    };
  });
  assert.deepEqual(reused, { ok: true, sameGL: true, contexts: 1, cityUnchanged: true, sameRecord: true, cameraUnchanged: true, debugContexts: 1 });
  result.checks.push({ name: "one context and unchanged city", ...reused });

  const resized = await browser.page(() => {
    const [before, after] = __previewCanvases;
    before.style.width = after.style.width = "340px";
    before.style.height = after.style.height = "240px";
    const ok = PALIMPSITY.renderer.renderArchitectureComparison(__previewHouse, "add_floor", before, after);
    window.__previewImages = { before: before.toDataURL("image/png"), after: after.toDataURL("image/png") };
    return {
      ok, before: [before.width, before.height], after: [after.width, after.height],
      sameGL: __previewGL === PALIMPSITY.renderer._architecturePreview.renderer.getContext(), contexts: __previewWebGLRequests,
    };
  });
  assert.deepEqual(resized, { ok: true, before: [680, 480], after: [680, 480], sameGL: true, contexts: 1 });
  result.checks.push({ name: "CSS resize recalculated on demand", ...resized });
  result.screenshots.push(saveDataUrl("architecture-preview-before", await browser.evaluate("__previewImages.before")));
  result.screenshots.push(saveDataUrl("architecture-preview-after", await browser.evaluate("__previewImages.after")));
  result.screenshots.push(await browser.screenshot("architecture-preview-cards", viewport));

  await browser.evaluate("document.getElementById('architecture-preview-fixture').remove(); PALIMPSITY.renderer.focusBuilding(__previewHouse)");
  await browser.frames(10);
  const focusPoint = () => browser.page(() => {
    const r = PALIMPSITY.renderer, point = r.controls.target.clone().project(r.camera);
    const x = (point.x * 0.5 + 0.5) * innerWidth, y = (-point.y * 0.5 + 0.5) * innerHeight;
    return {
      projection: r.projectionMode, viewOffset: !!r.camera.view?.enabled, x, y,
      sideLeft: document.getElementById("side").getBoundingClientRect().left,
      paletteTop: document.getElementById("palette").getBoundingClientRect().top,
      canvasAtTarget: document.elementFromPoint(x, y) === r.canvas,
    };
  });
  const perspective = await focusPoint();
  assert.equal(perspective.projection, "perspective");
  assert.equal(perspective.viewOffset, true);
  assert.equal(perspective.canvasAtTarget, true);
  assert.ok(perspective.x < perspective.sideLeft && perspective.y < perspective.paletteTop);
  result.checks.push({ name: "perspective focus uses visible space", ...perspective });
  await browser.evaluate("PALIMPSITY.renderer.setProjectionMode('ortho')");
  const orthographic = await focusPoint();
  assert.equal(orthographic.projection, "ortho");
  assert.equal(orthographic.viewOffset, true);
  assert.equal(orthographic.canvasAtTarget, true);
  assert.ok(orthographic.x < orthographic.sideLeft && orthographic.y < orthographic.paletteTop);
  result.checks.push({ name: "orthographic focus preserves useful framing", ...orthographic });
  result.screenshots.push(await browser.screenshot("architecture-focus-useful", viewport));

  const disposal = await browser.page(() => {
    const preview = PALIMPSITY.renderer._architecturePreview;
    PALIMPSITY.renderer.dispose();
    return { disposed: preview.disposed, cleared: PALIMPSITY.renderer._architecturePreview === null };
  });
  assert.deepEqual(disposal, { disposed: true, cleared: true });
  result.checks.push({ name: "preview disposed with renderer", ...disposal });
  assert.deepEqual([...browser.exceptions, ...browser.pageErrors], []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
