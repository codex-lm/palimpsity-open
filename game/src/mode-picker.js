import { getLocale, setLocale, onLocaleChange } from "./localization.js";

// Startup mode selector shown in a native top-layer <dialog>. The module owns
// its styles and bilingual copy so the game only wires onOpen/onChoose.
const PRIMARY = ["sandbox", "creative", "river"];
const ACCENTS = { sandbox: "#72CDD2", creative: "#E6A461", river: "#7FC98F", challenge: "#B9C0D0" };
const T = {
  en: {
    heading: "Choose how to play", group: "Game mode", language: "Language",
    intro: "Three ways to found your city, plus the original timed challenge.",
    warning: "Your city is paused. Starting a new city will replace it.",
    start: "Start a new city", confirm: "Replace city and start", continue: "Return to current city",
    sandbox: ["Sandbox", "600 € starting budget. Buildings unlock as your town grows. No time limit and no end screen."],
    creative: ["God mode", "Unlimited construction budget and materials. All buildings and upgrades available. Inhabitants still need food and water. No defeat."],
    river: ["River Pact", "A three-act scenario of civic charters and drought. 240 turns."],
    challenge: ["First Neighbourhood", "The original timed challenge: raise a thriving first neighbourhood before the clock runs out."],
  },
  fr: {
    heading: "Choisis ton mode de jeu", group: "Mode de jeu", language: "Langue",
    intro: "Trois façons de fonder ta ville, plus le défi chronométré d'origine.",
    warning: "Ta ville est en pause. Commencer une nouvelle ville la remplacera.",
    start: "Commencer une ville", confirm: "Remplacer la ville et commencer", continue: "Revenir à la ville en cours",
    sandbox: ["Bac à sable", "Budget de départ de 600 €. Les bâtiments se débloquent à mesure que la ville grandit. Ni limite de temps, ni écran de fin."],
    creative: ["Mode créatif", "Budget de construction et matériaux illimités. Tous les bâtiments et améliorations disponibles. Les habitants ont toujours besoin de nourriture et d'eau. Aucune défaite."],
    river: ["Le pacte de la rivière", "Un scénario en trois actes : chartes civiques et sécheresse. 240 tours."],
    challenge: ["Premier quartier", "Le défi chronométré d'origine : bâtis un premier quartier prospère avant la fin du compte à rebours."],
  },
};
const STYLES = `
dialog.mode-picker{width:min(960px,calc(100vw - 32px));max-height:90dvh;overflow:auto;padding:24px 26px;border:1px solid rgba(240,238,233,.18);border-radius:20px;background:#252E46;color:#F0EEE9;font:14px "Avenir Next","Segoe UI",system-ui,sans-serif;box-shadow:0 18px 60px rgba(5,10,24,.5)}
dialog.mode-picker::backdrop{background:rgba(10,15,29,.72);backdrop-filter:blur(5px)}
.mp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.mp-head h2{margin:0;font:600 26px Georgia,serif}
.mp-head p{margin:6px 0 0;max-width:600px;color:#B9C0D0;font-size:12.5px;line-height:1.5}
.mp-lang{display:flex;flex-direction:column;gap:4px;color:#B9C0D0;font-size:10px;font-weight:700}
#mp-lang{padding:6px 8px;border:1px solid rgba(240,238,233,.2);border-radius:9px;background:#1B2236;color:#F0EEE9;font:inherit;font-size:11px}
.mp-warning{margin:14px 0 0;padding:10px 13px;border:1px solid rgba(230,164,97,.55);border-radius:11px;background:rgba(230,164,97,.16);color:#E6A461;font-size:12px;font-weight:700}
.mp-fieldset{margin:16px 0 0;padding:0;border:0;min-width:0}
.mp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.mp-card{display:block;padding:15px;border:1px solid rgba(240,238,233,.16);border-top:3px solid var(--mp-accent);border-radius:14px;background:rgba(240,238,233,.04);cursor:pointer;transition:background .15s,border-color .15s}
.mp-card:hover{background:rgba(240,238,233,.08)}
.mp-card:has(input:checked){border-color:var(--mp-accent);background:color-mix(in srgb,var(--mp-accent) 13%,transparent)}
.mp-card:has(input:focus-visible){outline:3px solid rgba(114,205,210,.6);outline-offset:2px}
.mp-card input{accent-color:var(--mp-accent);margin:0 0 9px}
.mp-card-title{display:block;font:600 19px Georgia,serif}
.mp-card-desc{display:block;margin-top:6px;color:#B9C0D0;font-size:11px;line-height:1.55}
.mp-secondary{margin-top:12px;padding:12px 15px;border-top-width:1px}
.mp-secondary .mp-card-title{font-size:15px}
.mp-secondary .mp-card-desc{margin-top:4px}
.mp-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:9px;margin-top:18px}
.mp-actions button{min-height:40px;padding:10px 18px;border:0;border-radius:10px;cursor:pointer;font:inherit;font-size:12px;font-weight:700}
.mp-start{background:#72CDD2;color:#1B2236}
.mp-continue{background:transparent;border:1px solid rgba(240,238,233,.3);color:#F0EEE9}
.mp-actions button:focus-visible,#mp-lang:focus-visible{outline:3px solid rgba(114,205,210,.75);outline-offset:2px}
@media(max-width:700px){.mp-head{flex-direction:column}.mp-grid{grid-template-columns:1fr}dialog.mode-picker{padding:18px}}`;
let stylesAdded = false;
function ensureStyles() {
  if (stylesAdded) return;
  stylesAdded = true;
  const style = document.createElement("style");
  style.id = "mode-picker-styles";
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export class ModePicker {
  constructor({ onChoose, onOpen } = {}) {
    this.onChoose = onChoose;
    this.onOpen = onOpen;
    this.selected = "sandbox";
    this.hasCity = false;
    this.dialog = null;
  }
  get isOpen() { return !!this.dialog?.open; }
  open({ currentMode = "sandbox", hasCity = false } = {}) {
    ensureStyles();
    this.selected = ["sandbox", "creative", "river", "challenge"].includes(currentMode) ? currentMode : "sandbox";
    this.hasCity = hasCity;
    if (!this.dialog) this.build();
    this.render();
    if (!this.isOpen) this.dialog.showModal();
    this.dialog.querySelector("input:checked")?.focus();
    this.onOpen?.();
  }
  close() { if (this.isOpen) this.dialog.close(); }
  build() {
    const dialog = this.dialog = document.createElement("dialog");
    dialog.className = "mode-picker";
    dialog.setAttribute("data-no-translate", "");
    dialog.setAttribute("aria-labelledby", "mp-title");
    dialog.setAttribute("aria-describedby", "mp-desc");
    dialog.addEventListener("keydown", event => event.stopPropagation()); // Keep game hotkeys out; native buttons/Escape unaffected.
    dialog.addEventListener("cancel", event => { if (!this.hasCity) event.preventDefault(); });
    dialog.addEventListener("change", event => {
      if (event.target.name === "mp-mode") this.selected = event.target.value;
      else if (event.target.id === "mp-lang") setLocale(event.target.value);
    });
    dialog.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (button?.id === "mp-continue") this.close();
      else if (button?.id === "mp-start") { const selected = this.selected; this.close(); this.onChoose?.(selected); }
    });
    document.body.appendChild(dialog);
    onLocaleChange(() => { if (this.isOpen) this.render(true); });
  }
  card(mode, t, extra) {
    const [title, desc] = t[mode];
    const checked = this.selected === mode ? " checked" : "";
    return `<label class="mp-card${extra}" style="--mp-accent:${ACCENTS[mode]}"><input type="radio" name="mp-mode" id="mp-${mode}" value="${mode}" data-mode="${mode}"${checked}><span class="mp-card-title">${title}</span><span class="mp-card-desc">${desc}</span></label>`;
  }
  render(restoreFocus = false) {
    const active = document.activeElement;
    const focusId = restoreFocus && this.dialog.contains(active) && active.id ? active.id : "";
    const t = T[getLocale()] || T.en;
    this.dialog.innerHTML = `
<div class="mp-head"><div><h2 id="mp-title">${t.heading}</h2><p id="mp-desc">${t.intro}</p></div>
<label class="mp-lang">${t.language}<select id="mp-lang" aria-label="${t.language}"><option value="en" data-no-translate>English</option><option value="fr" data-no-translate>Français</option></select></label></div>
${this.hasCity ? `<p class="mp-warning" role="alert">${t.warning}</p>` : ""}
<fieldset class="mp-fieldset"><legend class="mp-sr">${t.group}</legend>
<div class="mp-grid">${PRIMARY.map(mode => this.card(mode, t, "")).join("")}</div>
${this.card("challenge", t, " mp-secondary")}
</fieldset>
<div class="mp-actions">${this.hasCity ? `<button type="button" id="mp-continue" class="mp-continue">${t.continue}</button>` : ""}<button type="button" id="mp-start" class="mp-start">${this.hasCity ? t.confirm : t.start}</button></div>`;
    this.dialog.querySelector("#mp-lang").value = getLocale();
    if (focusId) this.dialog.querySelector("#" + CSS.escape(focusId))?.focus();
  }
}
