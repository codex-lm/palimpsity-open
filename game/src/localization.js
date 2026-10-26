import { EXACT_FR, TEMPLATES_FR } from "./translations-fr.js";

export const LOCALE_STORAGE_KEY = "palimpsity.language";
function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
export function readSavedLocale(storage = defaultStorage()) {
  try { return storage?.getItem(LOCALE_STORAGE_KEY) === "fr" ? "fr" : "en"; }
  catch { return "en"; }
}
let locale = readSavedLocale();
const listeners = new Set();
export const getLocale = () => locale;
export function setLocale(value, { storage = defaultStorage(), persist = true } = {}) {
  locale = value === "fr" ? "fr" : "en";
  if (persist) { try { storage?.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Private/file browsing can deny storage. */ } }
  for (const listener of listeners) listener(locale);
  return locale;
}
export function onLocaleChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templates = TEMPLATES_FR.map(template => {
  const slots = [], parts = template.en.split(/(\{\d+\})/g);
  const pattern = parts.map(part => {
    if (/^\{\d+\}$/.test(part)) { slots.push(part.slice(1, -1)); return "([\\s\\S]*?)"; }
    return escapeRegExp(part);
  }).join("");
  return { ...template, slots, regex: new RegExp("^" + pattern + "$"), weight: template.en.replace(/\{\d+\}/g, "").length };
}).filter(template => template.weight > 0).sort((a, b) => b.weight - a.weight);
const has = key => Object.prototype.hasOwnProperty.call(EXACT_FR, key);

function french(text, depth) {
  if (depth > 6 || !text) return text;
  if (has(text)) return EXACT_FR[text];
  if (text.startsWith(" regime values: ")) {
    const tags = text.slice(" regime values: ".length);
    const period = tags.endsWith(".") ? "." : "";
    return " valorise : " + french(period ? tags.slice(0, -1) : tags, depth + 1) + period;
  }
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (trimmed !== text) {
    const translated = french(trimmed, depth + 1);
    if (translated !== trimmed) return text.slice(0, text.indexOf(trimmed)) + translated + text.slice(text.indexOf(trimmed) + trimmed.length);
  }
  for (const template of templates) {
    const match = template.regex.exec(text);
    if (!match) continue;
    const values = {};
    let consistent = true;
    template.slots.forEach((slot, index) => {
      const value = match[index + 1];
      if (slot in values && values[slot] !== value) consistent = false;
      values[slot] = value;
    });
    if (!consistent) continue;
    return template.fr.replace(/\{(\d+)\}/g, (_, slot) => french(values[slot] ?? "", depth + 1));
  }
  if (text.includes(" · ")) return text.split(" · ").map(part => french(part, depth + 1)).join(" · ");
  if (text.includes(", ")) return text.split(", ").map(part => french(part, depth + 1)).join(", ");
  if (/^[+−-]?\d+(?:\.\d+)? € \/ turn$/.test(text)) return text.replace(" € / turn", " € / tour");
  const lower = text.toLowerCase();
  if (has(lower)) return EXACT_FR[lower];
  return text;
}

export function translate(text, target = locale) {
  const source = String(text ?? "");
  return target === "fr" ? french(source, 0) : source;
}

// Keep canonical English separate from the UI's HTML cache. Existing reports,
// open dialogs and text already on screen can then switch back without a restart.
const textSources = new WeakMap(), attributeSources = new WeakMap();
const attributes = ["title", "aria-label", "placeholder", "alt"];
function excluded(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  return !!element?.closest?.("script, style, [data-no-translate]");
}
function translateText(node) {
  if (excluded(node)) return;
  const current = node.nodeValue;
  let cached = textSources.get(node);
  if (!cached || current !== cached.applied) cached = { source: current, applied: current };
  const value = translate(cached.source);
  if (current !== value) node.nodeValue = value;
  cached.applied = value;
  textSources.set(node, cached);
}
function translateAttributes(element) {
  if (excluded(element)) return;
  let cache = attributeSources.get(element);
  if (!cache) { cache = new Map(); attributeSources.set(element, cache); }
  for (const name of attributes) {
    if (!element.hasAttribute?.(name)) continue;
    const current = element.getAttribute(name);
    let cached = cache.get(name);
    if (!cached || current !== cached.applied) cached = { source: current, applied: current };
    const value = translate(cached.source);
    if (current !== value) element.setAttribute(name, value);
    cached.applied = value;
    cache.set(name, cached);
  }
}
export function localizeDOM(root = globalThis.document) {
  if (!root?.nodeType) return root;
  if (root.nodeType === 3) { translateText(root); return root; }
  const document = root.ownerDocument || (root.nodeType === 9 ? root : globalThis.document);
  if (root.nodeType === 1) translateAttributes(root);
  for (const element of root.querySelectorAll?.("[title], [aria-label], [placeholder], [alt]") || []) translateAttributes(element);
  const walker = document?.createTreeWalker?.(root, 4); // NodeFilter.SHOW_TEXT, including detached UI fragments.
  if (walker) { let node; while ((node = walker.nextNode())) translateText(node); }
  return root;
}
