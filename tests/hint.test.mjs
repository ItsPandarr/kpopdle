import { strict as assert } from "node:assert";
import {
  nextHintCost,
  totalHintPenalty,
  shuffle,
  nextHintAttr,
  attrIsKnown,
  attrsByUniqueness,
  FIRST_HINT_COST,
  SUBSEQUENT_HINT_COST,
} from "../js/hint.js";

// ─── nextHintCost ──────────────────────────────────────────────────────────────

// First hint costs 4; decays by 1 per guess; floored at 1 (hints are never free).
{
  const events = [];
  assert.equal(nextHintCost(events, 0), 4);
  assert.equal(nextHintCost(events, 1), 3);
  assert.equal(nextHintCost(events, 3), 1);
  assert.equal(nextHintCost(events, 4), 1, "floor at 1, not 0");
  assert.equal(nextHintCost(events, 10), 1, "never below floor");
}

// After the first click, the base drops to 2. The decay clock resets from the click.
{
  const events = [{ guessIdxAtClick: 3, attr: "company", value: "HYBE", cost: 2 }];
  assert.equal(nextHintCost(events, 3), 2, "right after click, cost = 2");
  assert.equal(nextHintCost(events, 4), 1);
  assert.equal(nextHintCost(events, 6), 1, "floor at 1");
  assert.equal(nextHintCost(events, 8), 1);
}

// Third click also uses SUBSEQUENT_HINT_COST.
{
  const events = [
    { guessIdxAtClick: 1, attr: "company", value: "HYBE", cost: 4 },
    { guessIdxAtClick: 5, attr: "gender", value: "boy", cost: 1 },
  ];
  assert.equal(nextHintCost(events, 5), 2);
  assert.equal(nextHintCost(events, 6), 1);
  assert.equal(nextHintCost(events, 9), 1, "floor at 1");
}

// Total penalty sums event costs.
{
  const events = [
    { attr: "a", cost: 5, guessIdxAtClick: 0 },
    { attr: "b", cost: 2, guessIdxAtClick: 4 },
    { attr: "c", cost: 0, guessIdxAtClick: 9 },
  ];
  assert.equal(totalHintPenalty(events), 7);
  assert.equal(totalHintPenalty([]), 0);
}

// ─── shuffle ───────────────────────────────────────────────────────────────────

