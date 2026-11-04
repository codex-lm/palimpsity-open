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

async function activate(selector, touch = false) {
  const point = await browser.page(selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`${selector}: missing`);
    element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!element.contains(hit)) throw new Error(`${selector}: covered by ${hit?.outerHTML.slice(0, 180)}`);
    return { x, y };
  }, selector);
  if (touch) {
    const start = browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
    const end = browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await Promise.all([start, end]);
  } else {
    const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
    const down = browser.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
    const up = browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
    await Promise.all([down, up]);
  }
  await browser.frames(2);
}

async function tileFor(id) {
  return browser.page(id => {
    for (let y = 190; y < innerHeight - 230; y += 40) for (let x = 25; x < innerWidth - 20; x += 35) {
      const cell = PALIMPSITY.renderer.pickTile(x, y);
      if (cell && !PALIMPSITY.engine.occ[cell.r]?.[cell.c] && PALIMPSITY.engine.terrain[cell.r][cell.c] !== 1 && document.elementFromPoint(x, y)?.id === "cv") return { x, y, cell };
    }
    return null;
  }, id);
}

async function setLocale(locale) {
  await browser.page(locale => {
    const select = document.getElementById("language-select");
    select.value = locale; select.dispatchEvent(new Event("change", { bubbles: true }));
  }, locale);
  await browser.frames(2);
}

