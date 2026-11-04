import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LivingLayersBrowser, machineInfo } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const docsDir = path.join(rootDir, "docs", "living-layers");
const capturesDir = path.join(docsDir, "captures");
const url = process.env.D1_ROOF_MATRIX_URL || "http://127.0.0.1:5173/index.html";
const viewport = { id: "1920x1080-dpr2-physical-4k", width: 1920, height: 1080, dpr: 2 };
const browser = new LivingLayersBrowser({ dist: path.join(rootDir, "dist", "palimpsity-mvp.html"), captures: capturesDir, frames: 10 });
mkdirSync(capturesDir, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(), url, viewport, machine: machineInfo(),
  fixture: "Paused classic game; phase 4, 5000 EUR and 500 materials prepared. All architecture changes use engine.transformBuilding.",
  renderer: "SwiftShader requested; visual validation only, no performance benchmark.",
  combinations: [], transformations: [], previews: [], selections: [], screenshots: [], checks: [],
};

async function applyOption(id) {
  const action = await browser.page(id => {
    const e = PALIMPSITY.engine, b = __d1House;
    const option = e.transformationOptions(b).find(item => item.id === id);
    const reason = e.transformationBlockReason(b, id);
    if (!option || reason) throw new Error(`${id}: ${reason || "missing offer"}`);
    const money = e.state.res.money, materials = e.state.res.materials;
    if (!e.transformBuilding(b, id)) throw new Error(`${id}: transformBuilding returned false`);
    if (e.state.res.money !== money - option.cost.money || e.state.res.materials !== materials - option.cost.materials) {
      throw new Error(`${id}: incorrect cost`);
    }
    PALIMPSITY.renderer.sync();
    PALIMPSITY.ui.update();
    return { id, cost: option.cost, architecture: { ...b.architecture }, history: b.history.at(-1) };
  }, id);
  report.transformations.push(action);
}

async function verifyCombination(floors, roof) {
  const result = await browser.page(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const b = __d1House, r = PALIMPSITY.renderer, rec = r.meshByBuilding.get(b);
    r.scene.updateMatrixWorld(true);
    const modules = rec.model.children.map((module, index) => {
      const box = new THREE.Box3().setFromObject(module), origin = module.getWorldPosition(new THREE.Vector3());
      return { index, positionY: module.position.y, baseY: box.min.y - origin.y, topY: box.max.y - origin.y };
    });
    return {
      floors: b.architecture.floors, roof: b.architecture.roof,
      family: b.architecture.family, variant: b.architecture.variant,
      signature: rec.layerSignature, roofCount: rec.roof ? 1 : 0,
      moduleCount: modules.length, modules,
      allModulesPickable: rec.model.children.every(module => r._pickTargets.includes(module)),
    };
  });
  assert.equal(result.floors, floors);
  assert.equal(result.roof, roof);
  assert.equal(result.family, "banks");
  assert.equal(result.variant, 0);
  assert.equal(result.roofCount, 1);
  assert.equal(result.moduleCount, floors + 1);
  assert.equal(result.allModulesPickable, true);
  const roofKey = roof === "traditional" ? "roof_traditional_banks_0" : `roof_${roof}_banks`;
  assert.equal(result.signature, `base_house_banks_0|${floors}|floor_banks_0|${roofKey}|true`);
  for (const module of result.modules) {
    assert.ok(Math.abs(module.positionY - module.index * 0.48) < 1e-6);
    assert.ok(Math.abs(module.baseY) < 0.002);
    if (module.index < floors) assert.ok(Math.abs(module.topY - 0.48) < 0.002);
    else assert.ok(module.topY > 0);
  }
  report.combinations.push(result);
  console.log(`PASS ${floors} floors / ${roof}`);
}

async function verifyPreview(roof, optionId) {
  const result = await browser.page(({ roof, optionId }) => {
    const r = PALIMPSITY.renderer, b = __d1House;
    const [before, after] = __d1PreviewCanvases;
    const cityBefore = JSON.stringify({ architecture: b.architecture, history: b.history, resources: PALIMPSITY.engine.state.res });
    const ok = r.renderArchitectureComparison(b, optionId, before, after);
    const hash = canvas => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let value = 2166136261;
      for (let i = 0; i < data.length; i += 401) value = Math.imul(value ^ data[i], 16777619) >>> 0;
      return value;
    };
    const output = {
      roof, optionId, ok, size: [before.width, before.height], hashes: [hash(before), hash(after)],
      cityUnchanged: cityBefore === JSON.stringify({ architecture: b.architecture, history: b.history, resources: PALIMPSITY.engine.state.res }),
      images: roof === "productive" ? { before: before.toDataURL("image/png"), after: after.toDataURL("image/png") } : null,
    };
    return output;
  }, { roof, optionId });
  assert.equal(result.ok, true);
  assert.deepEqual(result.size, [600, 420]);
  assert.notEqual(result.hashes[0], result.hashes[1]);
  assert.equal(result.cityUnchanged, true);
  report.previews.push(result);
}