// Deterministic with a seeded RNG; returns a permutation.
{
  let seed = 0.123;
  const rng = () => {
    // Mulberry32-ish, deterministic for the test.
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const out = shuffle(["a", "b", "c", "d"], rng);
  assert.equal(out.length, 4);
  assert.deepEqual([...out].sort(), ["a", "b", "c", "d"]);
}

// ─── attrIsKnown ───────────────────────────────────────────────────────────────

{
  const clues = {
    debut_year: { known: 2013, min: 2013, max: 2013 },
    member_count: { known: null, min: null, max: null },
    company: { known: "HYBE", knownParent: "HYBE", excludedCompanies: new Set(), excludedParents: new Set() },
    gender: { known: null, excluded: new Set(), impliedCoed: false },
    primary_group: { knownGroup: null, knownGroupId: null, sharedCandidateIds: new Set(), excludedPrimaryIds: new Set(), excludedIds: new Set() },
  };
  assert.equal(attrIsKnown("debut_year", clues), true);
  assert.equal(attrIsKnown("member_count", clues), false);
  assert.equal(attrIsKnown("company", clues), true);
  assert.equal(attrIsKnown("gender", clues), false);
  assert.equal(attrIsKnown("primary_group", clues), false);
}

// Idol gender is ternary: {boy, girl, nonbinary}. Excluding ANY TWO pins
// the third by elimination; one exclusion alone still leaves two options.
// Group gender is also ternary {boy, girl, coed} with the same rule.
{
  const oneExcluded = {
    gender: { known: null, excluded: new Set(["boy"]), impliedCoed: false },
  };
  const twoExcluded = {
    gender: { known: null, excluded: new Set(["boy", "girl"]), impliedCoed: false },
  };
  // Idol: one exclusion → still two options open.
  assert.equal(
    attrIsKnown("gender", oneExcluded, null, "idol"),
    false,
    "idol: one exclusion leaves two options (girl + nonbinary) — not yet pinned",
  );
  // Idol: two exclusions → third pinned.
  assert.equal(
    attrIsKnown("gender", twoExcluded, null, "idol"),
    true,
    "idol: two exclusions pin the remaining option (nonbinary)",
  );
  // Group: same rule.
  assert.equal(
    attrIsKnown("gender", oneExcluded, null, "group"),
    false,
    "group: one exclusion still leaves girl + coed open",
  );
  // Default (no entity arg) behaves like "group" — safe back-compat.
  assert.equal(attrIsKnown("gender", oneExcluded), false);
}

// Inferred-knowness: a range that has collapsed to a single value counts as
// known even without info.known being set. This is the regression case where
// guessing a Gen 5 and a Gen 3 idol pins generation to 4 — the hint button
// shouldn't still offer to "reveal" it.
{
  const clues = {
    debut_year:   { known: null, min: null, max: null },
    generation:   { known: null, min: 4,    max: 4    }, // collapsed to 4
    member_count: { known: null, min: null, max: null },
    birth_year:   { known: null, min: null, max: null },
  };
  assert.equal(attrIsKnown("generation", clues), true, "range collapse (min===max) counts as known");
  assert.equal(attrIsKnown("debut_year", clues), false);
}

// Bound saturation: when bounds are provided and the inferred range hits the
// dataset extreme on the *opposite* side, the value is pinned (e.g. max <= 1
// when dataset min is 1 → must be Gen 1).
{
  const clues = {
    debut_year:   { known: null, min: null, max: null },
    generation:   { known: null, min: null, max: 1    }, // "≤1" → must be 1
    member_count: { known: null, min: null, max: null },
    birth_year:   { known: null, min: null, max: null },
  };
  const bounds = { generation: { min: 1, max: 5 } };
  assert.equal(attrIsKnown("generation", clues, bounds), true, "max saturating dataset min counts as known");
  assert.equal(attrIsKnown("generation", clues), false, "but only when bounds are passed");
}

// Symmetric: min saturating dataset max also counts as known.
{
  const clues = {
    debut_year:   { known: null, min: 2026, max: null }, // "≥2026" → must be 2026
    generation:   { known: null, min: null, max: null },
    member_count: { known: null, min: null, max: null },
    birth_year:   { known: null, min: null, max: null },
  };
  const bounds = { debut_year: { min: 1993, max: 2026 } };
  assert.equal(attrIsKnown("debut_year", clues, bounds), true);
}

// ─── nextHintAttr ──────────────────────────────────────────────────────────────

const target = {
  debut_year: 2013,
  generation: 3,
  company: "Big Hit Music",
  member_count: 7,
  gender: "boy",
  status: "active",
  country: "KR",
};

// Empty clues + empty events: returns first attr in order that's visible and has a value.
{
  const order = ["country", "company", "member_count", "debut_year"];
  const visible = ["debut_year", "company", "member_count", "country"];
  const clues = {
    debut_year: { known: null, min: null, max: null },
    member_count: { known: null, min: null, max: null },
    company: { known: null, knownParent: null, excludedCompanies: new Set(), excludedParents: new Set() },
    country: { known: null, excluded: new Set() },
  };
  const attr = nextHintAttr({ order, events: [], clues, visibleAttrs: visible, target });
  assert.equal(attr, "country", "first visible + valued + unknown wins");
}

// If first candidate is already revealed, skip to next.
{
  const order = ["country", "company", "member_count", "debut_year"];
  const visible = ["debut_year", "company", "member_count", "country"];
  const clues = {
    debut_year: { known: null, min: null, max: null },
    member_count: { known: null, min: null, max: null },
    company: { known: null, knownParent: null, excludedCompanies: new Set(), excludedParents: new Set() },
    country: { known: null, excluded: new Set() },
  };
  const events = [{ guessIdxAtClick: 0, attr: "country", value: "KR", cost: 5 }];
  const attr = nextHintAttr({ order, events, clues, visibleAttrs: visible, target });
  assert.equal(attr, "company", "skip previously-revealed");
}

// If clue already pins it, skip.
{
  const order = ["country", "company", "member_count", "debut_year"];
  const visible = ["debut_year", "company", "member_count", "country"];
  const clues = {
    debut_year: { known: null, min: null, max: null },
    member_count: { known: null, min: null, max: null },
    company: { known: "Big Hit Music", knownParent: "HYBE", excludedCompanies: new Set(), excludedParents: new Set() },
    country: { known: "KR", excluded: new Set() },
  };
  const attr = nextHintAttr({ order, events: [], clues, visibleAttrs: visible, target });
  assert.equal(attr, "member_count", "skip clues already pinned by guesses");
}

// All known / revealed → null.
{
  const order = ["country", "company"];
  const visible = ["country", "company"];
  const clues = {
    company: { known: "Big Hit Music", knownParent: "HYBE", excludedCompanies: new Set(), excludedParents: new Set() },
    country: { known: "KR", excluded: new Set() },
  };
  const attr = nextHintAttr({ order, events: [], clues, visibleAttrs: visible, target });
  assert.equal(attr, null);
}

// Regression: nextHintAttr skips an attr whose range has collapsed to one
// value (the "guessed Gen 5 + Gen 3 → must be Gen 4" case).
{
  const order = ["generation", "company"];
  const visible = ["generation", "company"];
  const clues = {
    debut_year:   { known: null, min: null, max: null },
    generation:   { known: null, min: 4, max: 4 }, // pinned by ▲/▼ guesses
    member_count: { known: null, min: null, max: null },
    birth_year:   { known: null, min: null, max: null },
    company: { known: null, knownParent: null, excludedCompanies: new Set(), excludedParents: new Set() },
    country: { known: null, excluded: new Set() },
  };
  const attr = nextHintAttr({ order, events: [], clues, visibleAttrs: visible, target });
  assert.equal(attr, "company", "skip generation when range pins it to one value");
}

// ─── attrsByUniqueness ─────────────────────────────────────────────────────────

// Returns attrs sorted by unique value count, ascending. Stable on ties.
{
  const pool = [
    { country: "KR", company: "Big Hit Music",    debut_year: 2013, gender: "boy" },
    { country: "KR", company: "JYP Entertainment", debut_year: 2015, gender: "girl" },
    { country: "KR", company: "Big Hit Music",    debut_year: 2018, gender: "boy" },
    { country: "KR", company: "YG Entertainment", debut_year: 2016, gender: "coed" },
  ];
  const visible = ["debut_year", "company", "gender", "country"];
  // unique counts: country=1, gender=3, company=3, debut_year=4
  // ties (gender vs company at 3) preserved in input order: gender before company? No —
  // input order is debut_year, company, gender, country, so company comes before gender.
  const order = attrsByUniqueness(pool, visible);
  assert.deepEqual(order, ["country", "company", "gender", "debut_year"]);
}

// Null/empty values are ignored (don't inflate the unique-value count).
{
  const pool = [
    { generation: 1, status: "active" },
    { generation: 2, status: null },
    { generation: 3, status: "" },
    { generation: 4, status: undefined },
  ];
  const order = attrsByUniqueness(pool, ["generation", "status"]);
  // generation has 4 distinct values; status has 1 (only "active" counts).
  assert.deepEqual(order, ["status", "generation"]);
}

// Empty pool → all attrs tied at zero; output keeps input order.
{
  const order = attrsByUniqueness([], ["a", "b", "c"]);
  assert.deepEqual(order, ["a", "b", "c"]);
}

console.log("hint.test ok");
