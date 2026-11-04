import * as THREE from "three";
import { layerPlanForBuilding } from "./diorama-assets.js";

export function architectureForOption(architecture, optionId) {
  if (!architecture || typeof optionId !== "string") return null;
  const after = { ...architecture };
  if (optionId === "add_floor") after.floors = Math.min(4, after.floors + 1);
  else if (optionId.startsWith("family_")) after.family = optionId.slice(7);
  else if (optionId.startsWith("variant_")) after.variant = Number(optionId.slice(8));
  else if (optionId.startsWith("roof_")) after.roof = optionId.slice(5);
  else if (optionId.startsWith("base_")) after.base = optionId.slice(5);
  else return null;
  return after;
}

function canvasSize(canvas, dpr) {
  const rect = canvas?.getBoundingClientRect?.();
  const cssWidth = rect?.width || canvas?.clientWidth || 0;
  const cssHeight = rect?.height || canvas?.clientHeight || 0;
  if (!(cssWidth > 0 && cssHeight > 0)) return null;
  return {
    cssWidth, cssHeight,
    width: Math.max(1, Math.round(cssWidth * dpr)),
    height: Math.max(1, Math.round(cssHeight * dpr)),
  };
}

export class ArchitecturePreview {
  constructor(owner) {
    this.owner = owner;
    this.canvas = document.createElement("canvas");
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdde7df);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
    this.scene.add(new THREE.HemisphereLight(0xfff6e5, 0x7f9b83, 1.45));
    const sun = new THREE.DirectionalLight(0xffe8c6, 2.15);
    sun.position.set(-10, 20, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 50 });
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc6e1dd, 0.4);
    fill.position.set(12, 8, -10);
    this.scene.add(fill);
    this.groundGeometry = new THREE.PlaneGeometry(200, 200);
    this.groundMaterial = new THREE.MeshStandardMaterial({ color: 0xdde7df, roughness: 1 });
    const ground = new THREE.Mesh(this.groundGeometry, this.groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.012;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.disposed = false;
  }

  render(building, optionId, beforeCanvas, afterCanvas) {
    if (this.disposed || this.owner._disposed || !this.owner._loaded || !building?.architecture
      || !beforeCanvas || !afterCanvas || beforeCanvas === afterCanvas) return false;
    const beforeArchitecture = { ...building.architecture };
    const afterArchitecture = architectureForOption(beforeArchitecture, optionId);
    if (!afterArchitecture) return false;
    const beforePlan = layerPlanForBuilding({ ...building, architecture: beforeArchitecture }, this.owner.manifest.layers, true);
    const afterPlan = layerPlanForBuilding({ ...building, architecture: afterArchitecture }, this.owner.manifest.layers, true);
    if (!beforePlan || !afterPlan || beforePlan.signature === afterPlan.signature) return false;
    const dpr = globalThis.devicePixelRatio || 1;
    const beforeSize = canvasSize(beforeCanvas, dpr), afterSize = canvasSize(afterCanvas, dpr);
    if (!beforeSize || !afterSize) return false;
    const beforeContext = beforeCanvas.getContext("2d"), afterContext = afterCanvas.getContext("2d");
    if (!beforeContext || !afterContext) return false;
    let beforeRec, afterRec;
    try {
      beforeRec = this.owner.buildLayerMesh({ ...building, architecture: beforeArchitecture }, beforePlan);
      afterRec = this.owner.buildLayerMesh({ ...building, architecture: afterArchitecture }, afterPlan);
      beforeRec.group.updateMatrixWorld(true);
      afterRec.group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(beforeRec.group).union(new THREE.Box3().setFromObject(afterRec.group));
      const center = bounds.getCenter(new THREE.Vector3());
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const direction = new THREE.Vector3(4, 2.6, 7).normalize();
      const distance = Math.max(2, sphere.radius / Math.sin(THREE.MathUtils.degToRad(16)) * 1.12);
      this.camera.position.copy(center).addScaledVector(direction, distance);
      this.camera.lookAt(center);
      this.camera.updateMatrixWorld();
      const renderSide = (rec, canvas, context, size) => {
        this.scene.add(rec.group);
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(size.width, size.height, false);
        this.camera.aspect = size.width / size.height;
        this.camera.updateProjectionMatrix();
        this.renderer.render(this.scene, this.camera);
        if (canvas.width !== size.width) canvas.width = size.width;
        if (canvas.height !== size.height) canvas.height = size.height;
        context.clearRect(0, 0, size.width, size.height);
        context.drawImage(this.canvas, 0, 0, size.width, size.height);
        rec.group.removeFromParent();
      };
      renderSide(beforeRec, beforeCanvas, beforeContext, beforeSize);
      renderSide(afterRec, afterCanvas, afterContext, afterSize);
      return true;
    } catch (error) {
      this.lastError = error;
      return false;
    } finally {
      beforeRec?.group.removeFromParent();
      afterRec?.group.removeFromParent();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.clear();
    this.groundGeometry.dispose();
    this.groundMaterial.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
