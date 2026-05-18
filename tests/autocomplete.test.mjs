import { strict as assert } from "node:assert";
import { normalize, findMatches } from "../js/autocomplete.js";

// ─── normalize ──────────────────────────────────────────────────────────────
//
// Normalization rules: lowercase, strip combining marks (Latin diacritics),
// drop all whitespace, preserve Hangul precomposed syllables via NFKD→NFC
// roundtrip. The whole point is that superficial spelling differences
// between an alias in the dataset and what a player types stop blocking
// matches.

// Empty / nullish in → empty out, no crashes.
assert.equal(normalize(""), "");
assert.equal(normalize(null), "");
assert.equal(normalize(undefined), "");

// ASCII case + leading/trailing whitespace.
assert.equal(normalize("  BTS  "), "bts");
assert.equal(normalize("New Jeans"), "newjeans");

// Latin diacritics fold to their base char so "Beyoncé" matches "beyonce".
assert.equal(normalize("Beyoncé"), "beyonce");
assert.equal(normalize("Café"), "cafe");

// Whitespace collapsed everywhere — internal AND boundary. "Black Pink"
// alias on Wikidata becomes equivalent to "blackpink" typed input.
assert.equal(normalize("Black Pink"), "blackpink");
assert.equal(normalize("BLΛƆKPIИK"), "blλɔkpiиk"); // unaffected — non-Latin stays as-is

// Hangul: NFKD decomposes precomposed syllables into jamo, but NFC then
// recomposes. The net should preserve the visible form. And a stray space
// inside a Hangul alias matches the no-space user input.
assert.equal(normalize("블랙 핑크"), "블랙핑크");
assert.equal(normalize("블랙핑크"), "블랙핑크");
assert.equal(normalize("블랙 핑크"), normalize("블랙핑크"));

// "방탄소년단" stays as-is (no whitespace, already precomposed).
assert.equal(normalize("방탄소년단"), "방탄소년단");

// ─── findMatches ────────────────────────────────────────────────────────────
//
// Wraps `rank` over a pool. Match priority order:
//   0 name startsWith → 1 alias startsWith → 2 name substring → 3 alias substring
// Higher numbers rank LOWER in the sort. Cap at 8 results.

const POOL = [
  { name: "BTS",       aliases: ["방탄소년단", "방탄", "Bangtan", "비티에스"] },
  { name: "Blackpink", aliases: ["Black Pink", "블랙핑크", "블핑"] },
  { name: "Twice",     aliases: ["트와이스", "톼이스"] },
  { name: "NewJeans",  aliases: ["뉴진스", "NJZ"] },
  { name: "Stray Kids", aliases: ["SKZ", "스트레이 키즈"] },
];

// Roman input still works after the normalization change.
{
  const r = findMatches(POOL, "BTS");
  assert.equal(r[0]?.name, "BTS", "exact ASCII name match");
}

// Hangul input matches the canonical Korean name in aliases.
{
  const r = findMatches(POOL, "방탄");
  assert.equal(r[0]?.name, "BTS", "방탄 → BTS via alias");
}

// Whitespace mismatch between input and alias doesn't block the match.
{
  const r = findMatches(POOL, "블랙핑크");
  assert.equal(r[0]?.name, "Blackpink");
}
{
  const r = findMatches(POOL, "Black Pink");
  assert.equal(r[0]?.name, "Blackpink");
}
{
  const r = findMatches(POOL, "blackpink");
  assert.equal(r[0]?.name, "Blackpink");
}

// "스트레이 키즈" (with space in the alias) matches "스트레이키즈" without.
{
  const r = findMatches(POOL, "스트레이키즈");
  assert.equal(r[0]?.name, "Stray Kids");
}

// Empty query → no results.
assert.deepEqual(findMatches(POOL, ""), []);
assert.deepEqual(findMatches(POOL, "   "), []);

// Capped at 8 results.
{
  const big = Array.from({ length: 50 }, (_, i) => ({ name: `Group${i}`, aliases: [] }));
  const r = findMatches(big, "Group");
  assert.equal(r.length, 8, "MAX_SUGGESTIONS cap holds");
}

// Diacritic-insensitive matching for a Latin alias.
{
  const pool = [{ name: "Beyoncé", aliases: [] }];
  const r = findMatches(pool, "beyonce");
  assert.equal(r[0]?.name, "Beyoncé");
}

console.log("autocomplete.test ok");
