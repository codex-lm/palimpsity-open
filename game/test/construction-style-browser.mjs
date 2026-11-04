import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LivingLayersBrowser, VIEWPORTS } from './helpers-living-layers.mjs';

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = new LivingLayersBrowser({
  dist: path.resolve(gameDir, '../dist/palimpsity-mvp.html'),
  captures: path.resolve(gameDir, '../docs/living-layers/captures'),
  frames: 30,
});

try {
  await browser.connect();
  await browser.viewport(VIEWPORTS[0]);
  await browser.boot(pathToFileURL(browser.dist).href);
  const initial = await browser.page(() => ({
    family: PALIMPSITY.ui.buildFamily,
    choices: [...document.querySelectorAll('#house-family [data-family]')].map(button => button.dataset.family),
  }));
  assert.equal(initial.family, 'banks');
  assert.deepEqual(initial.choices, ['banks', 'works', 'gardens']);
  await browser.click('#house-family [data-family="works"]');
  assert.equal(await browser.page(() => PALIMPSITY.ui.buildFamily), 'works');
  await browser.click('#building-list [data-id="house"]');

  const placed = [];
  for (let r = 6; r < 9; r++) for (let c = 0; c < 3; c++) {
    const result = await browser.page(({ c, r }) => {
      const engine = PALIMPSITY.engine, renderer = PALIMPSITY.renderer;
      renderer.setHover({ c, r });
      const ghost = { ...renderer.ghostArchitecture };
      const building = engine.place('house', c, r, { family: PALIMPSITY.ui.buildFamily });
      if (!building) throw new Error(engine.placeBlockReason('house', c, r));
      renderer.sync();
      return { ghost, placed: { ...building.architecture }, signature: renderer.meshByBuilding.get(building).layerSignature };
    }, { c, r });
    assert.equal(result.ghost.family, 'works');
    assert.equal(result.ghost.variant, (c + 2 * r) % 3);
    assert.deepEqual(result.placed, result.ghost);
    assert.ok(result.signature.includes('base_house_works_'));
    placed.push(result.placed);
  }
  for (const variant of [0, 1, 2]) assert.equal(placed.filter(architecture => architecture.variant === variant).length, 3);

  const localized = await browser.page(() => {
    const before = PALIMPSITY.engine.state.buildings.map(building => ({ ...building.architecture }));
    const select = document.getElementById('language-select');
    select.value = 'fr';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const after = PALIMPSITY.engine.state.buildings.map(building => ({ ...building.architecture }));
    return {
      unchanged: JSON.stringify(before) === JSON.stringify(after),
      family: PALIMPSITY.ui.buildFamily,
      worksLabel: document.querySelector('#house-family [data-family="works"]').textContent,
    };
  });
  assert.equal(localized.unchanged, true);
  assert.equal(localized.family, 'works');
  assert.equal(localized.worksLabel, 'Fabriques');
  const stableAfterPauseAndZoom = await browser.page(() => {
    const select = document.getElementById('language-select');
    select.value = 'en';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const engine = PALIMPSITY.engine, renderer = PALIMPSITY.renderer, x = 1 - 7.5, z = 7 - 5.5;
    const before = engine.state.buildings.map(building => ({ ...building.architecture }));
    engine.state.speed = 0;
    renderer.controls.target.set(x, 0.45, z);
    renderer.camera.position.set(x + 5, 6, z + 7);
    renderer.controls.update();
    renderer.sync();
    const after = engine.state.buildings.map(building => ({ ...building.architecture }));
    return JSON.stringify(before) === JSON.stringify(after);
  });
  assert.equal(stableAfterPauseAndZoom, true);
  await browser.frames(10);
  const screenshot = await browser.screenshot('c1-nine-houses', VIEWPORTS[0]);
  console.log(JSON.stringify({ result: 'PASS', houses: placed.length, variants: [0, 1, 2].map(variant => placed.filter(a => a.variant === variant).length), family: 'works', screenshot: screenshot.file, browserValidation: true }, null, 2));
} finally {
  await browser.close();
}
