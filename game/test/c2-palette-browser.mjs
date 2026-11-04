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

async function assertFooterCommands(label) {
  const results = await browser.page(() => {
    const inspector = document.getElementById("inspector").getBoundingClientRect();
    return [...document.querySelectorAll(".preview-actions button")].map(button => {
      const rect = button.getBoundingClientRect();
      const inset = Math.min(10, rect.width / 4, rect.height / 4);
      const points = [
        [rect.left + inset, rect.top + inset], [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ];
      return {
        text: button.textContent,
        rect: rect.toJSON(),
        uncovered: points.filter(([x, y]) => !button.contains(document.elementFromPoint(x, y))).map(([x, y]) => ({ x, y, hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 220) })),
        outside: rect.left < inspector.left || rect.right > inspector.right || rect.top < inspector.top || rect.bottom > inspector.bottom || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight,
      };
    });
  });
  assert.equal(results.length, 2, `${label}: two footer commands`);
  for (const result of results) {
    assert.equal(result.outside, false, `${label}: ${result.text} is clipped (${JSON.stringify(result.rect)})`);
    assert.deepEqual(result.uncovered, [], `${label}: ${result.text} is covered at a corner or center (${JSON.stringify(result.uncovered)})`);
  }
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
    PALIMPSITY.renderer.sync(); PALIMPSITY.ui.showInspector(building);
    document.querySelector('[data-transform-preview="add_floor"]').click();
  });
  const colors = await browser.page(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    return {
      body: style("body").backgroundColor,
      inspector: style("#inspector").backgroundColor,
      text: style("#inspector").color,
      applyBackground: style("[data-transform-confirm]").backgroundColor,
      applyText: style("[data-transform-confirm]").color,
      preview: style(".transform-preview").backgroundColor,
    };
  });
  assert.equal(colors.body, "rgb(27, 34, 54)");
  assert.equal(colors.inspector, "rgba(37, 46, 70, 0.94)");
  assert.equal(colors.text, "rgb(240, 238, 233)");
  assert.equal(colors.applyBackground, "rgb(114, 205, 210)");
  assert.equal(colors.applyText, "rgb(27, 34, 54)");
  assert.equal(colors.preview, "rgb(43, 54, 82)");
  await assertFooterCommands("1280x720 first preview");
  const familyNormal = await browser.page(() => {
    const button = document.querySelector("[data-family=works]");
    button.focus();
    const style = getComputedStyle(button);
    return {
      labels: [...document.querySelectorAll(".family-choice")].map(choice => choice.textContent),
      background: style.backgroundColor, color: style.color, outline: style.outlineColor,
    };
  });
  assert.deepEqual(familyNormal.labels, ["Banks", "Works", "Gardens"]);
  assert.equal(familyNormal.background, "rgb(53, 64, 90)");
  assert.equal(familyNormal.color, "rgb(240, 238, 233)");
  assert.equal(familyNormal.outline, "rgb(114, 205, 210)");
  const hoverPoint = await browser.evaluate("(() => { const r = document.querySelector('[data-family=works]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverPoint });
  const hover = await browser.evaluate("getComputedStyle(document.querySelector('[data-family=works]:hover')).backgroundColor");
  assert.equal(hover, "rgba(114, 205, 210, 0.18)");
  const selected = await browser.page(() => {
    document.querySelector('[data-family="works"]').click();
    const button = document.querySelector('[data-family="works"]');
    const style = getComputedStyle(button);
    return { background: style.backgroundColor, color: style.color, text: button.textContent, pressed: button.getAttribute("aria-pressed") };
  });
  assert.equal(selected.background, "rgb(114, 205, 210)");
  assert.equal(selected.color, "rgb(27, 34, 54)");
  assert.equal(selected.text, "Works");
  assert.equal(selected.pressed, "true");
  await browser.screenshot("c2-palette-desktop", { width: 1280, height: 720, dpr: 1 });

  await browser.viewport({ width: 390, height: 844, dpr: 2 });
  await browser.page(() => {
    document.querySelector('[data-layer-group-toggle="appearance"]').click();
    document.querySelector('[data-transform-preview="variant_1"]').click();
    const select = document.getElementById("language-select");
    select.value = "fr"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await browser.frames(2);
  assert.equal(await browser.evaluate("document.querySelector('[data-layer-group-toggle=\"appearance\"] span').textContent"), "Apparence");
  assert.equal(await browser.evaluate("document.querySelector('[data-transform-confirm=\"variant_1\"]').textContent"), "Appliquer les modifications");
  assert.equal(await browser.evaluate("document.querySelector('[data-family=\"works\"]').textContent"), "Fabriques");
  assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "No horizontal overflow with C2");
  await assertFooterCommands("390x844 first preview");
  await browser.screenshot("c2-palette-mobile", { width: 390, height: 844, dpr: 2 });
  console.log("PASS C2 palette browser: desktop/mobile captures, computed colors and EN/FR");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
