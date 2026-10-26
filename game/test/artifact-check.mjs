/* Static verification of the actual offline deliverable. No browser is opened. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';

const game = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(path.resolve(game, '../dist/palimpsity-mvp.html'), 'utf8');
assert.match(source, /<html\b[^>]*\blang="en"/i, 'The delivered game declares English as its language');
const manifest = JSON.parse(readFileSync(path.join(game, 'art/diorama/asset-manifest.json'), 'utf8'));
const prefix = 'window.__PALIMPSITY_ASSET_MANIFEST=';
const separator = ';window.__PALIMPSITY_ASSETS=';
const start = source.indexOf(prefix), middle = source.indexOf(separator, start), end = source.indexOf(';</script>', middle);
assert.ok(start >= 0 && middle > start && end > middle, 'Offline asset data must be present');
const embeddedManifest = JSON.parse(source.slice(start + prefix.length, middle));
const assets = JSON.parse(source.slice(middle + separator.length, end));
assert.deepEqual(embeddedManifest, manifest, 'The deliverable embeds the current manifest');
assert.equal(Object.keys(manifest.models).length, 18);
const files = new Set();
function collect(value) {
  if (typeof value === 'string' && /\.glb$/i.test(value)) files.add(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
}
collect(manifest);
const keys = [...files].map(file => path.basename(file, '.glb')).sort();
assert.deepEqual(Object.keys(assets).sort(), keys, 'Exactly the referenced models and their variants are embedded');
for (const file of files) {
  const key = path.basename(file, '.glb'), url = assets[key];
  const header = 'data:model/gltf-binary;base64,';
  assert.ok(url.startsWith(header));
  assert.deepEqual(Buffer.from(url.slice(header.length), 'base64'), readFileSync(path.join(game, 'art/diorama', file)), `Current bytes for ${file}`);
}
assert.ok(!/<script[^>]+src\s*=/i.test(source), 'The offline HTML must not require an external script');
assert.ok(!/<(?:link|img)[^>]+(?:href|src)=["'](?:https?:|\.\.?\/)/i.test(source), 'No external stylesheet or image');
for (const id of ['cv', 'palette', 'inspector', 'objectives-summary', 'objectives-list', 'modal', 'end', 'language-select']) {
  assert.ok(source.includes(`id="${id}"`), `The shipped page contains ${id}`);
}
assert.ok(source.includes('data-conversion'), 'Conversion commands are included in the delivered UI');
const bundle = await esbuild.build({
  entryPoints: [path.join(game, 'src/main.js')], bundle: true, format: 'esm', minify: true,
  write: false, target: 'es2019', legalComments: 'none',
  alias: {
    'three/addons/controls/OrbitControls.js': path.join(game, 'node_modules/three/examples/jsm/controls/OrbitControls.js'),
    'three/addons/loaders/GLTFLoader.js': path.join(game, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js'),
  },
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/[ \t]+$/gm, '');
assert.ok(source.includes(`<script type="module">\n${js}\n</script>`), 'The actual delivered code exactly matches the current source bundle');
console.log(JSON.stringify({ result: 'PASS', sourceBundleMatches: true, models: 18, embeddedGLBs: files.size, bytes: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex'), browserValidation: false }, null, 2));
