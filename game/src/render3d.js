/* Palimpsity — custom diorama. Rendering only: all simulation rules stay in
   CityEngine. Public rotation methods take radians and never modify buildings. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { COLS, ROWS, BUILDINGS, ARCHITECTURE_DEFAULTS, districtOf } from "./data.js";
import { localizeDOM } from "./localization.js";
import { loadDioramaManifest, loadDioramaGLB, layerPlanForBuilding, environmentPlanForCell } from "./diorama-assets.js";
import { ArchitecturePreview } from "./architecture-preview.js";

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
    this.glbTemplates = new Map(); // legacy building IDs; shared GLB resources
    this.manifest = null;
    this._architecturePreview = null;
    this.ghost = null;
    this.ghostId = null;
    this.ghostFamily = "banks";
    this.ghostArchitecture = null;
    this.ghostMats = [];
    this.ghostRotation = 0;
    this.hover = this.keyboardCell = null;
    this.lens = "none";
    this.projectionMode = "perspective";
    this.cameraScale = "valley";
    this.quality = "high";
    this.reducedEffects = false;
    this.photoMode = false;
    this.ambiance = "day";
    this.roofsVisible = true;
    this._templatesByFile = new Map();
    this._photoMaterials = new Map();
    this._environmentBatches = new Map();
    this._environmentCellParts = new Map();
    this._environmentSignatures = new Map();
    this._environmentRebuiltCells = 0;
    this._reactiveMaterials = [];
    this._people = [];
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
    this._cameraTransition = null;
    this._droughtLevel = this._droughtTarget = 0;
    this._fps = 0;
    this._syncedEngine = engine;
    this._pointer = new THREE.Vector2();
    this._offset = new THREE.Vector3();
    this._invalidColor = new THREE.Color(0xc94f3c);
    this._dryColor = new THREE.Color(0xb09a68);
    this._dryWaterColor = new THREE.Color(0x587673);
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
    const hemisphere = this.hemisphere = new THREE.HemisphereLight(0xfff6e5, 0x7f9b83, 1.45);
    scene.add(hemisphere);
    const sun = this.sun = new THREE.DirectionalLight(0xffe8c6, 2.15);
    sun.position.set(-10, 20, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 65 });
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.025;
    scene.add(sun);
    const fill = this.fill = new THREE.DirectionalLight(0xc6e1dd, 0.4);
    fill.position.set(12, 8, -10);
    scene.add(fill);
    for (const name of ["terrainRoot", "decorRoot", "environmentRoot", "haloRoot", "overlayRoot", "pickRoot", "peopleRoot"]) {
      this[name] = new THREE.Group();
      scene.add(this[name]);
    }
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.buildGround();
    this.resize();
    this.homeCamera(true);
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
    const bodyGeometry = this._keepGeometry(new THREE.BoxGeometry(0.055, 0.11, 0.04));
    const headGeometry = this._keepGeometry(new THREE.SphereGeometry(0.035, 6, 4));
    const skin = this._keepMaterial(new THREE.MeshStandardMaterial({ color: 0xd9ae85, roughness: 1 }));
    const clothes = [0x547c75, 0xb26f4b, 0x65759a].map(color => this._keepMaterial(new THREE.MeshStandardMaterial({ color, roughness: 1 })));
    for (let i = 0; i < 8; i++) {
      const person = new THREE.Group();
      const body = new THREE.Mesh(bodyGeometry, clothes[i % clothes.length]);
      body.position.y = 0.09;
      body.castShadow = true;
      const head = new THREE.Mesh(headGeometry, skin);
      head.position.y = 0.175;
      person.add(body, head);
      person.visible = false;
      person.userData.phase = i * 1.7;
      this.peopleRoot.add(person);
      this._people.push(person);
    }
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
    const manifest = await loadDioramaManifest(window);
    for (const id of Object.keys(BUILDINGS)) {
      const architecture = ARCHITECTURE_DEFAULTS[id];
      const modular = layerPlanForBuilding({ def: BUILDINGS[id], architecture }, manifest.layers);
      if (!manifest.models?.[id]?.file && !modular) throw new Error(`Model missing from the manifest: ${id}`);
    }
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
      const gltf = await loadDioramaGLB(loader, file, embedded);
      if (this._disposed) {
        const geometries = new Set(), materials = new Set();
        gltf.scene.traverse(object => {
          if (object.geometry) geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material);
        });
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        throw new Error("Loading canceled: renderer disposed");
      }
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
    for (const id of Object.keys(BUILDINGS)) if (manifest.models[id]?.file) {
      this.glbTemplates.set(id, this._templatesByFile.get(fileKey(manifest.models[id].file)));
    }
    this.terrain = this._clone(fileOf(manifest.terrain));
    this._makeLandscapeReactive?.(this.terrain);
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

  _makeLandscapeReactive(root) {
    const cloned = new Map(), entries = [];
    root.traverse(object => {
      if (!object.isMesh) return;
      const reactive = source => {
        if (!source?.color || !/grass|leaf|meadow|crop|pine|water/i.test(source.name || object.name)) return source;
        if (cloned.has(source)) return cloned.get(source);
        const material = source.clone();
        const water = /water/i.test(source.name || object.name);
        const entry = { material, baseColor: material.color.clone(), water };
        material.color.copy(entry.baseColor).lerp(water ? this._dryWaterColor : this._dryColor, this._droughtLevel * (water ? 0.75 : 0.62));
        cloned.set(source, material);
        entries.push(entry);
        this._reactiveMaterials.push(entry);
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(reactive) : reactive(object.material);
    });
    root.userData.reactiveEntries = entries;
  }

  _makeBuildingReactive(building, rec) {
    if (rec.roof && building.architecture?.roof === "garden") this._makeLandscapeReactive(rec.roof);
    else if (building.def.id === "farm" || building.def.id === "park") this._makeLandscapeReactive(rec.visual);
  }

  buildLayerMesh(building, plan) {
    const group = new THREE.Group(), visual = new THREE.Group(), model = new THREE.Group();
    group.add(visual);
    visual.add(model);
    for (let level = 0; level < plan.floors; level++) {
      const module = this._clone(fileOf(this.manifest.layers.modules[level ? plan.floorKey : plan.baseKey]));
      module.position.y = level * plan.floorHeight;
      model.add(module);
    }
    let roof = null;
    if (plan.roofKey) {
      roof = this._clone(fileOf(this.manifest.layers.modules[plan.roofKey]));
      roof.position.y = plan.floors * plan.floorHeight;
      roof.visible = plan.roofsVisible;
      this._setRoofPickable(roof, plan.roofsVisible);
      model.add(roof);
    }
    const height = plan.height ?? (plan.floors + 1) * plan.floorHeight;
    const producesSmoke = building.architecture.base === "workshop" && building.architecture.family === "works" && !building.conversion;
    return {
      group, visual, model, roof, file: plan.signature, layerSignature: plan.signature, height,
      b: null, ring: null, halo: null, spin: null, car: null, indicator: null, producesSmoke,
      smokeAt: producesSmoke ? [0.29, 0.48, -0.16] : null,
    };
  }

  buildBuildingMesh(building) {
    const plan = layerPlanForBuilding(building, this.manifest.layers, this.roofsVisible);
    const rec = plan ? this.buildLayerMesh(building, plan) : this.buildMesh(building.def);
    rec.height ||= this.manifest.models[building.def.id]?.height || 1;
    rec.producesSmoke ??= !!rec.smokeAt;
    return rec;
  }

  renderArchitectureComparison(building, optionId, beforeCanvas, afterCanvas) {
    if (this._disposed || !this._loaded) return false;
    if (!this._architecturePreview) {
      try { this._architecturePreview = new ArchitecturePreview(this); }
      catch (error) { this._architecturePreviewError = error; return false; }
    }
    return this._architecturePreview.render(building, optionId, beforeCanvas, afterCanvas);
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

  _environmentTemplateParts(key) {
    this._environmentTemplateCache ||= new Map();
    if (this._environmentTemplateCache.has(key)) return this._environmentTemplateCache.get(key);
    const file = fileOf(this.manifest.environment?.modules?.[key]);
    const template = file ? this._templatesByFile.get(fileKey(file)) : null;
    const parts = [];
    template?.updateMatrixWorld(true);
    template?.traverse(object => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const materialKey = materials.map(material => material?.uuid || "none").join(":");
      parts.push({
        id: `${object.geometry.uuid}:${materialKey}`, geometry: object.geometry, material: object.material,
        matrix: object.matrixWorld.clone(), castShadow: object.castShadow, receiveShadow: object.receiveShadow,
      });
    });
    this._environmentTemplateCache.set(key, parts);
    return parts;
  }

  _environmentParts(c, r, plan) {
    const parts = new Map();
    for (const placement of plan) {
      const moduleMatrix = new THREE.Matrix4().makeRotationY(placement.rotation || 0);
      moduleMatrix.setPosition(worldX(c) + (placement.x || 0), placement.y || 0, worldZ(r) + (placement.z || 0));
      for (const part of this._environmentTemplateParts(placement.key)) {
        if (!parts.has(part.id)) parts.set(part.id, { ...part, matrices: [] });
        parts.get(part.id).matrices.push(moduleMatrix.clone().multiply(part.matrix));
      }
    }
    return parts;
  }

  _rebuildEnvironmentBatch(id, batch) {
    const count = [...batch.cells.values()].reduce((sum, matrices) => sum + matrices.length, 0);
    if (!count) {
      if (batch.mesh) this.disposeObj(batch.mesh);
      batch.mesh = null;
      return;
    }
    if (!batch.mesh || batch.mesh.instanceMatrix.count < count) {
      if (batch.mesh) this.disposeObj(batch.mesh);
      batch.mesh = new THREE.InstancedMesh(batch.geometry, batch.material, Math.max(16, count));
      batch.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      batch.mesh.castShadow = batch.castShadow;
      batch.mesh.receiveShadow = batch.receiveShadow;
      batch.mesh.userData.environment = true;
      this.environmentRoot.add(batch.mesh);
      this._makeLandscapeReactive(batch.mesh);
    }
    const mesh = batch.mesh;
    mesh.count = count;
    let index = 0;
    for (const matrices of batch.cells.values()) for (const matrix of matrices) mesh.setMatrixAt(index++, matrix);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  _rebuildEnvironmentCell(c, r, plan) {
    const cellKey = r * COLS + c, previous = this._environmentCellParts.get(cellKey) || new Map();
    const next = this._environmentParts(c, r, plan);
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
      const source = next.get(id) || previous.get(id);
      if (!this._environmentBatches.has(id)) this._environmentBatches.set(id, { ...source, cells: new Map(), mesh: null });
      const batch = this._environmentBatches.get(id);
      if (next.has(id)) batch.cells.set(cellKey, next.get(id).matrices);
      else batch.cells.delete(cellKey);
      this._rebuildEnvironmentBatch(id, batch);
    }
    this._environmentCellParts.set(cellKey, next);
    this._environmentRebuiltCells++;
  }

  _clearEnvironment() {
    for (const batch of this._environmentBatches.values()) if (batch.mesh) this.disposeObj(batch.mesh);
    this._environmentBatches.clear();
    this._environmentCellParts.clear();
    this._environmentSignatures.clear();
    this._environmentTemplateCache?.clear();
    this.environmentRoot.clear();
  }

  _syncEnvironment(restarted = false) {
    if (!this.manifest.environment?.modules) {
      if (this._environmentBatches.size) this._clearEnvironment();
      return;
    }
    if (restarted) this._clearEnvironment();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cellKey = r * COLS + c;
      const plan = environmentPlanForCell(this.engine.terrain, c, r, (x, y) => this.engine.occ[y]?.[x] || null);
      const signature = JSON.stringify(plan);
      if (this._environmentSignatures.get(cellKey) === signature) continue;
      this._environmentSignatures.set(cellKey, signature);
      this._rebuildEnvironmentCell(c, r, plan);
    }
  }

  _syncDecor() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const key = r * COLS + c;
      const file = fileOf(this.manifest.decor[DECOR[this.engine.terrain[r][c]]]);
      let decor = this.decorByCell.get(key);
      if (decor && decor.userData.file !== file) { this.disposeObj(decor); this.decorByCell.delete(key); decor = null; }
      if (file && !decor) {
        decor = this._clone(file);
        this._makeLandscapeReactive(decor);
        decor.position.set(worldX(c), 0, worldZ(r));
        decor.userData.file = file;
        this.decorRoot.add(decor);
        this.decorByCell.set(key, decor);
      }
      if (decor) decor.visible = !this.engine.occ[r]?.[c];
    }
  }

  _activityOf(building) {
    return building?.disabled ? 0 : clamp01(building?.activity ?? building?.occupancy ?? 1);
  }

  _occupancyOf(building) {
    return building?.disabled ? 0 : clamp01(building?.occupancy ?? 0);
  }

  _syncPeople() {
    const populated = (this.engine.state.res.population || 0) > 0;
    const homes = populated ? this.engine.state.buildings.filter(building => {
      const residential = building.architecture ? building.architecture.base === "residential"
        : !!(this.engine.profileOf?.(building) || building.def)?.outputs?.population;
      return residential && this._occupancyOf(building) > 0;
    }) : [];
    const limit = this.reducedEffects || this.quality === "low" ? 3 : this.quality === "balanced" ? 5 : this._people.length;
    for (let i = 0; i < this._people.length; i++) {
      const person = this._people[i], home = i < limit ? homes[i % Math.max(1, homes.length)] : null;
      person.visible = !!home;
      if (!home) continue;
      const angle = angleOf(home.c * 2.17 + home.r * 0.91 + i * 2.4);
      person.position.set(worldX(home.c) + Math.cos(angle) * 0.43, 0.02, worldZ(home.r) + Math.sin(angle) * 0.43);
      person.rotation.y = -angle + Math.PI / 2;
      person.userData.home = home;
    }
  }

  _syncWeather() {
    const weather = this.engine.weather?.();
    this._droughtTarget = weather?.kind === "drought" ? clamp01((1 - (weather.multiplier ?? 0.55)) / 0.45) : 0;
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
      this._architecturePreview?.dispose();
      this._architecturePreview = null;
      this._buildingRotations = new WeakMap();
      this._syncedEngine = this.engine;
      this.setHover(null);
      this.setKeyboardCursor(null);
    }
    for (const b of this.engine.state.buildings) {
      let rec = this.meshByBuilding.get(b);
      const signature = layerPlanForBuilding(b, this.manifest.layers, this.roofsVisible)?.signature || `legacy:${b.def.id}`;
      if (rec && rec.structureSignature !== signature) {
        this.disposeObj(rec.group);
        rec = null;
      }
      if (!rec) {
        rec = this.buildBuildingMesh(b);
        rec.b = b;
        rec.structureSignature = signature;
        this.meshByBuilding.set(b, rec);
        this._records.add(rec);
        this._recordsByGroup.set(rec.group, rec);
        this.scene.add(rec.group);
        this._makeBuildingReactive(b, rec);
        this._applyPhotoToObject(rec.visual);
        if (rec.smokeAt && rec.producesSmoke) this.addSmoke(rec);
      }
      rec.group.position.set(worldX(b.c), 0, worldZ(b.r));
      Object.assign(rec.group.userData, { c: b.c, r: b.r, modelId: b.def.id });
      this._syncTransport(b, rec);
      this._syncHalo(b, rec);
    }
    this._updateDistanceLimits();
    this._pickTargets = [this.pickRoot];
    for (const rec of this.meshByBuilding.values()) {
      if (rec.layerSignature) this._pickTargets.push(...rec.model.children);
      else this._pickTargets.push(rec.model);
      if (rec.spin) this._pickTargets.push(rec.spin);
      if (rec.car) this._pickTargets.push(rec.car);
    }
    for (const puff of this.smokePuffs.slice()) if (!this._records.has(puff.userData.rec)) this.disposeObj(puff);
    this.smokePuffs = this.smokePuffs.filter(puff => this._records.has(puff.userData.rec));
    this._syncDecor();
    this._syncEnvironment(restarted);
    this._syncPeople();
    this._syncWeather();
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
    if (obj.isInstancedMesh) obj.dispose();
    const rec = this._recordsByGroup.get(obj);
    if (rec) {
      this._removeHalo(rec.b);
      this.removePuffsOf(rec);
      this._records.delete(rec);
      this._recordsByGroup.delete(obj);
      if (this.meshByBuilding.get(rec.b) === rec) this.meshByBuilding.delete(rec.b);
    }
    const removedReactive = new Set();
    obj.traverse(object => {
      for (const entry of object.userData.reactiveEntries || []) removedReactive.add(entry);
    });
    if (removedReactive.size) this._reactiveMaterials = this._reactiveMaterials.filter(entry => !removedReactive.has(entry));
    obj.removeFromParent();
    obj.traverse(object => {
      if (object.geometry && !this._sharedGeometries.has(object.geometry)) this._disposeGeometry(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material && !this._sharedMaterials.has(material)) this._disposeMaterial(material);
      }
    });
  }

  setQuality(quality) {
    if (!["high", "balanced", "low"].includes(quality)) return this.quality;
    const changed = this.quality !== quality;
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality !== "low";
    this.sun.castShadow = quality !== "low";
    const shadowSize = quality === "high" ? 2048 : 1024;
    if (changed && this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
    this._syncPeople();
    return this.quality;
  }

  setReducedEffects(enabled) {
    this.reducedEffects = !!enabled;
    this._syncPeople();
    return this.reducedEffects;
  }

  _applyPhotoToObject(root) {
    root?.traverse(object => {
      if (!object.isMesh) return;
      object.userData.photoOriginalMaterial ||= object.material;
      const original = object.userData.photoOriginalMaterial;
      const convert = source => {
        const illuminated = this.photoMode && (this.ambiance === "evening" || this.ambiance === "night");
        if (!illuminated || !source?.emissive || !/glass|window|fen.*tre|lantern/i.test(`${source.name} ${object.name}`)) return source;
        const key = `${source.uuid}:${this.ambiance}`;
        if (!this._photoMaterials.has(key)) {
          const material = source.clone();
          material.emissive.setHex(0xffc878);
          material.emissiveIntensity = this.ambiance === "night" ? 1.35 : 0.72;
          this._sharedMaterials.add(material);
          this._ownedMaterials.add(material);
          this._photoMaterials.set(key, material);
        }
        return this._photoMaterials.get(key);
      };
      object.material = Array.isArray(original) ? original.map(convert) : convert(original);
    });
  }

  setPhotoMode(enabled, ambiance = "day") {
    this.photoMode = !!enabled;
    this.ambiance = this.photoMode && ["day", "golden", "evening", "night"].includes(ambiance) ? ambiance : "day";
    const settings = {
      day: [0xdde7df, 0xfff6e5, 1.45, 0xffe8c6, 2.15, 0xc6e1dd, 0.4, 1.08],
      golden: [0xe8cda8, 0xffdfb0, 1.1, 0xffb36b, 2.3, 0xc6d9d2, 0.25, 1.05],
      evening: [0x8596ad, 0xc4bdd0, 0.65, 0xd79a78, 0.85, 0x91a9c4, 0.3, 0.95],
      night: [0x26364c, 0x7184aa, 0.35, 0x8ea7d8, 0.18, 0x6c84a8, 0.18, 0.82],
    }[this.ambiance];
    this.scene.background.setHex(settings[0]);
    this.scene.fog.color.setHex(settings[0]);
    this.hemisphere.color.setHex(settings[1]);
    this.hemisphere.intensity = settings[2];
    this.sun.color.setHex(settings[3]);
    this.sun.intensity = settings[4];
    const golden = this.ambiance === "golden";
    this.sun.position.set(golden ? -12 : -10, golden ? 10 : 20, golden ? 16 : 12);
    this.fill.color.setHex(settings[5]);
    this.fill.intensity = golden ? 0.38 : settings[6];
    this.renderer.toneMappingExposure = settings[7];
    for (const rec of this._records) this._applyPhotoToObject(rec.visual);
    return this.ambiance;
  }

  _setRoofPickable(roof, pickable) {
    roof.traverse(object => {
      if (!object.isMesh) return;
      if (pickable) delete object.raycast;
      else object.raycast = () => {};
    });
  }

  toggleRoof(visible = !this.roofsVisible) {
    this.roofsVisible = !!visible;
    for (const [building, rec] of this.meshByBuilding) {
      if (!rec.roof) continue;
      rec.roof.visible = this.roofsVisible;
      this._setRoofPickable(rec.roof, this.roofsVisible);
      const plan = layerPlanForBuilding(building, this.manifest.layers, this.roofsVisible);
      if (plan) rec.structureSignature = rec.layerSignature = plan.signature;
    }
    return this.roofsVisible;
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
  setGhost(id, options = {}) {
    id = id && BUILDINGS[id] ? id : null;
    const family = ["banks", "works", "gardens"].includes(options?.family) ? options.family : "banks";
    if (id === this.ghostId && (id !== "house" || family === this.ghostFamily) && (this.ghost || !id)) return;
    this._clearGhost();
    if (id !== this.ghostId) this.ghostRotation = 0;
    this.ghostId = id;
    this.ghostFamily = family;
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
    if (!this._loaded || this._disposed || !this.ghostId) { this.ghostArchitecture = null; return; }
    const cell = this.hover;
    const def = BUILDINGS[this.ghostId], defaults = ARCHITECTURE_DEFAULTS[this.ghostId];
    const architecture = defaults ? { ...defaults } : null;
    if (architecture && this.ghostId === "house") {
      architecture.family = this.ghostFamily;
      architecture.variant = cell ? (cell.c + 2 * cell.r) % 3 : 0;
    }
    this.ghostArchitecture = architecture;
    const sample = architecture ? { def, architecture } : null;
    const plan = layerPlanForBuilding(sample, this.manifest.layers, this.roofsVisible);
    const choice = cell && TRANSPORT.has(this.ghostId) ? this.getTransportChoice(this.ghostId, cell.c, cell.r) : null;
    const file = choice ? fileOf(this.manifest.transportVariants[this.ghostId][choice.variant])
      : plan?.signature || this.manifest.models[this.ghostId].file;
    if (!this.ghost || this._ghostFile !== file) {
      this._clearGhost();
      this.ghost = (plan ? this.buildLayerMesh(sample, plan) : this.buildMesh(def, choice)).group;
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
    let tallest = 2.5;
    for (const rec of this._records) tallest = Math.max(tallest, rec.height || 1);
    const groundClearance = (tallest + 0.5) / Math.cos(this.controls.maxPolarAngle);
    this.controls.minDistance = Math.max(distance / this.controls.maxZoom, groundClearance);
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
  _focusViewMetrics() {
    const width = this._width || 1, height = this._height || 1;
    if (width <= 900 || this.photoMode || typeof document === "undefined") return { right: 0, bottom: 0, fit: 1 };
    let right = 0, bottom = 0;
    const side = document.getElementById("side")?.getBoundingClientRect();
    if (side?.width && side.left > width * 0.35 && side.right > 0 && side.top < height * 0.8) {
      right = Math.min(width * 0.45, Math.max(0, width - side.left + 12));
    }
    const palette = document.getElementById("palette")?.getBoundingClientRect();
    if (palette?.height && palette.top > height * 0.45 && palette.top < height) {
      bottom = Math.min(height * 0.35, Math.max(0, height - palette.top + 12));
    }
    const availableWidth = Math.max(width * 0.5, width - right), availableHeight = Math.max(height * 0.45, height - bottom);
    return { right, bottom, fit: Math.max(1, width / availableWidth, height / availableHeight) };
  }
  _clearFocusViewOffset() {
    for (const camera of [this.perspectiveCamera, this.orthoCamera]) {
      if (!camera.view?.enabled) continue;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    this._focusInsets = null;
  }
  _updateFocusViewOffset() {
    this._clearFocusViewOffset();
    if (this.cameraScale !== "building") return;
    const { right, bottom } = this._focusViewMetrics();
    if (!right && !bottom) return;
    this.camera.setViewOffset(this._width, this._height, right / 2, bottom / 2, this._width, this._height);
    this.camera.updateProjectionMatrix();
    this._focusInsets = { right, bottom };
  }
  _moveCamera(target, viewHeight, scale, immediate = false, facade = false) {
    this._clearControlDamping();
    this._updateDistanceLimits();
    if (facade) this._offset.set(10, 9, 20);
    else this._offset.copy(this.camera.position).sub(this.controls.target);
    if (this._offset.lengthSq() < 0.001) this._offset.copy(this.homePosition).sub(this.homeTarget);
    this._offset.normalize();
    const baseHeight = this._viewHeight();
    const zoom = this.projectionMode === "ortho" ? THREE.MathUtils.clamp(baseHeight / viewHeight, this.controls.minZoom, this.controls.maxZoom) : 1;
    let distance = (this.projectionMode === "ortho" ? baseHeight : viewHeight) / (2 * HALF_TAN);
    distance = THREE.MathUtils.clamp(distance, this.controls.minDistance, this.controls.maxDistance);
    const position = target.clone().addScaledVector(this._offset, distance);
    position.y = Math.max(0.65, position.y);
    this.cameraScale = scale;
    if (scale === "building") this._updateFocusViewOffset();
    else this._clearFocusViewOffset();
    if (immediate || this.reducedEffects) {
      this._cameraTransition = null;
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.camera.zoom = zoom;
      this.camera.updateProjectionMatrix();
      this._clearControlDamping();
      this.controls.enabled = !this._contextLost;
    } else {
      this._cameraTransition = {
        elapsed: 0, duration: 0.65, fromPosition: this.camera.position.clone(), toPosition: position,
        fromTarget: this.controls.target.clone(), toTarget: target.clone(), fromZoom: this.camera.zoom, toZoom: zoom,
      };
      this.controls.enabled = false;
    }
    this.camera.updateMatrixWorld();
    this._updateFog();
  }
  _updateCameraTransition(dt) {
    const transition = this._cameraTransition;
    if (!transition) return;
    const linear = Math.min(1, (transition.elapsed += dt) / transition.duration);
    const k = linear * linear * (3 - 2 * linear);
    this.camera.position.lerpVectors(transition.fromPosition, transition.toPosition, k);
    this.controls.target.lerpVectors(transition.fromTarget, transition.toTarget, k);
    this.camera.zoom = THREE.MathUtils.lerp(transition.fromZoom, transition.toZoom, k);
    this.camera.updateProjectionMatrix();
    if (linear === 1) {
      this._cameraTransition = null;
      this.controls.enabled = !this._contextLost;
      this._clearControlDamping();
    }
  }
  focusBuilding(building) {
    if (!building || !Number.isInteger(building.c) || !Number.isInteger(building.r)) return false;
    const rec = this.meshByBuilding.get(building);
    const height = rec?.height || ((building.architecture?.floors || 1) + 1) * (this.manifest?.layers?.floorHeight || 0.48);
    const target = new THREE.Vector3(worldX(building.c), Math.max(0.35, height * 0.42), worldZ(building.r));
    const viewHeight = Math.max(5.8, height * 2.8) * this._focusViewMetrics().fit;
    this._moveCamera(target, viewHeight, "building", false, true);
    return true;
  }
  setCameraScale(scale) {
    if (scale === "valley") { this.homeCamera(); return scale; }
    if (scale === "district") {
      const target = this.controls.target.clone();
      target.y = Math.max(0.35, target.y);
      this._moveCamera(target, Math.min(10, this._viewHeight() * 0.65), "district");
      return scale;
    }
    if (scale === "building" && this.engine.state.buildings.length) {
      let nearest = this.engine.state.buildings[0], best = Infinity;
      for (const building of this.engine.state.buildings) {
        const distance = Math.hypot(worldX(building.c) - this.controls.target.x, worldZ(building.r) - this.controls.target.z);
        if (distance < best) { best = distance; nearest = building; }
      }
      this.focusBuilding(nearest);
      return scale;
    }
    return this.cameraScale;
  }
  homeCamera(immediate = false) {
    this._moveCamera(this.homeTarget.clone(), this._viewHeight(), "valley", immediate);
    return this.camera.position.clone();
  }
  setProjectionMode(mode) {
    if (mode !== "perspective" && mode !== "ortho") return this.projectionMode;
    if (mode === this.projectionMode) return mode;
    this._cameraTransition = null;
    this.controls.enabled = !this._contextLost;
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
    this._updateFocusViewOffset();
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
    const nativeRatio = globalThis.devicePixelRatio || 1;
    this.renderer.setPixelRatio(this.quality === "high" ? nativeRatio : this.quality === "balanced" ? Math.min(nativeRatio, 1.5) : 1);
    this.renderer.setSize(width, height, false);
    this._updateFocusViewOffset();
    this._updateFog();
    return { width, height, viewHeight };
  }

  _animateDisabled(rec, time) {
    const disabled = !!rec.b.disabled;
    rec.group.position.y = disabled && !this.reducedEffects ? Math.sin(time * 34) * 0.02 : 0;
    rec.visual.position.x = 0;
    rec.visual.position.z = 0;
    if (disabled && !rec.indicator) {
      rec.indicator = new THREE.Mesh(this._sparkGeometry, new THREE.MeshBasicMaterial({ color: 0xe49543, transparent: true, depthWrite: false }));
      rec.indicator.scale.setScalar(2);
      rec.indicator.position.y = (rec.height || 1) + 0.18;
      rec.group.add(rec.indicator);
    }
    if (rec.indicator) {
      rec.indicator.visible = disabled;
      rec.indicator.material.opacity = this.reducedEffects ? 0.75 : 0.5 + 0.35 * Math.sin(time * 5);
      rec.indicator.rotation.y = this.reducedEffects ? 0 : time;
    }
  }
  _updateLandscape(dt) {
    const difference = this._droughtTarget - this._droughtLevel;
    if (Math.abs(difference) < 0.0005) return;
    this._droughtLevel += difference * Math.min(1, dt * 2.2);
    for (const entry of this._reactiveMaterials) {
      entry.material.color.copy(entry.baseColor).lerp(entry.water ? this._dryWaterColor : this._dryColor, this._droughtLevel * (entry.water ? 0.75 : 0.62));
    }
  }
  frame() {
    if (this._disposed || this._contextLost) return;
    const elapsed = this.clock.getDelta(), dt = Math.min(elapsed, 0.1), time = this.clock.elapsedTime;
    if (elapsed > 0) this._fps = this._fps ? THREE.MathUtils.lerp(this._fps, 1 / elapsed, 0.08) : 1 / elapsed;
    for (const [b, rec] of this.meshByBuilding) {
      const activity = this._activityOf(b);
      this._syncHalo(b, rec);
      this._animateDisabled(rec, time);
      if (rec.spin && !this.reducedEffects) rec.spin.rotation[rec.spinAxis] += dt * 1.25 * activity;
      if (rec.car) rec.car.position.x = rec.carAnchor[0] + (this.reducedEffects ? 0 : Math.sin(time * 0.45 + b.c * 0.7 + b.r) * 0.13 * activity);
    }
    for (const halo of this.haloRoot.children) {
      if (!halo.visible) continue;
      const phase = halo.userData.phase, pulse = this.reducedEffects ? 0 : Math.sin(time * 2.2 + phase);
      halo.children[0].scale.setScalar(1 + pulse * 0.07);
      halo.children[0].material.opacity = 0.52 + pulse * 0.17;
      for (let i = 1; i < halo.children.length; i++) {
        const spark = halo.children[i], angle = time * 0.35 + i * TAU / 3 + phase;
        spark.visible = !this.reducedEffects;
        spark.position.set(Math.cos(angle) * 0.52, 0.16 + Math.sin(time * 1.8 + phase + i) * 0.07, Math.sin(angle) * 0.52);
        spark.rotation.y = time + i;
      }
    }
    for (const puff of this.smokePuffs) {
      const rec = puff.userData.rec, activity = this._activityOf(rec.b);
      puff.visible = this._records.has(rec) && !!rec.group.parent && rec.producesSmoke && activity > 0 && !this.reducedEffects;
      if (!puff.visible) continue;
      const k = puff.userData.t = (puff.userData.t + dt * (0.04 + activity * 0.09)) % 1, anchor = rec.smokeAt;
      puff.position.set(anchor[0] + k * 0.13, anchor[1] + k * 0.8, anchor[2] + Math.sin(k * 5) * 0.045);
      puff.scale.setScalar(0.65 + k * 1.6);
      puff.material.opacity = (1 - k) * 0.28 * activity;
    }
    for (const person of this._people) {
      if (!person.visible) continue;
      const occupancy = this._occupancyOf(person.userData.home);
      person.position.y = 0.02 + (this.reducedEffects ? 0 : Math.sin(time * 2 + person.userData.phase) * 0.008 * occupancy);
    }
    this._updateCameraTransition(dt);
    this._updateLandscape(dt);
    this._updateGhost(); // includes canPlace even when money/unlocks change under a still pointer
    this.applyLens();
    this.controls.update();
    this._updateFog();
    this.renderer.render(this.scene, this.camera);
  }

  getDebugInfo() {
    const drawingSize = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      models: this.glbTemplates.size, buildingCount: this.meshByBuilding.size,
      modularCount: [...this.meshByBuilding.values()].filter(rec => !!rec.layerSignature).length,
      haloCount: this.haloRoot.children.reduce((count, halo) => count + Number(halo.visible), 0),
      overlayCount: this.overlays.reduce((count, item) => count + Number(item.mesh.visible), 0),
      decorCount: [...this.decorByCell.values()].filter(decor => decor.visible).length,
      environmentBatches: [...this._environmentBatches.values()].filter(batch => !!batch.mesh).length,
      environmentInstances: [...this._environmentBatches.values()].reduce((sum, batch) => sum + (batch.mesh?.count || 0), 0),
      environmentRebuiltCells: this._environmentRebuiltCells,
      peopleCount: this._people.filter(person => person.visible).length,
      smokeCount: this.smokePuffs.filter(puff => puff.visible).length, projectionMode: this.projectionMode,
      cameraScale: this.cameraScale, quality: this.quality, reducedEffects: this.reducedEffects,
      photoMode: this.photoMode, ambiance: this.ambiance, roofsVisible: this.roofsVisible,
      previewContextCount: this._architecturePreview && !this._architecturePreview.disposed ? 1 : 0,
      pixelRatio: this.renderer.getPixelRatio(), nativePixelRatio: globalThis.devicePixelRatio || 1,
      drawingSize: { width: drawingSize.x, height: drawingSize.y }, cssSize: { width: this._width, height: this._height },
      fps: Math.round(this._fps * 10) / 10, droughtLevel: this._droughtLevel,
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
    this._architecturePreview?.dispose();
    this._architecturePreview = null;
    this._ro?.disconnect();
    globalThis.removeEventListener("resize", this._onResize);
    this.canvas.removeEventListener("webglcontextlost", this._onContextLost);
    this.controls.dispose();
    for (const rec of this._records) this.disposeObj(rec.group);
    this._clearGhost();
    this._clearEnvironment();
    this.disposeObj(this.scene);
    for (const geometry of this._ownedGeometries) this._disposeGeometry(geometry);
    for (const material of this._ownedMaterials) this._disposeMaterial(material);
    this._ownedGeometries.clear();
    this._ownedMaterials.clear();
    this._templatesByFile.clear();
    this._photoMaterials.clear();
    this.glbTemplates.clear();
    this.decorByCell.clear();
    this.meshByBuilding.clear();
    this.smokePuffs = [];
    this._reactiveMaterials = [];
    this._people = [];
    this._pickTargets = [];
    this._cameraTransition = null;
    this.renderer.dispose();
    this._errorElement?.remove();
  }
}
