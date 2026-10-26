/* Real game, file://, no npm browser dependency. Build first; Node 22+ provides WebSocket.
   CHROME_EXE can select Chrome/Chromium. This script never uses a personal profile.
   Progression/halos use real placement and ticks. Only the final allocation stress
   fixture grants money/unlocks; it makes no claim about progression or balance. */
/* Integration contract: window.PALIMPSITY.{engine,renderer}; renderer exposes
   glbTemplates (18 model Groups), meshByBuilding (records with group and ring/halo),
   haloLight on records when present, smokePuffs (userData.rec), tiles, ghost/ghostId,
   lens, camera, controls, renderer, pickTile(), sync(), setGhost(), setHover().
   Existing #palette/.build/.bulldoze, #speed, #lenses, #modal, #toast, #hud-res and
   #end anchors remain; projection buttons use data-projection="ortho|perspective".
   R rotates the brush and the placed mesh visually, with model origins at Y=0. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BUILDINGS, ORDER, INITIAL_UNLOCKED } from "../src/data.js";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const dist = path.join(rootDir, "dist", "palimpsity-mvp.html");
const distURL = pathToFileURL(dist).href;
const shots = path.join(rootDir, ".claude", "shots");
const manifest = JSON.parse(readFileSync(path.join(gameDir, "art/diorama/asset-manifest.json"), "utf8"));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
assert.equal(typeof WebSocket, "function", "Use Node 22+ (built-in WebSocket required; no npm dependency).");
assert.ok(existsSync(dist), "Build the game first: cd game; npm run build");
const chrome = process.env.CHROME_EXE || [
  path.join(process.env.PROGRAMFILES || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env.LOCALAPPDATA || "C:/Users/Default/AppData/Local", "Google/Chrome/Application/chrome.exe"),
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(existsSync);
assert.ok(chrome, "Chrome not found; set CHROME_EXE to the Chrome/Chromium executable.");
mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), "palimpsity-game-cdp-"));
let child, ws, exited = false, launchError, stderr = "", serial = 0, scenario = "launch", interrupted = false;
const pending = new Map(), exceptions = [], requests = [], blocked = [], pageErrors = [];
const abort = () => { interrupted = true; rejectPending(new Error("Browser test interrupted")); };
process.once("SIGINT", abort);
process.once("SIGTERM", abort);

function rejectPending(error) {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
  pending.clear();
}
async function connect() {
  child = spawn(chrome, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--remote-allow-origins=*",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "--window-size=1280,720", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  child.once("error", error => { launchError = error; });
  child.once("exit", () => { exited = true; });
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-6000); });
  let target;
  for (let i = 0; i < 120; i++) {
    if (interrupted) throw new Error("Browser test interrupted");
    if (launchError) throw new Error(`Cannot launch CHROME_EXE=${chrome}: ${launchError.message}`);
    if (exited) throw new Error(`Chrome exited before CDP connected. ${stderr}`);
    try {
      const port = Number(readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) }).then(r => r.json());
      target = targets.find(item => item.type === "page");
      if (target) break;
    } catch {}
    await delay(250);
  }
  assert.ok(target, `Chrome did not expose a page over CDP. ${stderr}`);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP WebSocket connection timed out")), 10000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket connection failed")); }, { once: true });
  });
  ws.addEventListener("close", () => rejectPending(new Error("CDP connection closed")));
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      exceptions.push(details.exception?.description || details.text);
    } else if (message.method === "Network.requestWillBeSent") {
      const url = message.params.request.url;
      requests.push(/^(data|blob):/.test(url) ? url.split(":")[0] + ":" : url);
    } else if (message.method === "Fetch.requestPaused") {
      blocked.push(message.params.request.url);
      void send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "InternetDisconnected" }).catch(error => pageErrors.push(error.message));
    }
  });
}
function send(method, params = {}, timeout = 15000) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`${method}: CDP is closed`));
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: CDP timeout (${scenario})`)); }, timeout);
    pending.set(id, { resolve, reject, timer, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, 60000);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
const page = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map(arg => JSON.stringify(arg)).join(",")})`);
async function waitFor(expression, label, timeout = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (interrupted) throw new Error("Browser test interrupted");
    if (exceptions.length) throw new Error(`${label}: uncaught exception: ${exceptions.join("\n")}`);
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`${scenario}: timeout waiting for ${label}`);
}
async function frames(count = 3) {
  await page(async n => { for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame); }, count);
}
async function screenshot(name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  writeFileSync(path.join(shots, `game-${name}.png`), Buffer.from(result.data, "base64"));
}
async function clickPoint({ x, y }) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await frames();
}
async function click(selector) {
  await clickPoint(await page(selector => {
    const button = document.querySelector(selector);
    if (!button) throw new Error(`${selector}: missing DOM control`);
    button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight || !button.contains(document.elementFromPoint(x, y))) {
      throw new Error(`${selector}: DOM control is clipped or covered`);
    }
    return { x, y };
  }, selector));
}
async function palette(id) {
  await clickPoint(await page(id => {
    const t = window.__gameBrowserTest, e = PALIMPSITY.engine;
    const ids = t.order.filter(id => e.state.unlocked.has(id));
    const buttons = [...document.querySelectorAll("#palette .build:not(.bulldoze)")];
    if (!ids.includes(id)) throw new Error(`Palette: ${id} is locked`);
    const button = buttons.find(b => b.dataset.building === id || b.dataset.build === id || b.dataset.id === id) || buttons[ids.indexOf(id)];
    return t.point(button, `palette ${id}`);
  }, id));
  assert.equal(await evaluate("PALIMPSITY.renderer.ghostId"), id, `Palette click must select the ${id} brush`);
}
async function lens(id) {
  await clickPoint(await page(id => {
    const phase = PALIMPSITY.engine.state.phase;
    const ids = ["none", ...(phase >= 3 ? ["logistics"] : []), ...(phase >= 4 ? ["heat", "maintenance"] : [])];
    const buttons = [...document.querySelectorAll("#lenses button")];
    const button = buttons.find(b => b.dataset.lens === id) || buttons[ids.indexOf(id)];
    return window.__gameBrowserTest.point(button, `lens ${id}`);
  }, id));
  assert.equal(await evaluate("PALIMPSITY.renderer.lens"), id, `${id} UI lens must reach the renderer`);
}
async function key(key, code, virtualKey) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey });
  await frames();
}
async function dismissReports() {
  for (let i = 0; i < 12; i++) {
    await delay(300); // paused UI drains reports on its normal idle refresh
    if (await evaluate('document.querySelector("#modal").classList.contains("on")')) await key("Escape", "Escape", 27);
    else if (await evaluate('!PALIMPSITY.engine.state.reports.some(r => !r._shown)')) return;
  }
  throw new Error("Reports did not drain through Escape; a modal may intercept real canvas input");
}
async function viewport(width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await delay(250); await frames(5);
}
async function boot() {
  await send("Page.navigate", { url: distURL });
  await waitFor('window.PALIMPSITY && PALIMPSITY.renderer.glbTemplates?.size === 18 && document.querySelector("#palette .build")', "18 custom templates and the real game palette");
  await click("#speed button:first-child");
  assert.equal(await evaluate("PALIMPSITY.engine.state.speed"), 0, "Pause must freeze simulation before deterministic interactions");
  await page(order => {
    const t = window.__gameBrowserTest = { order };
    t.point = (button, label) => {
      if (!button) throw new Error(`${label}: missing DOM control`);
      button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (r.width < 24 || r.height < 24 || x < 0 || x >= innerWidth || y < 0 || y >= innerHeight || !button.contains(document.elementFromPoint(x, y))) {
        throw new Error(`${label}: control is clipped, too small or covered: ${JSON.stringify({ x, y, width: r.width, height: r.height, viewport: [innerWidth, innerHeight] })}`);
      }
      return { x, y };
    };
    t.snapshot = () => {
      const e = PALIMPSITY.engine;
      return { money: e.state.res.money, tick: e.state.tick, buildings: e.state.buildings.map(b => [b.def.id, b.c, b.r]) };
    };
    t.tile = (c, r) => {
      const renderer = PALIMPSITY.renderer, e = PALIMPSITY.engine;
      const p = renderer.camera.position.clone().set(c - (e.terrain[0].length - 1) / 2, 0, r - (e.terrain.length - 1) / 2).project(renderer.camera);
      const rect = renderer.renderer.domElement.getBoundingClientRect();
      const x = rect.left + (p.x * .5 + .5) * rect.width, y = rect.top + (-p.y * .5 + .5) * rect.height;
      const hit = renderer.pickTile(x, y);
      if (p.z < -1 || p.z > 1 || x < 12 || x > innerWidth - 12 || y < 12 || y > innerHeight - 12 || document.elementFromPoint(x, y) !== renderer.renderer.domElement || hit?.c !== c || hit?.r !== r) return null;
      return { x, y, c, r };
    };
    t.findTile = river => {
      const e = PALIMPSITY.engine, choices = [];
      for (let r = 0; r < e.terrain.length; r++) for (let c = 0; c < e.terrain[r].length; c++) {
        if ((e.terrain[r][c] === 1) !== river || e.occ[r][c]) continue;
        const point = t.tile(c, r); if (point) choices.push(point);
      }
      choices.sort((a, b) => Math.hypot(a.x - innerWidth / 2, a.y - innerHeight / 2) - Math.hypot(b.x - innerWidth / 2, b.y - innerHeight / 2));
      if (!choices.length) throw new Error(`No unobstructed ${river ? "river" : "land"} tile; check framing and UI overlays`);
      return choices[0];
    };
    t.place = (id, count, zone = [0, 16, 0, 12]) => {
      const e = PALIMPSITY.engine, placed = [];
      const [x0, x1, y0, y1] = zone;
      const cells = [];
      for (let r = y0; r < y1; r++) for (let c = x0; c < x1; c++) if (e.canPlace(id, c, r)) cells.push({ c, r, preferred: id === "farm" && e.terrain[r][c] === 2 });
      cells.sort((a, b) => Number(b.preferred) - Number(a.preferred));
      for (const cell of cells) {
        if (placed.length === count) break;
        const b = e.place(id, cell.c, cell.r);
        if (!b) throw new Error(`Fixture placement ${id}@${cell.c},${cell.r}: ${e.placeBlockReason(id, cell.c, cell.r)}`);
        placed.push(b);
      }
      if (placed.length !== count) throw new Error(`Fixture ${id}: placed ${placed.length}/${count}, money=${e.state.res.money}, phase=${e.state.phase}`);
      return placed;
    };
    t.geometryKey = (positions, indices) => {
      let hash = 2166136261;
      for (const v of positions) hash = Math.imul(hash ^ Math.round(v * 1e6), 16777619);
      for (const v of indices) hash = Math.imul(hash ^ v, 16777619);
      return `${positions.length / 3}:${indices.length}:${hash >>> 0}`;
    };
    t.geometryKeys = object => {
      const keys = [];
      object.traverse(node => {
        const p = node.geometry?.attributes.position;
        if (!node.isMesh || !p) return;
        // Geometry identity may differ for legitimate clones; compare the actual vertices.
        const positions = [];
        for (let i = 0; i < p.count; i++) positions.push(p.getX(i), p.getY(i), p.getZ(i));
        keys.push(t.geometryKey(positions, node.geometry.index?.array || []));
      });
      return keys;
    };
    // Transport records can legitimately replace the base template with a connection
    // variant. Read those embedded GLB vertices without assuming a renderer cache name.
    t.rawKeys = new Map();
    t.glbGeometryKeys = file => {
      if (t.rawKeys.has(file)) return t.rawKeys.get(file);
      const key = file.split(/[\\/]/).pop().replace(/\.glb$/i, "");
      const bytes = Uint8Array.from(atob(window.__PALIMPSITY_ASSETS[key].split(",")[1]), c => c.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      let json, binaryOffset;
      for (let offset = 12; offset < bytes.length;) {
        const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
        if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes.subarray(offset + 8, offset + 8 + length)));
        if (type === 0x004e4942) binaryOffset = offset + 8;
        offset += length + 8;
      }
      if (!json || binaryOffset === undefined) throw new Error(`${file}: invalid embedded GLB chunks`);
      const values = (accessorIndex, components) => {
        const accessor = json.accessors[accessorIndex], buffer = json.bufferViews[accessor.bufferView];
        const readers = { 5121: [1, "getUint8"], 5123: [2, "getUint16"], 5125: [4, "getUint32"], 5126: [4, "getFloat32"] };
        const reader = readers[accessor.componentType];
        if (!reader || accessor.sparse) throw new Error(`${file}: unsupported geometry accessor for browser assertion`);
        const [size, method] = reader, start = binaryOffset + (buffer.byteOffset || 0) + (accessor.byteOffset || 0);
        const stride = buffer.byteStride || size * components, result = [];
        for (let i = 0; i < accessor.count; i++) for (let c = 0; c < components; c++) result.push(view[method](start + i * stride + c * size, true));
        return result;
      };
      const keys = json.meshes.flatMap(mesh => mesh.primitives.map(primitive => t.geometryKey(values(primitive.attributes.POSITION, 3), primitive.indices === undefined ? [] : values(primitive.indices, 1))));
      t.rawKeys.set(file, keys);
      return keys;
    };
    t.custom = b => {
      const r = PALIMPSITY.renderer, rec = r.meshByBuilding.get(b), template = r.glbTemplates.get(b.def.id);
      if (!rec?.group || !template) throw new Error(`Custom mesh missing for ${b.def.id}@${b.c},${b.r}`);
      const actual = t.geometryKeys(rec.group), candidates = [t.geometryKeys(template)];
      const variants = window.__PALIMPSITY_ASSET_MANIFEST.transportVariants?.[b.def.id];
      if (variants) for (const file of Object.values(variants)) candidates.push(t.glbGeometryKeys(file));
      const matches = candidates.some(expected => {
        if (!expected.length) return false;
        const remaining = [...actual];
        return expected.every(key => { const i = remaining.indexOf(key); if (i < 0) return false; remaining.splice(i, 1); return true; });
      });
      if (!matches) throw new Error(`${b.def.id}: placed mesh does not contain its custom GLB/template geometry`);
      return rec;
    };
    t.tiles = () => PALIMPSITY.renderer.tiles.map(tile => {
      const material = Array.isArray(tile.material) ? tile.material[0] : tile.material;
      return [tile.visible, material.visible, material.opacity, material.color?.getHex()];
    });
    t.camera = () => {
      const r = PALIMPSITY.renderer, c = r.camera, distance = c.position.distanceTo(r.controls.target);
      return { perspective: !!c.isPerspectiveCamera, ortho: !!c.isOrthographicCamera, distance,
        height: c.isPerspectiveCamera ? 2 * distance * Math.tan(c.fov * Math.PI / 360) / c.zoom : (c.top - c.bottom) / c.zoom,
        near: r.scene.fog?.near, far: r.scene.fog?.far };
    };
  }, ORDER);
}

try {
  await connect();
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Network.setBypassServiceWorker", { bypass: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "http://*" }, { urlPattern: "https://*" }] });
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__gamePageErrors = [];
    addEventListener('error', e => window.__gamePageErrors.push(e.error?.stack || e.message));
    addEventListener('unhandledrejection', e => window.__gamePageErrors.push(String(e.reason?.stack || e.reason)));
  ` });
  await viewport(1280, 720);
  scenario = "offline boot";
  await boot();
  assert.deepEqual(await evaluate("window.__PALIMPSITY_ASSET_MANIFEST"), manifest, "dist must embed the current custom manifest");
  const embedded = await evaluate("Object.keys(window.__PALIMPSITY_ASSETS).sort()");
  const referenced = new Set();
  (function collect(value) {
    if (typeof value === "string" && /\.glb$/i.test(value)) referenced.add(path.basename(value).replace(/\.glb$/i, ""));
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  })(manifest);
  assert.deepEqual(embedded, [...referenced].sort(), "Embed exactly the recursive manifest GLBs, with no Quaternius/demo terrain");
  assert.ok(!embedded.includes("terrain"), "Demo terrain must not be embedded");
  assert.equal(await evaluate('Object.values(__PALIMPSITY_ASSETS).every(url => url.startsWith("data:model/gltf-binary;base64,"))'), true);
  assert.deepEqual(await evaluate("[...PALIMPSITY.renderer.glbTemplates.keys()].sort()"), [...ORDER].sort(), "All 18 custom model templates must load");
  assert.equal(await evaluate("PALIMPSITY.renderer.camera.isPerspectiveCamera"), true, "Soft perspective must be the default");
  assert.deepEqual(await evaluate("[...PALIMPSITY.engine.state.unlocked]"), INITIAL_UNLOCKED);
  await screenshot("boot-1280");

  scenario = "pointer construction, rotation and invalid placements";
  await palette("house");
  const land = await evaluate("__gameBrowserTest.findTile(false)");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: land.x, y: land.y }); await frames();
  assert.equal(await evaluate("PALIMPSITY.renderer.ghost?.visible"), true, "Pointer hover must show the custom construction ghost");
  const beforeRotation = await evaluate("__gameBrowserTest.snapshot()"), angle = await evaluate("PALIMPSITY.renderer.ghost.rotation.y");
  await key("r", "KeyR", 82);
  const rotatedAngle = await evaluate("PALIMPSITY.renderer.ghost.rotation.y");
  assert.ok(Math.abs(Math.sin((rotatedAngle - angle) / 2)) > .1, "R must visibly rotate the construction ghost");
  assert.deepEqual(await evaluate("__gameBrowserTest.snapshot()"), beforeRotation, "R must change only visual orientation, without cost, tick or occupancy changes");
  await clickPoint(land);
  const built = await page(({ c, r }) => {
    const b = PALIMPSITY.engine.occ[r][c];
    if (!b) throw new Error(`Pointer construction failed at ${c},${r}`);
    const rec = __gameBrowserTest.custom(b);
    return { id: b.def.id, y: rec.group.position.y, angle: rec.group.rotation.y, snapshot: __gameBrowserTest.snapshot() };
  }, land);
  assert.equal(built.id, "house", "The selected real building must occupy the picked tile");
  assert.equal(built.y, 0, "Custom model must sit at Y=0");
  assert.ok(Math.abs(Math.sin((built.angle - rotatedAngle) / 2)) < .001, "Placed custom mesh must retain the R orientation");
  assert.equal(built.snapshot.money, beforeRotation.money - BUILDINGS.house.cost.money, "A real UI placement must deduct the exact engine price once");
  for (const point of [land, await evaluate("__gameBrowserTest.findTile(true)")]) {
    const before = await evaluate("__gameBrowserTest.snapshot()");
    const reason = await page(({ c, r }) => PALIMPSITY.engine.placeBlockReason("house", c, r), point);
    assert.ok(reason, `Invalid placement fixture at ${point.c},${point.r} must be refused by the engine`);
    const count = await evaluate('document.querySelectorAll("#toast .toast-msg").length');
    await clickPoint(point);
    assert.deepEqual(await evaluate("__gameBrowserTest.snapshot()"), before, "River/occupied clicks must preserve money and occupancy");
    await waitFor(`document.querySelectorAll('#toast .toast-msg').length > ${count} && [...document.querySelectorAll('#toast .toast-msg')].some(e => e.textContent === ${JSON.stringify(reason)})`, "a toast explaining the actual engine refusal");
  }
  await screenshot("construction");

  scenario = "camera drag and multipointer do not construct";
  const drag = await evaluate("__gameBrowserTest.findTile(false)"), beforeGestures = await evaluate("__gameBrowserTest.snapshot()");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: drag.x, y: drag.y, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: drag.x + i * 8, y: drag.y + i, buttons: 1, button: "left" });
  for (let i = 9; i >= 0; i--) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: drag.x + i * 8, y: drag.y + i, buttons: 1, button: "left" });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: drag.x, y: drag.y, button: "left", buttons: 0, clickCount: 1 });
  await frames(8);
  assert.deepEqual(await evaluate("__gameBrowserTest.snapshot()"), beforeGestures, "A camera drag returning to its start must never build");
  const touch = await evaluate("__gameBrowserTest.findTile(false)");
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  const first = { x: touch.x, y: touch.y, id: 1 }, second = { x: touch.x + 45, y: touch.y, id: 2 };
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first, second] });
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...first, x: first.x - 12 }, { ...second, x: second.x + 12 }] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [first] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await send("Emulation.setTouchEmulationEnabled", { enabled: false }); await frames(8);
  assert.deepEqual(await evaluate("__gameBrowserTest.snapshot()"), beforeGestures, "A two-pointer gesture and its remaining pointer release must never build");
  await key("Escape", "Escape", 27);
  assert.equal(await evaluate("PALIMPSITY.renderer.ghost"), null, "Escape must clear the construction ghost");
  // Reproject after camera gestures rather than clicking an obsolete screen position.
  await click("#palette .bulldoze");
  const demolitionPoint = await page(({ c, r }) => __gameBrowserTest.tile(c, r), land);
  assert.ok(demolitionPoint, "The constructed house must remain reachable after camera gestures");
  await clickPoint(demolitionPoint);
  assert.equal(await page(({ c, r }) => PALIMPSITY.engine.occ[r][c], land), null, "Demolition must clear real occupancy");
  assert.equal(await evaluate("PALIMPSITY.renderer.meshByBuilding.size"), 0, "Demolition must remove the custom renderer record");
  assert.equal(await evaluate("PALIMPSITY.engine.state.res.money"), built.snapshot.money + BUILDINGS.house.cost.money * .4, "Demolition must apply the engine's 40% refund");
  await key("Escape", "Escape", 27);

  scenario = "real phase 2 progression";
  const phase2 = await page(() => {
    const e = PALIMPSITY.engine, t = __gameBrowserTest;
    t.place("house", 7); t.place("well", 3); t.place("farm", 2); t.place("workshop", 1); t.place("market", 1);
    for (let i = 0; i < 160 && e.state.phase < 2 && !e.state.outcome; i++) e.tick();
    PALIMPSITY.renderer.sync();
    return { phase: e.state.phase, outcome: e.state.outcome, population: e.state.res.population, unlocked: [...e.state.unlocked], count: e.state.buildings.length };
  });
  assert.equal(phase2.outcome, null, `Foundation must remain viable: ${JSON.stringify(phase2)}`);
  assert.equal(phase2.phase, 2, `Real place/tick calls must unlock phase 2: ${JSON.stringify(phase2)}`);
  for (const id of ORDER.filter(id => BUILDINGS[id].phase === 2)) assert.ok(phase2.unlocked.includes(id), `${id} must unlock through real phase 2 progression`);
  await waitFor(`document.querySelectorAll('#palette .build:not(.bulldoze)').length === ${phase2.unlocked.length} && document.querySelectorAll('#hud-res .hidden-res').length === 4`, "phase 2 palette and four revealed systemic resources");
  await dismissReports(); await screenshot("phase2");

  scenario = "industrial palimpseste through real engine calls";
  const industry = await page(() => {
    const e = PALIMPSITY.engine, t = __gameBrowserTest;
    // Earn the construction budget with the existing foundation; no balance edits.
    for (let i = 0; i < 1800 && e.state.res.money < 5200 && !e.state.outcome; i++) e.tick();
    if (e.state.res.money < 5200 || e.state.outcome) throw new Error(`Foundation economy failed: ${JSON.stringify(t.snapshot())}`);
    t.place("generator", 10, [10, 16, 0, 8]); t.place("factory", 8, [10, 16, 0, 8]);
    t.place("warehouse", 6, [10, 16, 0, 8]); t.place("water_plant", 2, [8, 16, 5, 12]);
    t.place("tower", 4, [0, 8, 5, 12]); t.place("farm", 3, [0, 8, 5, 12]);
    for (let i = 0; i < 240 && !e.state.outcome; i++) {
      e.tick();
      if (e.state.phase >= 4 && e.state.buildings.some(b => e.belongsToDominant(b)) && e.peakPop > 60) break;
    }
    PALIMPSITY.renderer.sync();
    return { phase: e.state.phase, outcome: e.state.outcome, dominant: e.dominantRegime(), regime: e.state.regime,
      peak: e.peakPop, events: e.state.events, revalued: e.state.buildings.filter(b => e.belongsToDominant(b)).map(b => b.def.id) };
  });
  assert.equal(industry.outcome, null, `Industrial fixture must remain alive: ${JSON.stringify(industry)}`);
  assert.equal(industry.phase, 4, `Industry must trigger the actual late unlocks: ${JSON.stringify(industry)}`);
  assert.ok(industry.revalued.length, `Industrial regimes must revalue old buildings without overwriting regime weights: ${JSON.stringify(industry)}`);
  await frames(5);
  const halos = await page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer;
    return e.state.buildings.map(b => {
      const rec = r.meshByBuilding.get(b), ring = rec?.ring || rec?.halo;
      if (!ring?.material) throw new Error(`Missing palimpseste ring for ${b.def.id}`);
      return { id: b.def.id, expected: e.belongsToDominant(b), lit: ring.visible && ring.material.opacity > .01, light: rec.haloLight?.intensity };
    });
  });
  assert.ok(halos.some(h => h.expected) && halos.some(h => !h.expected), "Halo fixture must contain revalued old and ordinary/native buildings");
  for (const halo of halos) {
    assert.equal(halo.lit, halo.expected, `${halo.id}: halo must follow engine.belongsToDominant exactly`);
    if (halo.light !== undefined) assert.equal(halo.light > .01, halo.expected, `${halo.id}: halo light must follow the same engine predicate`);
  }
  await dismissReports(); await screenshot("palimpseste");

  scenario = "lenses and reset";
  const baseTiles = await evaluate("__gameBrowserTest.tiles()");
  assert.ok(baseTiles.length, "Lens overlays/picking tiles must be exposed");
  for (const id of ["heat", "logistics", "maintenance"]) {
    await lens(id);
    const tiles = await evaluate("__gameBrowserTest.tiles()");
    assert.notDeepEqual(tiles, baseTiles, `${id} lens must visibly change the actual tile materials`);
    await screenshot(`lens-${id}`);
  }
  await lens("none");
  assert.deepEqual(await evaluate("__gameBrowserTest.tiles()"), baseTiles, "City lens must restore original tile visibility, opacity and colors");

  scenario = "all custom meshes, responsive palette and projection scale";
  await page(order => {
    const e = PALIMPSITY.engine, t = __gameBrowserTest;
    for (const id of order) if (!e.byId(id)) t.place(id, 1);
    PALIMPSITY.renderer.sync();
    for (const id of order) t.custom(e.state.buildings.find(b => b.def.id === id));
  }, ORDER);
  await waitFor("document.querySelectorAll('#palette .build:not(.bulldoze)').length === 18", "all naturally unlocked palette entries");
  let desktopCamera;
  for (const [width, height] of [[1280, 720], [1920, 1080], [320, 720]]) {
    await viewport(width, height);
    for (const id of ORDER) await palette(id); // actually scroll, hit-test and click every button
    await click("#palette .bulldoze");
    await key("Escape", "Escape", 27);
    const bounds = await page(() => {
      const p = document.querySelector("#palette").getBoundingClientRect();
      return { left: p.left, right: p.right, top: p.top, bottom: p.bottom, width: innerWidth, height: innerHeight };
    });
    assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.top >= 0 && bounds.bottom <= height + 1, `${width}px palette must remain inside the viewport: ${JSON.stringify(bounds)}`);
    if (width === 1280) {
      const beforeZoom = await evaluate("__gameBrowserTest.camera()"), point = await evaluate("__gameBrowserTest.findTile(false)");
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: -120 });
      await delay(350); await frames(8);
      const zoomed = await evaluate("__gameBrowserTest.camera()");
      assert.ok(zoomed.height < beforeZoom.height * .995, "Real wheel input must zoom before testing projection scale preservation");
    }
    const perspective = await evaluate("__gameBrowserTest.camera()");
    assert.equal(perspective.perspective, true, `${width}px: perspective remains active after resizing`);
    assert.ok(Number.isFinite(perspective.near) && perspective.far > perspective.distance + 20 && perspective.far > perspective.near, `${width}px: fog must adapt beyond the camera target: ${JSON.stringify(perspective)}`);
    if (width === 1280) desktopCamera = perspective;
    if (width === 320 && perspective.distance > desktopCamera.distance * 1.2) {
      assert.ok(perspective.far > desktopCamera.far, "Narrow perspective camera retreat must expand fog, rather than hide the map");
    }
    await click('[data-projection="ortho"]');
    const ortho = await evaluate("__gameBrowserTest.camera()");
    assert.equal(ortho.ortho, true, "Ortho UI toggle must change the real active camera");
    assert.ok(Math.abs(ortho.height / perspective.height - 1) < .04, `${width}px: ortho toggle must preserve apparent scale: ${JSON.stringify({ perspective, ortho })}`);
    await click('[data-projection="perspective"]');
    const restored = await evaluate("__gameBrowserTest.camera()");
    assert.ok(restored.perspective && Math.abs(restored.height / ortho.height - 1) < .04, `${width}px: round-trip to perspective must preserve scale`);
    await screenshot(`viewport-${width}`);
  }
  await viewport(1280, 720);

  scenario = "disabled smoking hub and exact restoration";
  const hub = await page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer;
    // Isolate eligible smoking hubs through real removals so the engine cascade
    // deterministically selects a generator, even if its scoring changes.
    for (const b of [...e.state.buildings]) if (b.def.tags.includes("centralized") && b.def.id !== "generator") e.removeAt(b.c, b.r);
    e.fireMaintenanceCascade(); r.sync();
    const b = e.state.buildings.find(b => b.disabled && b.def.id === "generator");
    if (!b) throw new Error("Actual maintenance cascade did not disable a generator");
    return { c: b.c, r: b.r };
  });
  const disabled = await page(async ({ c, r }) => {
    const renderer = PALIMPSITY.renderer, b = PALIMPSITY.engine.occ[r][c], rec = renderer.meshByBuilding.get(b), ys = [];
    for (let i = 0; i < 16; i++) { await new Promise(requestAnimationFrame); ys.push(rec.group.position.y); }
    const puffs = renderer.smokePuffs.filter(p => p.userData.rec === rec);
    return { ys, puffCount: puffs.length, smokeOff: puffs.every(p => !p.visible) };
  }, hub);
  assert.ok(Math.max(...disabled.ys) - Math.min(...disabled.ys) > .002, "A disabled hub must visibly vibrate");
  assert.ok(disabled.ys.every(y => Math.abs(y) <= .05), "Disabled custom hub vibration must stay centered on Y=0");
  assert.ok(disabled.puffCount > 0 && disabled.smokeOff, `Disabled smoking hub must hide every puff: ${JSON.stringify(disabled)}`);
  await screenshot("disabled-hub");
  await page(() => { for (let i = 0; i < 7; i++) PALIMPSITY.engine.tick(); PALIMPSITY.renderer.sync(); });
  await frames(5);
  const restoredHub = await page(({ c, r }) => {
    const renderer = PALIMPSITY.renderer, b = PALIMPSITY.engine.occ[r][c], rec = renderer.meshByBuilding.get(b);
    return { disabled: b.disabled, y: rec.group.position.y, smoke: renderer.smokePuffs.filter(p => p.userData.rec === rec).some(p => p.visible) };
  }, hub);
  assert.deepEqual(restoredHub, { disabled: false, y: 0, smoke: true }, "Engine repair must restore smoke and exact custom model height Y=0");

  scenario = "real end screen and restart";
  await dismissReports();
  await lens("heat"); await palette("house"); // restart must clear active tools as well as the ended city
  await page(() => {
    const building = PALIMPSITY.engine.state.buildings[0];
    PALIMPSITY.ui.showInspector(building);
    if (!document.querySelector("#inspector").classList.contains("on")) throw new Error("Inspector fixture failed to open before restart");
  });
  const end = await page(() => {
    const e = PALIMPSITY.engine;
    for (const b of [...e.state.buildings]) if (b.def.outputs.food || b.def.outputs.water) e.removeAt(b.c, b.r);
    for (let i = 0; i < 200 && !e.state.outcome; i++) e.tick();
    PALIMPSITY.renderer.sync();
    window.__gamePreviousEngine = e;
    return { outcome: e.state.outcome, info: e.state.outcomeInfo, peak: e.peakPop, population: e.state.res.population };
  });
  assert.equal(end.outcome, "defeat", `Removing vital supplies must produce a real engine end state: ${JSON.stringify(end)}`);
  await waitFor('document.querySelector("#end.on #end-restart") && !document.querySelector("#modal.on")', "end dialog with reports dismissed");
  await screenshot("end");
  await click("#end-restart"); await frames(5);
  assert.equal(await evaluate("PALIMPSITY.engine !== window.__gamePreviousEngine"), true, "Restart must replace the finished engine");
  await click("#speed button:first-child");
  const restarted = await page(() => ({ count: PALIMPSITY.engine.state.buildings.length, money: PALIMPSITY.engine.state.res.money,
    phase: PALIMPSITY.engine.state.phase, outcome: PALIMPSITY.engine.state.outcome, records: PALIMPSITY.renderer.meshByBuilding.size,
    puffs: PALIMPSITY.renderer.smokePuffs.length, lens: PALIMPSITY.renderer.lens, ghost: PALIMPSITY.renderer.ghost,
    unlocked: [...PALIMPSITY.engine.state.unlocked], end: document.querySelector("#end").classList.contains("on"), modal: document.querySelector("#modal").classList.contains("on"), inspector: document.querySelector("#inspector").classList.contains("on") }));
  assert.deepEqual(restarted, { count: 0, money: 600, phase: 1, outcome: null, records: 0, puffs: 0, lens: "none", ghost: null, unlocked: INITIAL_UNLOCKED, end: false, modal: false, inspector: false }, "Restart must reset economy, tools, records, smoke, lenses, unlocks, dialogs and inspector");
  assert.equal(await evaluate('document.querySelectorAll("#palette .build.on").length'), 0, "Restart must clear palette tool selection");
  assert.equal(await evaluate('document.querySelectorAll("#hud-res .hidden-res").length'), 0, "Restart must hide phase 2 resources again");
  assert.equal(await evaluate('document.querySelector("#inspector").textContent.trim()'), "", "Restart must clear the previous inspector content");
  await screenshot("restart");

  scenario = "60 construction/demolition cycles and bounded GPU memory";
  const allocation = await page(async order => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer, t = __gameBrowserTest;
    e.state.res.money = 1e6; e.unlock(order); // allocation-only fixture, after progression tests
    const cell = t.findTile(false);
    t.memory = () => ({ ...r.renderer.info.memory, programs: r.renderer.info.programs?.length || 0 });
    t.allocationCycle = async id => {
      const b = e.place(id, cell.c, cell.r);
      if (!b) throw new Error(`Allocation fixture ${id}: ${e.placeBlockReason(id, cell.c, cell.r)}`);
      r.sync(); t.custom(b);
      r.setGhost(id); r.setHover({ c: b.c + 1, r: b.r });
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      if (!e.removeAt(b.c, b.r)) throw new Error(`Allocation fixture: cannot demolish ${id}`);
      r.sync(); r.setGhost(null);
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      if (r.meshByBuilding.size || r.smokePuffs.length) throw new Error(`${id}: renderer records/smoke leaked after demolition`);
    };
    for (const id of order) await t.allocationCycle(id); // warm all materials/programs before measuring
    return { baseline: t.memory(), samples: [] };
  }, ORDER);
  // Batches keep each CDP evaluation bounded even on a slow software renderer.
  for (let batch = 0; batch < 6; batch++) {
    allocation.samples.push(await page(async ({ order, batch }) => {
      for (let i = 0; i < 10; i++) await __gameBrowserTest.allocationCycle(order[(batch * 10 + i) % order.length]);
      return __gameBrowserTest.memory();
    }, { order: ORDER, batch }));
  }
  for (const [i, sample] of allocation.samples.entries()) {
    assert.ok(sample.geometries <= allocation.baseline.geometries + 6, `GPU geometry growth after ${(i + 1) * 10} cycles: ${JSON.stringify(allocation)}`);
    assert.ok(sample.textures <= allocation.baseline.textures + 2, `GPU texture growth after ${(i + 1) * 10} cycles: ${JSON.stringify(allocation)}`);
    assert.ok(sample.programs <= allocation.baseline.programs + 2, `GPU program growth after ${(i + 1) * 10} cycles: ${JSON.stringify(allocation)}`);
  }
  assert.equal(await evaluate("PALIMPSITY.engine.state.buildings.length"), 0, "No buildings retained after 60 cycles");
  assert.equal(await evaluate("PALIMPSITY.renderer.meshByBuilding.size"), 0, "No renderer records retained after 60 cycles");
  await screenshot("memory-after-60");
  assert.deepEqual(await evaluate("window.__gamePageErrors"), [], "No window errors or unhandled rejections");
  assert.deepEqual(exceptions, [], "No uncaught browser exceptions throughout all scenarios");
  assert.deepEqual(pageErrors, [], "No CDP interception failures");
  assert.deepEqual(blocked, [], "Offline build must not even attempt external HTTP(S) requests");
  assert.deepEqual(requests.filter(url => url !== distURL && !/^(data|blob):$/.test(url)), [], "Only the single file:// document and embedded data/blob assets may be requested");
  console.log(`Game browser checks passed: offline file://, 18 custom models, UI construction/refusal/refund, R, gestures, real progression/halos, lenses, hub repair, responsive cameras, end/restart and 60 cycles. GPU: ${JSON.stringify(allocation)}. Screenshots: ${shots}`);
} catch (error) {
  if (ws?.readyState === WebSocket.OPEN) {
    try { await screenshot("failure"); } catch {}
    try { console.error("Game diagnostics:", await evaluate("JSON.stringify({phase:window.PALIMPSITY?.engine.state.phase, tick:window.PALIMPSITY?.engine.state.tick, outcome:window.PALIMPSITY?.engine.state.outcome, errors:window.__gamePageErrors})")); } catch {}
  }
  console.error(`Game browser check failed during ${scenario}:`, error);
  process.exitCode = 1;
} finally {
  if (ws?.readyState === WebSocket.OPEN) try { await send("Browser.close", {}, 3000); } catch {}
  for (let i = 0; child && !exited && !launchError && i < 30; i++) await delay(100);
  if (child && !exited && !launchError) { child.kill(); for (let i = 0; !exited && i < 30; i++) await delay(100); }
  ws?.close(); rejectPending(new Error("Browser test finished"));
  process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort);
  // Remove only the mkdtemp directory allocated by this process, after Chrome exits.
  assert.equal(path.dirname(profile), path.resolve(tmpdir()), "Refusing cleanup outside the temporary directory");
  assert.ok(path.basename(profile).startsWith("palimpsity-game-cdp-"), "Refusing unexpected profile cleanup path");
  try { await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
  catch (error) { console.error(`Temporary Chrome profile cleanup failed: ${profile}: ${error.message}`); process.exitCode = 1; }
}
