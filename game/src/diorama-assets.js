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

const ENVIRONMENT_TRANSPORT = new Set(["path", "road", "tram"]);
const ENVIRONMENT_DIRECTIONS = [
  { dc: 0, dr: -1, rotation: Math.PI }, { dc: 1, dr: 0, rotation: Math.PI / 2 },
  { dc: 0, dr: 1, rotation: 0 }, { dc: -1, dr: 0, rotation: -Math.PI / 2 },
];
const ENVIRONMENT_DIAGONALS = [
  { dc: 1, dr: -1, rotation: 0 }, { dc: 1, dr: 1, rotation: -Math.PI / 2 },
  { dc: -1, dr: 1, rotation: Math.PI }, { dc: -1, dr: -1, rotation: Math.PI / 2 },
];

export function environmentPlanForCell(terrain, c, r, occupied = () => null) {
  if (terrain[r]?.[c] === undefined || terrain[r][c] === 1) return [];
  const at = (dc, dr) => terrain[r + dr]?.[c + dc];
  const buildingAt = (dc, dr) => dc === 0 && dr === 0 ? occupied(c, r) : occupied(c + dc, r + dr);
  const current = buildingAt(0, 0);
  // The functional quay already supplies its own platform and bank details.
  if (current?.def?.id === "river_quay") return [];
  if (current?.def?.id === "commons" || current?.architecture?.base === "civic") {
    return [{ key: "civic_plaza", x: 0, y: 0.01, z: 0, rotation: 0 }];
  }
  const built = building => !!building && !ENVIRONMENT_TRANSPORT.has(building.def?.id);
  const builtContext = built(current) || ENVIRONMENT_DIRECTIONS.some(({ dc, dr }) => built(buildingAt(dc, dr)));
  const water = ENVIRONMENT_DIRECTIONS.filter(({ dc, dr }) => at(dc, dr) === 1);
  const mask = (at(0, -1) === 1 ? 1 : 0) | (at(1, 0) === 1 ? 2 : 0) | (at(0, 1) === 1 ? 4 : 0) | (at(-1, 0) === 1 ? 8 : 0);
  const diagonalWater = ENVIRONMENT_DIAGONALS.filter(({ dc, dr }) => at(dc, dr) === 1);
  const transportNear = ENVIRONMENT_TRANSPORT.has(current?.def?.id)
    || ENVIRONMENT_DIRECTIONS.some(({ dc, dr }) => ENVIRONMENT_TRANSPORT.has(buildingAt(dc, dr)?.def?.id));
  const greenNear = ENVIRONMENT_DIRECTIONS.some(({ dc, dr }) => buildingAt(dc, dr)?.def?.id === "park" || at(dc, dr) === 4);
  const groundKey = transportNear ? "ground_path"
    : current ? "ground_soil"
      : terrain[r][c] === 2 || ENVIRONMENT_DIRECTIONS.some(({ dc, dr }) => at(dc, dr) === 2) ? "ground_fertile"
        : terrain[r][c] === 4 || greenNear ? "ground_planted" : builtContext ? "ground_soil" : null;
  const straightKey = builtContext ? "quay_straight" : "bank_straight";
  const banks = [];
  if (mask === 0 && diagonalWater.length) banks.push({ ...diagonalWater[0], key: "bank_corner_outer" });
  else if ([1, 2, 4, 8].includes(mask)) banks.push({ ...water[0], key: straightKey });
  else if (mask === 3) banks.push({ key: "bank_corner_inner", rotation: Math.PI });
  else if (mask === 6) banks.push({ key: "bank_corner_inner", rotation: Math.PI / 2 });
  else if (mask === 12) banks.push({ key: "bank_corner_inner", rotation: 0 });
  else if (mask === 9) banks.push({ key: "bank_corner_inner", rotation: -Math.PI / 2 });
  // Preserve the original terrain for narrow islands and multi-sided water.
  if (mask && !banks.length) return [];
  const modules = groundKey && !banks.length ? [{ key: groundKey, x: 0, y: 0.01, z: 0, rotation: 0 }] : [];
  for (const bank of banks) modules.push({ key: bank.key, x: 0, y: 0, z: 0, rotation: bank.rotation });
  if (!current && banks.length === 1 && banks[0].key === "bank_straight") {
    const bank = banks[0];
    modules.push({ key: "vegetation_reeds", x: bank.dc * 0.42, y: 0, z: bank.dr * 0.42, rotation: bank.rotation });
  }
  if (!current && !banks.length && (groundKey === "ground_fertile" || groundKey === "ground_planted") && terrain[r][c] !== 4) {
    modules.push({ key: "vegetation_flowers", x: 0.22, y: 0, z: -0.18, rotation: (c + r) * Math.PI / 2 });
  }
  const civicOrParkNear = ENVIRONMENT_DIRECTIONS.some(({ dc, dr }) => ["commons", "park"].includes(buildingAt(dc, dr)?.def?.id));
  if (!current && !banks.length && civicOrParkNear) {
    if ((c + r) % 2 === 0) modules.push({ key: "furniture_bench", x: -0.2, y: 0, z: 0.18, rotation: 0 });
    else modules.push({ key: "furniture_planter", x: -0.2, y: 0, z: 0.18, rotation: 0 });
  }
  return modules;
}

export function quayRotationForTarget(c, r, target) {
  const dc = (target?.c ?? c) - c, dr = (target?.r ?? r) - r;
  if (dc === 1 && dr === 0) return Math.PI / 2;
  if (dc === -1 && dr === 0) return -Math.PI / 2;
  if (dc === 0 && dr === -1) return Math.PI;
  return 0;
}

export function quayTargetForRotation(waterSides, rotation) {
  const index = waterSides.length ? Math.round(rotation / (Math.PI / 2)) % waterSides.length : 0;
  return waterSides[index] || waterSides[0] || null;
}

export function riverVisualFlows(state, terrain) {
  const buildings = state?.buildings || [];
  const hasQuay = endpoint => buildings.some(building => building.def?.id === "river_quay" && building.c === endpoint?.c && building.r === endpoint?.r);
  return (state?.riverFlows || []).map((flow, index) => ({ flow, index }))
    .filter(({ flow }) => {
      const path = flow?.path;
      return Number.isFinite(flow?.amount) && flow.amount > 0 && ["food", "water"].includes(flow.resource)
        && hasQuay(flow.sourceQuay) && hasQuay(flow.destinationQuay) && Array.isArray(path) && path.length >= 1
        && path.every((cell, index) => terrain[cell.r]?.[cell.c] === 1
          && (index === 0 || Math.abs(cell.c - path[index - 1].c) + Math.abs(cell.r - path[index - 1].r) === 1));
    })
    .sort((a, b) => b.flow.amount - a.flow.amount || a.index - b.index)
    .slice(0, 6);
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
