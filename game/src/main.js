import { CityEngine } from "./engine.js";
import { Renderer3D } from "./render3d.js";
import { UI } from "./ui.js";
import { BUILDINGS, COLS, ROWS, DISTRICT_NAMES, districtOf } from "./data.js";
import { getLocale, setLocale, onLocaleChange, localizeDOM } from "./localization.js";
import { FirstNeighbourhood, applyHiddenPause, shouldAdvance } from "./challenge.js";
import { RiverCityEngine, RiverPact } from "./river-pact.js";
import { RiverPactView } from "./river-pact-ui.js";
import { advanceRiverTurns } from "./river-pact-controls.js";

const languageSelect = document.getElementById("language-select");
function applyLocale() {
  document.documentElement.lang = getLocale();
  if (languageSelect) languageSelect.value = getLocale();
  localizeDOM(document);
}
languageSelect?.addEventListener("change", () => setLocale(languageSelect.value));
onLocaleChange(applyLocale);
applyLocale();

const canvas = document.getElementById("cv");
const loading = document.getElementById("loading");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let engine = new CityEngine();
let renderer, ui;
onLocaleChange(() => { ui?.riverView?.render(); ui?.update(); });
let mode = "classic";              // classic | challenge | river
let challenge = null;
let river = null;
let speedBeforePhoto = null;
const challengeStorage = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
let selected = null, bulldoze = false, selectedRotation = 0, lastTool = null;
let keyboardCell = { c: Math.floor(COLS / 2), r: Math.floor(ROWS / 2) };
let downPos = null;
const activePointers = new Set();

function showFatal(error) {
  console.error(error);
  loading.hidden = false;
  loading.classList.remove("done");
  loading.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "The valley could not be displayed";
  const text = document.createElement("span");
  text.textContent = "Check that WebGL is enabled and the valley assets are available.";
  const detail = document.createElement("small");
  detail.textContent = error?.message || String(error);
  loading.append(title, text, detail);
  localizeDOM(loading);
}

const handlers = {
  onSelect: id => {
    selected = id;
    bulldoze = false;
    lastTool = id || null;
    selectedRotation = 0;
    renderer.setGhostRotation(0);
    if (id) setStatus(`Choose a tile for ${BUILDINGS[id].name.toLowerCase()} · R to rotate`);
    else setStatus("");
  },
  onSpeed: () => {
    if (river && !river.canAdvance) { engine.state.speed = 0; ui.buildSpeed(); }
    clock.acc = 0;
  },
  onPhotoMode: enabled => {
    if (enabled) {
      speedBeforePhoto = engine.state.speed;
      engine.state.speed = 0;
    } else {
      const canResume = !engine.state.outcome && (!challenge || challenge.status === "running") && (!river || river.canAdvance);
      if (canResume && speedBeforePhoto != null) engine.state.speed = speedBeforePhoto;
      speedBeforePhoto = null;
    }
    clock.acc = 0;
    clock.last = performance.now();
    ui.buildSpeed();
  },
  onRestart: () => restart(),
  onExitChallenge: () => exitChallenge(),
  onRiver: () => { mode = "river"; restart(); },
  onCharter: id => { river?.chooseCharter(id); ui.buildSpeed(); ui.update(); },
  onStep: () => {
    if (document.hidden || document.getElementById("modal").classList.contains("on")) return;
    advanceRiverTurns(engine, river, 5);
    clock.acc = 0;
    clock.last = performance.now();
    renderer.sync();
    ui.buildSpeed();
    ui.update();
  }
};

function syncModeButton() {
  const button = document.getElementById("mode-toggle");
  const challengeMode = mode !== "classic";
  button.textContent = challengeMode ? "Classic city" : "First Neighbourhood";
  button.title = challengeMode ? "Return to the classic city" : "Start the First Neighbourhood challenge";
  button.setAttribute("aria-pressed", String(challengeMode));
  localizeDOM(button);
}

function startChallenge() {
  mode = "challenge";
  restart();
}

function exitChallenge() {
  mode = "classic";
  restart();
}

