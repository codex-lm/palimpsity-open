/* UI contract tests with a small DOM boundary and real CityEngine transactions.
 * This does not launch a browser or validate layout/WebGL. The focused-control
 * boundary models how replacing innerHTML detaches an active button.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { UI } from '../src/ui.js';
import { CityEngine } from '../src/engine.js';
import { Renderer3D } from '../src/render3d.js';

class InspectorBoundary {
  constructor() {
    this._html = ''; this.children = []; this.classList = { add() {}, remove() {} };
  }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    if (this.contains(document.activeElement)) document.activeElement = null;
    this._html = html;
    this.children = [...html.matchAll(/<button\b([^>]*)>/g)].map(([, attributes]) => {
      const id = /\bid="([^"]+)"/.exec(attributes)?.[1];
      const conversion = /\bdata-conversion="([^"]+)"/.exec(attributes)?.[1];
      const control = { id, dataset: conversion ? { conversion } : {}, disabled: /\bdisabled\b/.test(attributes) };
      control.focus = () => { document.activeElement = control; };
      return control;
    });
    this.converted = html.includes('class="insp-conversion converted"')
      ? { focus() { document.activeElement = this; } } : null;
  }
  contains(element) { return !!element && (this.children.includes(element) || element === this.converted); }
  querySelectorAll(selector) { return selector === '[data-conversion]' ? this.children.filter(x => x.dataset.conversion) : []; }
  querySelector(selector) {
    if (selector === '.converted') return this.converted;
    if (selector.startsWith('#')) return this.children.find(x => x.id === selector.slice(1)) || null;
    const id = /\[data-conversion="([^"]+)"\]/.exec(selector)?.[1];
    return this.children.find(x => x.dataset.conversion === id) || null;
  }
  scrollIntoView() { this.scrolled = true; }
}

function fixture() {
  const engine = new CityEngine();
  const workshop = engine.place('workshop', 1, 7);
  const inspector = new InspectorBoundary();
  globalThis.document = { activeElement: null, getElementById: id => inspector.querySelector('#' + id) };
  let syncs = 0;
  const ui = {
    engine, renderer: { sync() { syncs++; } },
    $: { inspector, 'objectives-summary': {}, 'objectives-list': {} },
    showInspector: UI.prototype.showInspector,
    update() { this.showInspector(this.inspectBuilding); UI.prototype.renderObjectives.call(this); },
  };
  return { engine, workshop, inspector, ui, syncs: () => syncs };
}

test('l’inspecteur explique la condition bloquante et désactive la rénovation', () => {
  const { engine, workshop, inspector, ui } = fixture();
  ui.showInspector(workshop);
  const option = engine.conversionOptions(workshop)[0];
  assert.ok(option.reason);
  assert.ok(inspector.innerHTML.includes(option.reason));
  assert.equal(inspector.querySelectorAll('[data-conversion]')[0].disabled, true);
});

test('la commande de rénovation paie le moteur, actualise le profil et conserve le modèle', () => {
  const { engine, workshop, inspector, ui, syncs } = fixture();
  engine.state.phase = 3; workshop.age = 30; engine.state.res.materials = 40;
  const option = engine.conversionOptions(workshop)[0];
  const before = { money: engine.state.res.money, materials: engine.state.res.materials, def: workshop.def };
  ui.showInspector(workshop);
  inspector.querySelectorAll('[data-conversion]')[0].onclick();
  assert.equal(workshop.conversion, option.id);
  assert.equal(engine.state.res.money, before.money - option.cost.money);
  assert.equal(engine.state.res.materials, before.materials - option.cost.materials);
  assert.equal(workshop.def, before.def);
  assert.ok(inspector.innerHTML.includes(engine.profileOf(workshop).name));
  assert.equal(inspector.querySelectorAll('[data-conversion]').length, 0);
  assert.equal(document.activeElement, inspector.converted);
  assert.equal(syncs(), 1);
});

test('un contrôle devenu périmé ne rénove pas un bâtiment démoli', () => {
  const { engine, workshop, inspector, ui, syncs } = fixture();
  engine.state.phase = 3; workshop.age = 30; engine.state.res.materials = 40;
  ui.showInspector(workshop);
  const stale = inspector.querySelectorAll('[data-conversion]')[0];
  engine.removeAt(workshop.c, workshop.r);
  const money = engine.state.res.money;
  stale.onclick();
  assert.equal(engine.state.res.money, money);
  assert.equal(syncs(), 0);
  assert.equal(inspector.innerHTML, '');
  assert.match(engine.state.toasts.at(-1), /no longer exists|does not exist/i);
});

test('le rafraîchissement en cours de partie préserve le focus de la rénovation', () => {
  const { engine, workshop, inspector, ui } = fixture();
  engine.state.phase = 3; workshop.age = 30; engine.state.res.materials = 40;
  ui.showInspector(workshop);
  const before = inspector.querySelectorAll('[data-conversion]')[0];
  before.focus();
  workshop.age++;
  ui.showInspector(workshop);
  const after = inspector.querySelectorAll('[data-conversion]')[0];
  assert.notEqual(before, after, 'The changed age rebuilt the inspector');
  assert.equal(document.activeElement, after, 'The keyboard target remains usable between ticks');
});

test('les objectifs visibles utilisent les critères et détails actuels du moteur', () => {
  const { engine, ui } = fixture();
  UI.prototype.renderObjectives.call(ui);
  for (const item of engine.victoryProgress()) {
    assert.ok(ui.$['objectives-list'].innerHTML.includes(item.label));
    assert.ok(ui.$['objectives-list'].innerHTML.includes(item.detail));
    assert.ok(ui.$['objectives-list'].innerHTML.includes(`data-objective="${item.key}"`));
  }
  assert.ok(ui.$['objectives-summary'].innerHTML.includes('/' + engine.victoryProgress().length));
});

function lensFixture(lens) {
  const engine = new CityEngine();
  const building = engine.place('workshop', 0, 0);
  building.age = 130; building.grossMaintenance = 0.64;
  engine.state.districts = [{ demand: 6, access: 0.25, maintenanceCovered: 0 }];
  const mesh = { visible: false, material: { color: new THREE.Color(), opacity: 0 }, userData: { baseTop: 0x7fb35a } };
  return { engine, mesh, context: { engine, lens, overlays: [{ c: 0, r: 0, mesh }], _lensColors: { [lens]: [new THREE.Color('#cce1cc'), new THREE.Color('#ba5c45')] } } };
}

test('la lentille logistique montre le défaut de desserte même sans congestion', () => {
  const { engine, mesh, context } = lensFixture('logistics');
  assert.equal(engine.congField[0][0], 0);
  Renderer3D.prototype.applyLens.call(context);
  assert.equal(mesh.visible, true);
  engine.state.districts[0].access = 1;
  Renderer3D.prototype.applyLens.call(context);
  assert.equal(mesh.visible, false);
});

test('la lentille usure tient compte de l’entretien plutôt que du seul âge', () => {
  const { engine, mesh, context } = lensFixture('maintenance');
  Renderer3D.prototype.applyLens.call(context);
  const unattended = mesh.material.color.getHex();
  engine.state.districts[0].maintenanceCovered = 1;
  Renderer3D.prototype.applyLens.call(context);
  assert.equal(engine.state.buildings[0].age, 130);
  assert.notEqual(mesh.material.color.getHex(), unattended);
  assert.equal(mesh.material.color.getHex(), context._lensColors.maintenance[0].getHex());
});

function focusFixture() {
  const control = visible => ({
    isConnected: true,
    closest() { return null; },
    getClientRects() { return visible ? [{}] : []; },
    setAttribute() {},
    focus() { document.activeElement = this; },
  });
  const canvas = control(true), toggle = control(true), display = control(true), hidden = control(false);
  globalThis.document = {
    activeElement: null,
    body: { classList: { toggle() {} } },
    getElementById(id) { return id === 'cv' ? canvas : null; },
  };
  return { canvas, toggle, display, hidden };
}

test('la fermeture du tiroir cible le bouton visible puis le canvas en repli', () => {
  const { canvas, toggle } = focusFixture();
  const ui = { sideOpen: true, $: { 'side-toggle': toggle } };
  UI.prototype.setSideOpen.call(ui, false);
  assert.equal(document.activeElement, toggle);
  toggle.getClientRects = () => [];
  ui.sideOpen = true;
  UI.prototype.setSideOpen.call(ui, false);
  assert.equal(document.activeElement, canvas);
});

test('la sortie photo ignore les retours masqués par CSS et garde un focus visible', () => {
  const { canvas, toggle, display, hidden } = focusFixture();
  const ui = {
    photoMode: true, photoTime: 'day', photoReturnFocus: hidden,
    renderer: { setPhotoMode() {} }, h: { onPhotoMode() {} },
    $: { 'photo-controls': toggle, 'display-toggle': display },
  };
  UI.prototype.setPhotoMode.call(ui, false);
  assert.equal(document.activeElement, display);
  display.getClientRects = () => [];
  ui.photoMode = true;
  UI.prototype.setPhotoMode.call(ui, false);
  assert.equal(document.activeElement, canvas);
});

test('le refund affiché vient du crédit réel et P reste inerte derrière une modale', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /const moneyBefore = engine\.state\.res\.money/);
  assert.match(source, /engine\.state\.res\.money - moneyBefore/);
  assert.doesNotMatch(source, /building\.def\.cost\?\.money[^\n]*0\.4/);
  assert.match(source, /document\.querySelector\("#modal\.on, #end\.on, #challenge-end\.on, #river-dialog\.on"\)\) return/);
});

test('les contrôles mobiles du défi et du statut conservent leurs propres zones', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /#challenge\{position:fixed;top:94px;right:10px/);
  assert.match(html, /#placement-status\{bottom:145px;max-width:calc\(100vw - 20px\)\}/);
});

test('A3 sépare charge et apport d’entretien, coût argent et singuliers', () => {
  const engine = new CityEngine();
  engine.state.phase = 4; engine.state.res.money = 1000; engine.state.res.materials = 100;
  const house = engine.place('house', 0, 0);
  const singular = UI.prototype.renderTransformationPreview.call({}, engine.transformationOptions(house).find(option => option.id === 'variant_1'));
  assert.match(singular, /1 floor/);
  assert.match(singular, /1 material/);
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  assert.equal(engine.transformBuilding(house, 'add_floor'), true);
  const option = engine.transformationOptions(house).find(item => item.id === 'add_floor');
  const demand = UI.prototype.renderTransformationPreview.call({}, option);
  assert.match(demand, /Maintenance demand \(engine units\)/);
  assert.match(demand, /Upkeep \(€ \/ turn\)/);
  assert.match(demand, /data-tone="cost"/);
  const provided = UI.prototype.renderTransformationPreview.call({}, {
    ...option,
    before: { ...option.before, ext: { maintenance: -3 } },
    after: { ...option.after, ext: { maintenance: -6 } },
  });
  assert.match(provided, /Maintenance provided \(engine units\)/);
  assert.match(provided, /<td>6<\/td>/);
  assert.doesNotMatch(provided, /<td>-6<\/td>/);
});
