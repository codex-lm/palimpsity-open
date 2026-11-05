import assert from "node:assert/strict";
import test from "node:test";
import { architectureForOption } from "../src/architecture-preview.js";
import { Renderer3D } from "../src/render3d.js";

test("architecture preview options are local cloned transformations", () => {
  const before = { base: "residential", floors: 2, roof: "traditional", family: "banks", variant: 0 };
  const snapshot = JSON.stringify(before);
  assert.deepEqual(architectureForOption(before, "add_floor"), { ...before, floors: 3 });
  assert.deepEqual(architectureForOption(before, "family_works"), { ...before, family: "works" });
  assert.deepEqual(architectureForOption(before, "variant_2"), { ...before, variant: 2 });
  assert.deepEqual(architectureForOption(before, "roof_garden"), { ...before, roof: "garden" });
  assert.deepEqual(architectureForOption(before, "base_shop"), { ...before, base: "shop" });
  assert.equal(architectureForOption(before, "add_floor") === before, false);
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(architectureForOption(before, "unknown"), null);
  assert.equal(architectureForOption(before, "add_floor").floors, 3);
  assert.equal(architectureForOption({ ...before, floors: 4 }, "add_floor").floors, 4);
});

test("comparison API is inert before assets load and after disposal", () => {
  assert.equal(Renderer3D.prototype.renderArchitectureComparison.call({ _disposed: false, _loaded: false }, {}, "add_floor", {}, {}), false);
  assert.equal(Renderer3D.prototype.renderArchitectureComparison.call({ _disposed: true, _loaded: true }, {}, "add_floor", {}, {}), false);
});
