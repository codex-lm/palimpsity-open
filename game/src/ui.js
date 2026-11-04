import {
  ORDER, BUILDINGS, RES_VISIBLE, RES_HIDDEN, RES_META,
  REGIMES, REGIME_META, districtOf, DISTRICT_NAMES,
} from "./data.js";
import { buildingIcon, uiIcon } from "./icons.js";
import { localizeDOM } from "./localization.js";
import { CHALLENGE, formatSimTime } from "./challenge.js";

const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
const FLOW_NAMES = { food: "food", water: "water", energy: "energy", materials: "materials", workers: "workers", population: "residents", money: "€", heat: "heat", trust: "trust" };
const QUALITY_LEVELS = ["high", "balanced", "low"];
const PHOTO_TIMES = ["day", "golden", "evening", "night"];
const DISPLAY_STORAGE_KEY = "palimpsity.display";
const ARCHITECTURE_NAMES = {
  base: { residential: "Housing", shop: "Shop", workshop: "Workshop", warehouse: "Warehouse", civic: "Civic" },
  roof: { traditional: "Traditional roof", garden: "Garden roof", productive: "Productive roof" },
  family: { banks: "Banks", works: "Works", gardens: "Gardens" },
};
const TRANSFORMATION_GROUPS = [
  { id: "levels", label: "Levels", match: id => id === "add_floor" },
  { id: "use", label: "Use", match: id => id.startsWith("base_") },
  { id: "roof", label: "Roof", match: id => id.startsWith("roof_") },
  { id: "appearance", label: "Appearance", match: id => id.startsWith("family_") || id.startsWith("variant_") },
];
const groupOf = id => TRANSFORMATION_GROUPS.find(group => group.match(id)) || TRANSFORMATION_GROUPS[0];
const transformationIcon = id => id.startsWith("roof_") ? uiIcon("roof") : groupOf(id).id === "appearance" ? uiIcon("display") : buildingIcon(id === "base_shop" ? "market" : id === "base_workshop" ? "workshop" : "house");
const OUTPUT_LABELS = {
  population: "Housing capacity", workers: "Worker capacity", money: "Potential income (€ / turn)",
  food: "Food production", water: "Water production", energy: "Energy production",
  materials: "Materials production", trust: "Trust services",
};
const INPUT_LABELS = { food: "Food need", water: "Water need", energy: "Energy need", materials: "Materials need", workers: "Worker need", money: "Money need", heat: "Heat need" };
const EXTERNAL_LABELS = { heat: "Heat output", cooling: "Cooling", distribution: "Distribution service", capacity: "Distribution capacity", congestion: "Congestion" };
const tagText = tag => tag.replace(/_/g, " ");
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const setHTML = (node, html) => { if (node.__h !== html) { node.__h = html; node.innerHTML = html; } localizeDOM(node); };
const floorText = value => `${value} ${value === 1 ? "floor" : "floors"}`;
const materialText = value => `${value} ${value === 1 ? "material" : "materials"}`;
const costText = cost => `${cost?.money || 0} € + ${materialText(cost?.materials || 0)}`;
const flowText = (flows, sign) => Object.entries(flows || {}).filter(([, value]) => value).map(([key, value]) => `${sign}${value} ${key === "materials" && value === 1 ? "material" : FLOW_NAMES[key] || key}`).join("<br>") || "—";
export const RESOURCE_COLORS = { population: "#F0EEE9", money: "#E6A461", materials: "#c5a985", heat: "#ff8066", congestion: "#df9275" };
const resourceColor = key => RESOURCE_COLORS[key] || RES_META[key].col;
export const regimeColor = key => key === "maintenance_heat" ? "#df9275" : REGIME_META[key].col;
const metricValue = value => Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "—";
const metricAt = (profile, group, key) => profile?.[group]?.[key];
const readDisplayPreferences = () => {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(DISPLAY_STORAGE_KEY) || "null");
    return saved && typeof saved === "object" ? saved : {};
  } catch { return {}; }
};

function focusVisible(...candidates) {
  for (const candidate of candidates) {
    if (!candidate?.isConnected || candidate.closest?.("[hidden]")) continue;
    if (candidate.getClientRects && candidate.getClientRects().length === 0) continue;
    const view = candidate.ownerDocument?.defaultView || globalThis;
    const style = view.getComputedStyle?.(candidate);
    if (style && (style.display === "none" || style.visibility === "hidden")) continue;
    candidate.focus({ preventScroll: true });
    return candidate;
  }
  return null;
}

function comparisonRows(before, after) {
  const rows = [];
  const add = (label, left, right, tone = "neutral") => {
    if (left == null && right == null) return;
    const beforeValue = left ?? 0, afterValue = right ?? 0;
    rows.push({ label, left: metricValue(beforeValue), right: metricValue(afterValue), tone, changed: beforeValue !== afterValue });
  };
  add("Floors", before?.architecture?.floors, after?.architecture?.floors);
  for (const key of Object.keys(OUTPUT_LABELS)) add(OUTPUT_LABELS[key], metricAt(before, "outputs", key), metricAt(after, "outputs", key), "benefit");
  for (const key of Object.keys(INPUT_LABELS)) add(INPUT_LABELS[key], metricAt(before, "inputs", key), metricAt(after, "inputs", key), "cost");
  for (const key of Object.keys(EXTERNAL_LABELS)) add(EXTERNAL_LABELS[key], metricAt(before, "ext", key), metricAt(after, "ext", key), ["heat", "congestion"].includes(key) ? "cost" : "benefit");
  const beforeMaintenance = metricAt(before, "ext", "maintenance"), afterMaintenance = metricAt(after, "ext", "maintenance");
  if (beforeMaintenance > 0 || afterMaintenance > 0) add("Maintenance demand (engine units)", Math.max(0, beforeMaintenance || 0), Math.max(0, afterMaintenance || 0), "cost");
  if (beforeMaintenance < 0 || afterMaintenance < 0) add("Maintenance provided (engine units)", beforeMaintenance < 0 ? -beforeMaintenance : 0, afterMaintenance < 0 ? -afterMaintenance : 0, "benefit");
  add("Upkeep (€ / turn)", before?.upkeep ?? metricAt(before, "ext", "upkeep"), after?.upkeep ?? metricAt(after, "ext", "upkeep"), "cost");
  return rows;
}

