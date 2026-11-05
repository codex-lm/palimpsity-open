import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LivingLayersBrowser, machineInfo } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const docsDir = path.join(rootDir, "docs", "living-layers");
const capturesDir = path.join(docsDir, "captures");
const url = process.env.FIRST_HOUSE_URL || "http://127.0.0.1:5173/index.html";
const viewport = { id: "1920x1080-dpr2-physical-4k", width: 1920, height: 1080, dpr: 2 };
const browser = new LivingLayersBrowser({ dist: path.join(rootDir, "dist", "palimpsity-mvp.html"), captures: capturesDir, frames: 30 });
mkdirSync(capturesDir, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  url,
  viewport,
  machine: machineInfo(),
  conditions: {
    browserMode: "isolated temporary Chrome profile, new headless mode, CDP device emulation",
    renderer: "SwiftShader requested with --use-angle=swiftshader; not a hardware-GPU benchmark",
    simulation: "paused; phase and resources prepared, all floor changes executed with engine.transformBuilding",
  },
  checks: [],
  transformations: [],
  modules: [],
  selections: [],
  measurements: [],
  screenshots: [],
  errors: [],
};

function check(name, detail = true) {
  report.checks.push({ name, detail });
  console.log(`PASS ${name}`);
}

async function prepareCity() {
  return browser.page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer;
    e.state.phase = 4;
    e.state.res.money = 5000;
    e.state.res.materials = 500;
    const offsets = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, 1]];
    const candidates = [];
    for (let row = 1; row < e.terrain.length - 1; row++) for (let c = 1; c < e.terrain[0].length - 1; c++) {
      if (offsets.every(([dc, dr]) => e.terrain[row + dr][c + dc] !== 1)) {
        candidates.push({ c, r: row, score: Math.hypot(c - 7.5, row - 5.5) });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    let house = null;
    for (const cell of candidates) {
      house = e.place("house", cell.c, cell.r);
      if (house) break;
    }
    if (!house) throw new Error("No central buildable site for the first house");
    const references = [
      e.place("well", house.c - 1, house.r),
      e.place("farm", house.c + 1, house.r),
      e.place("park", house.c, house.r - 1),
      e.place("market", house.c - 1, house.r + 1),
    ];
    if (references.some(building => !building)) throw new Error("A legacy reference could not be placed");
    r.setQuality("high");
    r.setReducedEffects(false);
    r.setPhotoMode(false);
    r.toggleRoof(true);
    r.homeCamera(true);
    r.sync();
    PALIMPSITY.ui.showInspector(null);
    PALIMPSITY.ui.update();
    window.__firstHouse = { house, references };
    return {
      house: { c: house.c, r: house.r, architecture: { ...house.architecture } },
      references: references.map(building => ({ id: building.def.id, c: building.c, r: building.r })),
    };
  });
}

async function transformToFour() {
  for (let floor = 2; floor <= 4; floor++) {
    const action = await browser.page(() => {
      const e = PALIMPSITY.engine, b = __firstHouse.house;
      const offer = e.transformationOptions(b).find(option => option.id === "add_floor");
      const reason = e.transformationBlockReason(b, "add_floor");
      if (!offer || reason) throw new Error(`add_floor blocked: ${reason || "offer missing"}`);
      const money = e.state.res.money, materials = e.state.res.materials;
      if (!e.transformBuilding(b, "add_floor")) throw new Error("transformBuilding returned false");
      if (e.state.res.money !== money - offer.cost.money || e.state.res.materials !== materials - offer.cost.materials) {
        throw new Error("Transformation cost mismatch");
      }
      PALIMPSITY.renderer.sync();
      PALIMPSITY.ui.update();
      return { floors: b.architecture.floors, cost: offer.cost, history: b.history.at(-1) };
    });
    assert.equal(action.floors, floor);
    report.transformations.push(action);
  }
  check("Three real transformBuilding calls reach four floors", report.transformations);
}

