import { getLocale, translate } from "./localization.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const say = (en, fr) => getLocale() === "fr" ? fr : en;
const text = value => esc(translate(value));
const button = (id, label, disabled = false) => `<button type="button" id="${id}" ${disabled ? "disabled" : ""}>${esc(label)}</button>`;

export class RiverPactView {
  constructor(pact, engine, handlers) {
    this.pact = pact;
    this.engine = engine;
    this.h = handlers;
    this.panel = document.getElementById("river-panel");
    this.dialog = document.getElementById("river-dialog");
    this.dialogState = "";
    this.panel.onclick = event => this.act(event.target.closest("button")?.id);
    this.dialog.onclick = event => this.act(event.target.closest("button")?.id);
    this.dialog.onkeydown = event => {
      if (event.key !== "Tab") return;
      const buttons = [...this.dialog.querySelectorAll("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === buttons.length - 1)) { event.preventDefault(); buttons[0]?.focus(); }
    };
  }

  act(id) {
    if (id === "river-start") this.h.onRiver();
    if (id === "river-step") this.h.onStep();
    if (id === "river-retry") this.h.onRestart();
    if (id === "river-exit") this.h.onExitChallenge();
    if (id === "river-gardens" || id === "river-workshops") this.h.onCharter(id.slice(6));
  }

  set(node, html) {
    if (node.__riverHTML === html) return;
    const focus = node.contains(document.activeElement) ? document.activeElement.id : null;
    const expanded = [...node.querySelectorAll("details[open][id]")].map(el => el.id);
    node.innerHTML = html;
    node.__riverHTML = html;
    for (const id of expanded) { const detail = node.querySelector(`[id="${id}"]`); if (detail) detail.open = true; }
    if (focus) node.querySelector(`[id="${focus}"]`)?.focus({ preventScroll: true });
  }

  render(compact = false) {
    const p = this.pact;
    this.panel.classList.toggle("river-compact", compact);
    this.panel.setAttribute("aria-label", say("River Pact", "Le pacte de la rivière"));
    document.body.classList.toggle("river-mode", !!p);
    this.dialog.classList.toggle("on", !!p && (p.awaitingCharter || p.status !== "running"));
    if (!p) {
      this.set(this.panel, `<div class="river-kicker">${say("A city in three acts", "Une ville en trois actes")}</div><h2>${say("River Pact", "Le pacte de la rivière")}</h2><p>${say("Found two districts. Choose a civic charter. Keep your city alive through a forecast drought.", "Fonde deux quartiers. Choisis une charte. Prépare ta ville à une sécheresse annoncée.")}</p>${button("river-start", say("Start River Pact", "Commencer le pacte"))}<small>${say("Pause freely · advance in batches of five turns", "Pauses libres · avance par cinq tours")}</small>`);
      this.dialogState = "";
      return;
    }
    const s = this.engine.state, progress = p.progress();
    const stages = [say("A foothold", "Un premier ancrage"), say("Two districts", "Deux quartiers"), say("Keep the pact", "Tenir le pacte")];
    const weather = progress.weather || this.engine.weather();
    const forecast = weather.kind === "drought"
      ? say(`Drought · water output 55% · ${Math.max(0, 150 - s.tick)} turns left`, `Sécheresse · eau à 55 % · encore ${Math.max(0, 150 - s.tick)} tours`)
      : weather.kind === "recovery"
        ? say("The river returns · water output 100%", "La rivière revient · eau à 100 %")
        : say(`Drought in ${Math.max(0, 120 - s.tick)} turns · lasts 30 turns`, `Sécheresse dans ${Math.max(0, 120 - s.tick)} tours · durée : 30 tours`);
    const charter = p.charter === "gardens" ? say("Garden commons", "Jardins communs") : say("Makers quarter", "Quartiers artisans");
    const description = [
      say("Welcome 24 residents. Keep food, water and finances healthy for 4 turns. Council grant: 200 €.", "Accueille 24 habitants. Garde nourriture, eau et finances saines pendant 4 tours. Aide du conseil : 200 €."),
      say("Two districts, housing for 12+ residents each. Meet your charter and supply goals for 4 turns. Grant: 100 €.", "Deux quartiers, chacun avec des places pour 12 habitants ou plus. Tiens la charte et l’approvisionnement pendant 4 tours. Aide : 100 €."),
      say("Keep 36+ residents supplied for 12 drought turns, then 48+ residents for 12 recovery turns.", "Approvisionne au moins 36 habitants pendant 12 tours de sécheresse, puis 48 habitants pendant 12 tours après son passage.")
    ][p.stage];
    this.set(this.panel, `<div class="river-kicker">${say("River Pact", "Le pacte de la rivière")} · ${say("Turn", "Tour")} ${s.tick}/240</div>
      <ol class="river-acts" aria-label="${say("Scenario progress", "Progression du scénario")}">${stages.map((name, i) => `<li class="${i === p.stage ? "current" : i < p.stage ? "done" : ""}" ${i === p.stage ? 'aria-current="step"' : ""}><span>${i < p.stage ? "✓" : i + 1}</span>${name}</li>`).join("")}</ol>
      <div class="river-weather ${weather.kind}"><b>${forecast}</b><div class="river-timeline" aria-hidden="true"><i style="width:${Math.min(100, s.tick / 240 * 100)}%"></i><span></span></div><small>${say("Water supply falls on turns 120–149. Add wells before it arrives.", "La production d’eau baisse aux tours 120–149. Ajoute des puits avant.")}</small></div>
      <div class="river-budget">${Math.round(s.res.population)} ${say("residents", "habitants")} · ${Math.round(s.res.money)} €${p.charter ? ` · ${charter}` : ""}</div>
      ${button("river-step", say("Advance 5 turns", "Avancer de 5 tours"), !p.canAdvance)}
      <details id="river-objectives" ${compact ? "" : "open"}><summary>${say("Full objectives", "Objectifs complets")}</summary><h2>${text(progress.stageTitle || stages[p.stage])}</h2><p>${description}</p>
      ${s.tick === 0 ? `<p>${say("Try 5 houses, 2 wells, a farm and a local market in one quarter of the map. Build while paused, then advance.", "Essaie 5 maisons, 2 puits, une ferme et un marché dans un même quart de la carte. Construis en pause, puis avance.")}</p>` : ""}
      <ul class="river-goals">${progress.rows.map(row => `<li class="${row.met ? "met" : ""}"><span aria-label="${row.met ? say("Met", "Atteint") : say("Pending", "À atteindre")}">${row.met ? "✓" : "○"}</span><div><b>${text(row.label)}</b><small>${text(row.detail)}</small></div></li>`).join("")}</ul>
      <details id="river-ledger"><summary>${say("District supplies", "Approvisionnement des quartiers")}</summary><small>${say("The map has four quarters. Each inhabited district needs its own services.", "La carte a quatre quarts. Chaque quartier habité a besoin de ses services.")}</small>${s.districts.filter(d => d.pop > 0).map(d => `<p><b>${text(d.name)}</b><br>${say("Housing", "Logements")} ${Math.round(d.pop)} · ${say("food", "nourriture")} ${Math.round(d.foodCoverage * 100)}% · ${say("water", "eau")} ${Math.round(d.waterCoverage * 100)}% · ${say("access", "accès")} ${Math.round(d.access * 100)}%</p>`).join("")}</details></details>
      <small>${say("Pauses are free. Build before advancing. Each batch stops at a decision.", "Les pauses sont libres. Construis avant d’avancer. Chaque choix arrête les tours.")}</small>`);
    const objectives = this.panel.querySelector("#river-objectives");
    if (objectives && this.compactState !== compact) { objectives.open = !compact; this.compactState = compact; }
    for (const control of document.querySelectorAll("#speed button")) control.disabled = !p.canAdvance;
    const state = p.awaitingCharter ? "charter" : p.status === "running" ? "" : p.status;
    if (!state) {
      if (this.dialogState) this.panel.querySelector("#river-step")?.focus({ preventScroll: true });
      this.dialogState = "";
      return;
    }
    document.getElementById("modal").classList.remove("on");
    const content = state === "charter" ? this.charterDialog() : this.endDialog();
    this.set(this.dialog, `<div class="river-dialog-box" role="dialog" aria-modal="true" aria-labelledby="river-dialog-title">${content}</div>`);
    if (state !== this.dialogState) {
      this.dialog.querySelector("button")?.focus();
      this.dialogState = state;
    }
  }

  charterDialog() {
    return `<div class="river-kicker">${say("Act I complete · +200 €", "Acte I terminé · +200 €")}</div><h1 id="river-dialog-title">${say("What will your city stand for?", "Quelle ville veux-tu bâtir ?")}</h1><p>${say("Choose once. Keep your commitment in both districts through the drought. The clock is paused.", "Choisis une fois. Tiens cet engagement dans les deux quartiers pendant la sécheresse. Le temps est en pause.")}</p><div class="river-charters">
      <section><div class="charter-symbol" aria-hidden="true">♧</div><h2>${say("Garden commons", "Jardins communs")}</h2><p>${say("+100 € · In each district: 2 parks and 2 wells. A cooler city with a generous water supply.", "+100 € · Dans chaque quartier : 2 parcs et 2 puits. Une ville plus fraîche avec une eau abondante.")}</p>${button("river-gardens", say("Choose the gardens", "Choisir les jardins"))}</section>
      <section><div class="charter-symbol" aria-hidden="true">⚒</div><h2>${say("Makers quarter", "Quartiers artisans")}</h2><p>${say("+200 € · In each district: 1 workshop and 1 local market. Deliver 40 materials once to complete Act II.", "+200 € · Dans chaque quartier : 1 atelier et 1 marché local. Livre 40 matériaux une fois pour finir l’acte II.")}</p>${button("river-workshops", say("Choose the workshops", "Choisir les ateliers"))}</section></div>${button("river-exit", say("Back to classic city", "Retour à la ville classique"))}`;
  }

  endDialog() {
    const p = this.pact, win = p.status === "success";
    const reason = p.failReason === "drought"
      ? say("The districts did not stay supplied for 12 consecutive drought turns. Build more wells before turn 120, and finish Act II early.", "Les quartiers n’ont pas tenu 12 tours consécutifs pendant la sécheresse. Prévois plus de puits avant le tour 120 et termine l’acte II plus tôt.")
      : p.failReason === "collapse" ? say("The city collapsed before the pact was fulfilled. Keep food, water and income in balance.", "La ville s’est effondrée avant de tenir le pacte. Équilibre nourriture, eau et revenus.")
        : say("Turn 240 arrived before the city reached all its goals. Expand housing earlier and keep both districts supplied.", "Le tour 240 est arrivé avant que la ville atteigne ses objectifs. Agrandis les logements plus tôt et approvisionne les deux quartiers.");
    return `<div class="river-kicker">${say("River Pact", "Le pacte de la rivière")} · ${say("Turn", "Tour")} ${p.finishedAtTick}</div><h1 id="river-dialog-title">${win ? say("The pact holds.", "Le pacte est tenu.") : say("The river asks for another plan.", "La rivière demande un autre plan.")}</h1><p>${win ? say("Two living districts, a promise kept, and a city that survived the drought. Try the other charter for a different city.", "Deux quartiers vivants, une promesse tenue, une ville qui a résisté à la sécheresse. Essaie l’autre charte pour bâtir autrement.") : reason}</p>${button("river-retry", say("Try another pact", "Essayer une autre charte"))} ${button("river-exit", say("Back to classic city", "Retour à la ville classique"))}`;
  }
}