function comparisonTable(rows) {
  return `<table class="profile-diff"><thead><tr><th scope="col">Effect</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${rows.map(row => `<tr data-tone="${row.tone}"><th scope="row">${row.label}</th><td>${row.left}</td><td>${row.right}</td></tr>`).join("")}</tbody></table>`;
}

export class UI {
  constructor(engine, renderer, handlers) {
    this.engine = engine;
    this.renderer = renderer;
    this.h = handlers;
    this.selected = null;
    this.buildFamily = "banks";
    this.bulldoze = false;
    this.lens = "none";
    this.inspectBuilding = null;
    this.transformPreview = null;
    this.layerGroup = "levels";
    this.photoMode = false;
    this.photoTime = "day";
    this.sideOpen = false;
    this.lastReportId = null;
    this.challenge = null;         // posé par main.js quand le défi tourne
    const savedDisplay = readDisplayPreferences();
    this.displayPrefs = {
      quality: QUALITY_LEVELS.includes(savedDisplay.quality) ? savedDisplay.quality : "high",
      reducedEffects: typeof savedDisplay.reducedEffects === "boolean" ? savedDisplay.reducedEffects : !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
      showRoofs: typeof savedDisplay.showRoofs === "boolean" ? savedDisplay.showRoofs : true,
      photoTime: PHOTO_TIMES.includes(savedDisplay.photoTime) ? savedDisplay.photoTime : "day",
    };
    this.photoTime = this.displayPrefs.photoTime;
    this.$ = {};
    for (const id of ["hud-res", "regimes", "clock", "speed", "palette", "palette-hint", "advisors", "diagnostic", "inspector", "side", "side-toggle", "side-close", "lenses", "modal", "toast", "end", "camera-home", "objectives-summary", "objectives-list", "challenge", "challenge-end", "display-toggle", "display-panel", "display-close", "reduced-effects", "roof-visibility", "photo-controls", "photo-exit"]) {
      this.$[id] = document.getElementById(id);
    }
    this.buildSpeed();
    this.buildLenses();
    this.buildCameraTools();
    this.buildDisplayTools();
    this.buildPanelTools();
    this.applyDisplayPreferences();
    this.$.palette.addEventListener("scroll", () => this.renderPaletteHint(), { passive: true });
    this.renderPalette();
    this.renderRegimes();
  }

  buildDisplayTools() {
    this.$["display-toggle"].onclick = () => this.toggleDisplay();
    this.$["display-close"].onclick = () => this.toggleDisplay(false);
    for (const button of document.querySelectorAll("[data-quality]")) button.onclick = () => this.setQuality(button.dataset.quality);
    for (const button of document.querySelectorAll("[data-photo-time]")) button.onclick = () => this.setPhotoTime(button.dataset.photoTime);
    this.$["reduced-effects"].onchange = () => this.setReducedEffects(this.$["reduced-effects"].checked);
    this.$["roof-visibility"].onchange = () => this.setRoofsVisible(this.$["roof-visibility"].checked);
    document.getElementById("photo-enter").onclick = () => this.setPhotoMode(true);
    this.$["photo-exit"].onclick = () => this.setPhotoMode(false);
    this.renderDisplayTools();
  }

  buildPanelTools() {
    this.$["side-toggle"].onclick = () => this.setSideOpen(!this.sideOpen);
    this.$["side-close"].onclick = () => this.setSideOpen(false);
  }

