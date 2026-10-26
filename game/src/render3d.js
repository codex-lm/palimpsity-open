/* Palimpsity — custom diorama. Rendering only: all simulation rules stay in
   CityEngine. Public rotation methods take radians and never modify buildings. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { COLS, ROWS, BUILDINGS, districtOf } from "./data.js";
import { localizeDOM } from "./localization.js";

const worldX = c => c - (COLS - 1) / 2;
const worldZ = r => r - (ROWS - 1) / 2;
const fileKey = file => file.split(/[\\/]/).pop().replace(/\.glb$/i, "");
const fileOf = entry => typeof entry === "string" ? entry : entry?.file;
const TRANSPORT = new Set(["path", "road", "tram"]);
const DECOR = { 2: "fertile", 3: "hill", 4: "forest" };
const HALF_TAN = Math.tan(THREE.MathUtils.degToRad(15));
const TAU = Math.PI * 2;
const clamp01 = value => Math.max(0, Math.min(1, value));
const angleOf = value => ((value % TAU) + TAU) % TAU;
const validCell = cr => !!cr && Number.isInteger(cr.c) && Number.isInteger(cr.r)
  && cr.c >= 0 && cr.c < COLS && cr.r >= 0 && cr.r < ROWS;

export function webglAvailable() {
  try { const c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl"))); }
  catch (e) { return false; }
}

function showWebglFail() {
  const languageControl = document.getElementById("language-control");
  document.body.innerHTML =
    '<div style="max-width:540px;margin:14vh auto;padding:28px 32px;font:15px/1.6 system-ui,sans-serif;color:#4a3a2a;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(120,90,60,.2)">'
    + '<h2 style="margin:0 0 10px">This prototype requires WebGL</h2>'
    + "<p>Your browser does not provide a WebGL context (3D is disabled). Open "
    + "<code>edge://gpu</code> or <code>chrome://gpu</code> and check the <b>WebGL</b> entry, "
    + "or try <b>get.webgl.org</b>. Re-enabling hardware acceleration often resolves this.</p></div>";
  if (languageControl) document.body.appendChild(languageControl);
  localizeDOM(document.body);
}

export class Renderer3D {
  constructor(engine, canvas) {
    if (!webglAvailable()) { showWebglFail(); throw new Error("WebGL is unavailable"); }
    this.engine = engine;
    this.container = this.canvas = canvas;
    // Direct scene children: main.js also removes buildings itself on restart.
    this.meshByBuilding = new Map();
    this.smokePuffs = [];
    this.glbTemplates = new Map(); // 18 building IDs; shared GLB resources
    this.manifest = null;
    this.ghost = null;
    this.ghostId = null;
    this.ghostMats = [];
    this.ghostRotation = 0;
    this.hover = this.keyboardCell = null;
    this.lens = "none";
    this.projectionMode = "perspective";
    this._templatesByFile = new Map();
    this._buildingRotations = new WeakMap();
    this._records = new Set();
    this._recordsByGroup = new WeakMap();
    this._halos = new Map();
    this._pickTargets = [];
    this._sharedGeometries = new WeakSet();
    this._sharedMaterials = new WeakSet();
    this._ownedGeometries = new Set();
    this._ownedMaterials = new Set();
    this._disposedGeometries = new WeakSet();
    this._disposedMaterials = new WeakSet();
    this._loaded = this._disposed = this._contextLost = false;
    this._ghostOk = this._ghostFile = this._responsiveHeight = null;
    this._syncedEngine = engine;
    this._pointer = new THREE.Vector2();
    this._offset = new THREE.Vector3();
    this._invalidColor = new THREE.Color(0xc94f3c);
    this._lensColors = {
      heat: [new THREE.Color(0xf3d98c), new THREE.Color(0xff4a2a)],
      logistics: [new THREE.Color(0xe6ce9f), new THREE.Color(0xcf6a3a)],
      maintenance: [new THREE.Color(0x9a8f7a), new THREE.Color(0xc05a8a)],
    };
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdde7df);
    scene.fog = new THREE.Fog(0xdde7df, 34, 72);
    this.perspectiveCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 240);
    this.orthoCamera = new THREE.OrthographicCamera(-12, 12, 8, -8, 0.1, 240);
    this.camera = this.perspectiveCamera;
    this.homePosition = new THREE.Vector3(14, 16, 18.5);
    this.homeTarget = new THREE.Vector3(0, 0.1, 0.5);
    try { this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
    catch (error) { showWebglFail(); throw error; }
    const renderer = this.renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const controls = this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(controls, { enableDamping: true, dampingFactor: 0.075, minZoom: 0.55, maxZoom: 3,
      minPolarAngle: 0.45, maxPolarAngle: 1.18, rotateSpeed: 0.55, panSpeed: 0.7, zoomSpeed: 0.8 });
    scene.add(new THREE.HemisphereLight(0xfff6e5, 0x7f9b83, 1.45));
    const sun = new THREE.DirectionalLight(0xffe8c6, 2.15);
    sun.position.set(-10, 20, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 65 });
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.025;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc6e1dd, 0.4);
    fill.position.set(12, 8, -10);
    scene.add(fill);
    for (const name of ["terrainRoot", "decorRoot", "haloRoot", "overlayRoot", "pickRoot"]) {
      this[name] = new THREE.Group();
      scene.add(this[name]);
    }
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.buildGround();
    this.resize();
    this.homeCamera();
    this._onResize = () => this.resize();
    this._onContextLost = event => {
      event.preventDefault();
      this._contextLost = true;
      controls.enabled = false;
      this._showError("The WebGL context was lost. Reload the game to return to the valley.");
    };
    globalThis.addEventListener("resize", this._onResize);
    canvas.addEventListener("webglcontextlost", this._onContextLost);
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(canvas);
      if (canvas.parentElement) this._ro.observe(canvas.parentElement);
    }
  }

  _showError(message) {
    if (this._disposed) return;
    if (!this._errorElement) {
      const panel = this._errorElement = document.createElement("div");
      panel.setAttribute("role", "alert");
      panel.dataset.palimpsityRendererError = "";
      panel.style.cssText = "position:fixed;z-index:10000;inset:20vh max(20px,calc((100vw - 540px)/2)) auto;padding:24px;border-radius:16px;background:#fff8ed;color:#4a3a2a;box-shadow:0 10px 40px #0003;font:15px/1.6 system-ui,sans-serif";
      document.body.appendChild(panel);
    }
    this._errorElement.textContent = message;
    localizeDOM(this._errorElement);
  }

  // Generated singleton resources live with the renderer. Loaded GLB resources
  // get the same protection but are never disposed by instance/ghost cleanup.
  _keepGeometry(geometry) { this._sharedGeometries.add(geometry); this._ownedGeometries.add(geometry); return geometry; }
  _keepMaterial(material) { this._sharedMaterials.add(material); this._ownedMaterials.add(material); return material; }

  buildGround() {
    const backdrop = new THREE.Mesh(this._keepGeometry(new THREE.PlaneGeometry(180, 180)),
      this._keepMaterial(new THREE.MeshStandardMaterial({ color: 0xdde7df, roughness: 1 })));
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -0.74;
    backdrop.receiveShadow = true;
    this.scene.add(backdrop);
    this.tiles = [];
    this.pickTiles = [];
    this.overlays = [];
    this.decorByCell = new Map();
    this.tileGroup = this.overlayRoot; // public lens tiles, separate from the invisible pick grid
    const tileGeometry = this._keepGeometry(new THREE.PlaneGeometry(1, 1));
    const overlayGeometry = this._keepGeometry(new THREE.PlaneGeometry(0.94, 0.94));
    const pickMaterial = this._keepMaterial(new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
    }));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const tile = new THREE.Mesh(tileGeometry, pickMaterial);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(worldX(c), 0.025, worldZ(r));
      tile.userData = { c, r };
      this.pickRoot.add(tile);
      this.pickTiles.push(tile);
      const overlay = new THREE.Mesh(overlayGeometry, new THREE.MeshBasicMaterial({
        color: 0xe4edcf, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }));
      overlay.rotation.x = -Math.PI / 2;
      overlay.position.set(worldX(c), 0.14, worldZ(r));
      overlay.renderOrder = 2;
      overlay.visible = false;
      overlay.userData = { c, r, baseTop: 0xe4edcf, topMat: overlay.material };
      this.overlayRoot.add(overlay);
      this.tiles.push(overlay);
      this.overlays.push({ c, r, mesh: overlay });
    }
    this._ringGeometry = this._keepGeometry(new THREE.RingGeometry(0.46, 0.54, 40));
    this._sparkGeometry = this._keepGeometry(new THREE.OctahedronGeometry(0.038, 0));
    this._smokeGeometry = this._keepGeometry(new THREE.SphereGeometry(0.07, 8, 6));
    this.keyboardCursor = new THREE.Mesh(this._keepGeometry(new THREE.RingGeometry(0.43, 0.49, 4)),
      this._keepMaterial(new THREE.MeshBasicMaterial({ color: 0x285f4d, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide })));
    this.keyboardCursor.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    this.keyboardCursor.position.y = 0.08;
    this.keyboardCursor.renderOrder = 5;
    this.keyboardCursor.visible = false;
    this.scene.add(this.keyboardCursor);
  }

  async loadAssets() {
    if (this._disposed) throw new Error("The renderer has been disposed.");
    if (this._loaded) return this.getDebugInfo();
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = this._loadAssets().catch(error => {
      this._loadPromise = null;
      this._showError(`The valley could not be displayed: ${error.message}. Check the diorama assets and reload the game.`);
      throw error;
    });
    return this._loadPromise;
  }

  async _loadAssets() {
    const manifest = window.__PALIMPSITY_ASSET_MANIFEST || await fetch("./art/diorama/asset-manifest.json").then(response => {
      if (!response.ok) throw new Error(`Missing asset manifest (${response.status})`);
      return response.json();
    });
    for (const id of Object.keys(BUILDINGS)) if (!manifest.models?.[id]?.file) throw new Error(`Model missing from the manifest: ${id}`);
    if (!fileOf(manifest.terrain)) throw new Error("Terrain missing from the manifest");
    for (const key of Object.values(DECOR)) if (!fileOf(manifest.decor?.[key])) throw new Error(`Scenery missing from the manifest: ${key}`);
    for (const id of TRANSPORT) for (const variant of ["end", "straight", "corner", "tee", "cross"]) {
      if (!fileOf(manifest.transportVariants?.[id]?.[variant])) throw new Error(`Missing connection variant: ${id}/${variant}`);
    }
    const files = new Set();
    const collect = value => {
      if (typeof value === "string" && /\.glb$/i.test(value)) files.add(value);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(manifest);
    const loader = new GLTFLoader();
    const embedded = window.__PALIMPSITY_ASSETS || {};
    const results = await Promise.allSettled([...files].map(async file => {
      const url = embedded[fileKey(file)] || embedded[file.split(/[\\/]/).pop()] || `./art/diorama/${file}`;
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = object.receiveShadow = true;
        object.userData.sharedRes = true;
        if (object.geometry) {
          this._sharedGeometries.add(object.geometry);
          this._ownedGeometries.add(object.geometry);
        }
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) {
          this._sharedMaterials.add(material);
          this._ownedMaterials.add(material);
        }
      });
      return [fileKey(file), gltf.scene];
    }));
    if (this._disposed) throw new Error("Loading canceled: renderer disposed");
    const failed = results.findIndex(result => result.status === "rejected");
    if (failed !== -1) throw new Error(`Asset failed to load: ${[...files][failed]} (${results[failed].reason?.message || results[failed].reason})`);
    this.manifest = manifest;
    this._templatesByFile = new Map(results.map(result => result.value));
    for (const id of Object.keys(BUILDINGS)) this.glbTemplates.set(id, this._templatesByFile.get(fileKey(manifest.models[id].file)));
    this.terrain = this._clone(fileOf(manifest.terrain));
    this.terrainRoot.add(this.terrain); // already centered at base Y=0 on genTerrain's grid
    this._loaded = true;
    this._errorElement?.remove();
    this._errorElement = null;
    this.sync();
    return this.getDebugInfo();
  }

  _clone(file) {
    const template = this._templatesByFile.get(fileKey(file));
    if (!template) throw new Error(`Asset failed to load: ${file}`);
    return template.clone(true); // normalized Blender files; no independent rescaling
  }

  getTransportChoice(id, c, r) {
    const connected = (nc, nr) => {
      const other = this.engine.occ[nr]?.[nc]?.def.id;
      return id === "tram" ? other === "tram" : other === "path" || other === "road";
    };
    const mask = (connected(c, r - 1) ? 1 : 0) | (connected(c + 1, r) ? 2 : 0)
      | (connected(c, r + 1) ? 4 : 0) | (connected(c - 1, r) ? 8 : 0);
    // Base arms: end E; straight E+W; corner E+S; tee E+W+S.
    // Positive Three.js Y rotation takes E toward N.
    if (!mask) return { mask, variant: "straight", rotation: 0 };
    if (!(mask & (mask - 1))) return { mask, variant: "end", rotation: ({ 1: Math.PI / 2, 2: 0, 4: -Math.PI / 2, 8: Math.PI })[mask] };
    if (mask === 5 || mask === 10) return { mask, variant: "straight", rotation: mask === 5 ? Math.PI / 2 : 0 };
    if ([3, 6, 9, 12].includes(mask)) return { mask, variant: "corner", rotation: ({ 3: Math.PI / 2, 6: 0, 9: Math.PI, 12: -Math.PI / 2 })[mask] };
    if ([7, 11, 13, 14].includes(mask)) return { mask, variant: "tee", rotation: ({ 7: Math.PI / 2, 11: Math.PI, 13: -Math.PI / 2, 14: 0 })[mask] };
    return { mask, variant: "cross", rotation: 0 };
  }

  buildMesh(def, choice = null) {
    const config = this.manifest.models[def.id];
    const file = choice ? fileOf(this.manifest.transportVariants[def.id][choice.variant]) : config.file;
    const group = new THREE.Group(), visual = new THREE.Group(), model = this._clone(file);
    group.add(visual);
    visual.add(model);
    const rec = { group, visual, model, file, b: null, ring: null, halo: null, smokeAt: config.smoke || null, spin: null, car: null, indicator: null };
    if (config.rotor) {
      rec.spin = this._clone(config.rotor.file);
      rec.spin.position.fromArray(config.rotor.anchor || [0, 0, 0]);
      rec.spinAxis = ["x", "y", "z"].includes(config.rotor.axis) ? config.rotor.axis : "y";
      visual.add(rec.spin);
    }
    if (config.car) {
      rec.car = this._clone(config.car.file);
      rec.carAnchor = config.car.anchor || [0, 0, 0];
      rec.car.position.fromArray(rec.carAnchor);
      visual.add(rec.car);
    }
    return rec;
  }

  _syncTransport(b, rec) {
    const id = b.def.id;
    if (!TRANSPORT.has(id)) { rec.group.rotation.y = this.getBuildingRotation(b); return; }
    const choice = this.getTransportChoice(id, b.c, b.r);
    const file = fileOf(this.manifest.transportVariants[id][choice.variant]);
    if (file !== rec.file) {
      this.disposeObj(rec.model);
      rec.model = this._clone(file);
      rec.visual.add(rec.model);
      rec.file = file;
    }
    rec.choice = choice;
    rec.group.rotation.y = choice.rotation; // automatic network orientation wins over manual R
  }

  setBuildingRotation(building, rotation = this.ghostRotation) {
    if (!building || typeof building !== "object" || !Number.isFinite(rotation)) return null;
    this._buildingRotations.set(building, angleOf(rotation));
    const rec = this.meshByBuilding.get(building);
    if (rec) this._syncTransport(building, rec);
    return this.getBuildingRotation(building);
  }
  getBuildingRotation(building) { return this._buildingRotations.get(building) || 0; }

  _syncDecor() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const key = r * COLS + c;
      const file = fileOf(this.manifest.decor[DECOR[this.engine.terrain[r][c]]]);
      let decor = this.decorByCell.get(key);
      if (decor && decor.userData.file !== file) { this.disposeObj(decor); this.decorByCell.delete(key); decor = null; }
      if (file && !decor) {
        decor = this._clone(file);
        decor.position.set(worldX(c), 0, worldZ(r));
        decor.userData.file = file;
        this.decorRoot.add(decor);
        this.decorByCell.set(key, decor);
      }
      if (decor) decor.visible = !this.engine.occ[r]?.[c];
    }
  }

  sync() {
    if (!this._loaded || this._disposed) return;
    const present = new Set(this.engine.state.buildings);
    const restarted = this._syncedEngine !== this.engine;
    // Records survive a public Map.clear(), so orphan cleanup remains reliable.
    for (const rec of this._records) {
      if (restarted || !present.has(rec.b) || this.meshByBuilding.get(rec.b) !== rec || rec.group.parent !== this.scene) this.disposeObj(rec.group);
    }
    if (restarted) {
      this._buildingRotations = new WeakMap();
      this._syncedEngine = this.engine;
      this.setHover(null);
      this.setKeyboardCursor(null);
    }
    for (const b of this.engine.state.buildings) {
      let rec = this.meshByBuilding.get(b);
      if (!rec) {
        rec = this.buildMesh(b.def, TRANSPORT.has(b.def.id) ? this.getTransportChoice(b.def.id, b.c, b.r) : null);
        rec.b = b;
        this.meshByBuilding.set(b, rec);
        this._records.add(rec);
        this._recordsByGroup.set(rec.group, rec);
        this.scene.add(rec.group);
        if (rec.smokeAt) this.addSmoke(rec);
      }
      rec.group.position.set(worldX(b.c), 0, worldZ(b.r));
      Object.assign(rec.group.userData, { c: b.c, r: b.r, modelId: b.def.id });
      this._syncTransport(b, rec);
      this._syncHalo(b, rec);
    }
    this._pickTargets = [this.pickRoot];
    for (const rec of this.meshByBuilding.values()) {
      this._pickTargets.push(rec.model);
      if (rec.spin) this._pickTargets.push(rec.spin);
      if (rec.car) this._pickTargets.push(rec.car);
    }
    for (const puff of this.smokePuffs.slice()) if (!this._records.has(puff.userData.rec)) this.disposeObj(puff);
    this.smokePuffs = this.smokePuffs.filter(puff => this._records.has(puff.userData.rec));
    this._syncDecor();
    this.applyLens();
    this._updateGhost();
  }

  _syncHalo(b, rec) {
    const on = this.engine.belongsToDominant(b);
    let halo = this._halos.get(b);
    if (!halo) {
      halo = new THREE.Group();
      halo.userData.phase = b.c * 0.7 + b.r;
      const ring = new THREE.Mesh(this._ringGeometry, new THREE.MeshBasicMaterial({ color: 0x46d36a,
        transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.07;
      halo.add(ring);
      const material = new THREE.MeshBasicMaterial({ color: 0x8de49a, transparent: true, opacity: 0.7, depthWrite: false });
      for (let i = 0; i < 3; i++) halo.add(new THREE.Mesh(this._sparkGeometry, material));
      this.haloRoot.add(halo);
      this._halos.set(b, halo);
    }
    halo.position.set(worldX(b.c), 0, worldZ(b.r));
    halo.visible = on;
    rec.halo = halo;
    rec.ring = halo.children[0];
    rec.ring.visible = on;
    if (!on) rec.ring.material.opacity = 0;
  }
  _removeHalo(b) { const halo = this._halos.get(b); if (halo) this.disposeObj(halo); this._halos.delete(b); }

  addSmoke(rec) {
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(this._smokeGeometry, new THREE.MeshStandardMaterial({
        color: 0xd8d4c6, roughness: 1, transparent: true, opacity: 0.25, depthWrite: false,
      }));
      puff.userData = { phase: i / 5, t: i / 5, rec };
      puff.position.fromArray(rec.smokeAt);
      puff.visible = !rec.b?.disabled;
      rec.visual.add(puff); // follows the rotated model and manifest anchor
      this.smokePuffs.push(puff);
    }
  }
  removePuffsOf(rec) {
    this.smokePuffs = this.smokePuffs.filter(puff => {
      if (puff.userData.rec !== rec) return true;
      this.disposeObj(puff);
      return false;
    });
  }
  _disposeGeometry(geometry) {
    if (!this._disposedGeometries.has(geometry)) { geometry.dispose(); this._disposedGeometries.add(geometry); }
  }
  _disposeMaterial(material) {
    if (!this._disposedMaterials.has(material)) { material.dispose(); this._disposedMaterials.add(material); }
  }
  disposeObj(obj) {
    if (!obj) return;
    const rec = this._recordsByGroup.get(obj);
    if (rec) {
      this._removeHalo(rec.b);
      this.removePuffsOf(rec);
      this._records.delete(rec);
      this._recordsByGroup.delete(obj);
      if (this.meshByBuilding.get(rec.b) === rec) this.meshByBuilding.delete(rec.b);
    }
    obj.removeFromParent();
    obj.traverse(object => {
      if (object.geometry && !this._sharedGeometries.has(object.geometry)) this._disposeGeometry(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material && !this._sharedMaterials.has(material)) this._disposeMaterial(material);
      }
    });
  }

  setLens(id) {
    const lens = ({ heatField: "heat", congField: "logistics", age: "maintenance" })[id] || id;
    this.lens = Object.prototype.hasOwnProperty.call(this._lensColors, lens) ? lens : "none";
    this.applyLens();
    return this.lens;
  }
  applyLens() {
    const colors = this._lensColors[this.lens];
    for (const { c, r, mesh } of this.overlays) {
      let k = 0, visible = false;
      if (this.lens === "heat") { k = clamp01((this.engine.heatField[r]?.[c] || 0) / 6); visible = k > 0; }
      else if (this.lens === "logistics") {
        const district = this.engine.state.districts[districtOf(c, r)];
        const shortage = district?.demand > 0 ? 1 - Math.min(1, district.access) : 0;
        k = clamp01(Math.max(shortage, (this.engine.congField[r]?.[c] || 0) / 5));
        visible = k > 0;
      }
      else if (this.lens === "maintenance") {
        const b = this.engine.occ[r]?.[c];
        const district = this.engine.state.districts[districtOf(c, r)];
        visible = !!b;
        const uncovered = (b?.grossMaintenance || 0) * (1 - (district?.maintenanceCovered ?? 0));
        k = clamp01(uncovered / 2.5);
      }
      mesh.visible = visible;
      if (!visible) {
        mesh.material.color.setHex(mesh.userData.baseTop);
        mesh.material.opacity = 0;
        continue;
      }
      mesh.material.color.copy(colors[0]).lerp(colors[1], k);
      mesh.material.opacity = 0.24 + k * 0.38;
    }
  }

  _clearGhost() {
    if (this.ghost) this.disposeObj(this.ghost);
    this.ghost = null;
    this.ghostMats = [];
    this._ghostFile = this._ghostOk = null;
  }
  setGhost(id) {
    id = id && BUILDINGS[id] ? id : null;
    if (id === this.ghostId && (this.ghost || !id)) return;
    this._clearGhost();
    if (id !== this.ghostId) this.ghostRotation = 0;
    this.ghostId = id;
    this._updateGhost();
  }
  setGhostRotation(rotation) {
    if (!Number.isFinite(rotation)) return this.ghostRotation;
    this.ghostRotation = angleOf(rotation);
    this._updateGhost();
    return this.ghostRotation;
  }
  setHover(cr) { this.hover = validCell(cr) ? { c: cr.c, r: cr.r } : null; this._updateGhost(); }
  setKeyboardCursor(cr) {
    this.keyboardCell = validCell(cr) ? { c: cr.c, r: cr.r } : null;
    this.keyboardCursor.visible = !!this.keyboardCell;
    if (this.keyboardCell) this.keyboardCursor.position.set(worldX(cr.c), 0.08, worldZ(cr.r));
    return this.keyboardCell;
  }
  _updateGhost() {
    if (!this._loaded || this._disposed || !this.ghostId) return;
    const cell = this.hover;
    const choice = cell && TRANSPORT.has(this.ghostId) ? this.getTransportChoice(this.ghostId, cell.c, cell.r) : null;
    const file = choice ? fileOf(this.manifest.transportVariants[this.ghostId][choice.variant]) : this.manifest.models[this.ghostId].file;
    if (!this.ghost || this._ghostFile !== file) {
      this._clearGhost();
      this.ghost = this.buildMesh(BUILDINGS[this.ghostId], choice).group;
      this._ghostFile = file;
      const cloned = new Map();
      this.ghost.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = object.receiveShadow = false;
        const cloneMaterial = source => {
          if (cloned.has(source)) return cloned.get(source);
          const material = source.clone();
          material.transparent = true;
          material.opacity = 0.5;
          material.depthWrite = false;
          if (material.color) material.userData.ghostBaseColor = material.color.clone();
          cloned.set(source, material);
          this.ghostMats.push(material);
          return material;
        };
        object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
        object.userData.clonedMat = true;
      });
      this.scene.add(this.ghost);
    }
    this.ghost.visible = !!cell;
    if (!cell) return;
    this.ghost.position.set(worldX(cell.c), 0, worldZ(cell.r));
    this.ghost.rotation.y = choice ? choice.rotation : this.ghostRotation;
    this.refreshGhostTint();
  }
  refreshGhostTint() {
    const cell = this.hover;
    if (!this.ghost?.visible || !cell) return;
    const ok = this.engine.canPlace(this.ghostId, cell.c, cell.r);
    if (ok === this._ghostOk) return;
    this._ghostOk = ok;
    for (const material of this.ghostMats) {
      if (material.color) {
        material.color.copy(material.userData.ghostBaseColor);
        if (!ok) material.color.lerp(this._invalidColor, 0.65);
      }
      if (material.emissive) { material.emissive.setHex(ok ? 0x000000 : 0xb33524); material.emissiveIntensity = ok ? 0 : 0.55; }
      material.opacity = ok ? 0.5 : 0.4;
    }
  }

  pickTile(clientX, clientY) {
    if (this._disposed || this._contextLost) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(clientX) || !Number.isFinite(clientY)
      || clientX < rect.left || clientX > rect.left + rect.width || clientY < rect.top || clientY > rect.top + rect.height) return null;
    this._pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.scene.updateMatrixWorld(true); // also works between sync() and frame()
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this._pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this._pickTargets.length ? this._pickTargets : [this.pickRoot], true);
    for (const hit of hits) {
      let object = hit.object;
      while (object && object !== this.scene) {
        if (validCell(object.userData)) return { c: object.userData.c, r: object.userData.r };
        object = object.parent;
      }
    }
    return null;
  }

  // Equivalent view-height math from maquette-complete, measured on the canvas.
  _viewHeight() { return Math.max(15.5, 20.5 / (this._width / this._height)); }
  _updateDistanceLimits() {
    const distance = this._viewHeight() / (2 * HALF_TAN);
    this.controls.minDistance = distance / this.controls.maxZoom;
    this.controls.maxDistance = distance / this.controls.minZoom;
  }
  _clearControlDamping() {
    // Consume pending deltas with damping off, then restore the requested pose.
    const position = this.camera.position.clone(), target = this.controls.target.clone();
    const zoom = this.camera.zoom, damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.controls.enableDamping = damping;
    this.controls.saveState();
  }
  homeCamera() {
    this._offset.copy(this.homePosition).sub(this.homeTarget);
    this.camera.zoom = 1;
    if (this.projectionMode === "perspective") this._offset.setLength(this._viewHeight() / (2 * HALF_TAN));
    this.camera.position.copy(this.homeTarget).add(this._offset);
    this.controls.target.copy(this.homeTarget);
    this.camera.updateProjectionMatrix();
    this._clearControlDamping();
    this.camera.updateMatrixWorld();
    this._updateFog();
    return this.camera.position.clone();
  }
  setProjectionMode(mode) {
    if (mode !== "perspective" && mode !== "ortho") return this.projectionMode;
    if (mode === this.projectionMode) return mode;
    const height = this._viewHeight(), distance = this.camera.position.distanceTo(this.controls.target);
    const zoom = this.projectionMode === "ortho" ? this.camera.zoom : height / (2 * Math.max(0.001, distance) * HALF_TAN);
    this._offset.copy(this.camera.position).sub(this.controls.target).normalize();
    this.projectionMode = mode;
    this.camera = mode === "ortho" ? this.orthoCamera : this.perspectiveCamera;
    this.controls.object = this.camera;
    this.camera.zoom = mode === "ortho" ? zoom : 1;
    this.camera.position.copy(this.controls.target).addScaledVector(this._offset, height / zoom / (2 * HALF_TAN));
    this.camera.updateProjectionMatrix();
    this._clearControlDamping();
    this.camera.updateMatrixWorld();
    this._updateFog();
    return mode;
  }
  _updateFog() {
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.scene.fog.near = Math.max(34, distance * 1.2);
    this.scene.fog.far = Math.max(72, distance * 2.7);
    const far = Math.max(240, distance + 80);
    if (this.camera.far !== far) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
  }
  resize() {
    if (this._disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || globalThis.innerWidth || 1);
    const height = Math.max(1, rect.height || this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || globalThis.innerHeight || 1);
    const zoom = this._responsiveHeight && this.projectionMode === "perspective"
      ? this._responsiveHeight / (2 * Math.max(0.001, this.camera.position.distanceTo(this.controls.target)) * HALF_TAN) : null;
    this._width = width;
    this._height = height;
    const viewHeight = this._viewHeight(), aspect = width / height;
    this._responsiveHeight = viewHeight;
    Object.assign(this.orthoCamera, { left: -viewHeight * aspect / 2, right: viewHeight * aspect / 2, top: viewHeight / 2, bottom: -viewHeight / 2 });
    this.orthoCamera.updateProjectionMatrix();
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    this._updateDistanceLimits();
    if (zoom) {
      this._offset.copy(this.camera.position).sub(this.controls.target).setLength(viewHeight / zoom / (2 * HALF_TAN));
      this.camera.position.copy(this.controls.target).add(this._offset);
      this.camera.updateMatrixWorld();
    }
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);
    this._updateFog();
    return { width, height, viewHeight };
  }

  _animateDisabled(rec, time) {
    const disabled = !!rec.b.disabled;
    rec.group.position.y = disabled ? Math.sin(time * 34) * 0.02 : 0;
    rec.visual.position.x = 0;
    rec.visual.position.z = 0;
    if (disabled && !rec.indicator) {
      rec.indicator = new THREE.Mesh(this._sparkGeometry, new THREE.MeshBasicMaterial({ color: 0xe49543, transparent: true, depthWrite: false }));
      rec.indicator.scale.setScalar(2);
      rec.indicator.position.y = (this.manifest.models[rec.b.def.id].height || 1) + 0.18;
      rec.group.add(rec.indicator);
    }
    if (rec.indicator) {
      rec.indicator.visible = disabled;
      rec.indicator.material.opacity = 0.5 + 0.35 * Math.sin(time * 5);
      rec.indicator.rotation.y = time;
    }
  }
  frame() {
    if (this._disposed || this._contextLost) return;
    const dt = Math.min(this.clock.getDelta(), 0.1), time = this.clock.elapsedTime;
    for (const [b, rec] of this.meshByBuilding) {
      this._syncHalo(b, rec);
      this._animateDisabled(rec, time);
      if (rec.spin && !b.disabled) rec.spin.rotation[rec.spinAxis] += dt * 1.25;
      if (rec.car && !b.disabled) rec.car.position.x = rec.carAnchor[0] + Math.sin(time * 0.45 + b.c * 0.7 + b.r) * 0.13;
    }
    for (const halo of this.haloRoot.children) {
      if (!halo.visible) continue;
      const phase = halo.userData.phase, pulse = Math.sin(time * 2.2 + phase);
      halo.children[0].scale.setScalar(1 + pulse * 0.07);
      halo.children[0].material.opacity = 0.52 + pulse * 0.17;
      for (let i = 1; i < halo.children.length; i++) {
        const spark = halo.children[i], angle = time * 0.35 + i * TAU / 3 + phase;
        spark.position.set(Math.cos(angle) * 0.52, 0.16 + Math.sin(time * 1.8 + phase + i) * 0.07, Math.sin(angle) * 0.52);
        spark.rotation.y = time + i;
      }
    }
    for (const puff of this.smokePuffs) {
      const rec = puff.userData.rec;
      puff.visible = this._records.has(rec) && !!rec.group.parent && !rec.b.disabled;
      if (!puff.visible) continue;
      const k = puff.userData.t = (puff.userData.t + dt * 0.13) % 1, anchor = rec.smokeAt;
      puff.position.set(anchor[0] + k * 0.13, anchor[1] + k * 0.8, anchor[2] + Math.sin(k * 5) * 0.045);
      puff.scale.setScalar(0.65 + k * 1.6);
      puff.material.opacity = (1 - k) * 0.28;
    }
    this._updateGhost(); // includes canPlace even when money/unlocks change under a still pointer
    this.applyLens();
    this.controls.update();
    this._updateFog();
    this.renderer.render(this.scene, this.camera);
  }

  getDebugInfo() {
    return {
      models: this.glbTemplates.size, buildingCount: this.meshByBuilding.size,
      haloCount: this.haloRoot.children.reduce((count, halo) => count + Number(halo.visible), 0),
      overlayCount: this.overlays.reduce((count, item) => count + Number(item.mesh.visible), 0),
      decorCount: [...this.decorByCell.values()].filter(decor => decor.visible).length,
      smokeCount: this.smokePuffs.length, projectionMode: this.projectionMode,
      loaded: this._loaded, contextLost: this._contextLost, lens: this.lens,
      ghostId: this.ghostId, ghostRotation: this.ghostRotation, ghostValid: this.ghost?.visible ? this._ghostOk : null,
      cameraDistance: this.camera.position.distanceTo(this.controls.target), viewHeight: this._viewHeight(),
      fog: { near: this.scene.fog.near, far: this.scene.fog.far },
      memory: { ...this.renderer.info.memory }, render: { ...this.renderer.info.render },
    };
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._ro?.disconnect();
    globalThis.removeEventListener("resize", this._onResize);
    this.canvas.removeEventListener("webglcontextlost", this._onContextLost);
    this.controls.dispose();
    for (const rec of this._records) this.disposeObj(rec.group);
    this._clearGhost();
    this.disposeObj(this.scene);
    for (const geometry of this._ownedGeometries) this._disposeGeometry(geometry);
    for (const material of this._ownedMaterials) this._disposeMaterial(material);
    this._ownedGeometries.clear();
    this._ownedMaterials.clear();
    this._templatesByFile.clear();
    this.glbTemplates.clear();
    this.decorByCell.clear();
    this.meshByBuilding.clear();
    this.smokePuffs = [];
    this._pickTargets = [];
    this.renderer.dispose();
    this._errorElement?.remove();
  }
}
