import { strict as assert } from "node:assert";

// Minimal localStorage shim so persist.js's read/write code paths work in
// Node. The browser-only persistence layer otherwise silently falls back to
// DEFAULT_STATE on every read when globalThis.localStorage is undefined,
// which makes round-trip stateful tests (like streak progression) impossible.
globalThis.localStorage = (() => {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

const { summarizeHistory, getStats, recordDailyWin, recordDailyLoss, getDailyArchive } = await import("../js/persist.js");

function resetStorage() {
  globalThis.localStorage.clear();
}

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

// ─── Streak progression + streak-freeze ─────────────────────────────────────
//
// Rule: a streak survives ONE missed day (last win was day-before-yesterday).
// That "freeze" recharges only when the streak resets — same streak can't
// burn it twice. A loss always resets the streak and re-arms the freeze.
//
// Tests use explicit date strings so we don't depend on wall-clock time.

function streakOf(entity = "group", difficulty = "easy") {
  return getStats()[entity].streaks[difficulty];
}

// Consecutive wins: streak grows, freeze stays unused.
{
  resetStorage();
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-15");
  recordDailyWin("group", "easy", "Q2", 4, "2026-05-16");
  recordDailyWin("group", "easy", "Q3", 2, "2026-05-17");
  const s = streakOf();
  assert.equal(s.current, 3, "three back-to-back wins → streak=3");
  assert.equal(s.best, 3);
  assert.equal(s.freezeUsed, false, "no gap yet, freeze still available");
}

// Single missed day with freeze available → streak continues, freeze consumed.
{
  resetStorage();
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-15");
  recordDailyWin("group", "easy", "Q2", 4, "2026-05-16");
  // Skip 2026-05-17
  recordDailyWin("group", "easy", "Q3", 2, "2026-05-18");
  const s = streakOf();
  assert.equal(s.current, 3, "skip-then-win consumes the freeze and continues");
  assert.equal(s.freezeUsed, true);
  assert.equal(s.best, 3);
}

// Second missed day in the same streak → reset (freeze already used).
{
  resetStorage();
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-15");
  // Skip 2026-05-16 — first gap, uses freeze
  recordDailyWin("group", "easy", "Q2", 4, "2026-05-17");
  assert.equal(streakOf().current, 2);
  assert.equal(streakOf().freezeUsed, true);
  // Skip 2026-05-18 — second gap, no freeze left
  recordDailyWin("group", "easy", "Q3", 2, "2026-05-19");
  const s = streakOf();
  assert.equal(s.current, 1, "second gap with freeze already used → reset to 1");
  assert.equal(s.freezeUsed, false, "freeze re-arms for the new streak");
  assert.equal(s.best, 2, "best preserved from the earlier streak");
}

// Two consecutive missed days → reset (gap too large even with freeze).
{
  resetStorage();
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-15");
  recordDailyWin("group", "easy", "Q2", 4, "2026-05-16");
  // Skip 2026-05-17 AND 2026-05-18 (>1 day gap)
  recordDailyWin("group", "easy", "Q3", 2, "2026-05-19");
  const s = streakOf();
  assert.equal(s.current, 1, "two-day gap is beyond what the freeze covers");
  assert.equal(s.freezeUsed, false);
}

// A loss resets BOTH the streak and the freeze (so a fresh streak doesn't
// start with the freeze already burned).
{
  resetStorage();
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-15");
  // Skip 2026-05-16 → freeze used on next win
  recordDailyWin("group", "easy", "Q2", 4, "2026-05-17");
  assert.equal(streakOf().freezeUsed, true);
  // Now lose on 2026-05-18
  recordDailyLoss("group", "easy", "Q3", 6, "2026-05-18");
  let s = streakOf();
  assert.equal(s.current, 0);
  assert.equal(s.freezeUsed, false, "loss re-arms the freeze for the next streak");
  // Restart the streak — freeze should be available again.
  recordDailyWin("group", "easy", "Q4", 3, "2026-05-19");
  assert.equal(streakOf().current, 1);
  assert.equal(streakOf().freezeUsed, false);
}

// Same-day double-record: only counts once (no-op on re-record).
{
  resetStorage();
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-15");
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-15");
  assert.equal(streakOf().current, 1, "same date double-write is idempotent");
}

// Per-entity / per-difficulty isolation: group/easy doesn't affect idol/hard.
{
  resetStorage();
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-15");
  recordDailyWin("group", "easy", "Q2", 4, "2026-05-16");
  assert.equal(getStats().group.streaks.easy.current, 2);
  assert.equal(getStats().idol.streaks.easy.current, 0);
  assert.equal(getStats().group.streaks.hard.current, 0);
}

// ─── getDailyArchive ────────────────────────────────────────────────────────
//
// Produces a newest-first window of (up to N) daily-mode entries for the
// given (entity, difficulty). Played days carry their result + targetId;
// unplayed days are surfaced as a placeholder so the player can see the
// gap and click to replay. `today` is injectable for stable tests.

// Empty history → today + N-1 unplayed past days.
{
  resetStorage();
  const a = getDailyArchive("group", "easy", 5, "2026-05-18");
  assert.equal(a.length, 5);
  assert.deepEqual(a.map((r) => r.date), [
    "2026-05-18", "2026-05-17", "2026-05-16", "2026-05-15", "2026-05-14",
  ]);
  assert.equal(a[0].isToday, true);
  assert.equal(a.every((r, i) => i === 0 || r.isToday === false), true);
  assert.equal(a.every((r) => r.played === false), true);
}

// Mixed history: win, loss, skipped days; correct status per row.
{
  resetStorage();
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-14");
  // 2026-05-15: skipped
  recordDailyLoss("group", "easy", "Q2", 6, "2026-05-16");
  // 2026-05-17: skipped
  recordDailyWin("group", "easy", "Q3", 4, "2026-05-18");
  const a = getDailyArchive("group", "easy", 5, "2026-05-18");
  assert.equal(a[0].date, "2026-05-18");
  assert.equal(a[0].played, true);
  assert.equal(a[0].won, true);
  assert.equal(a[0].guesses, 4);
  assert.equal(a[0].targetId, "Q3");

  assert.equal(a[1].date, "2026-05-17");
  assert.equal(a[1].played, false, "skipped day shows up as not-played");

  assert.equal(a[2].date, "2026-05-16");
  assert.equal(a[2].played, true);
  assert.equal(a[2].won, false, "loss recorded correctly");
  assert.equal(a[2].targetId, "Q2");

  assert.equal(a[3].date, "2026-05-15");
  assert.equal(a[3].played, false);

  assert.equal(a[4].date, "2026-05-14");
  assert.equal(a[4].played, true);
  assert.equal(a[4].won, true);
  assert.equal(a[4].targetId, "Q1");
}

// Filters by (entity, difficulty): another difficulty's history doesn't bleed in.
{
  resetStorage();
  recordDailyWin("group", "easy",   "Q-easy",   3, "2026-05-17");
  recordDailyWin("group", "medium", "Q-medium", 4, "2026-05-17");
  recordDailyWin("group", "hard",   "Q-hard",   5, "2026-05-17");
  recordDailyWin("idol",  "easy",   "Q-idol",   2, "2026-05-17");

  const easy = getDailyArchive("group", "easy", 2, "2026-05-18");
  assert.equal(easy[1].targetId, "Q-easy", "group/easy archive only sees group/easy plays");

  const medium = getDailyArchive("group", "medium", 2, "2026-05-18");
  assert.equal(medium[1].targetId, "Q-medium");

  const idolEasy = getDailyArchive("idol", "easy", 2, "2026-05-18");
  assert.equal(idolEasy[1].targetId, "Q-idol");
}

// Day window defaults to 14 entries.
{
  resetStorage();
  const a = getDailyArchive("group", "easy");
  assert.equal(a.length, 14);
}

console.log("persist.test ok");
