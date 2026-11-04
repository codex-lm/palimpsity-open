import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LivingLayersBrowser } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const captures = await mkdtemp(path.join(tmpdir(), "palimpsity-a1-captures-"));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".glb": "model/gltf-binary", ".png": "image/png", ".css": "text/css; charset=utf-8" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(gameDir, pathname === "/" ? "index.html" : pathname.slice(1));
    if (file !== gameDir && !file.startsWith(gameDir + path.sep)) throw new Error("Outside game directory");
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    response.end(bytes);
  } catch {
    response.writeHead(404); response.end("Not found");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/index.html`;
const browser = new LivingLayersBrowser({ dist: path.join(rootDir, "dist", "palimpsity-mvp.html"), captures, frames: 20 });

async function snapshot() {
  return browser.page(() => {
    const building = PALIMPSITY.ui.inspectBuilding;
    return {
      money: PALIMPSITY.engine.state.res.money,
      materials: PALIMPSITY.engine.state.res.materials,
      architecture: building?.architecture ? { ...building.architecture } : null,
      selected: building ? [building.c, building.r] : null,
      camera: PALIMPSITY.renderer.controls.target.toArray(),
    };
  });
}

async function previewLayout() {
  return browser.page(() => {
    const preview = document.querySelector(".transform-preview");
    if (!preview) return { missing: true };
    const offer = preview.closest(".transformation-offer");
    const title = preview.querySelector("[data-transform-title]");
    const body = preview.querySelector(".preview-scroll");
    const firstRow = body.querySelector(".profile-diff tbody tr");
    const apply = preview.querySelector("[data-transform-confirm]");
    const cancel = preview.querySelector("[data-transform-cancel]");
    const inspector = document.getElementById("inspector");
    const cost = preview.querySelector(".conversion-cost");
    const condition = preview.querySelector(".conversion-condition");
    const rect = element => element.getBoundingClientRect();
    const visible = (element, container) => {
      const r = rect(element), c = rect(container);
      return r.width > 0 && r.height > 0 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.top >= 0 && r.bottom <= innerHeight + 1;
    };
    const bodyRect = rect(body), inspectorRect = rect(inspector), titleRect = rect(title), rowRect = rect(firstRow);
    return {
      count: document.querySelectorAll(".transform-preview").length,
      inline: preview.parentElement === offer,
      titleFocused: document.activeElement === title,
      titleVisible: titleRect.top >= inspectorRect.top - 1 && titleRect.bottom <= inspectorRect.bottom + 1 && titleRect.top >= 0,
      comparisonVisible: rowRect.top >= bodyRect.top - 1 && rowRect.top < bodyRect.bottom && rowRect.bottom > bodyRect.top,
      costVisible: visible(cost, body),
      conditionVisible: visible(condition, body),
      applyVisible: visible(apply, preview),
      cancelVisible: visible(cancel, preview),
      footerTop: rect(preview.querySelector(".preview-actions")).top,
    };
  });
}

function assertLayout(layout, label, scrolled = false) {
  assert.ok(!layout.missing, `${label}: preview missing`);
  const keys = ["inline", "titleFocused", "titleVisible", "applyVisible", "cancelVisible"];
  if (!scrolled) keys.push("comparisonVisible", "costVisible", "conditionVisible");
  for (const key of keys) assert.equal(layout[key], true, `${label}: ${key} failed (${JSON.stringify(layout)})`);
  assert.equal(layout.count, 1, `${label}: only one offer may be expanded`);
}

async function cancelAndCheck(before, label) {
  await browser.click(".cancel-transform");
  assert.equal(await browser.evaluate("document.querySelectorAll('.transform-preview').length"), 0, `${label}: preview closes`);
  assert.equal(await browser.evaluate("document.activeElement?.dataset?.transformPreview"), "base_shop", `${label}: focus returns to the offer`);
  assert.deepEqual(await snapshot(), before, `${label}: cancellation is mutation-free`);
}

try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport({ width: 1280, height: 720, dpr: 1 });
  await browser.boot(url);
  await browser.page(() => {
    const engine = PALIMPSITY.engine;
    engine.state.phase = 4;
    engine.state.res.money = 1000;
    engine.state.res.materials = 100;
    const building = engine.place("house", 0, 0);
    PALIMPSITY.renderer.sync();
    PALIMPSITY.ui.showInspector(building);
  });

  const desktopBefore = await snapshot();
  await browser.page(() => { document.querySelector('[data-layer-group-toggle="use"]').click(); });
  await browser.page(() => { document.querySelector('[data-transform-preview="base_shop"]').click(); });
  assertLayout(await previewLayout(), "1280x720 initial preview");
  const desktopFooter = await browser.evaluate("document.querySelector('.preview-actions').getBoundingClientRect().top");
  await browser.page(() => { document.querySelector(".preview-scroll").scrollTop = document.querySelector(".preview-scroll").scrollHeight; });
  await browser.frames(2);
  assert.equal(await browser.evaluate("document.querySelector('.preview-actions').getBoundingClientRect().top"), desktopFooter, "1280x720: footer remains fixed during internal scroll");
  assertLayout(await previewLayout(), "1280x720 scrolled preview", true);
  assert.deepEqual(await snapshot(), desktopBefore, "1280x720: opening and scrolling do not mutate game or camera");
  await cancelAndCheck(desktopBefore, "1280x720");

  await browser.page(() => { document.querySelector('[data-layer-group-toggle="use"]').click(); });
  await browser.page(() => { document.querySelector('[data-transform-preview="base_shop"]').click(); });
  await browser.page(() => { document.querySelector('[data-transform-preview="add_floor"]').click(); });
  assert.equal(await browser.evaluate("document.querySelectorAll('.transform-preview').length"), 1, "Opening another offer replaces the expanded preview");
  assert.equal(await browser.evaluate("document.activeElement?.dataset?.transformPreview"), undefined, "The new title, not the old offer, owns focus");
  assert.equal(await browser.evaluate("document.activeElement?.hasAttribute('data-transform-title')"), true);
  await browser.click(".cancel-transform");

  await browser.viewport({ width: 390, height: 844, dpr: 2 });
  const mobileBefore = await snapshot();
  await browser.page(() => { document.querySelector('[data-layer-group-toggle="use"]').click(); });
  await browser.page(() => { document.querySelector('[data-transform-preview="base_shop"]').click(); });
  assertLayout(await previewLayout(), "390x844 initial preview");
  const mobileFooter = await browser.evaluate("document.querySelector('.preview-actions').getBoundingClientRect().top");
  await browser.page(() => { document.querySelector(".preview-scroll").scrollTop = document.querySelector(".preview-scroll").scrollHeight; });
  await browser.frames(2);
  assert.equal(await browser.evaluate("document.querySelector('.preview-actions').getBoundingClientRect().top"), mobileFooter, "390x844: footer remains fixed during internal scroll");
  assertLayout(await previewLayout(), "390x844 scrolled preview", true);
  const mobileScroll = await browser.evaluate("document.querySelector('.preview-scroll').scrollTop");
  await browser.page(() => { PALIMPSITY.engine.state.tick++; PALIMPSITY.ui.update(); });
  assert.equal(await browser.evaluate("document.querySelector('.preview-scroll').scrollTop"), mobileScroll, "A refresh preserves internal scroll position");
  assert.equal(await browser.evaluate("document.activeElement?.hasAttribute('data-transform-title')"), true, "A refresh preserves title focus");
  assert.deepEqual(await snapshot(), mobileBefore, "390x844: opening and scrolling do not mutate game or camera");

  await browser.page(() => {
    PALIMPSITY.engine.state.res.money = 0;
    document.querySelector('[data-transform-confirm="base_shop"]').click();
  });
  assert.equal(await browser.evaluate("document.activeElement?.classList.contains('transform-feedback') && document.activeElement.classList.contains('error')"), true, "A refusal is visible and focused");
  assert.equal(await browser.evaluate("document.querySelector('.transform-feedback.error').textContent"), "Not enough money.");
  assert.equal(await browser.evaluate("document.querySelectorAll('.transform-preview').length"), 1, "A refused preview stays open");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.money"), 0, "A refusal spends nothing");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.inspectBuilding.architecture.base"), "residential", "A refusal does not transform");

  await browser.page(() => {
    PALIMPSITY.engine.state.res.money = 1000;
    PALIMPSITY.engine.state.res.materials = 100;
    PALIMPSITY.ui.update();
    const select = document.getElementById("language-select");
    select.value = "fr";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await browser.frames(2);
  await browser.page(() => { window.__a1StaleApply = document.querySelector('[data-transform-confirm="base_shop"]'); });
  await browser.click('[data-transform-confirm="base_shop"]');
  assert.equal(await browser.evaluate("document.querySelectorAll('.transform-preview').length"), 0, "Success closes the preview");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.inspectBuilding.architecture.base"), "shop");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.money"), 965, "Success charges exactly once");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.materials"), 94, "Materials are charged exactly once");
  const success = await browser.evaluate("document.querySelector('[data-transform-success]').textContent");
  assert.match(success, /Modifications appliquées/);
  assert.match(success, /35 € \+ 6 matériaux/);
  assert.equal(await browser.evaluate("document.activeElement?.hasAttribute('data-transform-success')"), true, "Success receives focus");
  await browser.page(() => { window.__a1StaleApply.click(); });
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.money"), 965, "A detached Apply cannot repeat the operation");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.materials"), 94, "A detached Apply cannot repeat material spending");

  console.log("PASS A1 preview browser: 1280x720 and 390x844 visibility, focus, cancellation, refusal and localized single apply");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(captures, { recursive: true, force: true });
}