function syncTools() {
  selected = ui.selected;
  bulldoze = ui.bulldoze;
  const tool = bulldoze ? "bulldoze" : selected;
  if (tool !== lastTool) {
    selectedRotation = 0;
    renderer.setGhostRotation(0);
    lastTool = tool;
  }
}

function setStatus(message, invalid = false) {
  const status = document.getElementById("placement-status");
  status.textContent = message;
  status.classList.toggle("invalid", invalid);
  status.hidden = !message;
  localizeDOM(status);
}

function clearTools() {
  selected = null;
  bulldoze = false;
  lastTool = null;
  if (ui) {
    ui.selected = null;
    ui.bulldoze = false;
    ui.renderPalette();
  }
  renderer.setGhost(null);
  renderer.setHover(null);
  setStatus("");
}

function placementOptions(cr) {
  const options = { family: ui.buildFamily };
  if (selected === "river_quay" && cr) {
    const sides = engine.waterSides(cr.c, cr.r), index = sides.length ? Math.round(selectedRotation / (Math.PI / 2)) % sides.length : 0;
    const target = sides[index] || sides[0];
    if (target) options.target = target;
  }
  return options;
}

function cellStatus(cr) {
  if (!cr) { setStatus("Outside the valley.", true); return; }
  if (bulldoze) {
    const building = engine.occ[cr.r]?.[cr.c];
    setStatus(building ? `Demolish ${building.def.name.toLowerCase()} · 40% refund` : "Choose a building to demolish.", !building);
    return;
  }
  if (selected) {
    const def = BUILDINGS[selected], materials = def.cost?.materials || 0;
    const cost = `${def.cost?.money || 0} €${materials ? ` + ${materials} ${materials === 1 ? "material" : "materials"}` : ""}`;
    const reason = engine.placeBlockReason(selected, cr.c, cr.r, placementOptions(cr));
    setStatus((river ? `${DISTRICT_NAMES[districtOf(cr.c, cr.r)]} · ` : "") + (reason || `Place ${def.name.toLowerCase()} · ${cost} · Enter to confirm`), !!reason);
    return;
  }
  const building = engine.occ[cr.r]?.[cr.c];
  setStatus(building ? `${building.def.name} · Enter to inspect` : `Tile ${cr.c + 1}, ${cr.r + 1} · choose a building from the palette`);
}

function updateKeyboardCursor() {
  const focused = document.activeElement === canvas;
  renderer.setKeyboardCursor(focused ? keyboardCell : null);
  if (!focused) return;
  if (selected) renderer.setHover(keyboardCell);
  cellStatus(keyboardCell);
}

function handleCell(cr) {
  if (ui.photoMode || (river && river.status !== "running")) return;
  syncTools();
  if (!cr) { ui.showInspector(null); return; }
  if (bulldoze) {
    const building = engine.occ[cr.r]?.[cr.c];
    if (!building) { engine.toast("There is no building to demolish here."); ui.update(); return; }
    const moneyBefore = engine.state.res.money;
    if (engine.removeAt(cr.c, cr.r)) {
      const refund = Math.round((engine.state.res.money - moneyBefore) * 100) / 100;
      renderer.sync();
      ui.showInspector(null);
      engine.toast(`${building.def.name} demolished · +${refund} €`);
      ui.update();
    }
    return;
  }
  if (selected) {
    const building = engine.place(selected, cr.c, cr.r, placementOptions(cr));
    if (building) {
      renderer.setBuildingRotation(building, selectedRotation);
      renderer.sync();
      ui.update();
      setStatus(`${building.def.name} built · choose another tile or press Escape`);
    } else {
      const reason = engine.placeBlockReason(selected, cr.c, cr.r, placementOptions(cr));
      if (reason) { engine.toast(reason); ui.update(); }
      cellStatus(cr);
    }
    return;
  }
  ui.showInspector(engine.occ[cr.r]?.[cr.c] || null);
}

function updateHover(event) {
  if (!selected && !bulldoze) {
    renderer.setHover(null);
    return;
  }
  const cr = renderer.pickTile(event.clientX, event.clientY);
  if (cr) keyboardCell = { c: cr.c, r: cr.r };
  renderer.setHover(cr);
  cellStatus(cr);
}

