import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { LivingLayersBrowser, machineInfo } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const docsDir = path.join(rootDir, "docs", "living-layers");
const capturesDir = path.join(docsDir, "captures", "d2");
const baselineFile = path.resolve(rootDir, "..", "kimi-palimpsity-living-layers-artifacts", "baseline-70c306f.html");
const baselineEvidence = path.resolve(rootDir, "..", "kimi-palimpsity-living-layers-artifacts", "baseline-results-70c306f.json");
const currentFile = path.join(rootDir, "dist", "palimpsity-mvp.html");
const viewport = { id: "1920x1080-dpr2", width: 1920, height: 1080, dpr: 2 };
const warmupMs = 5000;
const sampleMs = 10000;
mkdirSync(capturesDir, { recursive: true });

function artifact(id, file) {
  const bytes = readFileSync(file);
  return {
    id,
    file,
    url: pathToFileURL(file).href,
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const artifacts = [artifact("baseline", baselineFile), artifact("current", currentFile)];
assert.equal(artifacts[0].sha256, "49fba91a84a7c44da980f0bc228c2c0e04e49ab84e2fc666aef5ff3b2e64f4f0");
assert.equal(artifacts[1].sha256, "2c2579f4bc1233a4d0f45b8c8e41393c73d899aacd6da78079c675dac5d1e3fe");
assert.equal(artifacts[1].bytes, 17071612);

const report = {
  generatedAt: new Date().toISOString(),
  machine: machineInfo(),
  conditions: {
    browser: "one isolated headless Chrome process; baseline and current loaded sequentially",
    viewport,
    scenes: "identical public place/transformBuilding fixtures, homeCamera(true), day, roofs visible, reduced effects false, simulation paused",
    warmupMs,
    minimumSampleMs: sampleMs,
    gpuValidation: false,
    note: "SwiftShader is reported separately from hardware GPUs; these observations do not validate hardware performance.",
  },
  baselineEvidence,
  artifacts,
  measurements: [],
  comparisons: [],
  screenshots: [],
  errors: [],
};
const browser = new LivingLayersBrowser({ dist: currentFile, captures: capturesDir, frames: 30 });

async function prepareScene(scene) {
  await browser.page(scene => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer;
    e.state.phase = 4;
    e.state.res.money = 10000;
    e.state.res.materials = 2000;
    e.state.speed = 0;
    const placed = { houses: [], denseHouses: [] };
    const place = (id, c, row) => {
      const b = e.place(id, c, row);
      if (!b) throw new Error(`${scene}: cannot place ${id} at ${c},${row}: ${e.placeBlockReason(id, c, row)}`);
      return b;
    };
    for (let c = 0; c < 6; c++) placed.houses.push(place("house", c, 6));
    place("well", 6, 6); place("well", 7, 6); place("well", 0, 7);
    place("farm", 1, 7); place("farm", 2, 7);
    place("workshop", 3, 7); place("market", 4, 7); place("park", 5, 7);
    const transform = (b, id) => {
      const reason = e.transformationBlockReason(b, id);
      if (reason || !e.transformBuilding(b, id)) throw new Error(`${scene}: ${id} blocked at ${b.c},${b.r}: ${reason}`);
    };
    for (const [index, floors] of [3, 2, 3].entries()) {
      const b = placed.houses[index];
      while (b.architecture.floors < floors) transform(b, "add_floor");
      if (index < 2) transform(b, "roof_garden");
      if (index === 0) { transform(b, "family_gardens"); transform(b, "variant_1"); }
      if (index === 1) { transform(b, "family_works"); transform(b, "variant_2"); }
    }
    if (scene === "dense") {
      for (let c = 0; c < 12; c++) placed.denseHouses.push(place("house", c, 0));
      placed.denseHouses.forEach((b, index) => {
        while (b.architecture.floors < 4) transform(b, "add_floor");
        transform(b, index % 2 ? "roof_garden" : "roof_productive");
      });
    }
    r.setQuality("high");
    r.setReducedEffects(false);
    r.setPhotoMode(false);
    r.toggleRoof(true);
    r.homeCamera(true);
    r.sync();
    PALIMPSITY.ui.showInspector(null);
    PALIMPSITY.ui.update();
    return { tick: e.state.tick, buildings: e.state.buildings.length, speed: e.state.speed };
  }, scene);
  await browser.waitFor("!document.querySelector('#toast .toast-msg')", `${scene}: transient notifications to clear`, 120000);
  await browser.frames(5);
}

async function measure(scene, quality) {
  await browser.page(quality => {
    const r = PALIMPSITY.renderer;
    r.setQuality(quality);
    r.setReducedEffects(false);
    r.setPhotoMode(false);
    r.homeCamera(true);
    PALIMPSITY.ui.showInspector(null);
  }, quality);
  await browser.frames(5);
  const sample = await browser.page(async ({ warmupMs, sampleMs }) => {
    const r = PALIMPSITY.renderer, renderer = r.renderer, gl = renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const warmupStart = performance.now();
    let warmupFrames = 0;
    while (performance.now() - warmupStart < warmupMs || warmupFrames < 5) {
      await new Promise(requestAnimationFrame);
      warmupFrames++;
    }
    const tickBefore = PALIMPSITY.engine.state.tick;
    const warmupDurationMs = performance.now() - warmupStart;
    const started = performance.now();
    const deltas = [];
    let previous = await new Promise(requestAnimationFrame);
    while (performance.now() - started < sampleMs || deltas.length < 2) {
      const now = await new Promise(requestAnimationFrame);
      deltas.push(now - previous);
      previous = now;
    }
    const durationMs = performance.now() - started;
    const sorted = [...deltas].sort((a, b) => a - b);
    const canvas = renderer.domElement;
    return {
      warmupMs: warmupDurationMs,
      durationMs,
      frames: deltas.length,
      fps: deltas.length * 1000 / durationMs,
      medianFrameMs: sorted[Math.floor((sorted.length - 1) * 0.5)],
      p95FrameMs: sorted[Math.floor((sorted.length - 1) * 0.95)],
      maxFrameMs: sorted.at(-1),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      canvasCss: { width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height },
      devicePixelRatio,
      rendererPixelRatio: renderer.getPixelRatio(),
      quality: r.quality,
      reducedEffects: r.reducedEffects,
      cameraScale: r.cameraScale,
      tickBefore,
      tickAfter: PALIMPSITY.engine.state.tick,
      webgl: {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
      },
      jsHeap: performance.memory ? { usedBytes: performance.memory.usedJSHeapSize } : null,
    };
  }, { warmupMs, sampleMs });
  assert.ok(sample.durationMs >= sampleMs, `${scene}/${quality}: sample shorter than 10 seconds`);
  assert.equal(sample.tickAfter, sample.tickBefore, `${scene}/${quality}: simulation advanced during measurement`);
  assert.equal(sample.quality, quality);
  assert.equal(sample.reducedEffects, false);
  const expectedRatio = quality === "high" ? viewport.dpr : 1;
  assert.equal(sample.rendererPixelRatio, expectedRatio);
  assert.equal(sample.drawingBuffer.width, Math.round(sample.canvasCss.width * expectedRatio));
  assert.equal(sample.drawingBuffer.height, Math.round(sample.canvasCss.height * expectedRatio));
  return { scene, quality, viewport, ...sample };
}

async function runArtifact(item) {
  for (const scene of ["small", "dense"]) {
    browser.scenario = `${item.id}/${scene}`;
    await browser.viewport(viewport);
    await browser.boot(item.url);
    await prepareScene(scene);
    for (const quality of ["high", "low"]) {
      browser.scenario = `${item.id}/${scene}/${quality}`;
      const measurement = await measure(scene, quality);
      measurement.artifact = item.id;
      report.measurements.push(measurement);
      const name = `d2-${item.id}-${scene}-${quality}`;
      const shot = await browser.screenshot(name, viewport);
      report.screenshots.push({ artifact: item.id, scene, quality, name: `${name}.png`, width: shot.width, height: shot.height, bytes: shot.bytes });
      console.log(`${item.id} ${scene} ${quality}: ${measurement.fps.toFixed(2)} FPS, median ${measurement.medianFrameMs.toFixed(2)} ms, p95 ${measurement.p95FrameMs.toFixed(2)} ms, ${measurement.frames} frames in ${(measurement.durationMs / 1000).toFixed(2)} s`);
    }
  }
}

function percent(current, baseline) {
  return (current - baseline) / baseline * 100;
}

function markdown() {
  const lines = ["# D2 — comparaison de performance baseline / courant", "", `Généré : ${report.generatedAt}`, "",
    "## Conditions et portée", "",
    `- Un seul Chrome (${report.browser?.product || "indisponible"}), artifacts chargés séquentiellement, viewport ${viewport.width}×${viewport.height} à DPR ${viewport.dpr}.`,
    `- Moteur WebGL réel : **${report.measurements[0]?.webgl.renderer || "indisponible"}** (${report.measurements[0]?.webgl.vendor || "vendor indisponible"}).`,
    `- Après ${warmupMs / 1000} s minimum d’échauffement, chaque vue est échantillonnée pendant **au moins ${sampleMs / 1000} s**, simulation en pause.`,
    "- Mêmes scènes, caméra de vallée, fixtures publiques, qualité et résolution pour baseline et courant.",
    "- **SwiftShader uniquement : aucune validation de performance sur GPU matériel.**", "",
    "## Artifacts", "",
    "| Artifact | Brut | Gzip | SHA-256 |", "|---|---:|---:|---|"];
  for (const item of artifacts) lines.push(`| ${item.id} | ${item.bytes} o | ${item.gzipBytes} o | \`${item.sha256}\` |`);
  lines.push("", "## Mesures", "", "| Artifact | Scène | Qualité | Durée | Frames | FPS | Médiane | p95 | Draw calls | Triangles | Buffer |", 
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const m of report.measurements) lines.push(`| ${m.artifact} | ${m.scene} | ${m.quality} | ${(m.durationMs / 1000).toFixed(2)} s | ${m.frames} | ${m.fps.toFixed(2)} | ${m.medianFrameMs.toFixed(2)} ms | ${m.p95FrameMs.toFixed(2)} ms | ${m.drawCalls} | ${m.triangles} | ${m.drawingBuffer.width}×${m.drawingBuffer.height} |`);
  lines.push("", "## Delta du p95 courant vs baseline", "", "| Scène | Qualité | Baseline p95 | Courant p95 | Delta | Seuil 10 % |", "|---|---|---:|---:|---:|---|");
  for (const item of report.comparisons) lines.push(`| ${item.scene} | ${item.quality} | ${item.baselineP95Ms.toFixed(2)} ms | ${item.currentP95Ms.toFixed(2)} ms | ${item.deltaP95Percent >= 0 ? "+" : ""}${item.deltaP95Percent.toFixed(2)} % | ${item.exceedsAbsolute10Percent ? "À documenter" : "Non"} |`);
  const notable = report.comparisons.filter(item => item.exceedsAbsolute10Percent);
  lines.push("", "### Lecture", "");
  if (!notable.length) lines.push("Aucun delta absolu de p95 supérieur ou égal à 10 % entre les deux artifacts dans ces conditions.");
  for (const item of notable) lines.push(`- **${item.scene}/${item.quality}** : ${item.deltaP95Percent >= 0 ? "régression" : "amélioration"} de ${Math.abs(item.deltaP95Percent).toFixed(2)} % du p95. Constat documenté sans modification du produit pour le masquer.`);
  lines.push("", "## Captures natives", "");
  for (const shot of report.screenshots) lines.push(`- [${shot.artifact}/${shot.scene}/${shot.quality}](captures/d2/${shot.name}) — ${shot.width}×${shot.height}, ${shot.bytes} octets.`);
  lines.push("", "La baseline HTML et `baseline-results-70c306f.json` sont conservés hors de ce rapport et n’ont pas été réécrits.");
  if (report.errors.length) lines.push("", "## Erreurs", "", ...report.errors.map(error => `- ${error}`));
  return lines.join("\n") + "\n";
}

let failure = null;
try {
  await browser.connect();
  report.browser = browser.browserInfo;
  for (const item of artifacts) await runArtifact(item);
  for (const scene of ["small", "dense"]) for (const quality of ["high", "low"]) {
    const baseline = report.measurements.find(m => m.artifact === "baseline" && m.scene === scene && m.quality === quality);
    const current = report.measurements.find(m => m.artifact === "current" && m.scene === scene && m.quality === quality);
    const deltaP95Percent = percent(current.p95FrameMs, baseline.p95FrameMs);
    report.comparisons.push({
      scene, quality,
      baselineP95Ms: baseline.p95FrameMs,
      currentP95Ms: current.p95FrameMs,
      deltaP95Percent,
      exceedsAbsolute10Percent: Math.abs(deltaP95Percent) >= 10,
    });
  }
  report.errors = [...browser.exceptions, ...browser.pageErrors];
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  failure = error;
  report.status = "failed";
  report.errors.push(error.stack || String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  try { await browser.close(); } catch (error) {
    report.errors.push(`Browser cleanup: ${error.message}`);
    process.exitCode = 1;
  }
  report.browserClosed = browser.exited || !browser.child;
  writeFileSync(path.join(docsDir, "d2-performance-results.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(path.join(docsDir, "d2-performance-comparison.md"), markdown());
  console.log(`D2 report: ${path.join(docsDir, "d2-performance-comparison.md")}`);
}
