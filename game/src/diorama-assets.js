/* Standalone models are parsed from memory: fetching a data: URI would require
   a CSP connect-src exception. The development build keeps its local URLs. */
const EMBEDDED_HEADER = "data:model/gltf-binary;base64,";
const INVALID_EMBEDDED_MODEL = "Invalid embedded model data. Rebuild the standalone game.";
const ARCHITECTURE_BASES = new Set(["residential", "shop", "workshop", "warehouse", "civic"]);
const ARCHITECTURE_ROOFS = new Set(["traditional", "garden", "productive"]);
const ARCHITECTURE_FAMILIES = new Set(["banks", "works", "gardens"]);

export function layerPlanForBuilding(building, layers, roofsVisible = true) {
  const architecture = building?.architecture;
  if (!architecture || !layers?.modules) return null;
  const { base, floors, roof, family, variant } = architecture;
  if (!ARCHITECTURE_BASES.has(base) || !Number.isInteger(floors) || floors < 1 || floors > 4
    || !ARCHITECTURE_ROOFS.has(roof) || !ARCHITECTURE_FAMILIES.has(family)
    || !Number.isInteger(variant) || variant < 0 || variant > 2) return null;
  const floorHeight = Number(layers.floorHeight);
  if (!Number.isFinite(floorHeight) || floorHeight <= 0) return null;
  if (base === "civic") {
    if (!layers.modules.base_civic?.file) return null;
    return {
      baseKey: "base_civic", floorKey: null, roofKey: null, floors: 1, floorHeight,
      roofsVisible: true, height: 1.08, signature: "base_civic|standalone",
    };
  }
  let baseKey = base === "residential" ? `base_house_${family}_${variant % 3}`
    : base === "workshop" ? `base_workshop_${family}_${variant % 2}`
      : base === "warehouse" || base === "shop" ? `base_${base}_${family}` : "base_civic";
  const conversionKey = building.conversion ? `conversion_${building.conversion}` : null;
  if (conversionKey && layers.modules[conversionKey]?.file) baseKey = conversionKey;
  const floorKey = `floor_${family}_${variant % 3}`;
  const roofKey = roof === "traditional" ? `roof_traditional_${family}_${variant % 2}` : `roof_${roof}_${family}`;
  const keys = [baseKey, ...Array.from({ length: floors - 1 }, () => floorKey), roofKey];
  if (keys.some(key => !layers.modules[key]?.file)) return null;
  return {
    baseKey, floorKey, roofKey, floors, floorHeight, roofsVisible,
    signature: [baseKey, floors, floorKey, roofKey, roofsVisible].join("|"),
  };
}

export function decodeEmbeddedGLB(uri) {
  if (typeof uri !== "string" || !uri.startsWith(EMBEDDED_HEADER)) throw new Error(INVALID_EMBEDDED_MODEL);
  let binary;
  try { binary = atob(uri.slice(EMBEDDED_HEADER.length)); }
  catch { throw new Error(INVALID_EMBEDDED_MODEL); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const header = new DataView(bytes.buffer);
  if (bytes.length < 12 || header.getUint32(0, true) !== 0x46546c67
    || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.length) {
    throw new Error(INVALID_EMBEDDED_MODEL);
  }
  return bytes.buffer;
}

export async function loadDioramaManifest(scope = globalThis) {
  // esbuild removes this development URL entirely from the standalone bundle.
  if (typeof __PALIMPSITY_EMBEDDED__ !== "undefined" && __PALIMPSITY_EMBEDDED__) {
    if (!scope.__PALIMPSITY_ASSET_MANIFEST) throw new Error("Missing embedded asset manifest. Rebuild the standalone game.");
    return scope.__PALIMPSITY_ASSET_MANIFEST;
  } else {
    if (scope.__PALIMPSITY_ASSET_MANIFEST) return scope.__PALIMPSITY_ASSET_MANIFEST;
    const response = await fetch("./art/diorama/asset-manifest.json");
    if (!response.ok) throw new Error(`Missing asset manifest (${response.status})`);
    return response.json();
  }
}

export async function loadDioramaGLB(loader, file, embedded = {}) {
  const basename = file.split(/[\\/]/).pop();
  const uri = embedded[basename.replace(/\.glb$/i, "")] ?? embedded[basename];
  if (uri !== undefined) return loader.parseAsync(decodeEmbeddedGLB(uri), "");
  if (typeof __PALIMPSITY_EMBEDDED__ !== "undefined" && __PALIMPSITY_EMBEDDED__) {
    throw new Error(`Missing embedded model: ${file}. Rebuild the standalone game.`);
  } else {
    return loader.loadAsync(`./art/diorama/${file}`);
  }
}
