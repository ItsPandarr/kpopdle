import { strict as assert } from "node:assert";
import { summarizeHistory } from "../js/persist.js";

// ─── summarizeHistory ──────────────────────────────────────────────────────────

// Empty history → no plays, nullable win rate (UI shows "no plays").
{
  const r = summarizeHistory([], "daily", "easy");
  assert.equal(r.played, 0);
  assert.equal(r.wins, 0);
  assert.equal(r.winRatePct, null, "no plays → null rate, not 0");
  assert.deepEqual(r.distribution, {});
}

// Filters to mode + difficulty only. Other plays don't bleed into the count.
{
  const history = [
    { mode: "daily",   difficulty: "easy",   guesses: 3, won: true },
    { mode: "daily",   difficulty: "easy",   guesses: 2, won: true },
    { mode: "daily",   difficulty: "medium", guesses: 4, won: true },
    { mode: "endless", difficulty: "easy",   guesses: 5, won: true },
  ];
  const r = summarizeHistory(history, "daily", "easy");
  assert.equal(r.played, 2);
  assert.equal(r.wins, 2);
  assert.equal(r.winRatePct, 100);
  assert.deepEqual(r.distribution, { 2: 1, 3: 1 });
}

// Losses → "X" bucket; wins counted in the matching numeric bucket.
{
  const history = [
    { mode: "daily", difficulty: "easy", guesses: 6, won: false },
    { mode: "daily", difficulty: "easy", guesses: 3, won: true },
    { mode: "daily", difficulty: "easy", guesses: 3, won: true },
    { mode: "daily", difficulty: "easy", guesses: 6, won: false },
  ];
  const r = summarizeHistory(history, "daily", "easy");
  assert.equal(r.played, 4);
  assert.equal(r.wins, 2);
  assert.equal(r.winRatePct, 50);
  assert.deepEqual(r.distribution, { 3: 2, X: 2 }, "wins per guess count + losses pooled");
}

// Endless doesn't have losses → no X bucket, win rate 100%.
{
  const history = [
    { mode: "endless", difficulty: "hard", guesses: 7, won: true },
    { mode: "endless", difficulty: "hard", guesses: 9, won: true },
    { mode: "endless", difficulty: "hard", guesses: 7, won: true },
  ];
  const r = summarizeHistory(history, "endless", "hard");
  assert.equal(r.played, 3);
  assert.equal(r.wins, 3);
  assert.equal(r.winRatePct, 100);
  assert.deepEqual(r.distribution, { 7: 2, 9: 1 });
}

// Win rate rounds to nearest integer (1/3 → 33%).
{
  const history = [
    { mode: "daily", difficulty: "hard", guesses: 5, won: true },
    { mode: "daily", difficulty: "hard", guesses: 10, won: false },
    { mode: "daily", difficulty: "hard", guesses: 10, won: false },
  ];
  const r = summarizeHistory(history, "daily", "hard");
  assert.equal(r.winRatePct, 33);
}

// Null / undefined / missing history is treated as empty (defensive against
// a missing entity bucket).
assert.equal(summarizeHistory(null, "daily", "easy").played, 0);
assert.equal(summarizeHistory(undefined, "daily", "easy").played, 0);

// Endless skips: tagged with skipped:true and bucketed under "S".
{
  const history = [
    { mode: "endless", difficulty: "easy", guesses: 3, won: true },
    { mode: "endless", difficulty: "easy", guesses: 2, won: false, skipped: true },
    { mode: "endless", difficulty: "easy", guesses: 5, won: false, skipped: true },
  ];
  const r = summarizeHistory(history, "endless", "easy");
  assert.equal(r.played, 3);
  assert.equal(r.wins, 1);
  assert.deepEqual(r.distribution, { 3: 1, S: 2 }, "wins → numeric bucket, skips → S");
}

// Daily losses still bucket as X — skipped flag is endless-only convention.
{
  const history = [
    { mode: "daily", difficulty: "easy", guesses: 6, won: false },
  ];
  const r = summarizeHistory(history, "daily", "easy");
  assert.deepEqual(r.distribution, { X: 1 });
}

console.log("persist.test ok");
