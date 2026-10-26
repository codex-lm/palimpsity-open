/* Localization contracts. The DOM boundary models text nodes and attributes;
 * these tests do not launch a browser, execute WebGL or verify pixel layout.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CityEngine } from '../src/engine.js';
import { BUILDINGS } from '../src/data.js';
import { foundation, playSober } from './playthrough-helpers.mjs';
import {
  LOCALE_STORAGE_KEY, readSavedLocale, getLocale, setLocale,
  onLocaleChange, translate, localizeDOM,
} from '../src/localization.js';

afterEach(() => { setLocale('en', { persist: false }); });

function storage(initial = {}) {
  const values = new Map(Object.entries(initial)), writes = [];
  return { values, writes, getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); writes.push([key, value]); } };
}

test('the page offers a small accessible language choice with English first', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const selects = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)];
  const language = selects.find(([, , options]) => /value="en"/.test(options) && /value="fr"/.test(options));
  assert.ok(language, 'Players need both languages in the same selector');
  assert.match(language[1], /aria-label="[^"]+"/, 'The selector has an accessible name');
  const options = [...language[2].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/gi)];
  assert.match(options[0][1], /value="en"/);
  assert.equal(options[0][2].trim(), 'English');
  const french = options.find(([, attributes]) => /value="fr"/.test(attributes));
  assert.equal(french[2].trim(), 'Français');
  assert.doesNotMatch(french[1], /\bselected\b/i, 'French is chosen explicitly, not by default');
});

test('English is the default and a saved French choice survives reopening', () => {
  const empty = storage();
  assert.equal(readSavedLocale(empty), 'en');
  assert.equal(readSavedLocale(storage({ [LOCALE_STORAGE_KEY]: 'de' })), 'en');
  setLocale('fr', { storage: empty });
  assert.equal(getLocale(), 'fr');
  assert.deepEqual(empty.writes.at(-1), [LOCALE_STORAGE_KEY, 'fr']);
  assert.equal(readSavedLocale(empty), 'fr');
  setLocale('en', { storage: empty });
  assert.equal(readSavedLocale(empty), 'en');
  const writes = empty.writes.length;
  setLocale('fr', { storage: empty, persist: false });
  assert.equal(getLocale(), 'fr');
  assert.equal(empty.writes.length, writes);
});

test('invalid preferences and blocked storage never prevent language switching', () => {
  const denied = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(readSavedLocale(denied), 'en');
  assert.doesNotThrow(() => setLocale('fr', { storage: denied }));
  assert.equal(getLocale(), 'fr');
  assert.equal(setLocale('unknown', { storage: denied }), 'en');
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    assert.equal(readSavedLocale(), 'en');
    assert.doesNotThrow(() => setLocale('fr'));
    assert.equal(getLocale(), 'fr');
  } finally {
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
    else delete globalThis.localStorage;
  }
});

test('locale subscribers can update the current screen and unsubscribe', () => {
  setLocale('en', { persist: false });
  const changes = [];
  const unsubscribe = onLocaleChange(locale => changes.push(locale));
  setLocale('fr', { persist: false });
  setLocale('en', { persist: false });
  unsubscribe();
  setLocale('fr', { persist: false });
  assert.deepEqual(changes, ['fr', 'en']);
});

test('the whole building catalog and dynamic messages have French equivalents', () => {
  const expected = ['Maison', 'Puits', 'Ferme', 'Atelier', 'Marché local', 'Chemin', 'Parc', 'Route', 'Centrale thermique', 'Usine', 'Entrepôt central', "Station d'eau", 'Immeuble dense', 'Dépôt local', 'Tram', 'Centre de maintenance', 'Serre chauffée', 'Centre de recyclage'];
  assert.deepEqual(Object.values(BUILDINGS).map(building => translate(building.name, 'fr')), expected);
  for (const building of Object.values(BUILDINGS)) assert.notEqual(translate(building.desc, 'fr'), building.desc, `${building.id} description needs French copy`);
  assert.equal(translate('Choose a tile for house · R to rotate', 'fr'), 'Choisis une case pour maison · R pour pivoter');
  assert.equal(translate('Year 9 · Autumn', 'fr'), 'An 9 · automne');
  assert.equal(translate('Wells providing backup water: 3', 'fr'), '3 puits donnent une eau de secours');
  assert.match(translate('The workshop must be at least 24 turns old (12/24).', 'fr'), /24.*12\/24/);
  assert.equal(translate('65 € + 20 materials', 'fr'), '65 € + 20 matériaux');
  assert.equal(translate('An unfamiliar technical error', 'fr'), 'An unfamiliar technical error');
  assert.equal(translate('House', 'en'), 'House');
});

class TextBoundary {
  constructor(text) { this.nodeType = 3; this.nodeValue = text; this.parentNode = null; this.parentElement = null; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = value; }
}
function matches(element, selector) {
  if (selector === '*') return true;
  if (selector.startsWith('#')) return element.id === selector.slice(1);
  const attribute = /^\[([^\]=]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(selector);
  if (attribute) return element.hasAttribute(attribute[1]) && (attribute[2] == null || element.getAttribute(attribute[1]) === attribute[2]);
  return element.tagName.toLowerCase() === selector.toLowerCase();
}
class ElementBoundary {
  constructor(tag, children = [], attrs = {}) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.nodeName = this.tagName;
    this.childNodes = children; this.attrs = new Map(Object.entries(attrs));
    for (const child of children) { child.parentNode = this; child.parentElement = this; }
  }
  get id() { return this.getAttribute('id') || ''; }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  get children() { return this.childNodes.filter(child => child.nodeType === 1); }
  get lang() { return this.getAttribute('lang'); }
  set lang(value) { this.setAttribute('lang', value); }
  get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  getAttributeNames() { return [...this.attrs.keys()]; }
  hasAttribute(name) { return this.attrs.has(name); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  closest(selector) {
    const selectors = selector.split(',').map(value => value.trim());
    for (let element = this; element; element = element.parentElement) if (selectors.some(value => matches(element, value))) return element;
    return null;
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim()), found = [];
    const visit = node => { for (const child of node.children || []) { if (selectors.some(value => matches(child, value))) found.push(child); visit(child); } };
    visit(this); return found;
  }
}
function documentBoundary(...children) {
  const body = new ElementBoundary('body', children), html = new ElementBoundary('html', [body], { lang: 'en' });
  const doc = {
    nodeType: 9, documentElement: html, body, childNodes: [html],
    defaultView: { NodeFilter: { SHOW_TEXT: 4 } },
    querySelectorAll(selector) { return [...(matches(html, selector) ? [html] : []), ...html.querySelectorAll(selector)]; },
    createTreeWalker(root) {
      const texts = [];
      const visit = node => { for (const child of node.childNodes || []) { if (child.nodeType === 3) texts.push(child); else visit(child); } };
      visit(root); let index = 0; return { nextNode: () => texts[index++] || null };
    },
  };
  function attach(node) { node.ownerDocument = doc; for (const child of node.childNodes || []) attach(child); }
  attach(html);
  return doc;
}

test('live DOM translation restores English and follows updated text and attributes', () => {
  const name = new TextBoundary('House');
  const label = new ElementBoundary('button', [name], { id: 'house-action', title: 'Close inspector', 'aria-label': 'Build', 'data-id': 'house', class: 'build on' });
  const script = new ElementBoundary('script', [new TextBoundary('House')]);
  const option = new ElementBoundary('option', [new TextBoundary('Français')], { value: 'fr', 'data-no-translate': '' });
  const doc = documentBoundary(label, script, option);
  const beforeNode = label;
  setLocale('fr', { persist: false });
  localizeDOM(doc);
  assert.equal(name.nodeValue, 'Maison');
  assert.equal(label.getAttribute('title'), 'Fermer l’inspecteur');
  assert.equal(label.getAttribute('aria-label'), 'Construire');
  assert.equal(label.id, 'house-action'); assert.equal(label.getAttribute('data-id'), 'house');
  assert.equal(label.getAttribute('class'), 'build on'); assert.equal(label, beforeNode);
  assert.equal(script.textContent, 'House'); assert.equal(option.textContent, 'Français');
  localizeDOM(doc);
  assert.equal(name.nodeValue, 'Maison', 'Idle refresh must not translate already localized output twice');
  name.nodeValue = 'Well'; label.setAttribute('title', 'Normal speed');
  localizeDOM(doc);
  assert.equal(name.nodeValue, 'Puits'); assert.equal(label.getAttribute('title'), 'Vitesse normale');
  setLocale('en', { persist: false });
  localizeDOM(doc);
  assert.equal(name.nodeValue, 'Well'); assert.equal(label.getAttribute('title'), 'Normal speed');
  assert.equal(label.getAttribute('aria-label'), 'Build');
});

test('a newly inserted text node or root attribute is localized on its own', () => {
  const node = new TextBoundary('Not enough materials.');
  const button = new ElementBoundary('button', [node], { title: 'Normal speed' });
  documentBoundary(button);
  setLocale('fr', { persist: false });
  localizeDOM(node);
  assert.equal(node.nodeValue, 'Pas assez de matériaux.');
  localizeDOM(button);
  assert.equal(button.getAttribute('title'), 'Vitesse normale');
  setLocale('en', { persist: false });
  localizeDOM(button);
  assert.equal(node.nodeValue, 'Not enough materials.');
});

test('building tooltips translate the name and description while retaining their price', () => {
  const canonical = `${BUILDINGS.well.name}, 30 euros. ${BUILDINGS.well.desc}`;
  const button = new ElementBoundary('button', [new TextBoundary('Well')], { title: canonical, 'aria-label': canonical, 'data-id': 'well' });
  const doc = documentBoundary(button);
  setLocale('fr', { persist: false }); localizeDOM(doc);
  assert.match(button.getAttribute('title'), /^Puits, 30 euros\. Eau locale\./);
  assert.equal(button.getAttribute('aria-label'), button.getAttribute('title'));
  assert.equal(button.getAttribute('data-id'), 'well');
  setLocale('en', { persist: false }); localizeDOM(doc);
  assert.equal(button.getAttribute('title'), canonical);
  assert.equal(button.getAttribute('aria-label'), canonical);
});

test('a regime bonus sentence split by markup translates tags and punctuation together', () => {
  const panel = new ElementBoundary('p', [new TextBoundary('The '), new ElementBoundary('b', [new TextBoundary('Entropy')]), new TextBoundary(' regime values: repairable, low heat, heat reuse.')]);
  const doc = documentBoundary(panel);
  setLocale('fr', { persist: false }); localizeDOM(doc);
  assert.equal(panel.textContent, 'Le régime Entropie valorise : réparable, faible chaleur, réemploi de chaleur.');
  setLocale('en', { persist: false }); localizeDOM(doc);
  assert.equal(panel.textContent, 'The Entropy regime values: repairable, low heat, heat reuse.');
});

test('changing language midgame translates queued copy without restarting or mutating the city', () => {
  const { e } = foundation();
  e.fireLogisticsCrisis();
  const before = structuredClone(e.state);
  const tick = e.state.tick, building = e.state.buildings[0], queuedReport = e.state.reports.at(-1);
  const oldBody = queuedReport.body;
  const bodyNode = new TextBoundary(oldBody), headingNode = new TextBoundary(queuedReport.title);
  const doc = documentBoundary(new ElementBoundary('article', [headingNode, bodyNode]));
  setLocale('fr', { persist: false }); localizeDOM(doc);
  assert.notEqual(bodyNode.nodeValue, oldBody);
  assert.match(headingNode.nodeValue, /Année/);
  assert.equal(e.state.tick, tick); assert.equal(e.state.buildings[0], building);
  assert.deepEqual(e.state, before);
  assert.equal(queuedReport.body, oldBody, 'The queued canonical report stays intact for the other language');
  setLocale('en', { persist: false }); localizeDOM(doc);
  assert.equal(bodyNode.nodeValue, oldBody); assert.equal(headingNode.nodeValue, queuedReport.title);
  assert.deepEqual(e.state, before);
});

test('completed-city messages remain bilingual after the outcome already exists', () => {
  const winner = playSober(true);
  assert.equal(winner.state.outcome, 'victory');
  const original = winner.state.outcomeInfo.reason;
  const fr = translate(original, 'fr');
  assert.notEqual(fr, original);
  assert.match(fr, /Population|population/);
  assert.match(fr, /quartier/);
  assert.equal(translate(original, 'en'), original);
  assert.equal(winner.state.outcome, 'victory');
});
