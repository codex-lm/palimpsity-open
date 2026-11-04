import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LivingLayersBrowser } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const captures = path.join(rootDir, "docs", "living-layers", "captures");
const url = process.env.RENDERER_VISUAL_URL || "http://127.0.0.1:5173/index.html";
const viewport = { id: "1280x720", width: 1280, height: 720, dpr: 1 };
const browser = new LivingLayersBrowser({ dist: path.join(rootDir, "dist", "palimpsity-mvp.html"), captures, frames: 10 });
const result = { url, checks: [], screenshots: [] };

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
    e.state.unlocked.add("commons");
    const candidates = [];
    for (let row = 1; row < e.terrain.length - 1; row++) for (let c = 1; c < e.terrain[0].length - 1; c++) {
      if (e.terrain[row][c] !== 1 && e.terrain[row][c + 1] !== 1) candidates.push({ c, r: row, score: Math.hypot(c - 7.5, row - 5.5) });
    }
    candidates.sort((a, b) => a.score - b.score);
    let commons = null;
    for (const cell of candidates) if ((commons = e.place("commons", cell.c, cell.r))) break;
    const house = commons && e.place("house", commons.c + 1, commons.r);
    if (!commons || !house) throw new Error("Could not place commons and house");
    r.homeCamera(true);
    r.sync();
    PALIMPSITY.ui.showInspector(null);
    PALIMPSITY.ui.update();
    window.__rendererVisual = { commons, house };
  });
  const commons = await browser.page(() => {
    const r = PALIMPSITY.renderer, b = __rendererVisual.commons, rec = r.meshByBuilding.get(b);
    r.setGhost("commons");
    const ghostModel = r.ghost?.children[0]?.children[0];
    const ghostParts = ghostModel?.children.length;
    r.setGhost(null);
    r.focusBuilding(b);
    return { parts: rec.model.children.length, roof: !!rec.roof, height: rec.height, ghostParts };
  });
  assert.deepEqual(commons, { parts: 1, roof: false, height: 1.08, ghostParts: 1 });
  result.checks.push({ name: "commons placed and ghost are standalone", ...commons });
  await browser.frames(10);
  result.screenshots.push(await browser.screenshot("renderer-commons-standalone", viewport));

  await browser.page(() => {
    const r = PALIMPSITY.renderer, house = __rendererVisual.house;
    r.toggleRoof(false);
    r.focusBuilding(house);
  });
  await browser.frames(10);
  const hidden = await browser.page(() => {
    const rec = PALIMPSITY.renderer.meshByBuilding.get(__rendererVisual.house);
    return { visible: rec.roof.visible, roofMeshes: rec.roof.children.length };
  });
  assert.equal(hidden.visible, false);
  result.checks.push({ name: "house roof hidden", ...hidden });
  result.screenshots.push(await browser.screenshot("renderer-roof-hidden", viewport));
  assert.deepEqual([...browser.exceptions, ...browser.pageErrors], []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
