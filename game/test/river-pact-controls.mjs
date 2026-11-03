import test from 'node:test';
import assert from 'node:assert/strict';
import { CityEngine } from '../src/engine.js';
import { advanceRiverTurns } from '../src/river-pact-controls.js';

test('five-turn action runs real simulation turns and leaves the city paused', () => {
  const engine = new CityEngine();
  engine.state.speed = 3;
  const observed = [];
  const pact = { canAdvance: true, update() { observed.push(engine.state.tick); } };
  assert.equal(advanceRiverTurns(engine, pact), 5);
  assert.deepEqual(observed, [1, 2, 3, 4, 5]);
  assert.equal(engine.state.speed, 0);
  assert.equal(advanceRiverTurns(engine, pact, 999), 5, 'a click never advances more than five turns');
  assert.equal(engine.state.tick, 10);
});

test('a council or result in the middle of a batch stops without an extra turn', () => {
  const engine = new CityEngine();
  const pact = { canAdvance: true, update() { if (engine.state.tick === 3) this.canAdvance = false; } };
  assert.equal(advanceRiverTurns(engine, pact), 3);
  const snapshot = JSON.stringify(engine.state);
  assert.equal(advanceRiverTurns(engine, pact), 0, 'repeated click cannot bypass the council');
  assert.equal(JSON.stringify(engine.state), snapshot);
  pact.canAdvance = true;
  assert.equal(advanceRiverTurns(engine, pact), 5, 'a later valid choice resumes from the actual tick');
  assert.equal(engine.state.tick, 8);
});

test('the action cannot advance classic mode or an ended city', () => {
  const engine = new CityEngine();
  assert.equal(advanceRiverTurns(engine, null), 0);
  engine.state.outcome = 'defeat';
  assert.equal(advanceRiverTurns(engine, { canAdvance: true, update() { throw Error('must not run'); } }), 0);
  assert.equal(engine.state.tick, 0);
});
