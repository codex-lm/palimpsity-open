import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LivingLayersBrowser } from "./helpers-living-layers.mjs";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(gameDir, "..");
const dist = path.join(rootDir, "dist", "palimpsity-mvp.html");
const captures = path.join(rootDir, "docs", "living-layers", "captures");
const viewport = { id: "1920x1080-dpr2-4k", width: 1920, height: 1080, dpr: 2 };
const browser = new LivingLayersBrowser({ dist, captures, frames: 10 });
const result = { fixture: "Standalone embedded assets; real quays and waterPath; explicitly dated renderer flow fixture at tick 42", checks: [], screenshots: [] };

try {
  await browser.connect();
  await browser.viewport(viewport);
  await browser.boot(pathToFileURL(dist).href);
  const setup = await browser.page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer;
    e.state.phase = 4;
    e.state.res.money = 5000;
    e.state.res.materials = 500;
    e.state.unlocked.add("river_quay");
    const districtOf = (c, r) => (r >= e.terrain.length / 2 ? 2 : 0) + (c >= e.terrain[0].length / 2 ? 1 : 0);
    const candidates = [];
    for (const basin of e.waterBasins()) {
      const byDistrict = new Map();
      for (const side of basin.cells) for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const c = side.c + dc, r = side.r + dr;
        if (e.terrain[r]?.[c] === 1 || e.occ[r]?.[c] || e.placeBlockReason("river_quay", c, r, { quaySide: side })) continue;
        const district = districtOf(c, r);
        if (!byDistrict.has(district)) byDistrict.set(district, { c, r, side, district });
      }
      if (byDistrict.size >= 2) {
        const entries = [...byDistrict.values()];
        for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
          if (e.waterPath(entries[i].side, entries[j].side, basin).length >= 2) candidates.push({ basin, first: entries[i], second: entries[j] });
        }
      }
    }
    const chosen = candidates[0];
    if (!chosen) throw new Error("No two-district river basin");
    const first = e.place("river_quay", chosen.first.c, chosen.first.r, { quaySide: chosen.first.side });
    const second = e.place("river_quay", chosen.second.c, chosen.second.r, { quaySide: chosen.second.side });
    if (!first || !second) throw new Error("Quay placement failed");
    first.activity = second.activity = 1;
    e.computeDistricts();
    const path = e.waterPath(first.quaySide, second.quaySide, chosen.basin);
    const amounts = [8, 6, 5, 4, 3, 2, 1, 0.5];
    e.state.riverFlows = amounts.map((amount, index) => ({
      basin: chosen.basin.id, amount, resource: index % 2 ? "water" : "food",
      sourceQuay: first, destinationQuay: second, path,
    }));
    e.state.riverFlowTick = 42;
    r.setQuality("high");
    r.homeCamera(true);
    r.sync();
    PALIMPSITY.ui.showInspector(null);
    PALIMPSITY.ui.update();
    window.__lot015 = { first, second, basin: chosen.basin, path };
    return {
      first: { c: first.c, r: first.r, side: first.quaySide }, second: { c: second.c, r: second.r, side: second.quaySide },
      networks: e.state.riverNetworks.length, pathLength: path.length, barges: r.getDebugInfo().bargeCount,
      models: r.manifest.models.river_quay.file, riverAssets: Object.keys(r.manifest.riverAssets),
    };
  });
  console.log("LOT015 setup", setup);
  assert.equal(setup.networks > 0, true);
  assert.ok(setup.pathLength >= 2);
  assert.equal(setup.barges, 6);
  assert.deepEqual(setup.riverAssets.sort(), ["barge", "cargoFood", "cargoWater"]);
  result.checks.push({ name: "embedded models, current network and six barges", ...setup });

  console.log("Barge count direct", await browser.evaluate("PALIMPSITY.renderer._barges.length"));
  console.log("Amounts direct", await browser.evaluate("PALIMPSITY.renderer._barges.map(rec => rec.flow.amount).join(',')"));
  console.log("Resources direct", await browser.evaluate("PALIMPSITY.renderer._barges.map(rec => rec.flow.resource).join(',')"));
  console.log("Children direct", await browser.evaluate("PALIMPSITY.renderer._barges.map(rec => rec.group.children.length).join(',')"));
  const amounts = await browser.evaluate("PALIMPSITY.renderer._barges.map(rec => rec.flow.amount)");
  const resources = await browser.evaluate("PALIMPSITY.renderer._barges.map(rec => rec.flow.resource)");
  const children = await browser.evaluate("PALIMPSITY.renderer._barges.map(rec => rec.group.children.length)");
  const flows = amounts.map((amount, index) => ({ amount, resource: resources[index], children: children[index] }));
  assert.deepEqual(flows.map(flow => flow.amount), [8, 6, 5, 4, 3, 2]);
  const aquatic = await browser.evaluate("PALIMPSITY.renderer._barges.every(rec => rec.points.every(point => { const row = PALIMPSITY.engine.terrain[Math.round(point.z + 5.5)]; return row && row[Math.round(point.x + 7.5)] === 1; }))");
  assert.equal(aquatic, true);
  assert.ok(flows.every(flow => flow.children === 2));
  result.checks.push({ name: "amount order, cargo and aquatic paths", flows });

  const orientation = await browser.page(() => {
    const r = PALIMPSITY.renderer, b = __lot015.first, expected = r.meshByBuilding.get(b).group.rotation.y;
    r.setGhost("river_quay");
    r.setHover({ c: b.c, r: b.r });
    const ghost = r.ghost.rotation.y;
    r.setGhost(null);
    return { expected, ghost };
  });
  assert.equal(orientation.ghost, orientation.expected);
  result.checks.push({ name: "quay and ghost share orientation", ...orientation });

  const ghostSides = await browser.page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer, cases = [];
    for (let row = 0; row < e.terrain.length; row++) for (let c = 0; c < e.terrain[0].length; c++) {
      const sides = e.waterSides(c, row);
      if (![2, 3].includes(sides.length)) continue;
      for (let index = 0; index < sides.length; index++) {
        r.setGhost("river_quay");
        r.setGhostRotation(index * Math.PI / 2);
        r.setHover({ c, r: row });
        const target = sides[index], expected = target.c > c ? Math.PI / 2 : target.c < c ? -Math.PI / 2 : target.r < row ? Math.PI : 0;
        cases.push({ sides: sides.length, index, actual: r.ghost.rotation.y, expected });
      }
    }
    r.setGhost(null);
    return [cases.find(item => item.sides === 2), cases.find(item => item.sides === 3)];
  });
  assert.equal(ghostSides.length, 2);
  assert.ok(ghostSides.some(item => item.sides === 2) && ghostSides.some(item => item.sides === 3));
  assert.ok(ghostSides.every(item => item.actual === item.expected));
  result.checks.push({ name: "ghost rotation matches two and three water sides", cases: ghostSides });

  await browser.evaluate("PALIMPSITY.renderer.focusBuilding(__lot015.first)");
  await browser.frames(10);
  const quayPoint = await browser.page(() => {
    const r = PALIMPSITY.renderer, rec = r.meshByBuilding.get(__lot015.first);
    const projected = rec.group.position.clone().setY(0.3).project(r.camera), rect = r.canvas.getBoundingClientRect();
    return { x: rect.left + (projected.x * 0.5 + 0.5) * rect.width, y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height };
  });
  assert.deepEqual(await browser.evaluate(`PALIMPSITY.renderer.pickTile(${quayPoint.x}, ${quayPoint.y})`), { c: setup.first.c, r: setup.first.r });
  await browser.clickPoint(quayPoint);
  assert.equal(await browser.evaluate("PALIMPSITY.ui.inspectBuilding === __lot015.first"), true);
  result.checks.push({ name: "quay picking opens the correct building", ...quayPoint });

  await browser.evaluate("PALIMPSITY.renderer.setRiverSelection(__lot015.first); PALIMPSITY.renderer.homeCamera(true)");
  result.screenshots.push(await browser.screenshot("lot015-river-general-4k", viewport));
  const partner = await browser.evaluate("PALIMPSITY.renderer.focusQuayPartner(__lot015.first)");
  assert.equal(partner, true);
  await browser.frames(10);
  result.screenshots.push(await browser.screenshot("lot015-river-zoom-4k", viewport));

  const reduced = await browser.page(() => {
    const r = PALIMPSITY.renderer, barge = r._barges[0];
    r.setReducedEffects(true);
    const before = barge.group.position.toArray();
    r.frame();
    const after = barge.group.position.toArray();
    r.setPhotoMode(true, "golden");
    r.frame();
    return { before, after, goldenAfter: barge.group.position.toArray(), count: r._barges.length, reduced: r.reducedEffects };
  });
  assert.deepEqual(reduced.before, reduced.after);
  assert.deepEqual(reduced.before, reduced.goldenAfter);
  assert.equal(reduced.count, 6);
  result.checks.push({ name: "reducedEffects fixes cargo and photo preserves ledger", ...reduced });

  const stationary = await browser.page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer, first = __lot015.first, second = __lot015.second;
    e.state.riverFlows = [
      { amount: 2, resource: "food", sourceQuay: first, destinationQuay: second, path: [first.quaySide] },
      { amount: 1, resource: "water", sourceQuay: first, destinationQuay: second, path: [first.quaySide] },
    ];
    e.state.riverFlowTick = 43;
    r.sync();
    r._animateBarges(4);
    const positions = r._barges.map(rec => {
      rec.group.updateMatrixWorld(true);
      let minY = Infinity;
      rec.group.children[1].traverse(object => {
        if (!object.isMesh) return;
        object.geometry.computeBoundingBox();
        minY = Math.min(minY, object.geometry.boundingBox.min.clone().applyMatrix4(object.matrixWorld).y);
      });
      return { resource: rec.flow.resource, totalLength: rec.totalLength, position: rec.group.position.toArray(), minY, deckY: rec.group.position.y + 0.044 };
    });
    return { count: positions.length, positions };
  });
  assert.equal(stationary.count, 2);
  assert.ok(stationary.positions.every(item => item.totalLength === 0 && item.position.every(Number.isFinite) && item.minY >= item.deckY - 0.002));
  assert.ok(stationary.positions[0].position[0] < stationary.positions[1].position[0]);
  result.checks.push({ name: "stationary resources are separated and cargo rests on deck", ...stationary });

  const cleanup = await browser.page(() => {
    const e = PALIMPSITY.engine, r = PALIMPSITY.renderer, b = __lot015.second;
    e.removeAt(b.c, b.r);
    r.sync();
    return { barges: r.getDebugInfo().bargeCount, selection: r.getDebugInfo().riverSelectionCount, flows: e.state.riverFlows.length };
  });
  assert.equal(cleanup.barges, 0);
  assert.equal(cleanup.flows, 0);
  result.checks.push({ name: "demolition clears barges and flow selection", ...cleanup });

  const rendering = await browser.evaluate("({ css: [innerWidth, innerHeight], dpr: PALIMPSITY.renderer.renderer.getPixelRatio(), buffer: [PALIMPSITY.renderer.renderer.getContext().drawingBufferWidth, PALIMPSITY.renderer.renderer.getContext().drawingBufferHeight] })");
  assert.deepEqual(rendering, { css: [1920, 1080], dpr: 2, buffer: [3840, 2160] });
  result.rendering = rendering;
  assert.deepEqual([...browser.exceptions, ...browser.pageErrors], []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
