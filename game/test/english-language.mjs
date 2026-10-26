/* Player-facing language guard. Comments and historical mockups may stay French.
 * The explicit state fixtures below exercise message branches, not progression.
 * The artifact check separately proves that the playable HTML uses these sources.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { CityEngine } from '../src/engine.js';
import { BUILDINGS, BUILDING_CONVERSIONS, DISTRICT_NAMES, REGIME_META, RES_META } from '../src/data.js';
import { playSober } from './playthrough-helpers.mjs';

const french = /[àâäçéèêëîïôöùûüÿœ]|\b(?:quartier|quartiers|bâtiment|bâtiments|nourriture|usure|confiance|ouvriers|matériaux|puits|ferme|maison|entrepôt|dépôt|ville|chaleur|assez|aucun|aucune|reconverti|revalorisé|habitants|démolir|rénover|choisis|construire|défaite|victoire|attends|annuler|déplacer|glisser|molette|compris|printemps|automne|hiver)\b/i;
function assertEnglish(text, label) {
  assert.equal(typeof text, 'string', `${label} must expose text`);
  assert.ok(text.trim(), `${label} must not be empty`);
  const match = french.exec(text);
  assert.equal(match, null, `${label} still contains French near: ${match ? text.slice(Math.max(0, match.index - 45), match.index + 100) : ''}`);
}
function checkOutput(engine, label) {
  for (const [i, text] of engine.state.toasts.entries()) assertEnglish(text, `${label} toast ${i}`);
  for (const [i, card] of engine.state.advisorCards.entries()) {
    assertEnglish(card.who, `${label} advisor ${i}`); assertEnglish(card.text, `${label} advice ${i}`);
  }
  for (const report of engine.state.reports) {
    assertEnglish(report.title, `${label} report title`); assertEnglish(report.body, `${label} report body`);
  }
  const explanation = engine.explain();
  assertEnglish(explanation.problem, `${label} diagnostic`);
  for (const key of ['causes', 'helpful', 'actions']) for (const text of explanation[key]) assertEnglish(text, `${label} ${key}`);
  for (const item of engine.victoryProgress()) {
    assertEnglish(item.label, `${label} objective`); assertEnglish(item.detail, `${label} objective detail`);
  }
  const trajectory = engine.classifyCity();
  assertEnglish(trajectory.label, `${label} trajectory`); assertEnglish(trajectory.desc, `${label} trajectory description`);
  if (engine.state.outcomeInfo) assertEnglish(engine.state.outcomeInfo.reason, `${label} outcome`);
}

test('the catalog, districts, resources and conversion offer use English', () => {
  const names = ['House', 'Well', 'Farm', 'Workshop', 'Local market', 'Path', 'Park', 'Road', 'Thermal power plant', 'Factory', 'Central warehouse', 'Water treatment plant', 'Apartment building', 'Local depot', 'Tram', 'Maintenance center', 'Heated greenhouse', 'Recycling center'];
  assert.deepEqual(Object.values(BUILDINGS).map(b => b.name), names);
  for (const building of Object.values(BUILDINGS)) { assertEnglish(building.name, building.id); assertEnglish(building.desc, `${building.id} description`); }
  for (const district of DISTRICT_NAMES) assertEnglish(district, 'district');
  for (const value of Object.values(RES_META)) assertEnglish(value.lbl, 'resource label');
  for (const value of Object.values(REGIME_META)) { assertEnglish(value.lbl, 'regime label'); assertEnglish(value.q, 'regime question'); }
  for (const conversion of Object.values(BUILDING_CONVERSIONS)) {
    assertEnglish(conversion.name, 'conversion name'); assertEnglish(conversion.desc, 'conversion description');
    assertEnglish(conversion.profile.name, 'converted building name'); assertEnglish(conversion.profile.desc, 'converted building description');
  }
});

test('refusals, reports, advisors, diagnostics, objectives and outcomes stay in English', () => {
  const e = new CityEngine();
  assert.match(e.state.advisorCards[0].text, /pause/i);
  checkOutput(e, 'new game');
  for (const args of [['house', -1, 0], ['factory', 0, 0], ['house', 0, 2]]) assertEnglish(e.placeBlockReason(...args), 'placement refusal');
  const b = e.place('workshop', 0, 0);
  assertEnglish(e.placeBlockReason('house', 0, 0), 'occupied placement');
  assertEnglish(e.conversionBlockReason(null, 'workshop_repair'), 'missing building');
  assertEnglish(e.conversionBlockReason(b, 'unknown'), 'unknown conversion');
  assertEnglish(e.conversionBlockReason(b, 'workshop_repair'), 'locked conversion');
  e.state.phase = 3;
  assertEnglish(e.conversionBlockReason(b, 'workshop_repair'), 'young conversion');
  b.age = 24; e.state.res.money = 0;
  assertEnglish(e.placeBlockReason('house', 1, 0), 'unaffordable placement');
  assertEnglish(e.conversionBlockReason(b, 'workshop_repair'), 'unaffordable conversion');
  e.state.res.money = 100;
  assertEnglish(e.conversionBlockReason(b, 'workshop_repair'), 'missing materials');
  e.state.res.materials = 100; b.disabled = true;
  assertEnglish(e.conversionBlockReason(b, 'workshop_repair'), 'offline conversion');
  b.disabled = false;
  assert.equal(e.convertBuilding(b, 'workshop_repair'), true);
  assertEnglish(e.conversionBlockReason(b, 'workshop_repair'), 'already converted');
  e.enterPhase(2); e.fireLogisticsCrisis(); e.fireHeatCrisis(); e.fireMaintenanceCascade();
  checkOutput(e, 'events and conversion');

  for (const scenario of ['water', 'food', 'energy', 'logistics', 'heat', 'wear']) {
    const sample = new CityEngine();
    sample.state.phase = 4; sample.state.res.population = 60;
    sample.state.ratios = { foodR: 1, waterR: 1, energyR: 1, accessR: 1 };
    if (scenario === 'water') sample.state.ratios.waterR = 0.1;
    if (scenario === 'food') sample.state.ratios.foodR = 0.1;
    if (scenario === 'energy') { sample.state.unlocked.add('generator'); sample.place('generator', 12, 1); sample.state.ratios.energyR = 0.1; }
    if (scenario === 'logistics') sample.state.res.congestion = 30;
    if (scenario === 'heat') sample.state.res.heat = 50;
    if (scenario === 'wear') sample.state.res.maintenance = 50;
    sample.updateAdvisors({ congestionPressure: 3, maintHeatPressure: 1, hotResidential: 0 });
    checkOutput(sample, scenario);
  }
  for (const scenario of ['bankruptcy', 'shortage', 'collapse']) {
    const sample = new CityEngine();
    if (scenario === 'bankruptcy') { sample.state.res.money = -250; sample.bankruptTicks = 19; }
    if (scenario === 'shortage') { sample.starveTicks = 17; }
    if (scenario === 'collapse') { sample.peakPop = 100; }
    sample.checkEndStates(scenario === 'collapse' ? 10 : 30, scenario === 'shortage' ? 0 : 1, 1);
    assert.equal(sample.state.outcome, 'defeat'); checkOutput(sample, scenario);
  }
  const winner = playSober(true);
  assert.equal(winner.state.outcome, 'victory'); checkOutput(winner, 'completed city');
});

test('the default English player copy excludes French outside the language choice', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<html\b[^>]*\blang="en"/i);
  // The French language names itself in its option; the rest of the English
  // document, including the selector's accessible label, remains checked.
  const visibleDocument = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/(<option\b[^>]*\bvalue=["']fr["'][^>]*>)\s*Français\s*(<\/option>)/gi, '$1French$2');
  assertEnglish(visibleDocument, 'game HTML, tooltips and accessibility labels');
  for (const file of ['data.js', 'engine.js', 'ui.js', 'main.js', 'render3d.js', 'diorama-assets.js']) {
    const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
    const { code } = await esbuild.transform(source, { loader: 'js', legalComments: 'none', charset: 'utf8', minifyWhitespace: true });
    assertEnglish(code, `${file} runtime copy (comments removed)`);
  }
});
