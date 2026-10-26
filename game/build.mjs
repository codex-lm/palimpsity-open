/* =====================================================================
   BUILD — produit un fichier HTML unique, autoportant, double-cliquable.
   ---------------------------------------------------------------------
   esbuild bundle src/main.js AVEC Three.js inclus (zéro réseau), puis on
   inline le tout dans index.html → dist/palimpsity-mvp.html.
   Lancer :  node build.mjs   (ou npm run build)
   ===================================================================== */

import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const p = (...x) => path.join(here, ...x);

// 1) bundle (three résolu depuis node_modules ; les alias couvrent "three/addons/")
const result = await esbuild.build({
  entryPoints: [p("src/main.js")],
  bundle: true, format: "esm", minify: true, write: false,
  target: "es2019",                    // down-level explicite (?. / ?? transpilés) — cible large
  alias: {
    "three/addons/controls/OrbitControls.js":
      p("node_modules/three/examples/jsm/controls/OrbitControls.js"),
    "three/addons/loaders/GLTFLoader.js":
      p("node_modules/three/examples/jsm/loaders/GLTFLoader.js"),
  },
  legalComments: "none",
});

// 1b) collection Blender sur mesure : uniquement les GLB référencés par le manifeste.
const assetRoot = p("art/diorama");
const manifest = JSON.parse(readFileSync(path.join(assetRoot, "asset-manifest.json"), "utf8"));
const requiredModels = [
  "house", "well", "farm", "workshop", "market", "path", "park", "road", "generator",
  "factory", "warehouse", "water_plant", "tower", "depot", "tram", "maint_center", "greenhouse", "recycler",
];
function requireGLB(file, label) {
  if (typeof file !== "string" || !/\.glb$/i.test(file)) throw new Error(`build: référence GLB absente ou invalide: ${label}`);
}
for (const id of requiredModels) {
  requireGLB(manifest.models?.[id]?.file, `modèle ${id}`);
}
if (manifest.terrain !== "terrain-game.glb") {
  throw new Error("build: le terrain du vrai jeu doit être terrain-game.glb (pas le terrain de démonstration)");
}
for (const id of ["forest", "hill", "fertile"]) {
  requireGLB(manifest.decor?.[id], `décor ${id}`);
}
for (const id of ["path", "road", "tram"]) {
  for (const variant of ["end", "straight", "corner", "tee", "cross"]) {
    requireGLB(manifest.transportVariants?.[id]?.[variant], `variante ${id}/${variant}`);
  }
}
// Les références imbriquées (tram.car, recycler.rotor, futures pièces) sont incluses.
const files = new Set();
function collectGLBs(value) {
  if (typeof value === "string" && /\.glb$/i.test(value)) files.add(value);
  else if (Array.isArray(value)) value.forEach(collectGLBs);
  else if (value && typeof value === "object") Object.values(value).forEach(collectGLBs);
}
collectGLBs(manifest);
const assets = {};
for (const file of files) {
  const fullPath = path.resolve(assetRoot, file);
  const relative = path.relative(assetRoot, fullPath);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error(`build: référence GLB hors art/diorama: ${file}`);
  }
  const key = path.basename(file).replace(/\.glb$/i, "");
  if (key === "terrain") throw new Error("build: le terrain de démonstration ne doit pas être embarqué");
  if (Object.hasOwn(assets, key)) throw new Error(`build: basename GLB ambigu: ${key}`);
  let bytes;
  try { bytes = readFileSync(fullPath); }
  catch (error) { throw new Error(`build: GLB référencé introuvable: ${file} (${error.message})`); }
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "glTF") {
    throw new Error(`build: fichier GLB invalide: ${file}`);
  }
  assets[key] = "data:model/gltf-binary;base64," + bytes.toString("base64");
}
// JSON aussi échappé : une future description du manifeste peut contenir </script.
const inlineJSON = value => JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
const assetScript = `<script>window.__PALIMPSITY_ASSET_MANIFEST=${inlineJSON(manifest)};window.__PALIMPSITY_ASSETS=${inlineJSON(assets)};</script>\n`;
// une séquence "</script" dans une chaîne du bundle couperait le <script> inline
// à l'analyse HTML (dist cassé, indétectable par les gardes) — on l'échappe.
// Dans une chaîne JS, "<\/script" est strictement équivalent à "</script".
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script").replace(/[ \t]+$/gm, "");

// 2) inline dans index.html (on retire importmap + script src, on injecte le bundle)
let html = readFileSync(p("index.html"), "utf8");
// IMPORTANT : remplacement par FONCTION — sinon les "$&"/"$1" présents dans le
// bundle Three.js minifié seraient interprétés comme motifs de substitution.
// On ASSERTE chaque remplacement : si index.html a changé de forme, on échoue
// fort plutôt que de produire un dist silencieusement cassé (CDN/relatif résiduel).
let before = html;
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, () => "");
if (html === before) throw new Error("build: balise <script type=importmap> introuvable dans index.html");
// garde-fou AVANT injection du bundle : sinon un "jsdelivr"/"importmap" dans une
// chaîne de Three déclencherait un faux positif (ou masquerait un vrai résidu).
for (const bad of ["jsdelivr", "importmap"]) {
  if (html.includes(bad)) throw new Error(`build: référence résiduelle "${bad}" dans le template (livrable non autoportant)`);
}
before = html;
html = html.replace(/<script type="module" src="\.\/src\/main\.js"><\/script>/, () => `${assetScript}<script type="module">\n${js}\n</script>`);
if (html === before) throw new Error("build: balise <script src=./src/main.js> introuvable dans index.html");
if (/src="\.\/src\//.test(html)) throw new Error('build: référence résiduelle src="./src/ dans le dist');
// petite bannière pour Cédric
html = html.replace("<title>Palimpsity — Prototype</title>",
  "<title>Palimpsity — Prototype</title>\n<!-- Standalone offline game. Double-click to play. Three.js included; no network required. -->");

mkdirSync(p("../dist"), { recursive: true });
const out = p("../dist/palimpsity-mvp.html");
writeFileSync(out, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`✅ dist/palimpsity-mvp.html écrit (${kb} Ko, autoportant, double-cliquable).`);
