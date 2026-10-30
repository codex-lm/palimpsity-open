import {
  ORDER, BUILDINGS, RES_VISIBLE, RES_HIDDEN, RES_META,
  REGIMES, REGIME_META, districtOf, DISTRICT_NAMES,
} from "./data.js";
import { buildingIcon } from "./icons.js";
import { localizeDOM } from "./localization.js";
import { CHALLENGE, formatSimTime } from "./challenge.js";

const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
const FLOW_NAMES = { food: "food", water: "water", energy: "energy", materials: "materials", workers: "workers", population: "residents", money: "€", heat: "heat", trust: "trust" };
const tagText = tag => tag.replace(/_/g, " ");
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const setHTML = (node, html) => { if (node.__h !== html) { node.__h = html; node.innerHTML = html; } localizeDOM(node); };
const flowText = (flows, sign) => Object.entries(flows || {}).filter(([, value]) => value).map(([key, value]) => `${sign}${value} ${FLOW_NAMES[key] || key}`).join("<br>") || "—";
const resourceColor = key => key === "population" ? "#263c35" : key === "money" ? "#9a7625" : RES_META[key].col;

export class UI {
  constructor(engine, renderer, handlers) {
    this.engine = engine;
    this.renderer = renderer;
    this.h = handlers;
    this.selected = null;
    this.bulldoze = false;
    this.lens = "none";
    this.inspectBuilding = null;
    this.lastReportId = null;
    this.challenge = null;         // posé par main.js quand le défi tourne
    this.$ = {};
    for (const id of ["hud-res", "regimes", "clock", "speed", "palette", "advisors", "diagnostic", "inspector", "lenses", "modal", "toast", "end", "camera-home", "objectives-summary", "objectives-list", "challenge", "challenge-end"]) {
      this.$[id] = document.getElementById(id);
    }
    this.buildSpeed();
    this.buildLenses();
    this.buildCameraTools();
    this.renderPalette();
    this.renderRegimes();
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
    this.$.palette.append(heading, list, bulldoze);
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
        this.renderer.setGhost(this.selected);
        this.h.onSelect(this.selected);
        this.renderPalette();
      };
      list.appendChild(button);
    }
    state.newlyUnlocked = [];
    localizeDOM(this.$.palette);
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
      html += `<div class="regime${key === dominant ? " dom" : ""}" title="${meta.q}"><span class="rgl" style="color:${meta.col}">${meta.lbl}</span><span class="rgbar"><span style="width:${Math.round(clamp(value / 1.6 * 100, 0, 100))}%;background:${meta.col}"></span></span></div>`;
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

  showInspector(building) {
    const changed = this.inspectBuilding !== building;
    const active = document.activeElement;
    const focusedAction = this.$.inspector.contains(active)
      ? active.id === "close-inspector" ? "#close-inspector" : active.dataset?.conversion ? `[data-conversion="${active.dataset.conversion}"]` : null
      : null;
    this.inspectBuilding = building;
    if (!building || !this.engine.state.buildings.includes(building)) {
      this.inspectBuilding = null;
      setHTML(this.$.inspector, "");
      this.$.inspector.classList.remove("on");
      return;
    }
    const def = this.engine.profileOf(building);
    const value = this.engine.buildingValue(building);
    const pct = clamp((value - 0.4) / 2 * 100, 0, 100);
    const revalued = this.engine.belongsToDominant(building);
    const bonusTags = this.engine.tagBonusFor(building);
    const heat = this.engine.localHeatAt(building.c, building.r);
    let html = `<div class="insp-h"><span>${def.name}${revalued ? ' <span class="reval">⬆ renewed value</span>' : ""}</span><button type="button" id="close-inspector" aria-label="Close inspector">×</button></div>`;
    if (building.disabled) html += `<div class="insp-disabled">OUT OF SERVICE — this building is temporarily disabled.</div>`;
    html += `<div class="insp-d">${def.desc}</div>`;
    html += `<div class="insp-val">Value in the current regime<span class="vbar"><span style="width:${pct}%"></span></span><b>${value.toFixed(2)}×</b></div>`;
    html += `<div class="insp-io"><div class="io-box"><b>Base output</b>${flowText(def.outputs, "+")}</div><div class="io-box"><b>Base needs</b>${flowText(def.inputs, "−")}</div></div>`;
    if (this.engine.state.tick > 0) {
      const inhabited = def.tags.includes("residential");
      const activity = inhabited ? building.occupancy ?? 0 : building.activity ?? 0;
      html += `<div class="insp-service">District service: <b>${Math.round((building.served ?? 0) * 100)}%</b><br>${inhabited ? "Occupancy" : "Activity"}: <b>${Math.round(activity * 100)}%</b></div>`;
      if (def.outputs?.money) html += `<div class="insp-service">Actual income: <b>${(building.income ?? 0).toFixed(1)} € / turn</b></div>`;
    }
    html += `<div class="insp-tags">${def.tags.map(tag => `<span class="tag${bonusTags.includes(tag) ? " hot" : ""}">${tagText(tag)}</span>`).join("")}</div>`;
    if (bonusTags.length) html += `<div class="insp-note">The <b>${REGIME_META[this.engine.dominantRegime().key].lbl}</b> regime values: ${bonusTags.map(tagText).join(", ")}.</div>`;
    const districtName = DISTRICT_NAMES[districtOf(building.c, building.r)];
    html += `<div class="insp-age">Age: ${building.age} turns · ${districtName} · local heat: ${heat.toFixed(1)}</div>`;
    const options = this.engine.conversionOptions(building);
    if (building.conversion) {
      html += `<div class="insp-conversion converted" tabindex="-1"><strong>✓ Workshop repurposed</strong><p>Maintains the ${districtName}. This service replaces materials production.</p></div>`;
    } else if (options.length) {
      html += `<div class="insp-conversion"><div class="conversion-kicker">Give this building a new role</div>${options.map(option => `<div class="conversion-offer"><strong>${option.name}</strong><p>Maintains the ${districtName}. Replaces the workshop's materials production and sales income.</p><p class="conversion-cost">${option.cost.money} € + ${option.cost.materials} materials</p><button type="button" data-conversion="${option.id}" ${option.reason ? "disabled" : ""}>Renovate this workshop</button><p class="conversion-condition">${option.reason || `Available from phase ${option.phase}, after ${option.minAge} turns.`}</p></div>`).join("")}</div>`;
    }
    setHTML(this.$.inspector, html);
    this.$.inspector.classList.add("on");
    const close = document.getElementById("close-inspector");
    if (close) close.onclick = () => this.showInspector(null);
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
    if (focusedAction) this.$.inspector.querySelector(focusedAction)?.focus({ preventScroll: true });
    if (changed) this.$.inspector.scrollIntoView({ block: "nearest" });
  }

  drainReports() {
    const state = this.engine.state;
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
    if (this.challenge) { this.$.end.classList.remove("on"); return; } // en défi, seul l'écran du défi parle
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
  }
}