try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport({ width: 1280, height: 720, dpr: 1 });
  await browser.boot(url);
  await browser.page(() => {
    const engine = PALIMPSITY.engine;
    engine.state.phase = 3; engine.state.unlocked.add("commons"); engine.state.res.materials = 7;
    PALIMPSITY.renderer.sync(); PALIMPSITY.ui.renderPalette(); PALIMPSITY.ui.update();
  });
  const poor = await browser.page(() => {
    const button = document.querySelector('[data-id="commons"]');
    return { text: button.querySelector(".bcost").textContent, title: button.title, aria: button.getAttribute("aria-label"), poor: button.classList.contains("poor"), houseCost: document.querySelector('[data-id="house"] .bcost').textContent };
  });
  assert.equal(poor.text, "105 € + 8 materials");
  assert.match(poor.title, /Cost: 105 € \+ 8 materials/);
  assert.match(poor.aria, /Commons, 105 € \+ 8 materials\./);
  assert.equal(poor.poor, true, "Seven materials makes Commons poor without disabling consultation");
  assert.equal(poor.houseCost, "40 €", "Money-only buildings stay compact");
  await activate('[data-id="commons"]');
  const refusedTile = await tileFor("commons");
  assert.ok(refusedTile, "A Commons tile remains inspectable at seven materials");
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: refusedTile.x, y: refusedTile.y, button: "left", buttons: 1, clickCount: 1 });
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: refusedTile.x, y: refusedTile.y, button: "left", buttons: 0, clickCount: 1 });
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.materials"), 7, "Seven materials cannot be debited");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.buildings.length"), 0, "Seven materials cannot place Commons");

  await browser.page(() => { PALIMPSITY.engine.state.res.materials = 8; PALIMPSITY.ui.update(); });
  assert.equal(await browser.evaluate("document.querySelector('[data-id=\"commons\"]').classList.contains('poor')"), false, "Eight materials clears poor on refresh");
  const acceptedTile = await tileFor("commons");
  assert.ok(acceptedTile);
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: acceptedTile.x, y: acceptedTile.y, button: "left", buttons: 1, clickCount: 1 });
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: acceptedTile.x, y: acceptedTile.y, button: "left", buttons: 0, clickCount: 1 });
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.buildings.filter(building => building.def.id === 'commons').length"), 1, "Exactly eight materials places Commons once");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.materials"), 0, "Exactly eight materials is debited once");
  assert.equal(await browser.evaluate("PALIMPSITY.engine.state.res.money"), 495, "Money is debited once");
  await browser.screenshot("nilo-006-commons-desktop", { width: 1280, height: 720, dpr: 1 });
  await setLocale("fr");
  const french = await browser.page(() => {
    const button = document.querySelector('[data-id="commons"]');
    return { text: button.querySelector(".bcost").textContent, title: button.title, aria: button.getAttribute("aria-label") };
  });
  assert.equal(french.text, "105 € + 8 matériaux");
  assert.match(french.title, /Coût : 105 € \+ 8 matériaux/);
  assert.match(french.aria, /Communs, 105 € \+ 8 matériaux\./);

  await setLocale("en");
  await browser.boot(url);
  await browser.page(() => {
    const engine = PALIMPSITY.engine;
    engine.state.phase = 3; engine.state.res.money = 1000; engine.state.res.materials = 100;
    const workshop = engine.place("workshop", 0, 6); workshop.age = 30;
    engine.state.unlocked.add("warehouse");
    const warehouse = engine.place("warehouse", 1, 6); warehouse.age = 20;
    engine.convertBuilding(workshop, "workshop_repair");
    engine.convertBuilding(warehouse, "warehouse_hall");
    PALIMPSITY.renderer.sync(); PALIMPSITY.ui.showInspector(workshop);
  });
  assert.equal(await browser.evaluate("document.querySelector('.conversion-check').textContent"), "✓");
  assert.equal(await browser.evaluate("document.querySelector('.converted-name').textContent"), "Maintenance workshop");
  await setLocale("fr");
  assert.equal(await browser.evaluate("document.querySelector('.converted-name').textContent"), "Atelier de maintenance");
  await browser.page(() => { PALIMPSITY.ui.showInspector(PALIMPSITY.engine.state.buildings.find(building => building.def.id === "warehouse")); });
  assert.equal(await browser.evaluate("document.querySelector('.converted-name').textContent"), "Maison de quartier");
  await setLocale("en");
  assert.equal(await browser.evaluate("document.querySelector('.converted-name').textContent"), "Neighborhood hall");

  await browser.viewport({ width: 390, height: 844, dpr: 2 });
  await browser.boot(url);
  const familyTargets = await browser.page(() => [...document.querySelectorAll(".family-choice")].map(button => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { family: button.dataset.family, display: getComputedStyle(button).display, rect: rect.toJSON(), hit: button.contains(hit), hitHtml: hit?.outerHTML.slice(0, 120) };
  }));
  for (const target of familyTargets) {
    assert.notEqual(target.display, "none", "Family is visible at 390px");
    assert.ok(target.rect.width >= 44 && target.rect.height >= 44, `Family target too small: ${JSON.stringify(target)}`);
    assert.equal(target.hit, true, `Family target is clickable at 390px: ${JSON.stringify(target)}`);
  }
  await activate('[data-family="works"]', true);
  await activate('[data-id="house"]', true);
  let tile = await tileFor("house");
  assert.ok(tile, "A house tile is available after choosing Works");
  await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tile.x, y: tile.y }] });
  await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  let family = await browser.evaluate("PALIMPSITY.engine.state.buildings.at(-1).architecture.family");
  assert.equal(family, "works", "Touch construction uses the selected family");
  assert.match(await browser.evaluate("PALIMPSITY.renderer.meshByBuilding.get(PALIMPSITY.engine.state.buildings.at(-1)).layerSignature"), /works/);
  await browser.key("Escape", "Escape", 27);
  await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tile.x, y: tile.y }] });
  await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.match(await browser.evaluate("document.querySelector('.architecture-summary').textContent"), /Works/);
  await browser.key("Escape", "Escape", 27);

  await activate('[data-family="gardens"]', true);
  await activate('[data-id="house"]', true);
  tile = await tileFor("house");
  assert.ok(tile, "A second house tile is available after choosing Gardens");
  await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tile.x, y: tile.y }] });
  await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  family = await browser.evaluate("PALIMPSITY.engine.state.buildings.at(-1).architecture.family");
  assert.equal(family, "gardens", "The next construction preserves the new family");
  assert.equal(await browser.evaluate("PALIMPSITY.ui.buildFamily"), "gardens", "Palette refresh preserves family state");
  assert.match(await browser.evaluate("PALIMPSITY.renderer.meshByBuilding.get(PALIMPSITY.engine.state.buildings.at(-1)).layerSignature"), /gardens/);
  await browser.key("Escape", "Escape", 27);
  await browser.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tile.x, y: tile.y }] });
  await browser.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.match(await browser.evaluate("document.querySelector('.architecture-summary').textContent"), /Gardens/);
  assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "No horizontal page scroll at 390px");
  await browser.screenshot("nilo-010-mobile-family", { width: 390, height: 844, dpr: 2 });

  console.log("PASS NILO-006/007/010 Commons costs, conversion banners and real mobile family construction");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
