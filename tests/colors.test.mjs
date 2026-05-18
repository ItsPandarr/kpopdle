import { strict as assert } from "node:assert";
import { parseHex, luminance, expandPalette, rgbToHex, accentColor } from "../js/colors.js";

// ─── parseHex ─────────────────────────────────────────────────────────────────

assert.deepEqual(parseHex("#ff5fa2"), [255, 95, 162]);
assert.deepEqual(parseHex("ff5fa2"), [255, 95, 162], "leading # optional");
assert.deepEqual(parseHex("#F00"), [255, 0, 0], "3-digit hex expands");
assert.equal(parseHex("not-a-color"), null);
assert.equal(parseHex(null), null);
assert.equal(parseHex(undefined), null);
assert.equal(parseHex("#abcdefg"), null, "non-hex chars rejected");

// ─── luminance ────────────────────────────────────────────────────────────────

assert.ok(luminance([0, 0, 0]) < 0.05, "black ~ 0");
assert.ok(luminance([255, 255, 255]) > 0.95, "white ~ 1");
// Mid-luminance for #808080.
{
  const mid = luminance([128, 128, 128]);
  assert.ok(mid > 0.18 && mid < 0.30, `gray luminance reasonable, got ${mid}`);
}

// ─── rgbToHex ────────────────────────────────────────────────────────────────

assert.equal(rgbToHex([255, 95, 162]), "#FF5FA2");
assert.equal(rgbToHex([0, 0, 0]), "#000000");
assert.equal(rgbToHex([255, 255, 255]), "#FFFFFF");
// Clamping out-of-range.
assert.equal(rgbToHex([300, -10, 128]), "#FF0080");

// ─── expandPalette ───────────────────────────────────────────────────────────

// Empty / null → null.
assert.equal(expandPalette(null), null);
assert.equal(expandPalette([]), null);

// 3+ colors passed through unchanged.
{
  const p = ["#ff5fa2", "#6f88ff", "#5ce0d8"];
  assert.deepEqual(expandPalette(p), p);
}

// Single color expands with light + dark variants.
{
  const out = expandPalette(["#FF0000"]);
  assert.equal(out.length, 3, "single color → 3 variants");
  assert.equal(out[0], "#FF0000", "original preserved");
  assert.notEqual(out[1], out[0], "lighter variant differs");
  assert.notEqual(out[2], out[0], "darker variant differs");
}

// Two colors expand to six (each + light + dark per color).
{
  const out = expandPalette(["#FF0000", "#00FF00"]);
  assert.equal(out.length, 6);
}

// Bad hex in palette skipped without crashing.
{
  const out = expandPalette(["bogus"]);
  assert.equal(out.length, 1, "bad hex passed through but no variants generated");
}

// ─── accentColor ──────────────────────────────────────────────────────────────

// Empty input → null.
assert.equal(accentColor(null), null);
assert.equal(accentColor([]), null);

// Mid-luminance color preferred over near-black or near-white.
{
  const pick = accentColor(["#FFFFFF", "#000000", "#FF5FA2"]);
  assert.equal(pick, "#FF5FA2", "mid-luminance pink wins over extremes");
}

// Single color always returned (no other option).
assert.equal(accentColor(["#800080"]), "#800080");

// Bad hex entries skipped.
{
  const pick = accentColor(["not-a-hex", "#3399FF"]);
  assert.equal(pick, "#3399FF");
}

console.log("colors.test ok");
