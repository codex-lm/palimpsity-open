import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LivingLayersBrowser } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const captures = path.join(rootDir, "docs", "living-layers", "captures");
const url = process.env.RENDERER_ENVIRONMENT_URL || "http://127.0.0.1:5173/index.html";
const viewport = { id: "1280x720-dpr2", width: 1280, height: 720, dpr: 2 };
const browser = new LivingLayersBrowser({ dist: path.join(rootDir, "dist", "palimpsity-mvp.html"), captures, frames: 10 });
const result = { url, checks: [], screenshots: [], measurements: {} };

try {
  await browser.connect();
  await browser.send("Fetch.disable");
  await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await browser.viewport(viewport);
  await browser.boot(url);
  const setup = await browser.page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer;
    e.state.phase = 4;
    e.state.res.money = 5000;
    e.state.res.materials = 500;
    e.state.unlocked.add("commons");
    const rows = [];
    for (let row = 1; row < e.terrain.length - 1; row++) for (let c = 1; c < e.terrain[0].length - 4; c++) {
      const cells = [0, 1, 2, 3].map(offset => ({ c: c + offset, r: row }));
      if (cells.every(cell => e.terrain[cell.r][cell.c] !== 1)) {
        const waterDistance = Math.min(...cells.map(cell => {
          let best = 99;
          for (let r = 0; r < e.terrain.length; r++) for (let x = 0; x < e.terrain[0].length; x++) {
            if (e.terrain[r][x] === 1) best = Math.min(best, Math.abs(x - cell.c) + Math.abs(r - cell.r));
          }
          return best;
        }));
        rows.push({ cells, score: waterDistance * 10 + Math.hypot(c + 1.5 - 7.5, row - 5.5) });
      }
    }
    rows.sort((a, b) => a.score - b.score);
    const chosen = rows[0]?.cells;
    if (!chosen) throw new Error("No four-cell riverfront site");
    const houses = ["banks", "works", "gardens"].map((family, index) => {
      const cell = chosen[index], house = e.place("house", cell.c, cell.r);
      if (!house) throw new Error(`Could not place ${family}`);
      house.architecture = { base: "residential", floors: index + 2, roof: index === 2 ? "garden" : "traditional", family, variant: 0 };
      house.occupancy = 1;
      return house;
    });
    const commons = e.place("commons", chosen[3].c, chosen[3].r);
    if (!commons) throw new Error("Could not place Commons");
    let reserve = null;
    for (let row = 0; row < e.terrain.length && !reserve; row++) for (let c = 0; c < e.terrain[0].length; c++) {
      const near = Math.abs(c - chosen[1].c) + Math.abs(row - chosen[1].r) <= 3;
      const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const adjacentBuilt = neighbors.some(([dc, dr]) => e.occ[row + dr]?.[c + dc]);
      const adjacentWater = neighbors.some(([dc, dr]) => e.terrain[row + dr]?.[c + dc] === 1);
      if (near && e.terrain[row][c] !== 1 && !e.occ[row][c] && !adjacentBuilt && !adjacentWater) {
        reserve = { c, r: row };
        break;
      }
    }
    if (!reserve) throw new Error("No reserved construction cell");
    e.state.res.population = 30;
    r.sync();
    PALIMPSITY.ui.showInspector(null);
    PALIMPSITY.ui.update();
    window.__environmentFixture = { houses, commons, reserve };
    return {
      houses: houses.map(house => ({ ...house.architecture })),
      commons: { c: commons.c, r: commons.r }, reserve,
      batches: r.getDebugInfo().environmentBatches,
      instances: r.getDebugInfo().environmentInstances,
    };
  });
  assert.equal(setup.batches > 0, true);
  assert.equal(setup.instances > 0, true);
  assert.deepEqual(setup.houses.map(house => house.family), ["banks", "works", "gardens"]);
  result.checks.push({ name: "three families and instanced environment", ...setup });

  const stable = await browser.evaluate("({ rebuilt: PALIMPSITY.renderer.getDebugInfo().environmentRebuiltCells, pickCount: PALIMPSITY.renderer._pickTargets.length, hasEnvironmentInPicks: PALIMPSITY.renderer._pickTargets.some(object => object.userData.environment) })");
  await browser.evaluate("PALIMPSITY.renderer.sync()");
  assert.equal(await browser.evaluate("PALIMPSITY.renderer.getDebugInfo().environmentRebuiltCells"), stable.rebuilt);
  assert.equal(stable.hasEnvironmentInPicks, false);
  result.checks.push({ name: "stable sync does not rebuild or alter picking", ...stable });

  await browser.evaluate("PALIMPSITY.renderer.focusBuilding(__environmentFixture.houses[1])");
  await browser.frames(10);
  const focus = await browser.evaluate("({ y: PALIMPSITY.renderer._offset.y, viewOffset: !!PALIMPSITY.renderer.camera.view?.enabled, projection: PALIMPSITY.renderer.projectionMode, lod: PALIMPSITY.renderer.getDebugInfo().environmentLod, instances: PALIMPSITY.renderer.getDebugInfo().environmentInstances })");
  assert.ok(focus.y < 0.41);
  assert.equal(focus.viewOffset, true);
  assert.equal(focus.lod, "full");
  assert.ok(focus.instances >= setup.instances);
  await browser.evaluate("PALIMPSITY.renderer.setProjectionMode('ortho')");
  assert.equal(await browser.evaluate("PALIMPSITY.renderer.camera.view?.enabled"), true);
  await browser.evaluate("PALIMPSITY.renderer.setProjectionMode('perspective')");
  result.checks.push({ name: "oblique focus works in both projections", ...focus });
  result.screenshots.push(await browser.screenshot("environment-families-day", viewport));
  await browser.evaluate("PALIMPSITY.renderer.setPhotoMode(true, 'golden')");
  await browser.frames(3);
  const golden = await browser.evaluate("({ position: PALIMPSITY.renderer.sun.position.toArray(), shadow: PALIMPSITY.renderer.renderer.shadowMap.enabled, type: PALIMPSITY.renderer.renderer.shadowMap.type })");
  assert.equal(golden.shadow, true);
  assert.equal(golden.position[1], 10);
  result.checks.push({ name: "golden uses low frontal directional light and soft shadows", ...golden });
  result.screenshots.push(await browser.screenshot("environment-families-golden", viewport));

  await browser.evaluate("PALIMPSITY.renderer.setPhotoMode(false); PALIMPSITY.renderer.focusBuilding(__environmentFixture.houses[0])");
  await browser.frames(10);
  result.screenshots.push(await browser.screenshot("environment-before-construction", viewport));
  const rebuild = await browser.page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer, reserve = __environmentFixture.reserve;
    const before = r.getDebugInfo().environmentRebuiltCells;
    const house = e.place("house", reserve.c, reserve.r);
    if (!house) throw new Error("Reserved construction failed");
    r.sync();
    return { delta: r.getDebugInfo().environmentRebuiltCells - before };
  });
  console.log("Environment rebuild", rebuild);
  result.screenshots.push(await browser.screenshot("environment-after-construction", viewport));
  assert.ok(rebuild.delta > 0 && rebuild.delta <= 9);
  result.checks.push({ name: "construction rebuilds only its local environment", ...rebuild });
  await browser.evaluate("PALIMPSITY.renderer.setPhotoMode(true, 'golden')");
  await browser.frames(3);
  result.screenshots.push(await browser.screenshot("environment-close-golden", viewport));

  const rendering = await browser.page(() => {
    const r = PALIMPSITY.renderer, gl = r.renderer.getContext();
    return {
      batches: r.getDebugInfo().environmentBatches,
      instances: r.getDebugInfo().environmentInstances,
      drawCalls: r.renderer.info.render.calls,
      pixelRatio: r.renderer.getPixelRatio(), nativeRatio: devicePixelRatio,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  });
  assert.equal(rendering.pixelRatio, 2);
  assert.equal(rendering.nativeRatio, 2);
  assert.deepEqual(rendering.drawingBuffer, [2560, 1440]);
  assert.ok(rendering.drawCalls < 1000);
  result.measurements.rendering = rendering;
  const drought = await browser.page(() => {
    const r = PALIMPSITY.renderer, e = PALIMPSITY.engine;
    const before = r._reactiveMaterials.map(entry => entry.material.color.getHex());
    e.weather = () => ({ kind: "drought", multiplier: 0.55 });
    r.sync();
    r._updateLandscape(1);
    const dry = r._reactiveMaterials.map(entry => entry.material.color.getHex());
    e.weather = () => ({ kind: "recovery", multiplier: 1 });
    r.sync();
    r._updateLandscape(1);
    const recovered = r._reactiveMaterials.map(entry => entry.material.color.getHex());
    return {
      entries: before.length,
      changed: dry.some((color, index) => color !== before[index]),
      recovered: recovered.every((color, index) => color === before[index]),
    };
  });
  assert.ok(drought.entries > 0 && drought.changed && drought.recovered);
  result.checks.push({ name: "drought and recovery preserve reactive environment materials", ...drought });
  const bankComposition = await browser.page(async () => {
    const { environmentPlanForCell } = await import("/src/diorama-assets.js");
    return [[3, 6], [4, 6], [9, 3], [6, 4], [12, 4]].map(([c, r]) => ({
      c, r,
      modules: environmentPlanForCell(PALIMPSITY.engine.terrain, c, r, (x, y) => PALIMPSITY.engine.occ[y]?.[x] || null).map(module => module.key),
      assembledPartTypes: PALIMPSITY.renderer._environmentCellParts.get(r * 16 + c)?.size || 0,
    }));
  });
  for (const cell of bankComposition) {
    assert.ok(!cell.modules.some(key => key.startsWith("ground_") || key === "vegetation_flowers" || key.startsWith("furniture_")));
    if ([9, 6, 12].includes(cell.c) && cell.r !== 6) {
      assert.deepEqual(cell.modules, []);
      assert.equal(cell.assembledPartTypes, 0);
    }
  }
  result.checks.push({ name: "bank cells have no full ground or unmasked decoration", cells: bankComposition });
  await browser.evaluate("PALIMPSITY.renderer.setPhotoMode(false); PALIMPSITY.renderer.focusBuilding({ c: 3, r: 6 })");
  await browser.frames(10);
  for (let step = 0; step < 4; step++) {
    await browser.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 520, y: 360, deltaX: 0, deltaY: -120 });
    await browser.frames(2);
  }
  result.screenshots.push(await browser.screenshot("environment-bank-no-furrows", viewport));
  await browser.evaluate("PALIMPSITY.renderer.focusBuilding({ c: 9, r: 3 })");
  await browser.frames(10);
  for (let step = 0; step < 4; step++) {
    await browser.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 520, y: 360, deltaX: 0, deltaY: -120 });
    await browser.frames(2);
  }
  result.screenshots.push(await browser.screenshot("environment-no-coplanar-banks", viewport));
  assert.deepEqual([...browser.exceptions, ...browser.pageErrors], []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