function wireInputs() {
  canvas.addEventListener("pointerdown", event => {
    canvas.focus({ preventScroll: true });
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) {
      if (downPos) downPos.multi = true;
      return;
    }
    if (event.button === 0) downPos = { id: event.pointerId, lastX: event.clientX, lastY: event.clientY, travel: 0, multi: false };
  });
  canvas.addEventListener("pointermove", event => {
    if (downPos?.id === event.pointerId) {
      downPos.travel += Math.hypot(event.clientX - downPos.lastX, event.clientY - downPos.lastY);
      downPos.lastX = event.clientX;
      downPos.lastY = event.clientY;
    }
    if (activePointers.size > 1) { renderer.setHover(null); return; }
    updateHover(event);
  });
  canvas.addEventListener("pointerup", event => {
    const multi = activePointers.size > 1 || downPos?.multi;
    activePointers.delete(event.pointerId);
    if (event.button !== 0 || !downPos || downPos.id !== event.pointerId) {
      if (!activePointers.size) downPos = null;
      return;
    }
    const cancelled = multi || downPos.travel > 6;
    downPos = null;
    if (!cancelled) handleCell(renderer.pickTile(event.clientX, event.clientY));
  });
  canvas.addEventListener("pointercancel", event => {
    activePointers.delete(event.pointerId);
    if (downPos?.id === event.pointerId) downPos = null;
    else if (downPos) downPos.multi = true;
  });
  canvas.addEventListener("pointerleave", event => {
    activePointers.delete(event.pointerId);
    downPos = null;
    renderer.setHover(null);
    if (selected) setStatus(`Choose a tile for ${BUILDINGS[selected].name.toLowerCase()} · R to rotate`);
  });
  canvas.addEventListener("contextmenu", event => event.preventDefault());
  // Onglet caché : pause nette et HONNÊTE — vitesse 0, accumulateur vidé,
  // horloge réalignée. Aucune simulation ni défi n'avance tant que la page
  // est cachée, et la reprise est manuelle (bouton ▶), sans rattrapage.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      applyHiddenPause(engine, clock, performance.now());
      ui.buildSpeed();
    } else {
      clock.last = performance.now();
    }
  });
  document.getElementById("mode-toggle").onclick = () => {
    if (mode !== "classic") exitChallenge();
    else startChallenge();
  };
  canvas.addEventListener("focus", updateKeyboardCursor);
  canvas.addEventListener("blur", () => {
    renderer.setKeyboardCursor(null);
    setStatus(selected ? `Choose a tile for ${BUILDINGS[selected].name.toLowerCase()} · R to rotate` : bulldoze ? "Choose a building to demolish." : "");
  });
  addEventListener("keydown", event => {
    if (event.target === languageSelect) return;
    if (event.key === "Escape") {
      const modal = document.getElementById("modal");
      if (modal.classList.contains("on")) { document.getElementById("modal-ok")?.click(); return; }
      if (ui.photoMode) { ui.setPhotoMode(false); return; }
      if (!document.getElementById("display-panel").hidden) { ui.toggleDisplay(false); return; }
      clearTools();
      ui.showInspector(null);
      updateKeyboardCursor();
      return;
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
    if ((event.key === "p" || event.key === "P") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (document.querySelector("#modal.on, #end.on, #challenge-end.on, #river-dialog.on")) return;
      event.preventDefault();
      ui.setPhotoMode(!ui.photoMode);
      return;
    }
    if (event.code === "Space" && !["BUTTON", "INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
      event.preventDefault();
      if (ui.photoMode || (river && !river.canAdvance)) return;
      engine.state.speed = engine.state.speed === 0 ? 1 : 0;
      ui.buildSpeed();
      return;
    }
    if ((event.key === "r" || event.key === "R") && selected && !ui.photoMode) {
      event.preventDefault();
      selectedRotation = (selectedRotation + Math.PI / 2) % (Math.PI * 2);
      renderer.setGhostRotation(selectedRotation);
      setStatus(`${BUILDINGS[selected].name} · rotation ${Math.round(selectedRotation * 180 / Math.PI)}°`);
      return;
    }
    if (event.target !== canvas) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key]) {
      event.preventDefault();
      const [dc, dr] = directions[event.key];
      keyboardCell = { c: clamp(keyboardCell.c + dc, 0, COLS - 1), r: clamp(keyboardCell.r + dr, 0, ROWS - 1) };
      updateKeyboardCursor();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      handleCell(keyboardCell);
      updateKeyboardCursor();
    }
  });
}

