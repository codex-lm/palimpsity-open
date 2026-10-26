/* Reachability through ordinary player actions, not an unlocked, funded fixture. */
import assert from 'node:assert/strict';
import { VICTORY_POP } from '../src/engine.js';
import { playSober, playIndustrial, summary } from './playthrough-helpers.mjs';

for (const [name, play] of [
  ['Sobre, entretien précoce', () => playSober(true)],
  ['Sobre, réparation tardive', () => playSober(false)],
  ['Industrielle, adaptation aux crises', () => playIndustrial()],
]) {
  const engine = play();
  assert.equal(engine.state.outcome, 'victory', name + ': ' + JSON.stringify(summary(engine)));
  assert.ok(engine.state.res.population >= VICTORY_POP);
  assert.ok(engine.victoryProgress().every(item => item.met), name + ': objectives must match the end screen');
  console.log(name + ': ' + JSON.stringify(summary(engine)));
}
console.log('PASS — trois victoires depuis 600 €, avec déblocages naturels.');
