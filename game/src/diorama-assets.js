/* Standalone models are parsed from memory: fetching a data: URI would require
   a CSP connect-src exception. The development build keeps its local URLs. */
const EMBEDDED_HEADER = "data:model/gltf-binary;base64,";
const INVALID_EMBEDDED_MODEL = "Invalid embedded model data. Rebuild the standalone game.";

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
