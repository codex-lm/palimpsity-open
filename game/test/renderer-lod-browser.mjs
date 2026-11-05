import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LivingLayersBrowser } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const captures = path.join(rootDir, "docs", "living-layers", "captures");
const url = process.env.RENDERER_LOD_URL || "http://127.0.0.1:5173/index.html";
const viewport = { id: "1280x720-dpr2", width: 1280, height: 720, dpr: 2 };
const browser = new LivingLayersBrowser({ dist: path.join(rootDir, "dist", "palimpsity-mvp.html"), captures, frames: 10 });
const result = { checks: [], screenshots: [] };

async function state(label) {
  const sample = await browser.page(() => {
    const r = PALIMPSITY.renderer, distance = r.camera.position.distanceTo(r.controls.target);
    return {
      projection: r.projectionMode, scale: r.cameraScale, zoom: r.camera.zoom, distance,
      projectedDistance: distance / r.camera.zoom, lod: r.getDebugInfo().environmentLod,
      dpr: r.renderer.getPixelRatio(), buffer: [r.renderer.getContext().drawingBufferWidth, r.renderer.getContext().drawingBufferHeight],
    };
  });
  result.checks.push({ label, ...sample });
  return sample;
}

async function wheel(deltaY) {
  await browser.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 520, y: 360, deltaX: 0, deltaY });
  await browser.frames(2);
}

try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport(viewport);
  await browser.boot(url);
  await browser.page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer;
    e.state.phase = 4;
    e.state.res.money = 5000;
    e.state.res.materials = 500;
    let house = null;
    for (let r = 0; r < e.terrain.length && !house; r++) for (let c = 0; c < e.terrain[0].length; c++) {
      if (e.terrain[r][c] !== 1 && (house = e.place("house", c, r))) break;
    }
    if (!house) throw new Error("No house site");
    window.__lodHouse = house;
    r.setQuality("high");
    r.controls.zoomSpeed = 2;
    r.setProjectionMode("ortho");
    r.homeCamera(true);
    r.sync();
    PALIMPSITY.ui.showInspector(null);
  });
  const orthoValley = await state("ortho valley");
  assert.equal(orthoValley.lod, "valley");
  result.screenshots.push(await browser.screenshot("nilo-011-ortho-valley", viewport));
  for (let i = 0; i < 40 && (await browser.evaluate("PALIMPSITY.renderer.camera.zoom < 2.95")); i++) await wheel(-120);
  const orthoZoom = await state("ortho zoom 3");
  console.log("Orthographic zoom", orthoZoom);
  assert.ok(orthoZoom.zoom >= 2.95);
  assert.ok(Math.abs(orthoZoom.distance - orthoValley.distance) < 0.001);
  assert.equal(orthoZoom.lod, "full");
  result.screenshots.push(await browser.screenshot("nilo-011-ortho-zoom", viewport));
  for (let i = 0; i < 40 && (await browser.evaluate("PALIMPSITY.renderer.camera.zoom > 1.01")); i++) await wheel(120);
  const orthoBack = await state("ortho zoom back");
  assert.equal(orthoBack.lod, "valley");
  for (let i = 0; i < 40 && (await browser.evaluate("PALIMPSITY.renderer.camera.zoom < 2.95")); i++) await wheel(-120);
  await browser.evaluate("PALIMPSITY.renderer.setProjectionMode('perspective')");
  await browser.frames(3);
  const perspective = await state("perspective equivalent");
  assert.equal(perspective.lod, "full");
  result.screenshots.push(await browser.screenshot("nilo-011-perspective-equivalent", viewport));
  for (let i = 0; i < 40 && (await browser.evaluate("PALIMPSITY.renderer.camera.position.distanceTo(PALIMPSITY.renderer.controls.target) < 27")); i++) await wheel(120);
  const perspectiveBack = await state("perspective zoom back");
  assert.equal(perspectiveBack.lod, "valley");
  await browser.evaluate("PALIMPSITY.renderer.homeCamera(true)");
  const home = await state("home");
  assert.equal(home.lod, "valley");
  await browser.evaluate("PALIMPSITY.renderer.focusBuilding(__lodHouse)");
  await browser.frames(10);
  const focus = await state("focus");
  assert.equal(focus.lod, "full");
  assert.ok(focus.dpr === 2 && focus.buffer[0] === 2560 && focus.buffer[1] === 1440);
  await browser.evaluate("PALIMPSITY.renderer.homeCamera(true)");
  for (let i = 0; i < 40 && (await browser.evaluate("PALIMPSITY.renderer.camera.position.distanceTo(PALIMPSITY.renderer.controls.target) > 15")); i++) await wheel(-120);
  const perspectiveClose = await state("perspective close before ortho");
  assert.equal(perspectiveClose.lod, "full");
  await browser.evaluate("PALIMPSITY.renderer.setProjectionMode('ortho')");
  await browser.frames(3);
  const orthoFromClose = await state("ortho from close perspective");
  assert.equal(orthoFromClose.lod, "full");
  result.screenshots.push(await browser.screenshot("nilo-011-perspective-close-to-ortho", viewport));
  for (let i = 0; i < 40 && (await browser.evaluate("PALIMPSITY.renderer.camera.zoom > 1.01")); i++) await wheel(120);
  const orthoDezoom = await state("ortho dezoom");
  assert.equal(orthoDezoom.lod, "valley");
  result.screenshots.push(await browser.screenshot("nilo-011-ortho-dezoom", viewport));
  await browser.evaluate("PALIMPSITY.renderer.homeCamera(true)");
  assert.equal((await state("final home")).lod, "valley");
  assert.deepEqual([...browser.exceptions, ...browser.pageErrors], []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
