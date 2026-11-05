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

async function activate(selector, input = "mouse") {
  const point = await browser.page(selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`${selector}: missing`);
    element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!element.contains(hit)) throw new Error(`${selector}: covered at ${x},${y} by ${hit?.outerHTML.slice(0, 180)}`);
    return { x, y };
  }, selector);
  if (input === "touch") {
    const start = browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
    const end = browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await Promise.all([start, end]);
  } else if (input === "keyboard") {
    await browser.page(selector => { document.querySelector(selector).focus(); }, selector);
    const down = browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    const up = browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await Promise.all([down, up]);
  } else {
    const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
    const down = browser.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
    const up = browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
    await Promise.all([down, up]);
  }
  await browser.frames(2);
}

async function assertCombinedLayout(label, mobile, requireRiver = false) {
  const result = await browser.page(() => {
    const side = document.getElementById("side").getBoundingClientRect();
    const inspector = document.getElementById("inspector").getBoundingClientRect();
    const riverPanel = document.getElementById("river-panel");
    const buttons = [...document.querySelectorAll(".preview-actions button")].map(button => {
      const rect = button.getBoundingClientRect(), inset = Math.min(10, rect.width / 4, rect.height / 4);
      const points = [
        [rect.left + inset, rect.top + inset], [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ];
      return {
        text: button.textContent,
        rect: rect.toJSON(),
        covered: points.filter(([x, y]) => !button.contains(document.elementFromPoint(x, y))).map(([x, y]) => ({ x, y, hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 120) })),
        outside: rect.left < inspector.left || rect.right > inspector.right || rect.top < inspector.top || rect.bottom > inspector.bottom || rect.top < 0 || rect.bottom > innerHeight,
      };
    });
    return {
      sideHeight: side.height, viewportHeight: innerHeight,
      riverVisible: getComputedStyle(riverPanel).display !== "none" && riverPanel.getBoundingClientRect().height > 0,
      objectives: !!document.getElementById("river-objectives"),
      outerOverflow: getComputedStyle(document.querySelector(".inspector-scroll")).overflowY,
      innerOverflow: getComputedStyle(document.querySelector(".preview-scroll")).overflowY,
      buttons,
    };
  });
  if (mobile) assert.ok(result.sideHeight <= result.viewportHeight * .6 + 1, `${label}: panel exceeds 60vh (${result.sideHeight})`);
  if (requireRiver) {
    assert.equal(result.riverVisible, true, `${label}: River summary is not visible`);
    assert.equal(result.objectives, true, `${label}: objectives are not accessible`);
  }
  assert.equal(result.outerOverflow, "hidden", `${label}: outer inspector scrolls during preview`);
  assert.equal(result.innerOverflow, "auto", `${label}: preview body is not the only scrollable content`);
  assert.equal(result.buttons.length, 2, `${label}: missing Apply or Cancel`);
  for (const button of result.buttons) {
    assert.equal(button.outside, false, `${label}: ${button.text} is clipped (${JSON.stringify(button.rect)})`);
    assert.deepEqual(button.covered, [], `${label}: ${button.text} is not clickable (${JSON.stringify(button.covered)})`);
  }
}

async function prepareHouse() {
  await browser.page(() => {
    const engine = PALIMPSITY.engine;
    engine.state.phase = 4; engine.state.res.money = 1000; engine.state.res.materials = 100;
    const building = engine.place("house", 0, 6);
    PALIMPSITY.renderer.sync(); PALIMPSITY.ui.showInspector(building); PALIMPSITY.ui.update();
  });
}

try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport({ width: 1280, height: 720, dpr: 1 });
  await browser.boot(url);
  await activate("#river-start");
  await browser.waitFor("PALIMPSITY.mode === 'river'", "River Pact start");
  await prepareHouse();
  await activate('[data-transform-preview="add_floor"]');
  await assertCombinedLayout("River desktop EN", false, true);
  await browser.screenshot("nilo-001-river-desktop", { width: 1280, height: 720, dpr: 1 });

  await browser.viewport({ width: 390, height: 844, dpr: 2 });
  await assertCombinedLayout("River mobile resize EN", true, true);
  await activate("#river-objectives summary", "touch");
  assert.equal(await browser.evaluate("document.getElementById('river-objectives').open"), true, "Touch opens objectives");
  await activate("#river-objectives summary", "touch");
  assert.equal(await browser.evaluate("document.getElementById('river-objectives').open"), false, "Touch collapses objectives");
  await browser.screenshot("nilo-001-river-mobile-en", { width: 390, height: 844, dpr: 2 });
  await browser.page(() => {
    const select = document.getElementById("language-select");
    select.value = "fr"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await browser.frames(2);
  await assertCombinedLayout("River mobile FR", true, true);
  await browser.screenshot("nilo-001-river-mobile-fr", { width: 390, height: 844, dpr: 2 });
  await activate('[data-transform-confirm="add_floor"]', "touch");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.inspectBuilding.architecture.floors"), 2, "Touch Apply adds exactly one floor");
  assert.equal(await browser.evaluate("document.querySelectorAll('.transform-preview').length"), 0, "Apply closes preview");

  await activate('[data-transform-preview="add_floor"]', "keyboard");
  await assertCombinedLayout("River mobile keyboard preview", true, true);
  await activate(".cancel-transform", "keyboard");
  assert.equal(await browser.evaluate("document.querySelectorAll('.transform-preview').length"), 0, "Keyboard Cancel closes preview");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.inspectBuilding.architecture.floors"), 2, "Cancel does not add another floor");

  await activate("#mode-toggle");
  await browser.waitFor("PALIMPSITY.mode === 'classic'", "Classic mode");
  await prepareHouse();
  await activate('[data-transform-preview="add_floor"]');
  await assertCombinedLayout("Classic mobile", true);
  await activate(".cancel-transform");
  await activate("#mode-toggle");
  await browser.waitFor("PALIMPSITY.mode === 'challenge'", "Challenge mode");
  await prepareHouse();
  await activate('[data-transform-preview="add_floor"]');
  await assertCombinedLayout("Challenge mobile", true);
  await activate(".cancel-transform");

  console.log("PASS NILO-001 combined River/classic/challenge preview, resize, touch, mouse and keyboard");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
