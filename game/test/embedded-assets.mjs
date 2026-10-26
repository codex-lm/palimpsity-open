/* Exercise the real GLTF parser without WebGL, a browser, a server or network.
   Development fetch responses below are in-memory copies of the actual files. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Renderer3D } from '../src/render3d.js';
import { decodeEmbeddedGLB, loadDioramaManifest, loadDioramaGLB } from '../src/diorama-assets.js';
import { translate } from '../src/localization.js';

const assetRoot = new URL('../art/diorama/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('asset-manifest.json', assetRoot), 'utf8'));
const files = new Set();
function collect(value) {
  if (typeof value === 'string' && /\.glb$/i.test(value)) files.add(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
}
collect(manifest);
const bytesByFile = new Map([...files].map(file => [file, readFileSync(new URL(file, assetRoot))]));
const embedded = Object.fromEntries([...bytesByFile].map(([file, bytes]) =>
  [file.replace(/\.glb$/i, ''), 'data:model/gltf-binary;base64,' + bytes.toString('base64')]));
const { outputFiles } = await esbuild.build({
  entryPoints: [fileURLToPath(new URL('../src/diorama-assets.js', import.meta.url))],
  bundle: true, format: 'esm', write: false, minify: true,
  define: { __PALIMPSITY_EMBEDDED__: 'true' },
});
const standaloneCode = outputFiles[0].text;
// Node imports this helper as code; no browser or HTTP endpoint is involved.
const standalone = await import('data:text/javascript;base64,' + Buffer.from(standaloneCode).toString('base64'));

async function withGlobals(values, action) {
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    return await action();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

function assertModel(gltf, file) {
  let meshes = 0;
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    assert.ok(object.geometry.getAttribute('position').count > 0, `${file} contains actual geometry`);
  });
  assert.ok(meshes > 0, `${file} contains a rendered mesh`);
}

test('embedded GLB decoding preserves bytes and rejects malformed model data', () => {
  const [file, bytes] = bytesByFile.entries().next().value;
  assert.deepEqual(Buffer.from(decodeEmbeddedGLB(embedded[file.replace(/\.glb$/i, '')])), bytes);
  for (const bad of [null, '', 'https://example.invalid/model.glb', 'data:model/gltf-binary;base64,!', 'data:model/gltf-binary;base64,YWJj']) {
    assert.throws(() => decodeEmbeddedGLB(bad), /Invalid embedded model data/);
  }
  const corrupt = Buffer.from(bytes);
  corrupt.writeUInt32LE(bytes.length + 1, 8);
  assert.throws(() => decodeEmbeddedGLB('data:model/gltf-binary;base64,' + corrupt.toString('base64')), /Invalid embedded model data/);
});

test('standalone compilation removes development URLs and reports missing embedded assets in both languages', async () => {
  assert.ok(!standaloneCode.includes('./art/diorama/'));
  let requests = 0;
  await withGlobals({ fetch() { requests++; throw new Error('Unexpected fetch'); } }, async () => {
    await assert.rejects(standalone.loadDioramaManifest({}), /Missing embedded asset manifest/);
    await assert.rejects(standalone.loadDioramaGLB(new GLTFLoader(), 'missing.glb'), /Missing embedded model: missing.glb/);
    assert.equal(await standalone.loadDioramaManifest({ __PALIMPSITY_ASSET_MANIFEST: manifest }), manifest);
  });
  assert.equal(requests, 0);
  for (const message of [
    'Invalid embedded model data. Rebuild the standalone game.',
    'Missing embedded asset manifest. Rebuild the standalone game.',
    'Missing embedded model: house.glb. Rebuild the standalone game.',
  ]) {
    assert.equal(translate(message, 'en'), message);
    assert.notEqual(translate(message, 'fr'), message);
    const wrapped = `The valley could not be displayed: ${message}. Check the diorama assets and reload the game.`;
    assert.ok(!translate(wrapped, 'fr').includes(message), 'Nested renderer errors also translate');
  }
});

test('the standalone loader parses all 39 actual embedded GLBs without a single fetch', async () => {
  assert.equal(files.size, 39);
  let requests = 0;
  await withGlobals({ fetch() { requests++; throw new Error('CSP blocks all fetch in this test'); } }, async () => {
    const loader = new GLTFLoader();
    for (const file of files) assertModel(await standalone.loadDioramaGLB(loader, file, embedded), file);
    const file = files.values().next().value;
    assertModel(await standalone.loadDioramaGLB(loader, file, { [file]: embedded[file.replace(/\.glb$/i, '')] }), file);
  });
  assert.equal(requests, 0);
});

test('the renderer loads its full embedded diorama through the real parser without fetch or WebGL', async () => {
  let requests = 0, syncs = 0;
  const renderer = {
    _disposed: false, _loaded: false,
    _sharedGeometries: new WeakSet(), _ownedGeometries: new Set(),
    _sharedMaterials: new WeakSet(), _ownedMaterials: new Set(),
    glbTemplates: new Map(), terrainRoot: new THREE.Group(),
    _clone: Renderer3D.prototype._clone,
    sync() { syncs++; },
    getDebugInfo() { return { loaded: this._loaded, models: this.glbTemplates.size }; },
  };
  await withGlobals({
    window: { __PALIMPSITY_ASSET_MANIFEST: manifest, __PALIMPSITY_ASSETS: embedded },
    fetch() { requests++; throw new Error('CSP blocks all fetch in this test'); },
  }, async () => {
    assert.deepEqual(await Renderer3D.prototype._loadAssets.call(renderer), { loaded: true, models: 18 });
  });
  assert.equal(renderer._templatesByFile.size, 39);
  assert.equal(renderer.terrainRoot.children.length, 1);
  assert.ok(renderer._ownedGeometries.size > 0);
  assert.ok(renderer._ownedMaterials.size > 0);
  for (const template of renderer._templatesByFile.values()) template.traverse(object => {
    if (object.isMesh) assert.ok(object.castShadow && object.receiveShadow && object.userData.sharedRes);
  });
  assert.equal(syncs, 1);
  assert.equal(requests, 0);
});

test('development still fetches the local manifest and parses all 39 actual GLBs via loadAsync', async () => {
  const base = 'https://palimpsity.test/game/';
  const NativeRequest = globalThis.Request;
  const requests = [];
  await withGlobals({
    Request: class extends NativeRequest {
      constructor(input, options) { super(typeof input === 'string' ? new URL(input, base) : input, options); }
    },
    ProgressEvent: globalThis.ProgressEvent || class extends Event {
      constructor(type, values) { super(type); Object.assign(this, values); }
    },
    async fetch(input) {
      const url = new URL(typeof input === 'string' ? input : input.url, base);
      assert.equal(url.origin, new URL(base).origin);
      requests.push(url.pathname);
      if (url.pathname === '/game/art/diorama/asset-manifest.json') return new Response(JSON.stringify(manifest));
      const file = url.pathname.replace('/game/art/diorama/', '');
      assert.ok(bytesByFile.has(file), `Only a manifest-referenced local model may be requested: ${url.pathname}`);
      return new Response(bytesByFile.get(file), { headers: { 'Content-Type': 'model/gltf-binary' } });
    },
  }, async () => {
    assert.deepEqual(await loadDioramaManifest({}), manifest);
    const loader = new GLTFLoader();
    for (const file of files) assertModel(await loadDioramaGLB(loader, file), file);
    assert.equal(requests.length, 40);
    assert.equal(new Set(requests).size, 40);
    await withGlobals({ fetch: async () => new Response('', { status: 404 }) }, async () => {
      await assert.rejects(loadDioramaManifest({}), /Missing asset manifest \(404\)/);
    });
  });
});
