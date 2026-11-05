import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COLS, ROWS, genTerrain } from "./src/data.js";

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const outputDir = path.join(gameDir, "art", "diorama");
const script = path.join(outputDir, "build_assets.py");
const blender = process.env.BLENDER_EXE;
const demoModelIds = ["house", "well", "farm", "workshop", "market", "generator", "park"];
const catalogModelIds = [...demoModelIds, "path", "road", "factory", "warehouse", "water_plant", "tower", "depot", "tram", "maint_center", "greenhouse", "recycler", "river_quay"];
const transportIds = ["path", "road", "tram"];
const variantNames = ["end", "straight", "corner", "tee", "cross"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function collectGlbFiles(value, files = new Set()) {
  if (typeof value === "string" && value.endsWith(".glb")) files.add(value);
  else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectGlbFiles(child, files);
  }
  return files;
}

async function writeGameMap() {
  const terrain = genTerrain();
  assert(COLS === 16 && ROWS === 12, `Dimensions inattendues dans data.js: ${COLS} × ${ROWS}`);
  assert(Array.isArray(terrain) && terrain.length === ROWS, "genTerrain: nombre de lignes invalide");
  assert(terrain.every((row) => Array.isArray(row) && row.length === COLS && row.every((value) => Number.isInteger(value) && value >= 0 && value <= 4)), "genTerrain: contenu invalide");
  const payload = { cols: COLS, rows: ROWS, terrain };
  await writeFile(path.join(outputDir, "game-map.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Carte du jeu écrite depuis data.js: ${COLS} × ${ROWS}`);
}

async function validateOutputs() {
  const demoMap = JSON.parse(await readFile(path.join(outputDir, "map.json"), "utf8"));
  assert(demoMap.cols === 16 && demoMap.rows === 12 && Array.isArray(demoMap.rowsData) && demoMap.rowsData.length === 12, "map.json ne respecte pas le format 16 × 12.");
  assert(demoMap.rowsData.every((row) => typeof row === "string" && row.length === 16 && /^[.FHWTP]+$/.test(row)), "rowsData contient une ligne ou un caractère invalide.");
  assert(Array.isArray(demoMap.initial), "map.json: initial est absent.");
  const occupied = new Set();
  for (const item of demoMap.initial) {
    assert(demoModelIds.includes(item.id) && Number.isInteger(item.c) && Number.isInteger(item.r) && typeof item.rotation === "number", `Placement démo invalide: ${JSON.stringify(item)}`);
    const key = `${item.c},${item.r}`;
    assert(!occupied.has(key) && ".FH".includes(demoMap.rowsData[item.r]?.[item.c] ?? ""), `Placement démo interdit ou dupliqué: ${key}`);
    occupied.add(key);
  }
  for (const id of demoModelIds) assert(demoMap.initial.some((item) => item.id === id), `La démo ne contient pas ${id}.`);

  const gameMap = JSON.parse(await readFile(path.join(outputDir, "game-map.json"), "utf8"));
  assert(Object.keys(gameMap).sort().join(",") === "cols,rows,terrain", "game-map.json: clés racine invalides");
  assert(gameMap.cols === COLS && gameMap.rows === ROWS && gameMap.terrain.length === ROWS, "game-map.json: dimensions invalides");
  assert(gameMap.terrain.every((row) => row.length === COLS && row.every((value) => Number.isInteger(value) && value >= 0 && value <= 4)), "game-map.json: terrain invalide");
  assert(JSON.stringify(gameMap.terrain) === JSON.stringify(genTerrain()), "game-map.json ne correspond pas à genTerrain()");

  const manifest = JSON.parse(await readFile(path.join(outputDir, "asset-manifest.json"), "utf8"));
  assert(Object.keys(manifest).sort().join(",") === "decor,environment,layers,models,riverAssets,terrain,transportVariants", "Manifeste: structure racine invalide");
  assert(manifest.terrain === "terrain-game.glb", "Manifeste: terrain invalide");
  assert(Object.keys(manifest.models).length === 19 && catalogModelIds.every((id) => id in manifest.models), "Manifeste: les 19 ids sont requis");
  for (const [id, entry] of Object.entries(manifest.models)) {
    assert(entry.file === `${id}.glb` && entry.footprint <= 0.95 && entry.height > 0, `Manifeste: entrée invalide pour ${id}`);
  }
  assert(manifest.models.tower.height > 1.7 && manifest.models.tower.height <= 2.1, "Manifeste: la hauteur de tower doit être signalée");
  assert(Array.isArray(manifest.models.generator.smoke) && manifest.models.generator.smoke.length === 3, "Manifeste: fumée generator absente");
  assert(Array.isArray(manifest.models.factory.smoke) && manifest.models.factory.smoke.length === 3, "Manifeste: fumée factory absente");
  assert(manifest.models.recycler.rotor?.file === "recycler_rotor.glb" && manifest.models.recycler.rotor.axis === "y" && manifest.models.recycler.rotor.anchor.length === 3, "Manifeste: rotor invalide");
  assert(manifest.models.tram.car?.file === "tram_car.glb" && manifest.models.tram.car.anchor.length === 3, "Manifeste: rame invalide");
  for (const kind of transportIds) {
    assert(Object.keys(manifest.transportVariants[kind] ?? {}).sort().join(",") === [...variantNames].sort().join(","), `Manifeste: variantes ${kind} invalides`);
    for (const variant of variantNames) assert(manifest.transportVariants[kind][variant] === `${kind}_${variant}.glb`, `Manifeste: fichier ${kind}_${variant} invalide`);
  }
  assert(manifest.decor.forest === "forest.glb" && manifest.decor.hill === "hill.glb" && manifest.decor.fertile === "fertile.glb", "Manifeste: décors invalides");

  const families = ["banks", "works", "gardens"];
  const layerKeys = [
    ...families.flatMap((family) => [0, 1, 2].map((variant) => `base_house_${family}_${variant}`)),
    ...families.flatMap((family) => [0, 1].map((variant) => `base_workshop_${family}_${variant}`)),
    ...families.map((family) => `base_warehouse_${family}`),
    ...families.map((family) => `base_shop_${family}`),
    "base_civic",
    ...families.flatMap((family) => [0, 1, 2].map((variant) => `floor_${family}_${variant}`)),
    ...families.flatMap((family) => [0, 1].map((variant) => `roof_traditional_${family}_${variant}`)),
    ...families.map((family) => `roof_garden_${family}`),
    ...families.map((family) => `roof_productive_${family}`),
    "conversion_workshop_repair", "conversion_warehouse_hall",
  ];
  assert(layerKeys.length === 45 && manifest.layers?.floorHeight === 0.48, "Manifeste: contrat layers invalide");
  assert(Object.keys(manifest.layers.modules ?? {}).sort().join(",") === [...layerKeys].sort().join(","), "Manifeste: les 45 modules layers sont requis");
  for (const key of layerKeys) assert(manifest.layers.modules[key].file === `layers/${key}.glb`, `Manifeste: module ${key} invalide`);

  const environmentKeys = [
    "bank_straight", "bank_corner_inner", "bank_corner_outer", "quay_straight",
    "ground_path", "ground_soil", "ground_fertile", "ground_planted",
    "civic_plaza", "vegetation_reeds", "vegetation_flowers",
    "furniture_bench", "furniture_lamp", "furniture_planter",
  ];
  assert(environmentKeys.length === 14, "Manifeste: contrat environment invalide");
  assert(Object.keys(manifest.environment?.modules ?? {}).sort().join(",") === [...environmentKeys].sort().join(","), "Manifeste: les 14 modules environment sont requis");
  for (const key of environmentKeys) assert(manifest.environment.modules[key].file === `environment/${key}.glb`, `Manifeste: module ${key} invalide`);

  assert(Object.keys(manifest.models.river_quay).sort().join(",") === "file,footprint,height", "Manifeste: river_quay invalide");
  const riverEntries = { barge: "river_barge.glb", cargoFood: "river_cargo_food.glb", cargoWater: "river_cargo_water.glb" };
  assert(Object.keys(manifest.riverAssets ?? {}).sort().join(",") === Object.keys(riverEntries).sort().join(","), "Manifeste: riverAssets invalide");
  for (const [key, file] of Object.entries(riverEntries)) assert(manifest.riverAssets[key].file === file && Object.keys(manifest.riverAssets[key]).join(",") === "file", `Manifeste: ${key} invalide`);

  const glbFiles = collectGlbFiles(manifest);
  glbFiles.add("terrain.glb");
  assert(glbFiles.size === 103, `103 GLB attendus, ${glbFiles.size} trouvés`);
  for (const file of [...glbFiles, "palimpsity-diorama.blend", "preview.png", "assets-preview.png", "assets-preview-18.png", "game-terrain-preview.png", "vegetation-preview.png", "rear-preview.png"]) {
    const info = await stat(path.join(outputDir, file));
    assert(info.size >= 1024, `${file} est vide ou incomplet.`);
  }
  for (const file of glbFiles) {
    const data = await readFile(path.join(outputDir, file));
    assert(data.toString("ascii", 0, 4) === "glTF" && data.readUInt32LE(4) === 2 && data.readUInt32LE(8) === data.length, `${file} n'est pas un GLB 2.0 valide.`);
  }
  console.log(`Contrôle Node réussi: 19 modèles, 15 variantes, 45 modules layers, 14 modules environment, 3 riverAssets, ${glbFiles.size} GLB, manifeste, cartes et six rendus.`);
}

async function runBlender(scriptPath, extraArgs = []) {
  assert(existsSync(scriptPath), `Script de génération introuvable: ${scriptPath}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(blender, ["--background", "--factory-startup", "--python-exit-code", "1", "--python", scriptPath, ...extraArgs], {
      cwd: gameDir,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => signal ? reject(new Error(`Blender interrompu par ${signal}`)) : resolve(code));
  });
  assert(code === 0, `Blender a échoué avec le code ${code}.`);
}

async function run() {
  assert(typeof blender === "string" && existsSync(blender), "Set BLENDER_EXE to the absolute path of your Blender executable.");
  await writeGameMap();
  console.log(`Blender: ${blender}`);
  await runBlender(script);
  await runBlender(path.join(gameDir, "art", "living-layers", "build_living_layers.py"), ["--", "--skip-render"]);
  await runBlender(path.join(gameDir, "art", "environment", "build_environment.py"), ["--", "--skip-render"]);
  await runBlender(path.join(gameDir, "art", "river", "build_river_assets.py"), ["--", "--skip-render"]);
  await validateOutputs();
  console.log(`Assets prêts dans ${outputDir}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
