import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Renderer3D } from "../src/render3d.js";
import { environmentPlanForCell } from "../src/diorama-assets.js";
import { COLS, ROWS, genTerrain } from "../src/data.js";

// These contracts concern the actual exported meshes, not placeholder cubes or
// the generator's implementation. The original terrain stays underneath them.
const ASSETS = new URL("../art/diorama/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("asset-manifest.json", ASSETS), "utf8"));
const SHORE_KEYS = ["bank_straight", "bank_corner_inner", "bank_corner_outer", "quay_straight", "vegetation_reeds"];
const WATER_Y = -0.0925;
const EPS = 0.0002;
const DIRECTIONS = [
  { bit: 1, x: 0, z: -1, name: "north" },
  { bit: 2, x: 1, z: 0, name: "east" },
  { bit: 4, x: 0, z: 1, name: "south" },
  { bit: 8, x: -1, z: 0, name: "west" },
];
const normal = (point, side) => point.x * side.x + point.z * side.z;
const tangent = (point, side) => point.x * side.z - point.z * side.x;
const materials = material => (Array.isArray(material) ? material : [material]).map(item => item.name);
const plant = names => names.every(name => /^(?:pine|leaf)(?:\.\d+)?$/.test(name));
const close = (actual, expected, message, tolerance = EPS) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual}, expected ${expected}`);

async function parse(file) {
  const bytes = readFileSync(new URL(file, ASSETS));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

const templates = new Map(await Promise.all(SHORE_KEYS.map(async key => [key, await parse(manifest.environment.modules[key].file)])));
const renderer = Object.assign(Object.create(Renderer3D.prototype), {
  manifest, _templatesByFile: templates,
});

function terrainFor(mask) {
  const terrain = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const side of DIRECTIONS) if (mask & side.bit) terrain[2 + side.z][2 + side.x] = 1;
  return terrain;
}

// Use the renderer's real world transformations, then express the result
// relative to its land tile so assertions also catch placement offsets.
function partsAt(c, r, plan) {
  const origin = new THREE.Vector3(c - (COLS - 1) / 2, 0, r - (ROWS - 1) / 2);
  return [...renderer._environmentParts(c, r, plan).values()].flatMap(part => part.matrices.map(matrix => {
    const positions = part.geometry.getAttribute("position");
    const vertices = Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(matrix).sub(origin));
    return { vertices, geometry: part.geometry, names: materials(part.material) };
  }));
}

function shoreParts(mask, built = false) {
  const house = { def: { id: "house" } };
  const plan = environmentPlanForCell(terrainFor(mask), 2, 2, (c, r) => built && c === 2 && r === 2 ? house : null);
  return partsAt(2, 2, plan.filter(item => /^(bank_|quay_)/.test(item.key)));
}

function solidVertices(parts) {
  const points = parts.filter(part => !plant(part.names)).flatMap(part => part.vertices);
  assert.ok(points.length, "a shore module must contain actual bank or quay geometry");
  return points;
}

function assertEdge(points, side, label) {
  const edge = points.filter(point => Math.abs(normal(point, side) - 0.5) <= 0.04 && point.y <= 0.045);
  assert.ok(edge.length, `${label}: no geometry at the actual land/water boundary`);
  assert.ok(Math.min(...edge.map(point => tangent(point, side))) <= -0.5 + EPS, `${label}: start of the one-unit edge has a gap`);
  assert.ok(Math.max(...edge.map(point => tangent(point, side))) >= 0.5 - EPS, `${label}: end of the one-unit edge has a gap`);
  assert.ok(Math.min(...edge.map(point => point.y)) <= WATER_Y + 0.004, `${label}: bank face does not reach the river surface`);
  assert.ok(Math.max(...edge.map(point => point.y)) >= -0.006, `${label}: bank face does not reach the land surface`);
}

test("shore correction preserves the original full-cell terrain and its actual water level", async () => {
  const terrainFile = typeof manifest.terrain === "string" ? manifest.terrain : manifest.terrain.file;
  const bytes = readFileSync(new URL(terrainFile, ASSETS));
  // terrain-game.glb from reviewed source e8fe549; this fix must not reshape the map.
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "b858af795634beca9da230c3b1bb4c2df0fe20afac1925f2a31871abd511d120");
  const terrain = await parse(terrainFile);
  const water = [];
  terrain.traverse(object => {
    if (!object.isMesh || !materials(object.material).includes("water")) return;
    const positions = object.geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) water.push(new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld));
  });
  assert.ok(water.length, "the real terrain contains the river surface");
  close(Math.max(...water.map(point => point.y)), WATER_Y, "river surface height");
});

test("bank and quay GLBs contain no second water surface; reeds contain no soil plinth", () => {
  for (const key of SHORE_KEYS) {
    const parts = partsAt(2, 2, [{ key, rotation: 0 }]);
    const names = parts.flatMap(part => part.names);
    assert.ok(!names.some(name => /water/i.test(name)), `${key}: remove the raised duplicate water mesh`);
    if (key === "vegetation_reeds") assert.ok(!names.some(name => /soil|earth|mud/i.test(name)), "reeds must not carry a floating rectangular soil tile");
  }
});

for (const built of [false, true]) {
  test(`${built ? "built quays" : "natural straight banks"} meet the full real edge in all four orientations`, () => {
    for (const side of DIRECTIONS) {
      const points = solidVertices(shoreParts(side.bit, built));
      assertEdge(points, side, side.name);
      for (const point of points) {
        assert.ok(normal(point, side) >= 0.32 - EPS, `${side.name}: a shore overlay covers the tile interior`);
        assert.ok(normal(point, side) <= 0.54 + EPS, `${side.name}: a shore overlay projects into the river`);
        assert.ok(Math.abs(tangent(point, side)) <= 0.54 + EPS, `${side.name}: a shore overlay projects beyond its neighbors`);
        assert.ok(point.y >= -0.12 - EPS, `${side.name}: a bank extends below the existing riverbed`);
      }
    }
  });
}

test("two-water corners follow both real shores without raising or cutting the land tile", () => {
  for (const mask of [3, 6, 12, 9]) {
    const sides = DIRECTIONS.filter(side => mask & side.bit);
    const points = solidVertices(shoreParts(mask));
    for (const side of sides) assertEdge(points, side, `corner ${mask}, ${side.name}`);
    for (const point of points) {
      assert.ok(sides.some(side => normal(point, side) >= 0.32 - EPS), `corner ${mask}: geometry covers the tile interior`);
      assert.ok(Math.abs(point.x) <= 0.54 + EPS && Math.abs(point.z) <= 0.54 + EPS, `corner ${mask}: geometry escapes the real corner`);
    }
  }
});

test("a diagonal-only water contact decorates just its corner, not a fictitious diagonal coast", () => {
  for (const [dx, dz] of [[1, -1], [1, 1], [-1, 1], [-1, -1]]) {
    const terrain = terrainFor(0);
    terrain[2 + dz][2 + dx] = 1;
    const plan = environmentPlanForCell(terrain, 2, 2).filter(item => item.key.startsWith("bank_"));
    // Leaving this land-only cell untouched is also valid.
    for (const part of partsAt(2, 2, plan)) for (const point of part.vertices) {
      assert.ok(point.x * dx >= 0.22 - EPS && point.z * dz >= 0.22 - EPS, "diagonal decoration must stay near the corner touching water");
      assert.ok(Math.abs(point.x) <= 0.54 + EPS && Math.abs(point.z) <= 0.54 + EPS, "diagonal decoration must not extend into adjacent tiles");
      // Small stones may embed their feet in the intact ground, but a diagonal
      // contact does not expose a full-depth riverbank inside this land tile.
      assert.ok(point.y >= -0.06, "diagonal-only contact must not dig a new diagonal water edge");
    }
  }
});

test("straight and corner edge endpoints join without the old 0.05-unit gap", () => {
  const straight = solidVertices(shoreParts(4));
  const inner = solidVertices(shoreParts(12));
  const endpoint = (points, x) => points.filter(point => Math.abs(point.x - x) < EPS && point.z >= 0.46 && point.z <= 0.54 && point.y <= 0.045);
  const right = endpoint(straight, 0.5);
  const left = endpoint(straight, -0.5);
  const cornerRight = endpoint(inner, 0.5);
  for (const [name, first, second] of [["straight/straight", right, left], ["corner/straight", cornerRight, left]]) {
    assert.ok(first.length && second.length, `${name}: missing endpoint geometry`);
    // Compare the vertical end profiles; tangent coordinates differ by one tile.
    const matches = first.filter(a => second.some(b => Math.abs(a.y - b.y) < EPS && Math.abs(a.z - b.z) < EPS));
    assert.ok(matches.some(point => point.y <= WATER_Y + 0.004), `${name}: lower edge profiles do not meet`);
    assert.ok(matches.some(point => point.y >= -0.006), `${name}: upper edge profiles do not meet`);
  }
});

// Joined-by-material exports combine many stems into one mesh. Recover each
// connected stem from actual triangles, welding positional duplicates at caps.
function connectedBounds(part) {
  const parents = new Map();
  const points = new Map();
  const keys = part.vertices.map(point => {
    const key = [point.x, point.y, point.z].map(value => Math.round(value * 100000)).join(",");
    parents.set(key, key); points.set(key, point); return key;
  });
  const find = key => {
    let root = key;
    while (parents.get(root) !== root) root = parents.get(root);
    while (parents.get(key) !== key) { const next = parents.get(key); parents.set(key, root); key = next; }
    return root;
  };
  const indices = part.geometry.index;
  const count = indices ? indices.count : keys.length;
  for (let index = 0; index < count; index += 3) {
    const triangle = [0, 1, 2].map(offset => keys[indices ? indices.getX(index + offset) : index + offset]);
    parents.set(find(triangle[1]), find(triangle[0]));
    parents.set(find(triangle[2]), find(triangle[0]));
  }
  const groups = new Map();
  for (const [key, point] of points) {
    const root = find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(point);
  }
  return [...groups.values()].map(vertices => ({ vertices, bounds: new THREE.Box3().setFromPoints(vertices) }));
}

test("each real reed stem is rooted on land at Y0 after placement, in every direction and on the map", () => {
  let stems = 0;
  const check = (terrain, c, r) => {
    const plan = environmentPlanForCell(terrain, c, r).filter(item => item.key === "vegetation_reeds");
    for (const part of partsAt(c, r, plan)) {
      if (!part.names.some(name => /^pine(?:\.\d+)?$/.test(name))) continue;
      for (const { vertices, bounds } of connectedBounds(part)) {
        stems++;
        close(bounds.min.y, 0, `reed at ${c},${r} must begin at the land surface`, 0.006);
        assert.ok(bounds.max.y >= 0.045, "a root must belong to a real upright stem");
        for (const point of vertices.filter(point => point.y <= bounds.min.y + 0.007)) {
          assert.ok(Math.abs(point.x) <= 0.5 + EPS && Math.abs(point.z) <= 0.5 + EPS, `reed at ${c},${r} roots in water instead of its land tile`);
        }
      }
    }
  };
  for (const side of DIRECTIONS) check(terrainFor(side.bit), 2, 2);
  const terrain = genTerrain();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) check(terrain, c, r);
  assert.ok(stems >= 4, "the real coastline still contains visible reed stems");
});