  saveDisplayPreferences() {
    try { globalThis.localStorage?.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(this.displayPrefs)); } catch { /* Storage can be unavailable in private or file browsing. */ }
  }

  applyDisplayPreferences() {
    document.body.classList.toggle("reduced-effects", this.displayPrefs.reducedEffects);
    this.renderer.setQuality?.(this.displayPrefs.quality);
    this.renderer.setReducedEffects?.(this.displayPrefs.reducedEffects);
    this.renderer.toggleRoof?.(this.displayPrefs.showRoofs);
    this.renderDisplayTools();
  }

  renderDisplayTools() {
    for (const button of document.querySelectorAll("[data-quality]")) {
      const active = button.dataset.quality === this.displayPrefs.quality;
      button.classList.toggle("on", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of document.querySelectorAll("[data-photo-time]")) {
      const active = button.dataset.photoTime === this.photoTime;
      button.classList.toggle("on", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.$["reduced-effects"].checked = this.displayPrefs.reducedEffects;
    this.$["roof-visibility"].checked = this.displayPrefs.showRoofs;
  }

  setQuality(value) {
    if (!QUALITY_LEVELS.includes(value)) return;
    this.displayPrefs.quality = value;
    this.renderer.setQuality?.(value);
    this.saveDisplayPreferences();
    this.renderDisplayTools();
  }

  setReducedEffects(value) {
    this.displayPrefs.reducedEffects = !!value;
    document.body.classList.toggle("reduced-effects", this.displayPrefs.reducedEffects);
    this.renderer.setReducedEffects?.(this.displayPrefs.reducedEffects);
    this.saveDisplayPreferences();
    this.renderDisplayTools();
  }

  setRoofsVisible(visible) {
    this.displayPrefs.showRoofs = !!visible;
    this.renderer.toggleRoof?.(this.displayPrefs.showRoofs);
    this.saveDisplayPreferences();
    this.renderDisplayTools();
  }

  setPhotoTime(value) {
    if (!PHOTO_TIMES.includes(value)) return;
    this.photoTime = this.displayPrefs.photoTime = value;
    if (this.photoMode) this.renderer.setPhotoMode?.(true, value);
    this.saveDisplayPreferences();
    this.renderDisplayTools();
  }

  toggleDisplay(open = this.$["display-panel"].hidden) {
    this.$["display-panel"].hidden = !open;
    this.$["display-toggle"].setAttribute("aria-expanded", String(open));
    if (open) this.$["display-close"].focus({ preventScroll: true });
    else this.$["display-toggle"].focus({ preventScroll: true });
  }

  setSideOpen(open) {
    const wasOpen = this.sideOpen;
    this.sideOpen = !!open;
    document.body?.classList.toggle("side-open", this.sideOpen);
    this.$["side-toggle"]?.setAttribute("aria-expanded", String(this.sideOpen));
    if (wasOpen && !this.sideOpen) focusVisible(this.$["side-toggle"], document.getElementById("cv"));
  }

  setPhotoMode(enabled) {
    enabled = !!enabled;
    if (this.photoMode === enabled) return;
    if (enabled) this.photoReturnFocus = document.activeElement;
    this.photoMode = enabled;
    document.body.classList.toggle("photo-mode", enabled);
    this.$["photo-controls"].hidden = !enabled;
    this.$["display-toggle"].setAttribute("aria-pressed", String(enabled));
    this.renderer.setPhotoMode?.(enabled, this.photoTime);
    this.h.onPhotoMode?.(enabled);
    if (enabled) {
      this.$["display-panel"].hidden = true;
      this.$["display-toggle"].setAttribute("aria-expanded", "false");
      this.setSideOpen(false);
      this.$["photo-exit"].focus({ preventScroll: true });
    } else {
      focusVisible(this.photoReturnFocus, this.$["display-toggle"], document.getElementById("cv"));
    }
  }

  buildSpeed() {
    this.$.speed.innerHTML = "";
    for (const [lbl, value, aria] of [["⏸", 0, "Pause"], ["▶", 1, "Normal speed"], ["⏩", 3, "Fast speed"]]) {
      const button = el("button", "spd" + (this.engine.state.speed === value ? " on" : ""), lbl);
      button.setAttribute("aria-label", aria);
      button.title = aria;
      button.setAttribute("aria-pressed", String(this.engine.state.speed === value));
      button.onclick = () => {
        this.engine.state.speed = value;
        [...this.$.speed.children].forEach(child => { child.classList.remove("on"); child.setAttribute("aria-pressed", "false"); });
        button.classList.add("on");
        button.setAttribute("aria-pressed", "true");
        this.h.onSpeed(value);
      };
      this.$.speed.appendChild(button);
    }
    localizeDOM(this.$.speed);
  }

  buildLenses() {
    this.lensDefs = [["none", "City", 1], ["logistics", "Logistics", 3], ["heat", "Heat", 4], ["maintenance", "Wear", 4]];
    this.renderLenses();
  }

  renderLenses() {
    this.$.lenses.innerHTML = "";
    for (const [id, label, phase] of this.lensDefs) {
      if (this.engine.state.phase < phase && id !== "none") continue;
      const button = el("button", "lens" + (this.lens === id ? " on" : ""), label);
      button.setAttribute("aria-pressed", String(this.lens === id));
      if (id === "logistics") button.title = "Underserved districts and local congestion";
      if (id === "maintenance") button.title = "Unmet maintenance needs in each district";
      button.onclick = () => {
        this.lens = id;
        this.renderer.setLens(id);
        this.renderLenses();
      };
      this.$.lenses.appendChild(button);
    }
    localizeDOM(this.$.lenses);
  }

  buildCameraTools() {
    for (const button of document.querySelectorAll("[data-projection]")) {
      button.onclick = () => {
        this.renderer.setProjectionMode(button.dataset.projection);
        this.renderProjection();
      };
    }
    this.$["camera-home"].onclick = () => this.renderer.homeCamera();
    this.renderProjection();
  }

  renderProjection() {
    for (const button of document.querySelectorAll("[data-projection]")) {
      const active = button.dataset.projection === this.renderer.projectionMode;
      button.classList.toggle("on", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  renderPalette() {
    const state = this.engine.state;
    this.$.palette.innerHTML = "";
    const heading = el("div", "palette-heading", "<span>Build</span><small>Choose a building, then an empty tile</small>");
    const list = el("div", "", "");
    list.id = "building-list";
    const bulldoze = el("button", "build bulldoze" + (this.bulldoze ? " on" : ""), `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m10 10 20 20M30 10 10 30"/></svg><span class="bname">Demolish</span>`);
    bulldoze.setAttribute("aria-pressed", String(this.bulldoze));
    bulldoze.title = "Demolish a building and recover 40% of its cost";
    bulldoze.onclick = () => {
      this.bulldoze = !this.bulldoze;
      this.selected = null;
      this.renderer.setGhost(null);
      this.h.onSelect(null);
      this.renderPalette();
    };
    const familyPicker = el("div", "palette-heading house-family");
    familyPicker.id = "house-family";
    familyPicker.setAttribute("role", "group");
    familyPicker.setAttribute("aria-label", "House family");
    familyPicker.appendChild(el("small", "", "House family"));
    for (const family of Object.keys(ARCHITECTURE_NAMES.family)) {
      const button = el("button", "family-choice" + (this.buildFamily === family ? " on" : ""), ARCHITECTURE_NAMES.family[family]);
      button.dataset.family = family;
      button.title = "House family";
      button.setAttribute("aria-label", ARCHITECTURE_NAMES.family[family]);
      button.setAttribute("aria-pressed", String(this.buildFamily === family));
      button.onclick = () => {
        this.buildFamily = family;
        this.renderer.setGhost(this.selected, { family });
        this.renderPalette();
      };
      familyPicker.appendChild(button);
    }
    this.$.palette.append(heading, familyPicker, list, bulldoze);
    for (const id of ORDER) {
      if (!state.unlocked.has(id)) continue;
      const def = BUILDINGS[id];
      const cost = def.cost?.money || 0;
      const afford = state.res.money >= cost;
      const isNew = state.newlyUnlocked.includes(id);
      const button = el("button", "build" + (this.selected === id ? " on" : "") + (afford ? "" : " poor") + (isNew ? " fresh" : ""));
      button.dataset.id = id;
      button.style.color = def.color;
      button.innerHTML = `${buildingIcon(id)}<span class="bname">${def.name}</span><span class="bcost">${cost} €</span>`;
      button.title = `${def.desc} Cost: ${cost} €`;
      button.setAttribute("aria-label", `${def.name}, ${cost} euros. ${def.desc}`);
      button.setAttribute("aria-pressed", String(this.selected === id));
      button.onclick = () => {
        this.bulldoze = false;
        this.selected = this.selected === id ? null : id;
        this.renderer.setGhost(this.selected, { family: this.buildFamily });
        this.h.onSelect(this.selected);
        this.renderPalette();
      };
      list.appendChild(button);
    }
    state.newlyUnlocked = [];
    localizeDOM(this.$.palette);
    this.renderPaletteHint();
  }

  renderPaletteHint() {
    const hint = this.$["palette-hint"];
    if (!hint) return;
    const buttons = [...this.$.palette.querySelectorAll("#building-list [data-id]")];
    const bounds = this.$.palette.getBoundingClientRect();
    const visible = buttons.filter(button => {
      const rect = button.getBoundingClientRect();
      return rect.right > bounds.left + 2 && rect.left < bounds.right - 2;
    });
    const first = buttons.indexOf(visible[0]), last = buttons.indexOf(visible.at(-1));
    const more = this.$.palette.scrollWidth > this.$.palette.clientWidth + 4;
    hint.textContent = buttons.length && more ? `${first + 1}–${last + 1} of ${buttons.length} · Scroll for more` : `${buttons.length} buildings`;
    localizeDOM(hint);
  }

  refreshPaletteAfford() {
    const state = this.engine.state;
    for (const button of this.$.palette.querySelectorAll("[data-id]")) {
      button.classList.toggle("poor", state.res.money < (BUILDINGS[button.dataset.id].cost?.money || 0));
    }
  }

  renderHUD() {
    const state = this.engine.state, res = state.res, net = state.flowNet || {};
    const list = state.phase >= 2 ? [...RES_VISIBLE, ...RES_HIDDEN] : RES_VISIBLE;
    let html = "";
    for (const key of list) {
      const meta = RES_META[key];
      const value = key === "population" ? Math.round(res[key]) : Math.round(res[key] * 10) / 10;
      const n = net[key];
      const arrow = n > 0.2 ? "▲" : n < -0.2 ? "▼" : "";
      const cls = n > 0.2 ? "up" : n < -0.2 ? "down" : "";
      html += `<div class="res${RES_HIDDEN.includes(key) ? " hidden-res" : ""}"><span class="rlbl" style="color:${resourceColor(key)}">${meta.lbl}</span><span class="rval">${value}</span><span class="rarr ${cls}">${arrow}</span></div>`;
    }
    setHTML(this.$["hud-res"], html);
    setHTML(this.$.clock, `Year ${state.year} · ${SEASONS[state.season]} <span class="phase">Phase ${state.phase}</span>`);
  }

  renderRegimes() {
    const state = this.engine.state;
    const dominant = this.engine.dominantRegime().key;
    let html = "";
    for (const key of REGIMES) {
      const meta = REGIME_META[key];
      const value = state.regime[key];
      html += `<div class="regime${key === dominant ? " dom" : ""}" title="${meta.q}"><span class="rgl" style="color:${regimeColor(key)}">${meta.lbl}</span><span class="rgbar"><span style="width:${Math.round(clamp(value / 1.6 * 100, 0, 100))}%;background:${regimeColor(key)}"></span></span></div>`;
    }
    setHTML(this.$.regimes, html);
  }

  renderAdvisors() {
    let html = "";
    for (const card of this.engine.state.advisorCards) html += `<div class="advisor ${card.kind || ""}"><div class="who">${card.who}</div><div class="txt">${card.text}</div></div>`;
    setHTML(this.$.advisors, html);
  }

  renderDiagnostic() {
    const ex = this.engine.explain();
    let html = `<div class="diag-h">Diagnosis</div><div class="diag-p">${ex.problem}</div>`;
    if (ex.causes.length) html += `<div class="diag-s">Causes</div><ul>${ex.causes.map(c => `<li>${c}</li>`).join("")}</ul>`;
    if (ex.helpful.length) html += `<div class="diag-s good">What helps</div><ul>${ex.helpful.map(c => `<li>${c}</li>`).join("")}</ul>`;
    if (ex.actions.length) html += `<div class="diag-s">Options</div><ul>${ex.actions.map(c => `<li>${c}</li>`).join("")}</ul>`;
    setHTML(this.$["diagnostic"], html);
  }

  renderObjectives() {
    if (this.challenge) return this.renderChallengeObjectives();
    const progress = this.engine.victoryProgress();
    const ready = progress.filter(item => item.met).length;
    setHTML(this.$["objectives-summary"], `Thriving city · ${ready}/${progress.length}`);
    const rows = progress.map(item => `<li class="objective ${item.met ? "met" : "pending"}" data-objective="${item.key}"><span aria-hidden="true">${item.met ? "✓" : "○"}</span><div><b>${item.label}</b><small>${item.detail}</small></div><span class="sr-only">${item.met ? "Achieved" : "Not yet achieved"}</span></li>`).join("");
    setHTML(this.$["objectives-list"], `<ul>${rows}</ul><p>You can prevent crises and still win.</p>`);
  }

  // En mode défi, le panneau d'objectifs suit le défi — la victoire classique
  // "Thriving city" n'est ni affichée ni revendiquée ici.
  renderChallengeObjectives() {
    const progress = this.challenge.progress();
    setHTML(this.$["objectives-summary"], `First Neighbourhood · ${progress.metCount}/${progress.rows.length}`);
    const rows = progress.rows.map(item => `<li class="objective ${item.met ? "met" : "pending"}" data-objective="${item.key}"><span aria-hidden="true">${item.met ? "✓" : "○"}</span><div><b>${item.label}</b><small>${item.detail}</small></div><span class="sr-only">${item.met ? "Achieved" : "Not yet achieved"}</span></li>`).join("");
    setHTML(this.$["objectives-list"], `<ul>${rows}</ul><p>You can pause freely: only simulation turns count (0.6 s each).</p>`);
  }

  renderChallenge() {
    const chip = this.$.challenge;
    const ch = this.challenge;
    if (!ch) {
      chip.hidden = true;
      setHTML(chip, "");
      this.renderChallengeEnd();
      return;
    }
    const progress = ch.progress();
    chip.hidden = false;
    chip.title = progress.best != null ? `Best: ${formatSimTime(progress.best)}` : "First Neighbourhood";
    setHTML(chip, `<b>First Neighbourhood</b><br>Turn ${progress.tick}/${CHALLENGE.deadlineTicks} · ${progress.timeRemaining} left · ${progress.streak}/${CHALLENGE.sustainTicks} held`);
    this.renderChallengeEnd();
  }

  renderChallengeEnd() {
    const box = this.$["challenge-end"];
    const ch = this.challenge;
    if (!ch || ch.status === "running") { box.classList.remove("on"); return; }
    if (box.classList.contains("on")) return;
    this.$.modal.classList.remove("on");
    this.$.end.classList.remove("on");
    const progress = ch.progress();
    const win = ch.status === "success";
    let reason;
    if (win) reason = `Goals held together at turn ${ch.finishedAtTick} · simulation time ${formatSimTime(ch.finishedAtTick)}.`;
    else if (ch.failReason === "collapse") reason = `The city collapsed first: ${this.engine.state.outcomeInfo?.reason || ""}`;
    else reason = `Turn ${CHALLENGE.deadlineTicks} arrived before every goal held together.`;
    const best = progress.best != null ? `Best completion: ${formatSimTime(progress.best)}` : "";
    const record = win && progress.newBest ? "New best time!" : "";
    box.innerHTML = `<div class="end-box ${win ? "win" : "lose"}" role="dialog" aria-modal="true"><h1>${win ? "Challenge completed" : "Out of time"}</h1><p class="end-reason">${reason}</p><div class="end-traj">${[best, record].filter(Boolean).join("<br>") || "First Neighbourhood"}</div><p class="end-metrics">A side challenge — the Thriving city victory stays the classic mode's goal.</p><button id="challenge-retry">Try again</button> <button id="challenge-exit">Back to classic city</button></div>`;
    box.classList.add("on");
    document.getElementById("challenge-retry").onclick = () => this.h.onRestart();
    document.getElementById("challenge-exit").onclick = () => this.h.onExitChallenge();
    document.getElementById("challenge-retry").focus();
    localizeDOM(box);
  }

  renderTransformationPreview(option, feedback = null) {
    const rows = comparisonRows(option.before, option.after);
    const changedRows = rows.filter(row => row.changed), unchangedRows = rows.filter(row => !row.changed);
    const group = groupOf(option.id);
    const aesthetic = group.id === "appearance";
    const condition = option.reason || (option.phase ? `Available from phase ${option.phase}.` : "Available now.");
    const architecture = option.after?.architecture;
    const result = architecture ? [
      floorText(architecture.floors), ARCHITECTURE_NAMES.base[architecture.base], ARCHITECTURE_NAMES.roof[architecture.roof],
      ARCHITECTURE_NAMES.family[architecture.family], `Variant ${architecture.variant + 1}`,
    ].join(" · ") : "";
    return `<section class="transform-preview" aria-label="Transformation preview">
      <div class="preview-heading"><span class="section-kicker">Before confirmation</span><h3 tabindex="-1" data-transform-title>${option.name}</h3></div>
      <div class="preview-scroll">
        ${result ? `<p class="preview-architecture"><b>After</b> · ${result}</p>` : ""}
        <p class="conversion-cost">Cost: ${costText(option.cost)}</p>
        <p class="conversion-condition">${condition}</p>
        ${aesthetic ? '<p class="aesthetic-note">Appearance only · no economic advantage.</p>' : ""}
        ${changedRows.length ? comparisonTable(changedRows) : '<p class="aesthetic-note">No economic changes.</p>'}
        ${group.id !== "use" ? `<div class="architecture-comparison" data-architecture-comparison><figure><figcaption>Before</figcaption><canvas data-architecture-before aria-label="Current architecture"></canvas></figure><figure><figcaption>After</figcaption><canvas data-architecture-after aria-label="Proposed architecture"></canvas></figure></div>` : ""}
        ${unchangedRows.length ? `<details class="unchanged-details"><summary>Unchanged values (${unchangedRows.length})</summary>${comparisonTable(unchangedRows)}</details>` : ""}
      </div>
      ${feedback?.type === "error" ? `<div class="transform-feedback error" role="alert" tabindex="-1">${feedback.text}</div>` : ""}
      <div class="preview-actions"><button type="button" class="confirm-transform" data-transform-confirm="${option.id}" ${option.reason ? "disabled" : ""}>Apply changes</button><button type="button" class="cancel-transform" data-transform-cancel>Cancel</button></div>
    </section>`;
  }

  syncArchitectureComparison() {
    const root = this.$.inspector.querySelector("[data-architecture-comparison]");
    const key = this.transformPreview?.id || "";
    if (!root || !this.transformPreview) {
      this.architectureObserver?.disconnect();
      if (this.architectureFrame) globalThis.cancelAnimationFrame?.(this.architectureFrame);
      this.architectureFrame = this.architectureRoot = this.architectureDrawnRoot = null;
      this.architectureKey = "";
      return;
    }
    if (this.architectureRoot === root && this.architectureKey === key) return;
    this.architectureObserver?.disconnect();
    if (this.architectureFrame) globalThis.cancelAnimationFrame?.(this.architectureFrame);
    this.architectureFrame = null;
    this.architectureRoot = root;
    this.architectureKey = key;
    const draw = () => {
      this.architectureFrame = null;
      if (!root.isConnected || !this.transformPreview) return;
      const width = root.clientWidth, height = root.clientHeight, ratio = globalThis.devicePixelRatio || 1;
      if (this.architectureDrawnRoot === root && this.architectureWidth === width && this.architectureHeight === height && this.architectureRatio === ratio) return;
      this.architectureDrawnRoot = root;
      this.architectureWidth = width;
      this.architectureHeight = height;
      this.architectureRatio = ratio;
      const before = root.querySelector("[data-architecture-before]"), after = root.querySelector("[data-architecture-after]");
      for (const canvas of [before, after]) {
        const pixelWidth = Math.max(1, Math.round(canvas.clientWidth * ratio)), pixelHeight = Math.max(1, Math.round(canvas.clientHeight * ratio));
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      }
      const rendered = this.renderer.renderArchitectureComparison?.(this.transformPreview.building, this.transformPreview.id, before, after) || false;
      root.dataset.rendered = String(rendered);
    };
    this.architectureDraw = draw;
    if (globalThis.ResizeObserver) {
      this.architectureObserver = new ResizeObserver(() => {
        if (this.architectureFrame) return;
        this.architectureFrame = globalThis.requestAnimationFrame(() => this.architectureDraw?.());
      });
      this.architectureObserver.observe(root);
    }
    draw();
  }

  showInspector(building, { focusPreview = false } = {}) {
    const changed = this.inspectBuilding !== building;
    const active = document.activeElement;
    const previousInspectorScroll = this.$.inspector.querySelector(".inspector-scroll")?.scrollTop || 0;
    const previousPreviewScroll = this.$.inspector.querySelector(".preview-scroll")?.scrollTop || 0;
    let focusedAction = null;
    if (this.$.inspector.contains(active)) {
      if (active.id === "close-inspector") focusedAction = "#close-inspector";
      else if (active.dataset?.conversion) focusedAction = `[data-conversion="${active.dataset.conversion}"]`;
      else if (active.dataset?.layerGroupToggle) focusedAction = `[data-layer-group-toggle="${active.dataset.layerGroupToggle}"]`;
      else if (active.dataset?.transformPreview) focusedAction = `[data-transform-preview="${active.dataset.transformPreview}"]`;
      else if (active.dataset?.transformConfirm) focusedAction = `[data-transform-confirm="${active.dataset.transformConfirm}"]`;
      else if (active.hasAttribute?.("data-transform-title")) focusedAction = "[data-transform-title]";
      else if (active.hasAttribute?.("data-transform-success")) focusedAction = "[data-transform-success]";
      else if (active.classList?.contains("transform-feedback") && active.classList.contains("error")) focusedAction = ".transform-feedback.error";
      else if (active.hasAttribute?.("data-transform-cancel")) focusedAction = "[data-transform-cancel]";
      else if (active.hasAttribute?.("data-focus-building")) focusedAction = "[data-focus-building]";
    }
    this.inspectBuilding = building;
    if (!building || !this.engine.state.buildings.includes(building)) {
      this.inspectBuilding = null;
      this.transformPreview = null;
      this.transformFeedback = null;
      setHTML(this.$.inspector, "");
      this.$.inspector.classList.remove("on");
      this.$.side?.classList.remove("has-inspector", "has-transform-preview");
      this.setSideOpen?.(false);
      return;
    }
    if (changed) {
      this.transformPreview = null;
      this.transformFeedback = null;
      this.layerGroup = "levels";
      this.setSideOpen?.(true);
    }
    this.$.side?.classList.add("has-inspector");
    const def = this.engine.profileOf(building);
    const value = this.engine.buildingValue(building);
    const pct = clamp((value - 0.4) / 2 * 100, 0, 100);
    const revalued = this.engine.belongsToDominant(building);
    const bonusTags = this.engine.tagBonusFor(building);
    const heat = this.engine.localHeatAt(building.c, building.r);
    const canFocus = typeof this.renderer.focusBuilding === "function";
    let html = `<div class="insp-h"><span>${def.name}${revalued ? ' <span class="reval">⬆ renewed value</span>' : ""}</span><div class="insp-actions"><button type="button" class="icon-button" data-focus-building aria-label="Focus building" title="Focus building" ${canFocus ? "" : "disabled"}>${uiIcon("focus")}</button><button type="button" class="icon-button" id="close-inspector" aria-label="Close inspector">${uiIcon("close")}</button></div></div><div class="inspector-scroll"><div class="inspector-collapsed">`;
    if (building.disabled) html += `<div class="insp-disabled">OUT OF SERVICE — this building is temporarily disabled.</div>`;
    html += `<div class="insp-d">${def.desc}</div>`;
    const architecture = building.architecture || def.architecture;
    if (architecture) {
      const summary = [
        architecture.floors ? floorText(architecture.floors) : null,
        ARCHITECTURE_NAMES.base[architecture.base], ARCHITECTURE_NAMES.roof[architecture.roof],
        ARCHITECTURE_NAMES.family[architecture.family], Number.isInteger(architecture.variant) ? `Variant ${architecture.variant + 1}` : null,
      ].filter(Boolean).join(" · ");
      html += `<div class="architecture-summary">${summary}</div>`;
    }
    html += `<div class="insp-val">Value in the current regime<span class="vbar"><span style="width:${pct}%"></span></span><b>${value.toFixed(2)}×</b></div>`;
    html += `<div class="insp-io"><div class="io-box"><b>Current output</b>${flowText(def.outputs, "+")}</div><div class="io-box"><b>Current needs</b>${flowText(def.inputs, "−")}</div></div>`;
    if (this.engine.state.tick > 0) {
      const inhabited = def.tags.includes("residential");
      const activity = inhabited ? building.occupancy ?? 0 : building.activity ?? 0;
      html += `<div class="insp-service">District service: <b>${Math.round((building.served ?? 0) * 100)}%</b><br>${inhabited ? "Occupancy" : "Activity"}: <b>${Math.round(activity * 100)}%</b></div>`;
      if (def.outputs?.money) html += `<div class="insp-service">Actual income: <b>${(building.income ?? 0).toFixed(1)} € / turn</b></div>`;
    }
    html += `<div class="insp-tags">${def.tags.map(tag => `<span class="tag${bonusTags.includes(tag) ? " hot" : ""}">${tagText(tag)}</span>`).join("")}</div>`;
    if (bonusTags.length) html += `<div class="insp-note">The <b>${REGIME_META[this.engine.dominantRegime().key].lbl}</b> regime values: ${bonusTags.map(tagText).join(", ")}.</div>`;
    const districtName = DISTRICT_NAMES[districtOf(building.c, building.r)];
    html += `<div class="insp-age">Age: ${building.age} turns · ${districtName} · local heat: ${heat.toFixed(1)}</div></div>`;

    const transformations = this.engine.transformationOptions?.(building) || [];
    if (transformations.length) {
      if (this.transformPreview?.building !== building || !transformations.some(option => option.id === this.transformPreview.id)) this.transformPreview = null;
      if (this.transformPreview) this.layerGroup = groupOf(this.transformPreview.id).id;
      if (!TRANSFORMATION_GROUPS.some(group => group.id === this.layerGroup)) this.layerGroup = "levels";
      const feedback = this.transformFeedback?.building === building ? this.transformFeedback : null;
      this.$.side?.classList.toggle("has-transform-preview", !!this.transformPreview);
      html += `<section class="living-layers"><div class="section-kicker">Living Layers</div><h2>Transform this building</h2><p class="section-help">Review every effect before spending anything.</p>${feedback?.type === "success" ? `<div class="transform-feedback success" role="status" tabindex="-1" data-transform-success>${feedback.text}</div>` : ""}<div class="transformation-groups">${TRANSFORMATION_GROUPS.map(group => {
        const offers = transformations.filter(option => group.match(option.id));
        if (!offers.length) return "";
        const open = this.layerGroup === group.id;
        return `<section class="transformation-group${open ? " active" : ""}" data-layer-group="${group.id}"><button type="button" class="layer-group-toggle" data-layer-group-toggle="${group.id}" aria-expanded="${open}" aria-controls="layer-group-${group.id}"><span>${group.label}</span><small>${offers.length}</small></button><div class="transformation-list" id="layer-group-${group.id}" ${open ? "" : "hidden"}>${offers.map(option => {
          const current = option.reason === "This transformation is already applied.";
          return `<article class="transformation-offer${this.transformPreview?.id === option.id ? " selected" : ""}"><div class="offer-heading"><span class="offer-icon">${transformationIcon(option.id)}</span><strong>${option.name}</strong><span>${costText(option.cost)}</span></div><p>${option.desc || ""}</p><p class="offer-state${current ? " current" : ""}">${current ? "Current" : option.reason || "Available now."}</p><button type="button" data-transform-preview="${option.id}" aria-expanded="${this.transformPreview?.id === option.id}">Preview transformation</button>${this.transformPreview?.id === option.id ? this.renderTransformationPreview(option, feedback) : ""}</article>`;
        }).join("")}</div></section>`;
      }).join("")}</div></section>`;
    } else {
      this.transformPreview = null;
      this.$.side?.classList.remove("has-transform-preview");
    }

    html += `<div class="inspector-collapsed">`;
    const options = this.engine.conversionOptions(building);
    if (building.conversion) {
      html += `<div class="insp-conversion converted" tabindex="-1"><strong>✓ ${def.name}</strong><p>${def.desc}</p></div>`;
    } else if (options.length) {
      html += `<div class="insp-conversion"><div class="conversion-kicker">Give this building a new role</div>${options.map(option => `<div class="conversion-offer"><strong>${option.name}</strong><p>${option.desc}</p><p class="conversion-cost">${costText(option.cost)}</p><button type="button" data-conversion="${option.id}" ${option.reason ? "disabled" : ""}>Confirm repurposing</button><p class="conversion-condition">${option.reason || `Available from phase ${option.phase}, after ${option.minAge} turns.`}</p></div>`).join("")}</div>`;
    }

    const history = Array.isArray(building.history) ? building.history : [];
    html += `<details class="insp-history"><summary>Building history</summary>${Number.isFinite(building.createdAt) ? `<p>Built on turn ${building.createdAt}</p>` : ""}${history.length ? `<ol>${history.map(event => `<li><span>Turn ${event.tick}</span><p>${event.label}</p></li>`).join("")}</ol>` : "<p>No transformations recorded yet.</p>"}</details></div></div>`;
    setHTML(this.$.inspector, html);
    this.$.inspector.classList.add("on");
    const close = document.getElementById("close-inspector");
    if (close) close.onclick = () => this.showInspector(null);
    this.$.inspector.querySelector("[data-focus-building]")?.addEventListener?.("click", () => {
      this.renderer.focusBuilding?.(building);
      this.setSideOpen?.(false);
    });
    for (const button of this.$.inspector.querySelectorAll("[data-layer-group-toggle]")) {
      button.onclick = () => {
        this.layerGroup = button.dataset.layerGroupToggle;
        this.transformPreview = null;
        this.transformFeedback = null;
        this.showInspector(building);
      };
    }
    for (const button of this.$.inspector.querySelectorAll("[data-transform-preview]")) {
      button.onclick = () => {
        this.transformFeedback = null;
        this.layerGroup = groupOf(button.dataset.transformPreview).id;
        this.transformPreview = { building, id: button.dataset.transformPreview };
        this.showInspector(building, { focusPreview: true });
      };
    }
    this.$.inspector.querySelector("[data-transform-cancel]")?.addEventListener?.("click", () => {
      const id = this.transformPreview?.id;
      this.transformPreview = null;
      this.transformFeedback = null;
      this.showInspector(building);
      if (id) this.$.inspector.querySelector(`[data-transform-preview="${id}"]`)?.focus({ preventScroll: true });
    });
    for (const button of this.$.inspector.querySelectorAll("[data-transform-confirm]")) {
      button.onclick = () => {
        const id = button.dataset.transformConfirm;
        if (this.transformBusy || this.transformPreview?.building !== building || this.transformPreview.id !== id) return;
        this.transformBusy = true;
        try {
          const reason = this.engine.transformationBlockReason(building, id);
          if (reason) {
            this.transformFeedback = { building, id, type: "error", text: reason };
            this.update();
            this.$.inspector.querySelector(".transform-feedback.error")?.focus({ preventScroll: true });
            return;
          }
          const option = this.engine.transformationOptions(building).find(item => item.id === id);
          if (this.engine.transformBuilding(building, id)) {
            this.transformPreview = null;
            this.transformFeedback = { building, id, type: "success", text: `Changes applied: ${option.name} · Spent ${costText(option.cost)}` };
            this.renderer.sync();
            this.update();
            const success = this.$.inspector.querySelector("[data-transform-success]");
            success?.focus({ preventScroll: true });
            success?.scrollIntoView({ block: "nearest", inline: "nearest" });
          } else {
            const text = this.engine.transformationBlockReason(building, id) || "This transformation could not be applied.";
            this.transformFeedback = { building, id, type: "error", text };
            this.update();
            this.$.inspector.querySelector(".transform-feedback.error")?.focus({ preventScroll: true });
          }
        } finally { this.transformBusy = false; }
      };
    }
    for (const button of this.$.inspector.querySelectorAll("[data-conversion]")) {
      button.onclick = () => {
        const id = button.dataset.conversion;
        const reason = this.engine.conversionBlockReason(building, id);
        if (reason) { this.engine.toast(reason); this.update(); return; }
        if (this.engine.convertBuilding(building, id)) {
          this.renderer.sync();
          this.update();
          this.$.inspector.querySelector(".converted")?.focus({ preventScroll: true });
        }
      };
    }
    if (!focusPreview) {
      const inspectorScroll = this.$.inspector.querySelector(".inspector-scroll");
      if (inspectorScroll) inspectorScroll.scrollTop = previousInspectorScroll;
      if (this.transformPreview) {
        const scroll = this.$.inspector.querySelector(".preview-scroll");
        if (scroll) scroll.scrollTop = previousPreviewScroll;
      }
    }
    this.syncArchitectureComparison?.();
    if (focusPreview) {
      const title = this.$.inspector.querySelector("[data-transform-title]");
      title?.focus({ preventScroll: true });
      const preview = title?.closest(".transform-preview");
      (preview || title)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (focusedAction) this.$.inspector.querySelector(focusedAction)?.focus({ preventScroll: true });
    if (changed) this.$.inspector.scrollIntoView({ block: "nearest" });
  }

  drainReports() {
    const state = this.engine.state;
    if (this.river && !this.river.canAdvance) return;
    if (state.outcome || this.$.modal.classList.contains("on")) return;
    const report = state.reports.find(item => item.id !== this.lastReportId && !item._shown);
    if (!report) return;
    report._shown = true;
    this.lastReportId = report.id;
    this.$.modal.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"><h2>${report.title}</h2><p>${report.body}</p><button id="modal-ok">Got it</button></div>`;
    this.$.modal.classList.add("on");
    const ok = document.getElementById("modal-ok");
    ok.onclick = () => this.$.modal.classList.remove("on");
    ok.focus();
    localizeDOM(this.$.modal);
  }

  drainToasts() {
    const state = this.engine.state;
    if (!state.toasts.length) return;
    const message = state.toasts.shift();
    this.$.toast.style.bottom = (this.$.palette.offsetHeight + 44) + "px";
    const toast = el("div", "toast-msg", message);
    this.$.toast.appendChild(toast);
    localizeDOM(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 400); }, 4200);
  }

  renderEnd() {
    const state = this.engine.state;
    if (this.challenge || this.river) { this.$.end.classList.remove("on"); return; } // chaque scénario a son écran de résultat
    if (!state.outcome) { this.$.end.classList.remove("on"); return; }
    if (this.$.end.classList.contains("on")) return;
    this.$.modal.classList.remove("on");
    const info = state.outcomeInfo, trajectory = info.trajectory;
    const win = state.outcome === "victory";
    this.$.end.innerHTML = `<div class="end-box ${win ? "win" : "lose"}" role="dialog" aria-modal="true"><h1>${win ? "Thriving city" : "The city faltered"}</h1><p class="end-reason">${info.reason}</p><div class="end-traj"><b>${trajectory.label}</b><br>${trajectory.desc}</div><div class="end-metrics">industry ${trajectory.metrics.industrial} · centralization ${trajectory.metrics.centralization} · green ${trajectory.metrics.green} · decentralized ${trajectory.metrics.decentralized}</div><button id="end-restart">Try another strategy</button></div>`;
    this.$.end.classList.add("on");
    const button = document.getElementById("end-restart");
    button.onclick = () => this.h.onRestart();
    button.focus();
    localizeDOM(this.$.end);
  }

  update() {
    this.renderHUD();
    this.renderRegimes();
    this.renderAdvisors();
    this.renderDiagnostic();
    this.renderObjectives();
    this.renderProjection();
    this.renderChallenge();
    if (this.engine.state.newlyUnlocked.length) { this.renderPalette(); this.renderLenses(); }
    else this.refreshPaletteAfford();
    if (this.inspectBuilding) this.showInspector(this.inspectBuilding);
    this.drainReports();
    this.drainToasts();
    this.renderEnd();
    this.riverView?.render(!!this.inspectBuilding);
  }
}