async function moduleBounds() {
  const result = await browser.page(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const b = __firstHouse.house, r = PALIMPSITY.renderer, rec = r.meshByBuilding.get(b);
    r.scene.updateMatrixWorld(true);
    const modules = rec.model.children.map((module, index) => {
      const box = new THREE.Box3().setFromObject(module);
      const origin = module.getWorldPosition(new THREE.Vector3());
      let meshes = 0;
      module.traverse(object => { if (object.isMesh) meshes++; });
      return {
        index,
        positionY: module.position.y,
        localBaseY: box.min.y - origin.y,
        localTopY: box.max.y - origin.y,
        meshes,
        worldBox: { min: box.min.toArray(), max: box.max.toArray() },
      };
    });
    return {
      architecture: { ...b.architecture },
      floorHeight: r.manifest.layers.floorHeight,
      signature: rec.layerSignature,
      moduleCount: modules.length,
      modules,
      roofCount: rec.roof ? 1 : 0,
      legacyReferences: __firstHouse.references.map(building => ({ id: building.def.id, modular: !!r.meshByBuilding.get(building)?.layerSignature })),
    };
  });
  assert.equal(result.architecture.family, "banks");
  assert.equal(result.architecture.variant, 0);
  assert.equal(result.architecture.floors, 4);
  assert.equal(result.floorHeight, 0.48);
  assert.equal(result.moduleCount, 5);
  assert.equal(result.roofCount, 1);
  assert.equal(result.signature, "base_house_banks_0|4|floor_banks_0|roof_traditional_banks_0|true");
  result.modules.forEach((module, index) => {
    assert.ok(Math.abs(module.positionY - index * 0.48) < 1e-6, `Module ${index} Y position`);
    assert.ok(Math.abs(module.localBaseY) < 0.002, `Module ${index} local base`);
    if (index < 4) assert.ok(Math.abs(module.localTopY - 0.48) < 0.002, `Module ${index} local top`);
    assert.ok(module.meshes > 0, `Module ${index} meshes`);
  });
  assert.ok(result.legacyReferences.every(reference => !reference.modular));
  report.modules = result.modules;
  report.structure = result;
  check("Banks variant 0 has four 0.48 levels and one roof at Y=1.92", result.modules.map(module => ({ index: module.index, y: module.positionY, base: module.localBaseY, top: module.localTopY })));
  check("No intermediate roof and legacy references remain legacy", { moduleCount: result.moduleCount, references: result.legacyReferences });
}

async function selectionPoints() {
  return browser.page(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const b = __firstHouse.house, r = PALIMPSITY.renderer, rec = r.meshByBuilding.get(b);
    r.scene.updateMatrixWorld(true);
    r.camera.updateMatrixWorld();
    const rect = r.canvas.getBoundingClientRect();
    return rec.model.children.map((module, index) => {
      const box = new THREE.Box3().setFromObject(module);
      const origin = module.getWorldPosition(new THREE.Vector3());
      const height = box.max.y - origin.y;
      const facade = module.localToWorld(new THREE.Vector3(0, height * 0.5, 0.46)).project(r.camera);
      return { index, x: rect.left + (facade.x * 0.5 + 0.5) * rect.width, y: rect.top + (-facade.y * 0.5 + 0.5) * rect.height };
    });
  });
}

async function verifySelection() {
  const points = await selectionPoints();
  for (const point of points) {
    const picked = await browser.page(({ x, y, index }) => {
      const r = PALIMPSITY.renderer, b = __firstHouse.house, rec = r.meshByBuilding.get(b);
      const hitCell = r.pickTile(x, y);
      const rect = r.canvas.getBoundingClientRect();
      const pointer = { x: ((x - rect.left) / rect.width) * 2 - 1, y: -((y - rect.top) / rect.height) * 2 + 1 };
      r.scene.updateMatrixWorld(true);
      r.camera.updateMatrixWorld();
      r.raycaster.setFromCamera(pointer, r.camera);
      const hit = r.raycaster.intersectObject(rec.model, true)[0];
      let object = hit?.object, moduleIndex = null;
      while (object && object !== rec.model) {
        const indexOfModule = rec.model.children.indexOf(object);
        if (indexOfModule !== -1) { moduleIndex = indexOfModule; break; }
        object = object.parent;
      }
      return { index, x, y, hitCell, moduleIndex, canvasAtPoint: document.elementFromPoint(x, y) === r.canvas };
    }, point);
    assert.deepEqual(picked.hitCell, { c: __firstHouseCell.c, r: __firstHouseCell.r });
    assert.equal(picked.moduleIndex, point.index);
    assert.ok(picked.canvasAtPoint);
    await browser.clickPoint(point);
    assert.equal(await browser.evaluate("PALIMPSITY.ui.inspectBuilding === __firstHouse.house"), true);
    report.selections.push(picked);
  }
  check("Base, three floors and roof each raycast and click-select the house", report.selections);
}

