import assert from 'node:assert/strict';
import { RiverCityEngine, RiverPact } from '../src/river-pact.js';
import { BUILDINGS, COLS, ROWS, districtOf } from '../src/data.js';

// Ordinary player actions only. Every simulation step calls the controller.
export function riverRoute(charter, stopAt = 240) {
  const engine = new RiverCityEngine(), pact = new RiverPact(engine), actions = [];
  const step = () => {
    assert.ok(pact.canAdvance && !engine.state.outcome, JSON.stringify(pact.progress()));
    engine.tick(); pact.update();
  };
  const buy = (id, count, district) => {
    for (let i = 0; i < count; i++) {
      assert.ok(engine.state.unlocked.has(id));
      while (engine.state.res.money < BUILDINGS[id].cost.money) step();
      const cells = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (districtOf(c,r) === district && engine.canPlace(id,c,r)) cells.push([c,r]);
      }
      if (id === 'farm') cells.sort((a,b) => Number(engine.terrain[b[1]][b[0]] === 2) - Number(engine.terrain[a[1]][a[0]] === 2));
      assert.ok(cells.length, `No site for ${id}`);
      const [c,r] = cells[0];
      assert.ok(engine.place(id,c,r));
      actions.push({tick:engine.state.tick,build:id,c,r});
    }
  };
  assert.equal(engine.state.res.money, 600);
  pact.start();
  buy('house',5,2); buy('well',2,2); buy('farm',1,2); buy('market',1,2);
  while (!pact.awaitingCharter && pact.canAdvance) step();
  assert.ok(pact.awaitingCharter);
  assert.ok(pact.chooseCharter(charter));
  actions.push({tick:engine.state.tick,charter});
  buy('well',1,2); buy('farm',1,2); buy('park',charter === 'gardens' ? 2 : 1,2);
  if (charter === 'workshops') buy('workshop',1,2);
  buy('house',5,0); buy('well',3,0); buy('farm',2,0); buy('market',1,0);
  buy('park',charter === 'gardens' ? 2 : 1,0);
  if (charter === 'workshops') buy('workshop',1,0);
  while (pact.canAdvance && engine.state.tick < stopAt) step();
  return {engine,pact,actions,step,buy};
}
