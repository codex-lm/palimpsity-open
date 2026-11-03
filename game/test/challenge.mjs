/* First Neighbourhood challenge contracts.
 * Run: node --test test/challenge.mjs
 * The success route is a real playthrough: initial 600 EUR, naturally
 * unlocked buildings only, no injected money or content. State stubs are
 * used only to isolate deadline/counting rules, not as progression evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CityEngine, VICTORY_POP } from '../src/engine.js';
import {
  CHALLENGE, BEST_STORAGE_KEY, FirstNeighbourhood,
  formatSimTime, readBestTime, writeBestTime,
  shouldAdvance, applyHiddenPause,
} from '../src/challenge.js';
import { translate } from '../src/localization.js';
import { buy, summary } from './playthrough-helpers.mjs';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, String(value)); } };
}
function stubEngine({ tick = 0, population = 0, money = 600, foodR = 0, waterR = 0, outcome = null } = {}) {
  return { state: { tick, res: { population, money }, ratios: { foodR, waterR }, outcome, outcomeInfo: null, toasts: [] } };
}
function healthyStub(tick) {
  return stubEngine({ tick, population: CHALLENGE.targetPop + 6, money: 120, foodR: 1, waterR: 1 });
}

test('normal budget route: the challenge is winnable well before the deadline', () => {
  const e = new CityEngine();
  assert.equal(e.state.res.money, 600);
  const ch = new FirstNeighbourhood(e, { storage: storage() });
  ch.start();
  assert.match(e.state.toasts.at(-1), /First Neighbourhood/);
  // An opening any player can afford at once: homes, water, food, distribution.
  buy(e, 'house', 5, { district: 2 });
  buy(e, 'well', 2, { district: 2 });
  buy(e, 'farm', 1, { district: 2 });
  buy(e, 'market', 1, { district: 2 });
  assert.ok(e.state.res.money >= 0, `The opening stays within the 600 EUR budget: ${JSON.stringify(summary(e))}`);
  for (let t = 0; t < CHALLENGE.deadlineTicks && ch.status === 'running'; t++) { e.tick(); ch.update(); }
  assert.equal(ch.status, 'success', JSON.stringify({ ...summary(e), goals: ch.goalRows() }));
  assert.ok(e.state.res.population >= CHALLENGE.targetPop);
  assert.ok(ch.finishedAtTick <= CHALLENGE.deadlineTicks);
  assert.equal(e.state.outcome, null, 'The classic victory/defeat is not claimed by the challenge');
});

test('timeout: an empty city fails exactly at the deadline turn', () => {
  const e = new CityEngine();
  const ch = new FirstNeighbourhood(e);
  for (let t = 0; t < CHALLENGE.deadlineTicks - 1; t++) { e.tick(); ch.update(); }
  assert.equal(ch.status, 'running');
  assert.equal(ch.progress().ticksRemaining, 1);
  e.tick(); ch.update();
  assert.equal(e.state.tick, CHALLENGE.deadlineTicks);
  assert.equal(ch.status, 'failed');
  assert.equal(ch.failReason, 'deadline');
  assert.equal(ch.finishedAtTick, CHALLENGE.deadlineTicks);
  ch.update();
  assert.equal(ch.finishedAtTick, CHALLENGE.deadlineTicks, 'A finished challenge never moves again');
});

test('boundary: success completed on the exact deadline turn wins over the deadline', () => {
  const win = new FirstNeighbourhood(healthyStub(CHALLENGE.deadlineTicks));
  win.streak = CHALLENGE.sustainTicks - 1;
  win.update();
  assert.equal(win.status, 'success');
  assert.equal(win.finishedAtTick, CHALLENGE.deadlineTicks);
  const lose = new FirstNeighbourhood(stubEngine({ tick: CHALLENGE.deadlineTicks }));
  lose.update();
  assert.equal(lose.status, 'failed');
  assert.equal(lose.failReason, 'deadline');
});

test('an engine defeat during the challenge fails the challenge, without claiming classic victory', () => {
  const engine = healthyStub(40);
  engine.state.outcome = 'defeat';
  engine.state.outcomeInfo = { reason: 'Essential supply crisis: food or water is not reaching residents.' };
  const ch = new FirstNeighbourhood(engine);
  ch.streak = 3;
  ch.update();
  assert.equal(ch.status, 'failed');
  assert.equal(ch.failReason, 'collapse');
});

test('paused or hidden play never advances the challenge clock', () => {
  const engine = healthyStub(50);
  const ch = new FirstNeighbourhood(engine);
  ch.update();
  assert.equal(ch.streak, 1);
  ch.update(); ch.update(); // refreshes without a new tick: nothing moves
  assert.equal(ch.streak, 1);
  assert.equal(ch.progress().ticksRemaining, CHALLENGE.deadlineTicks - 50);
  engine.state.tick = 51; // one real simulation turn
  ch.update();
  assert.equal(ch.streak, 2);
});

test('a broken streak restarts the consecutive count from zero', () => {
  const engine = healthyStub(10);
  const ch = new FirstNeighbourhood(engine);
  ch.update(); ch.update();
  engine.state.tick = 11;
  engine.state.res.money = -4; // finances break the streak
  ch.update();
  assert.equal(ch.streak, 0);
  engine.state.tick = 12;
  engine.state.res.money = 10;
  ch.update();
  assert.equal(ch.streak, 1);
});

test('local best completion time persists and only improves', () => {
  const store = storage();
  const fast = new FirstNeighbourhood(healthyStub(30), { storage: store });
  fast.streak = CHALLENGE.sustainTicks - 1;
  fast.update();
  assert.equal(fast.status, 'success');
  assert.equal(fast.newBest, true);
  assert.equal(store.getItem(BEST_STORAGE_KEY), '30');
  assert.equal(readBestTime(store), 30);
  const slower = new FirstNeighbourhood(healthyStub(80), { storage: store });
  slower.streak = CHALLENGE.sustainTicks - 1;
  slower.update();
  assert.equal(slower.status, 'success');
  assert.equal(slower.newBest, false, 'A slower completion does not overwrite the record');
  assert.equal(readBestTime(store), 30);
  const faster = new FirstNeighbourhood(healthyStub(20), { storage: store });
  faster.streak = CHALLENGE.sustainTicks - 1;
  faster.update();
  assert.equal(faster.newBest, true);
  assert.equal(readBestTime(store), 20);
});

test('storage errors and corrupt values never break the challenge', () => {
  for (const bad of ['abc', '-5', '0', '0.2', '7', '20.5', '121', '1.5.2', 'NaN', 'Infinity', '{}']) {
    assert.equal(readBestTime(storage({ [BEST_STORAGE_KEY]: bad })), null, `corrupt value ${bad}`);
  }
  assert.equal(readBestTime(storage({ [BEST_STORAGE_KEY]: '42' })), 42);
  assert.equal(readBestTime(null), null);
  assert.equal(writeBestTime(null, 30), false);
  assert.equal(writeBestTime(storage(), 20.5), false);
  const absent = new FirstNeighbourhood(healthyStub(30));
  absent.streak = CHALLENGE.sustainTicks - 1;
  absent.update();
  assert.equal(absent.newBest, false, 'Missing storage cannot confirm a saved record');
  const denied = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  const ch = new FirstNeighbourhood(healthyStub(30), { storage: denied });
  ch.streak = CHALLENGE.sustainTicks - 1;
  assert.doesNotThrow(() => ch.update());
  assert.equal(ch.status, 'success');
  assert.equal(ch.newBest, false, 'A denied storage cannot confirm a saved record');
  assert.equal(writeBestTime(denied, 30), false);
});

test('restart: a fresh engine and controller restart the challenge cleanly', () => {
  const first = new CityEngine();
  const ch1 = new FirstNeighbourhood(first, { storage: storage() });
  buy(ch1.engine, 'house', 2);
  for (let t = 0; t < 10; t++) { first.tick(); ch1.update(); }
  assert.ok(first.state.tick > 0);
  const second = new CityEngine(); // what main.js creates on every mode switch
  const ch2 = new FirstNeighbourhood(second, { storage: storage() });
  assert.equal(second.state.tick, 0);
  assert.equal(second.state.res.money, 600);
  assert.equal(second.state.buildings.length, 0);
  assert.ok(second.state.unlocked.has('house') && !second.state.unlocked.has('factory'), 'natural initial unlocks');
  assert.equal(ch2.status, 'running');
  assert.equal(ch2.streak, 0);
  assert.equal(ch2.progress().ticksRemaining, CHALLENGE.deadlineTicks);
  assert.ok(ch1.status === 'running', 'The abandoned run stays untouched');
});

test('classic mode is untouched: no challenge coupling and unchanged victory contract', () => {
  const e = new CityEngine();
  assert.equal(VICTORY_POP, 180);
  assert.deepEqual(e.victoryProgress().map(p => p.key),
    ['population', 'maturity', 'resources', 'distribution', 'resilience', 'heat', 'economy', 'stability']);
  const snapshot = JSON.stringify(e.state);
  const probe = new FirstNeighbourhood(e); // a controller reading an engine must not mutate it
  probe.update();
  probe.goalRows();
  probe.progress();
  assert.equal(JSON.stringify(e.state), snapshot);
  for (let i = 0; i < 5; i++) e.tick();
  assert.equal(e.state.outcome, null);
});

test('all new player-facing strings have live French translations', () => {
  const exact = [
    'First Neighbourhood', 'Classic city', 'Start the First Neighbourhood challenge',
    'Return to the classic city', 'Reach 24 residents', 'Keep food and water healthy',
    'Keep finances non-negative', 'Hold everything together',
    'You can pause freely: only simulation turns count (0.6 s each).',
    'Challenge completed', 'Out of time', 'Try again', 'Back to classic city',
    'New best time!', "A side challenge — the Thriving city victory stays the classic mode's goal.",
  ];
  for (const text of exact) assert.notEqual(translate(text, 'fr'), text, `missing FR for: ${text}`);
  const dynamic = [
    ['Turn 23/120 · 1:12 left · 3/8 held', /Tour 23\/120 .* 3\/8 tenus/],
    ['Best: 0:45', /Record : 0:45/],
    ['First Neighbourhood · 2/4', /Premier quartier · 2\/4/],
    ['Food 92% · water 100% · need 85%', /Nourriture 92 % .* 85 % requis/],
    ['Balance 523 €', /Solde 523 €/],
    ['3 / 8 consecutive turns', /3 \/ 8 tours consécutifs/],
    ['Goals held together at turn 40 · simulation time 0:24.', /tour 40 .* 0:24/],
    ['Turn 120 arrived before every goal held together.', /tour 120/],
    ['The city collapsed first: Essential supply crisis: food or water is not reaching residents.', /effondrée/],
    ['Best completion: 0:24', /Meilleur temps : 0:24/],
    ['First Neighbourhood: reach 24 residents with healthy food, water and finances for 8 consecutive turns, before turn 120.', /Premier quartier : atteins 24 habitants/],
  ];
  for (const [text, pattern] of dynamic) assert.match(translate(text, 'fr'), pattern, `missing FR template for: ${text}`);
  assert.equal(translate('First Neighbourhood', 'en'), 'First Neighbourhood');
});

test('visibility helper: hidden pause clears speed, accumulator and timing; resume is manual', () => {
  const e = new CityEngine();
  e.state.speed = 3;
  const clock = { acc: 450, last: 1000 };
  const wasRunning = applyHiddenPause(e, clock, 4200);
  assert.equal(wasRunning, true);
  assert.equal(e.state.speed, 0);
  assert.equal(clock.acc, 0);
  assert.equal(clock.last, 4200);
  assert.equal(shouldAdvance(e, true), false, 'hidden tab: no simulation advance');
  assert.equal(shouldAdvance(e, false), false, 'back visible: still paused until the player resumes');
  e.state.speed = 1;
  assert.equal(shouldAdvance(e, false), true);
  assert.equal(shouldAdvance(e, true), false);
  e.state.outcome = 'defeat';
  assert.equal(shouldAdvance(e, false), false, 'a finished city never advances');
});

test('simulation time formatting stays honest (600 ms per turn)', () => {
  assert.equal(CHALLENGE.tickMs, 600);
  assert.equal(formatSimTime(0), '0:00');
  assert.equal(formatSimTime(120), '1:12');
  assert.equal(formatSimTime(20), '0:12');
});

test('finished challenge cannot advance even if a speed shortcut is used again', () => {
  const e = new CityEngine();
  e.state.speed = 3;
  assert.equal(shouldAdvance(e, false, { status: 'running' }), true);
  for (const status of ['success', 'failed']) assert.equal(shouldAdvance(e, false, { status }), false);
  assert.equal(shouldAdvance(e, false), true, 'Classic city remains independent');
});