function saveDataUrl(name, dataUrl) {
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  const file = path.join(capturesDir, `${name}.png`);
  writeFileSync(file, bytes);
  const shot = { name, file, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  report.screenshots.push(shot);
}

async function verifyFinalPicking() {
  const houseCell = await browser.evaluate("({ c: __d1House.c, r: __d1House.r })");
  const points = await browser.page(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const r = PALIMPSITY.renderer, rec = r.meshByBuilding.get(__d1House);
    r.scene.updateMatrixWorld(true);
    r.camera.updateMatrixWorld();
    const rect = r.canvas.getBoundingClientRect();
    return rec.model.children.map((module, index) => {
      const box = new THREE.Box3().setFromObject(module), origin = module.getWorldPosition(new THREE.Vector3());
      const facade = module.localToWorld(new THREE.Vector3(0, (box.max.y - origin.y) * 0.5, 0.46)).project(r.camera);
      return { index, x: rect.left + (facade.x * 0.5 + 0.5) * rect.width, y: rect.top + (-facade.y * 0.5 + 0.5) * rect.height };
    });
  });
  for (const point of points) {
    const picked = await browser.page(({ x, y, index }) => {
      const r = PALIMPSITY.renderer, rec = r.meshByBuilding.get(__d1House);
      const hitCell = r.pickTile(x, y), rect = r.canvas.getBoundingClientRect();
      r.raycaster.setFromCamera({ x: ((x - rect.left) / rect.width) * 2 - 1, y: -((y - rect.top) / rect.height) * 2 + 1 }, r.camera);
      const hit = r.raycaster.intersectObject(rec.model, true)[0];
      let object = hit?.object, moduleIndex = null;
      while (object && object !== rec.model) {
        const candidate = rec.model.children.indexOf(object);
        if (candidate !== -1) { moduleIndex = candidate; break; }
        object = object.parent;
      }
      return { index, hitCell, moduleIndex, canvas: document.elementFromPoint(x, y) === r.canvas };
    }, point);
    assert.deepEqual(picked.hitCell, houseCell);
    assert.equal(picked.moduleIndex, point.index);
    assert.equal(picked.canvas, true);
    await browser.clickPoint(point);
    assert.equal(await browser.evaluate("PALIMPSITY.ui.inspectBuilding === __d1House"), true);
    report.selections.push(picked);
  }
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
    const cells = [];
    for (let row = 1; row < e.terrain.length - 1; row++) for (let c = 1; c < e.terrain[0].length - 1; c++) {
      if (e.terrain[row][c] !== 1 && e.terrain[row][c - 1] !== 1 && e.terrain[row][c + 1] !== 1 && e.terrain[row - 1][c] !== 1 && e.terrain[row + 1][c - 1] !== 1) {
        cells.push({ c, r: row, score: Math.hypot(c - 7.5, row - 5.5) });
      }
    }
    cells.sort((a, b) => a.score - b.score);
    let house = null;
    for (const cell of cells) if ((house = e.place("house", cell.c, cell.r))) break;
    if (!house) throw new Error("No house site");
    const references = [e.place("well", house.c - 1, house.r), e.place("farm", house.c + 1, house.r), e.place("park", house.c, house.r - 1), e.place("market", house.c - 1, house.r + 1)];
    if (references.some(building => !building)) throw new Error("Legacy reference placement failed");
    window.__d1House = house;
    r.setQuality("high");
    r.setReducedEffects(false);
    r.setPhotoMode(false);
    r.toggleRoof(true);
    r.homeCamera(true);
    r.sync();
    PALIMPSITY.ui.showInspector(null);
    PALIMPSITY.ui.update();
  });
  if (await browser.evaluate("__d1House.architecture.family !== 'banks'")) await applyOption("family_banks");
  if (await browser.evaluate("__d1House.architecture.variant !== 0")) await applyOption("variant_0");
  await browser.page(() => {
    const fixture = document.createElement("div");
    fixture.id = "d1-preview-fixture";
    fixture.style.cssText = "position:fixed;z-index:30;left:30px;top:110px;display:flex;gap:12px;padding:12px;background:#fff8ed;border-radius:14px";
    for (const id of ["before", "after"]) {
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "width:300px;height:210px;display:block";
      fixture.append(canvas);
    }
    document.body.append(fixture);
    window.__d1PreviewCanvases = [...fixture.children];
  });
  for (let floors = 1; floors <= 4; floors++) {
    if (floors > 1) await applyOption("add_floor");
    for (const roof of ["traditional", "garden", "productive"]) {
      if (await browser.evaluate(`__d1House.architecture.roof !== '${roof}'`)) await applyOption(`roof_${roof}`);
      await verifyCombination(floors, roof);
      if (floors === 4) await verifyPreview(roof, roof === "traditional" ? "roof_garden" : roof === "garden" ? "roof_productive" : "roof_traditional");
    }
  }
  assert.equal(report.combinations.length, 12);
  assert.equal(report.previews.length, 3);
  report.checks.push("12 real floor/roof combinations with 0.48 anchors and one upper roof");
  const productivePreview = report.previews.find(preview => preview.roof === "productive");
  saveDataUrl("d1-preview-productive-before", productivePreview.images.before);
  saveDataUrl("d1-preview-traditional-after", productivePreview.images.after);
  await browser.evaluate("document.getElementById('d1-preview-fixture').remove(); PALIMPSITY.renderer.homeCamera(true); PALIMPSITY.ui.showInspector(null)");
  await browser.frames(4);
  report.screenshots.push(await browser.screenshot("d1-house-4-productive-general", viewport));
  await browser.evaluate("PALIMPSITY.ui.showInspector(__d1House)");
  await browser.click("[data-focus-building]");
  await browser.frames(10);
  for (let step = 0; step < 20; step++) {
    await browser.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 800, y: 500, deltaX: 0, deltaY: -120 });
    await browser.frames(2);
  }
  await verifyFinalPicking();
  report.screenshots.push(await browser.screenshot("d1-house-4-productive-zoom", viewport));
  report.rendering = await browser.page(() => {
    const r = PALIMPSITY.renderer, gl = r.renderer.getContext();
    return {
      quality: r.quality, css: [r.canvas.getBoundingClientRect().width, r.canvas.getBoundingClientRect().height],
      nativeDpr: devicePixelRatio, rendererDpr: r.renderer.getPixelRatio(), buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      shadow: r.renderer.shadowMap.enabled, previewContexts: r.getDebugInfo().previewContextCount,
    };
  });
  assert.equal(report.rendering.quality, "high");
  assert.equal(report.rendering.nativeDpr, 2);
  assert.equal(report.rendering.rendererDpr, 2);
  assert.deepEqual(report.rendering.buffer, [3840, 2160]);
  assert.equal(report.rendering.shadow, true);
  assert.equal(report.rendering.previewContexts, 1);
  assert.equal(report.selections.length, 5);
  assert.deepEqual([...browser.exceptions, ...browser.pageErrors], []);
} catch (error) {
  report.failure = error.stack || String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

const bytes = file => { try { return readFileSync(file).length; } catch { return 0; } };
const lines = [
  "# D1 — floor and roof matrix, native 4K", "",
  `Generated: ${report.generatedAt}`, `Result: ${report.failure ? "FAIL" : "PASS"}`, `Source: ${report.url}`, "",
  "## Fixture and scope", "",
  `- ${report.fixture}`,
  `- ${report.renderer}`,
  `- Viewport: ${viewport.width}×${viewport.height} CSS at DPR ${viewport.dpr}; expected drawing buffer and general/zoom PNGs: 3840×2160.`,
  "- House: Banks variant 0. Legacy well, farm, park and market provide scale references.",
  `- Real transformations recorded: ${report.transformations.length}.`, "",
  "## Twelve combinations", "",
  "| Floors | Roof | Modules | Roof Y | Signature |",
  "|---:|---|---:|---:|---|",
];
for (const combo of report.combinations) lines.push(`| ${combo.floors} | ${combo.roof} | ${combo.moduleCount} | ${combo.modules.at(-1).positionY.toFixed(2)} | \`${combo.signature}\` |`);
lines.push("", "Every level has local base 0 and top 0.48. Every roof has local base 0 at floors × 0.48. Each combination has exactly one upper roof and all its modules are pick targets.", "", "## Previews and final picking", "");
for (const preview of report.previews) lines.push(`- ${preview.roof} preview via ${preview.optionId}: distinct pixel hashes ${preview.hashes.join(" / ")}, 600×420 canvases, city unchanged.`);
lines.push(`- Final productive four-level house: ${report.selections.length}/5 parts selected by raycast and real click.`, "", "## Native captures", "", "| Capture | CSS | DPR | Drawing buffer | PNG | Bytes |", "|---|---|---:|---|---|---:|");
for (const shot of report.screenshots) {
  const individual = shot.width === 600 && shot.height === 420;
  lines.push(`| [${shot.name}](captures/${path.basename(shot.file)}) | ${individual ? "300×210" : "1920×1080"} | 2 | ${individual ? "600×420" : "3840×2160"} | ${shot.width}×${shot.height} | ${bytes(shot.file)} |`);
}
if (report.failure) lines.push("", `Failure: ${report.failure.split("\n")[0]}`);
lines.push("", "Visual continuity and floating accessories require inspection of the general and zoom PNGs; structural assertions alone do not constitute that visual inspection.", "");
writeFileSync(path.join(docsDir, "d1-roof-matrix-4k.md"), lines.join("\n"), "utf8");
console.log(JSON.stringify({ success: !report.failure, combinations: report.combinations.length, transformations: report.transformations.length, previews: report.previews.length, selections: report.selections.length, rendering: report.rendering, screenshots: report.screenshots, failure: report.failure }, null, 2));