let __firstHouseCell;
try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport(viewport);
  await browser.boot(url);
  const placed = await prepareCity();
  __firstHouseCell = placed.house;
  report.placed = placed;
  check("Real game loads with nearby legacy references", placed);
  report.screenshots.push(await browser.screenshot("first-house-1-level", viewport));
  await transformToFour();
  await browser.evaluate("PALIMPSITY.renderer.homeCamera(true); PALIMPSITY.ui.showInspector(null)");
  await browser.frames(8);
  await moduleBounds();
  report.screenshots.push(await browser.screenshot("first-house-general", viewport));
  report.measurements.push(await browser.measure("four-floor-general", viewport));

  await browser.evaluate("PALIMPSITY.ui.showInspector(__firstHouse.house)");
  await browser.click("[data-focus-building]");
  await browser.frames(10);
  assert.equal(await browser.evaluate("PALIMPSITY.renderer.cameraScale"), "building");
  check("Inspector focus reaches the four-floor house");

  report.zoomSamples = [];
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 960, y: 540 });
  for (let step = 0; step < 40; step++) {
    const sample = await browser.evaluate("({ distance: PALIMPSITY.renderer.camera.position.distanceTo(PALIMPSITY.renderer.controls.target), minimum: PALIMPSITY.renderer.controls.minDistance, enabled: PALIMPSITY.renderer.controls.enabled })");
    report.zoomSamples.push(sample);
    if (sample.distance <= sample.minimum * 1.001) break;
    await browser.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 960, y: 540, deltaX: 0, deltaY: -120 });
    await browser.frames(3);
  }
  const zoom = await browser.evaluate("({ distance: PALIMPSITY.renderer.camera.position.distanceTo(PALIMPSITY.renderer.controls.target), minimum: PALIMPSITY.renderer.controls.minDistance, cameraY: PALIMPSITY.renderer.camera.position.y, enabled: PALIMPSITY.renderer.controls.enabled })");
  console.log("Zoom measurement", zoom);
  assert.ok(zoom.distance <= zoom.minimum * 1.001);
  assert.ok(zoom.cameraY > 0);
  report.zoom = zoom;
  check("Wheel zoom reaches minDistance without crossing the ground", zoom);
  report.screenshots.push(await browser.screenshot("first-house-zoom-max", viewport));
  await verifySelection();
  report.measurements.push(await browser.measure("four-floor-zoom-max", viewport));

  const shadow = await browser.evaluate("({ enabled: PALIMPSITY.renderer.renderer.shadowMap.enabled, sun: PALIMPSITY.renderer.sun.castShadow, map: [PALIMPSITY.renderer.sun.shadow.mapSize.x, PALIMPSITY.renderer.sun.shadow.mapSize.y] })");
  assert.deepEqual(shadow, { enabled: true, sun: true, map: [2048, 2048] });
  report.shadow = shadow;
  check("High quality keeps 2048 shadow mapping enabled", shadow);
  report.browser = browser.browserInfo;
  report.errors = [...browser.exceptions, ...browser.pageErrors];
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack || String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

const success = !report.failure;
const bytes = file => {
  try { return readFileSync(file).length; } catch { return 0; }
};
const lines = [
  "# First house — four floors, native 4K validation",
  "",
  `Generated: ${report.generatedAt}`,
  `Result: ${success ? "PASS" : "FAIL"}`,
  `Source: ${report.url}`,
  "",
  "## Conditions",
  "",
  `- Viewport: ${viewport.width}×${viewport.height} CSS pixels at DPR ${viewport.dpr}; expected captures and drawing buffer: **3840×2160 physical pixels**.`,
  `- Renderer: ${report.conditions.renderer}.`,
  "- Quality: `high`, native unclamped DPR, antialiasing requested by the renderer, 2048×2048 shadow map.",
  "- The simulation was paused. Phase and resources were prepared; all three floor additions used `transformBuilding`.",
  `- Machine: ${report.machine.platform}/${report.machine.architecture}, ${report.machine.processor}, Node ${report.machine.node}.`,
  "",
  "## Structural and interaction checks",
  "",
];
for (const item of report.checks) lines.push(`- PASS — ${item.name}.`);
if (report.failure) lines.push(`- FAIL — ${report.failure.split("\n")[0]}`);
if (report.zoom) lines.push("", `- Maximum zoom: distance ${report.zoom.distance.toFixed(4)} / minDistance ${report.zoom.minimum.toFixed(4)}; camera Y ${report.zoom.cameraY.toFixed(4)}.`);
lines.push("", "### Module anchors", "", "| Part | Local Y | Measured base | Measured top | Meshes |", "|---|---:|---:|---:|---:|");
for (const module of report.modules) lines.push(`| ${module.index === 4 ? "Roof" : module.index === 0 ? "Ground floor" : `Floor ${module.index + 1}`} | ${module.positionY.toFixed(2)} | ${module.localBaseY.toFixed(4)} | ${module.localTopY.toFixed(4)} | ${module.meshes} |`);
lines.push("", "## Native rendering measurements", "", "| View | FPS (SwiftShader) | Mean ms | p95 ms | DPR | Drawing buffer | Draw calls | Triangles |", "|---|---:|---:|---:|---:|---:|---:|---:|");
for (const sample of report.measurements) lines.push(`| ${sample.label} | ${sample.fps.toFixed(1)} | ${sample.meanFrameMs.toFixed(1)} | ${sample.p95FrameMs.toFixed(1)} | ${sample.rendererPixelRatio} | ${sample.drawingBuffer.width}×${sample.drawingBuffer.height} | ${sample.drawCalls} | ${sample.triangles} |`);
lines.push("", "These numbers are observations under SwiftShader, not hardware-GPU performance claims.", "", "## Captures", "");
for (const shot of report.screenshots) lines.push(`- [${shot.name}](captures/${path.basename(shot.file)}) — ${shot.width}×${shot.height} physical pixels, ${bytes(shot.file)} bytes.`);
lines.push("", "The general and maximum-zoom captures include the real interface. Visual proportion, roof continuity, reference-building scale, occlusion and shadow sharpness still require inspection of the PNGs; structural assertions alone do not prove them.", "");
writeFileSync(path.join(docsDir, "first-house-4k.md"), lines.join("\n"), "utf8");
console.log(JSON.stringify({ success, checks: report.checks.length, measurements: report.measurements, screenshots: report.screenshots, failure: report.failure }, null, 2));
