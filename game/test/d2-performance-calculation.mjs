import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromeRendererOptions, summarizeFrameIntervals } from "./helpers-living-layers.mjs";

test("D2 duration and FPS use the same raw RAF interval sum", () => {
  const intervals = [10, 20, 30, 40];
  const result = summarizeFrameIntervals(intervals);
  assert.equal(result.durationMs, 100);
  assert.equal(result.frames, 4);
  assert.equal(result.fps, 40);
  assert.equal(result.medianFrameMs, 20);
  assert.equal(result.p95FrameMs, 30);
  assert.equal(result.maxFrameMs, 40);
  assert.deepEqual(intervals, [10, 20, 30, 40], "Raw intervals must not be mutated");
});

test("twenty slow intervals can represent the full ten-second window", () => {
  const result = summarizeFrameIntervals(Array(20).fill(500));
  assert.equal(result.frames, 20);
  assert.equal(result.durationMs, 10000);
  assert.equal(result.fps, 2);
  assert.equal(result.medianFrameMs, 500);
  assert.equal(result.p95FrameMs, 500);
});

test("invalid RAF intervals are rejected instead of fabricating statistics", () => {
  for (const intervals of [[], [0], [-1], [Infinity], [NaN], null]) {
    assert.throws(() => summarizeFrameIntervals(intervals), /RAF intervals/);
  }
});

test("Chrome uses its normal renderer by default and SwiftShader only explicitly", () => {
  assert.deepEqual(chromeRendererOptions({}), { mode: "default", args: [] });
  assert.deepEqual(chromeRendererOptions({ LIVING_LAYERS_RENDERER: "default" }), { mode: "default", args: [] });
  assert.deepEqual(chromeRendererOptions({ LIVING_LAYERS_RENDERER: "swiftshader" }), {
    mode: "swiftshader",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  assert.throws(() => chromeRendererOptions({ LIVING_LAYERS_RENDERER: "hardware" }), /default or swiftshader/);
});

test("D2 source keeps RAF evidence and does not pin the current artifact or double PNG extensions", () => {
  const source = readFileSync(new URL("./d2-performance-comparison.mjs", import.meta.url), "utf8");
  assert.match(source, /firstRafTimestamp/);
  assert.match(source, /rafIntervalsMs/);
  assert.match(source, /minimumIntervals = 20/);
  assert.match(source, /maxSampleMs = 60000/);
  assert.match(source, /summarizeFrameIntervals\(sample\.rafIntervalsMs\)/);
  assert.match(source, /effectiveRenderers\.length, 1/);
  assert.doesNotMatch(source, /artifacts\[1\]\.sha256/);
  assert.doesNotMatch(source, /\.png\.png/);
});
