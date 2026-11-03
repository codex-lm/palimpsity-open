import test from 'node:test';
import assert from 'node:assert/strict';
import { CityEngine } from '../src/engine.js';
import { BUILDINGS } from '../src/data.js';
import { PACT, CHARTERS, RiverCityEngine, RiverPact } from '../src/river-pact.js';
import { riverRoute } from './river-routes.mjs';
import { translate } from '../src/localization.js';

for (const charter of ['gardens','workshops']) test(`normal 600 EUR route: ${charter} survives the real drought and wins`, () => {
  const {engine,pact,actions} = riverRoute(charter);
  assert.equal(pact.status,'success',JSON.stringify(pact.progress()));
  assert.equal(pact.finishedAtTick,161);
  assert.equal(pact.droughtHeld,true);
  assert.ok(engine.state.res.population >= 48);
  assert.equal(engine.state.outcome,null,'the original victory is not claimed');
  assert.deepEqual([...pact._paid], ['act1',`charter:${charter}`,'act2',...(charter === 'workshops' ? ['delivery'] : [])]);
  assert.ok(actions.every(a => a.charter || Object.hasOwn(BUILDINGS,a.build)));
  const snapshot=JSON.stringify({state:engine.state,progress:pact.progress()});
  pact.update(); pact.chooseCharter(charter === 'gardens' ? 'workshops' : 'gardens');
  assert.equal(JSON.stringify({state:engine.state,progress:pact.progress()}),snapshot);
});

test('real output is reduced on exactly turns 120–149; base engine and catalogue stay unchanged', () => {
  const catalogue=JSON.stringify(BUILDINGS);
  const river=new RiverCityEngine(), base=new CityEngine();
  const rw=river.place('well',0,0), bw=base.place('well',0,0);
  for(let t=1;t<=151;t++) {
    river.tick(); base.tick();
    const multiplier=t>=120 && t<150 ? .55 : 1;
    assert.ok(Math.abs(rw.flowOutput.water - bw.flowOutput.water*multiplier)<1e-8,`actual water at turn ${t}`);
    assert.equal(river.weather().multiplier,multiplier);
    assert.equal(base.profileOf(bw),BUILDINGS.well);
    assert.equal(river.profileOf(rw).inputs,BUILDINGS.well.inputs);
  }
  assert.equal(JSON.stringify(BUILDINGS),catalogue);
});

// Synthetic snapshots below isolate controller boundaries, not playability.
function fixture(stage=0,tick=0,charter=null) {
  const buildings=[];
  for(const r of [0,6]) for(const [id,count] of [['house',2],['park',2],['well',2],['workshop',1],['market',1]]) {
    for(let i=0;i<count;i++) buildings.push({def:BUILDINGS[id],c:0,r,activity:1,disabled:false});
  }
  const engine={ state:{tick,speed:0,outcome:null,res:{population:60,money:600,materials:100},ratios:{foodR:1,waterR:1},buildings,
    districts:[0,1,2,3].map(id=>({name:`district ${id}`,demand:id%2===0?30:0,foodCoverage:1,waterCoverage:1,access:1})),toasts:[]},
    toast(message){this.state.toasts.push(message);},
    weather(){const t=this.state.tick;return {kind:t<120?'normal':t<150?'drought':'recovery',multiplier:t>=120&&t<150?.55:1,startsAt:120,endsAt:150};} };
  const pact=new RiverPact(engine);pact.stage=stage;pact.charter=charter;pact.countedTick=tick;
  const step=(n=1)=>{for(let i=0;i<n;i++){engine.state.tick++;pact.update();}};
  return {engine,pact,step};
}

test('pause, duplicate, backwards and skipped callbacks cannot fabricate consecutive turns',()=>{
  const {engine:e,pact:p,step}=fixture();
  p.update(); assert.equal(p.streak,0);
  step(2); assert.equal(p.streak,2);
  for(let i=0;i<8;i++)p.update(); assert.equal(p.streak,2);
  e.state.tick=1;p.update();assert.equal(p.streak,2);
  e.state.tick=8;p.update();assert.equal(p.streak,1);
  e.state.ratios.waterR=.2;step();assert.equal(p.streak,0);
  e.state.ratios.waterR=1;step(4);assert.equal(p.awaitingCharter,true);
});

test('charter choice and milestone rewards are atomic, single-use and reject inherited keys',()=>{
  const {engine:e,pact:p,step}=fixture();
  assert.equal(p.chooseCharter('gardens'),false);
  step(4);assert.equal(e.state.res.money,800);assert.equal(p.canAdvance,false);
  for(const id of ['constructor','__proto__','missing',null])assert.equal(p.chooseCharter(id),false);
  assert.equal(e.state.res.money,800);
  assert.equal(p.chooseCharter('workshops'),true);assert.equal(e.state.res.money,1000);
  assert.equal(p.chooseCharter('gardens'),false);
  step(4);assert.equal(p.stage,2);assert.equal(e.state.res.money,1100);assert.equal(e.state.res.materials,60);
  step(10);assert.equal(e.state.res.money,1100);assert.equal(e.state.res.materials,60);
});

