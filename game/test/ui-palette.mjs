import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RES_META, REGIME_META } from "../src/data.js";
import { RESOURCE_COLORS, regimeColor } from "../src/ui.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const cssVar = name => {
  const values = [...html.matchAll(new RegExp(`--${name}:([^;]+)`, "g"))];
  return values.at(-1)?.[1].trim();
};
const channels = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const luminance = hex => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (foreground, background) => {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test("C2 utilise la palette nuit propre au jeu et des paires lisibles", () => {
  assert.equal(cssVar("night"), "#1B2236");
  assert.equal(cssVar("paper-solid"), "#252E46");
  assert.equal(cssVar("ink"), "#F0EEE9");
  assert.equal(cssVar("green"), "#72CDD2");
  assert.equal(cssVar("clay"), "#E6A461");
  const panel = cssVar("paper-solid"), night = cssVar("night");
  const pairs = [
    ["texte courant / panneau", cssVar("ink"), panel, 4.5],
    ["texte secondaire / panneau", cssVar("muted"), panel, 4.5],
    ["cyan / panneau", cssVar("green"), panel, 4.5],
    ["ambre / panneau", cssVar("clay"), panel, 4.5],
    ["commande nuit / cyan", night, cssVar("green"), 3],
    ["commande nuit / ambre", night, cssVar("clay"), 3],
    ["erreur / fond erreur", cssVar("error"), cssVar("error-bg"), 4.5],
    ["disabled / fond disabled", cssVar("disabled-text"), cssVar("disabled-bg"), 4.5],
  ];
  for (const [label, foreground, background, minimum] of pairs) {
    assert.ok(contrast(foreground, background) >= minimum, `${label}: ${contrast(foreground, background).toFixed(2)} < ${minimum}`);
  }
});

test("C2 conserve la distinction des ressources et régimes au contraste courant", () => {
  const panel = cssVar("paper-solid");
  for (const [key, meta] of Object.entries(RES_META)) {
    const color = RESOURCE_COLORS[key] || meta.col;
    assert.ok(contrast(color, panel) >= 4.5, `${key}: ${color} sur ${panel} = ${contrast(color, panel).toFixed(2)}`);
  }
  for (const key of Object.keys(REGIME_META)) {
    const color = regimeColor(key);
    assert.ok(contrast(color, panel) >= 4.5, `${key}: ${color} sur ${panel} = ${contrast(color, panel).toFixed(2)}`);
  }
});