const TICK_MS = 600;
const clock = { acc: 0, last: performance.now() };
let uiIdle = 0;
function loop(now) {
  const dt = now - clock.last;
  clock.last = now;
  if (shouldAdvance(engine, document.hidden, challenge) && (!river || river.canAdvance)) {
    clock.acc = Math.min(clock.acc + dt * engine.state.speed, TICK_MS * 4);
    let steps = 0;
    while (clock.acc >= TICK_MS && steps < 4) {
      clock.acc -= TICK_MS;
      engine.tick();
      challenge?.update();
      river?.update();
      steps++;
      if ((challenge && challenge.status !== "running") || (river && !river.canAdvance)) break;
    }
    if (((challenge && challenge.status !== "running") || (river && !river.canAdvance)) && engine.state.speed !== 0) {
      engine.state.speed = 0;                 // le défi est terminé : on fige tout
      ui.buildSpeed();
    }
    if (steps) { renderer.sync(); ui.update(); }
  } else {
    uiIdle += dt;
    if (uiIdle >= 250) { uiIdle = 0; ui.update(); }
  }
  renderer.frame();
  requestAnimationFrame(loop);
}

function restart() {
  if (ui?.photoMode) ui.setPhotoMode(false);
  document.body.classList.remove("photo-mode", "side-open");
  document.getElementById("display-panel").hidden = true;
  document.getElementById("display-toggle").setAttribute("aria-expanded", "false");
  for (const [, record] of renderer.meshByBuilding) {
    renderer.scene.remove(record.group);
    renderer.disposeObj(record.group);
  }
  renderer.meshByBuilding.clear();
  for (const puff of renderer.smokePuffs) {
    renderer.scene.remove(puff);
    renderer.disposeObj(puff);
  }
  renderer.smokePuffs = [];
  engine = mode === "river" ? new RiverCityEngine() : new CityEngine();
  // Chaque entrée/sortie de mode repart d'un moteur frais : 600 € et les
  // déblocages naturels, que ce soit pour le défi ou pour la ville classique.
  challenge = mode === "challenge" ? new FirstNeighbourhood(engine, { storage: challengeStorage }) : null;
  river = mode === "river" ? new RiverPact(engine) : null;
  renderer.engine = engine;
  renderer.setLens("none");
  renderer.setGhost(null);
  renderer.setHover(null);
  renderer.setKeyboardCursor(null);
  renderer.homeCamera();
  renderer.sync();
  ui = new UI(engine, renderer, handlers);
  ui.challenge = challenge;
  ui.river = river;
  ui.riverView = new RiverPactView(river, engine, handlers);
  ui.showInspector(null);
  selected = null;
  bulldoze = false;
  selectedRotation = 0;
  lastTool = null;
  keyboardCell = { c: Math.floor(COLS / 2), r: Math.floor(ROWS / 2) };
  clock.acc = 0;
  clock.last = performance.now();
  document.getElementById("end").classList.remove("on");
  document.getElementById("modal").classList.remove("on");
  document.getElementById("challenge-end").classList.remove("on");
  syncModeButton();
  challenge?.start();
  river?.start();
  ui.update();
}

async function start() {
  renderer = new Renderer3D(engine, canvas);
  await renderer.loadAssets();
  renderer.sync();
  ui = new UI(engine, renderer, handlers);
  ui.riverView = new RiverPactView(null, engine, handlers);
  wireInputs();
  syncModeButton();
  ui.update();
  clock.last = performance.now();
  requestAnimationFrame(loop);
  loading.classList.add("done");
  setTimeout(() => { if (loading.classList.contains("done")) loading.hidden = true; }, 500);
}

window.PALIMPSITY = {
  get engine() { return engine; },
  get renderer() { return renderer; },
  get ui() { return ui; },
  get selectedRotation() { return selectedRotation; },
  get mode() { return mode; },
  get challenge() { return challenge; }
};

start().catch(showFatal);