test('both charter obligations must belong to the same two supplied districts',()=>{
  const {engine:e,pact:p,step}=fixture(1,20,'gardens');
  for(const b of e.state.buildings)if(b.def.id==='park' && b.r===6)b.disabled=true;
  step(6);assert.equal(p.stage,1);assert.equal(p.streak,0);
  for(const b of e.state.buildings)b.disabled=false;
  step(4);assert.equal(p.stage,2);
});

test('an inactive workshop cannot satisfy the makers charter',()=>{
  const {engine:e,pact:p,step}=fixture(1,20,'workshops');
  e.state.buildings.find(b=>b.def.id==='workshop').activity=0;
  step(5);assert.equal(p.stage,1);
});

test('materials are not consumed until every second-act goal holds for four turns',()=>{
  const {engine:e,pact:p,step}=fixture(1,20,'workshops');
  e.state.res.materials=39;step(5);assert.equal(p.stage,1);assert.equal(e.state.res.materials,39);
  e.state.res.materials=40;step(3);assert.equal(e.state.res.materials,40);
  step();assert.equal(e.state.res.materials,0);assert.equal(p.stage,2);
});

test('drought streak resets on lost supply, then remains achieved after twelve consecutive turns',()=>{
  const {engine:e,pact:p,step}=fixture(2,119,'gardens');
  assert.equal(p.progress().rows.find(row=>row.key==='population').met,false,'post-drought goal is not marked complete early');
  step(3);assert.equal(p.droughtStreak,3);
  e.state.districts[0].waterCoverage=.2;step();assert.equal(p.droughtStreak,0);
  e.state.districts[0].waterCoverage=1;step(12);assert.equal(p.droughtHeld,true);
  e.state.res.population=10;step();assert.equal(p.droughtHeld,true);assert.equal(p.droughtStreak,0);
});

test('skipping the drought cannot create a victory, even from an otherwise ready city',()=>{
  const {engine:e,pact:p}=fixture(2,149,'gardens');
  p.streak=11;e.state.tick=240;p.update();
  assert.equal(p.status,'failed');assert.equal(p.failReason,'drought');
});

test('an unprepared city fails when the drought ends and freezes its result',()=>{
  const {engine:e,pact:p,step}=fixture(2,119,'gardens');
  e.state.res.population=20;step(31);
  assert.equal(p.status,'failed');assert.equal(p.failReason,'drought');assert.equal(p.finishedAtTick,150);
  e.state.res.population=60;step(10);assert.equal(p.finishedAtTick,150);assert.equal(p.canAdvance,false);
});

test('success on turn 240 takes priority over the absolute deadline',()=>{
  const {pact:p,step}=fixture(2,239,'gardens');p.droughtHeld=true;p.streak=11;
  step();assert.equal(p.status,'success');assert.equal(p.finishedAtTick,240);
});

test('deadline and engine collapse are explicit failures, with collapse taking priority',()=>{
  const a=fixture(2,239,'gardens');a.pact.droughtHeld=true;a.step();
  assert.equal(a.pact.failReason,'deadline');
  const b=fixture(2,239,'gardens');b.pact.droughtHeld=true;b.pact.streak=11;b.engine.state.outcome='defeat';b.step();
  assert.equal(b.pact.failReason,'collapse');assert.equal(b.pact.status,'failed');
});

test('restart and classic city retain natural money, unlocks, weather and original goals',()=>{
  const e=new RiverCityEngine(), p=new RiverPact(e), classic=new CityEngine();
  assert.equal(e.state.res.money,600);assert.equal(e.state.buildings.length,0);assert.equal(p.stage,0);
  assert.equal(p.charter,null);assert.equal(p.droughtHeld,false);assert.equal(e.weather().kind,'normal');
  assert.deepEqual(e.state.unlocked,classic.state.unlocked);
  assert.deepEqual(e.victoryProgress(),classic.victoryProgress());
  assert.ok(Object.isFrozen(PACT.drought));assert.ok(Object.isFrozen(CHARTERS.workshops));
});

test('the scenario goals and notifications translate live into French',()=>{
  for (const charter of ['gardens','workshops']) {
    for (const stage of [0,1,2]) {
      const {pact:p}=fixture(stage,stage===2?125:20,charter);
      for (const row of p.progress().rows) {
        assert.notEqual(translate(row.label,'fr'),row.label,`label: ${row.label}`);
        if (!/^(NW|NE|SW|SE):/.test(row.detail)) assert.notEqual(translate(row.detail,'fr'),row.detail,`detail: ${row.detail}`);
      }
    }
  }
  for (const message of [
    'River Pact: build the first district. The drought arrives on turn 120. Pauses are free.',
    'The council grants 200 €. Choose a civic charter.', 'Garden commons signed: +100 €.',
    'Civic delivery: 40 materials consumed.', 'Two living districts: +100 €. Prepare for the drought on turn 120.',
    'Drought: water output is 55% on turns 120–149.', 'The river has recovered. Hold 48 residents and both districts for 12 turns.'
  ]) assert.notEqual(translate(message,'fr'),message);
});
