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

const {
  summarizeHistory,
  getStats,
  recordDailyWin,
  recordDailyLoss,
  getDailyArchive,
  getDailyHistoryEntry,
  getRecentEndlessTargets,
  pushRecentEndlessTarget,
  RECENT_ENDLESS_CAP,
  ARCHIVE_DAYS,
  exportStats,
  importStats,
  parseImportedStats,
  getActiveReplay,
  saveActiveReplay,
  clearActiveReplay,
} = await import("../js/persist.js");

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

// ─── Recent-endless ring buffer ────────────────────────────────────────────
//
// pickTarget filters its endless rolls against this buffer so a player
// doesn't get the same target twice in a row. The buffer is per-entity,
// newest-first, capped at RECENT_ENDLESS_CAP.

// Empty by default; mutation through the helper survives a re-read.
{
  resetStorage();
  assert.deepEqual(getRecentEndlessTargets("group"), []);
  pushRecentEndlessTarget("group", "Q1");
  assert.deepEqual(getRecentEndlessTargets("group"), ["Q1"]);
  pushRecentEndlessTarget("group", "Q2");
  assert.deepEqual(getRecentEndlessTargets("group"), ["Q2", "Q1"], "newest first");
}

// Per-entity isolation — pushing to group doesn't bleed into idol.
{
  resetStorage();
  pushRecentEndlessTarget("group", "Q1");
  assert.deepEqual(getRecentEndlessTargets("group"), ["Q1"]);
  assert.deepEqual(getRecentEndlessTargets("idol"), []);
}

// De-dupe: pushing an id that's already in the buffer moves it to the
// front instead of stacking duplicates. Prevents one stuck id from
// hogging multiple slots in the ring.
{
  resetStorage();
  pushRecentEndlessTarget("group", "Q1");
  pushRecentEndlessTarget("group", "Q2");
  pushRecentEndlessTarget("group", "Q3");
  pushRecentEndlessTarget("group", "Q1");
  assert.deepEqual(getRecentEndlessTargets("group"), ["Q1", "Q3", "Q2"]);
}

// Trim to RECENT_ENDLESS_CAP — oldest entries fall off the back.
{
  resetStorage();
  for (let i = 0; i < RECENT_ENDLESS_CAP + 5; i++) {
    pushRecentEndlessTarget("group", `Q${i}`);
  }
  const list = getRecentEndlessTargets("group");
  assert.equal(list.length, RECENT_ENDLESS_CAP);
  // The 5 oldest pushes should have been evicted.
  assert.ok(!list.includes("Q0"));
  assert.ok(!list.includes("Q4"));
  // The 5 newest should be at the front, newest first.
  assert.equal(list[0], `Q${RECENT_ENDLESS_CAP + 4}`);
}

// Defensive: null/empty id is a no-op rather than corrupting the list.
{
  resetStorage();
  pushRecentEndlessTarget("group", "Q1");
  pushRecentEndlessTarget("group", null);
  pushRecentEndlessTarget("group", "");
  pushRecentEndlessTarget("group", undefined);
  assert.deepEqual(getRecentEndlessTargets("group"), ["Q1"]);
}

// ─── Daily history + guessIds + pruning ────────────────────────────────────

// guessIds round-trip through recordDailyWin / recordDailyLoss.
{
  resetStorage();
  recordDailyWin("group", "easy", "Q-target", 3, "2026-05-17", {
    guessIds: ["Q1", "Q2", "Q-target"],
    hints: 0,
  });
  const e = getDailyHistoryEntry("group", "easy", "2026-05-17");
  assert.ok(e, "entry was saved");
  assert.deepEqual(e.guessIds, ["Q1", "Q2", "Q-target"]);
  assert.equal(e.won, true);
}

// Missing guessIds opt → stored as empty array (back-compat, no crash).
{
  resetStorage();
  recordDailyWin("group", "easy", "Q-target", 3, "2026-05-17");
  const e = getDailyHistoryEntry("group", "easy", "2026-05-17");
  assert.deepEqual(e.guessIds, []);
}

// Loss path stores guessIds too.
{
  resetStorage();
  recordDailyLoss("group", "easy", "Q-target", 6, "2026-05-17", {
    guessIds: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"],
  });
  const e = getDailyHistoryEntry("group", "easy", "2026-05-17");
  assert.equal(e.won, false);
  assert.equal(e.guessIds.length, 6);
}

// Daily entries older than ARCHIVE_DAYS get pruned on the next record.
// Endless entries are NOT date-pruned (they age out via the cap instead).
{
  resetStorage();
  // 25 days back — outside the ARCHIVE_DAYS window.
  recordDailyWin("group", "easy", "Q-old", 3, "2026-04-22", { guessIds: ["Q1"] });
  // Today's record triggers the prune via trimHistory.
  recordDailyWin("group", "easy", "Q-today", 3, "2026-05-17", { guessIds: ["Q2"] });
  const old = getDailyHistoryEntry("group", "easy", "2026-04-22");
  const fresh = getDailyHistoryEntry("group", "easy", "2026-05-17");
  assert.equal(old, null, "25-day-old daily entry was pruned");
  assert.ok(fresh, "today's entry survived");
}

// Entry exactly at the edge of the window stays.
{
  resetStorage();
  // ARCHIVE_DAYS days back — at the boundary, should survive.
  const today = new Date("2026-05-17T00:00:00Z");
  const edge = new Date(today);
  edge.setUTCDate(edge.getUTCDate() - ARCHIVE_DAYS);
  const edgeStr = edge.toISOString().slice(0, 10);
  recordDailyWin("group", "easy", "Q-edge", 3, edgeStr, { guessIds: ["Q1"] });
  recordDailyWin("group", "easy", "Q-today", 3, "2026-05-17", { guessIds: ["Q2"] });
  assert.ok(getDailyHistoryEntry("group", "easy", edgeStr), "edge entry survives");
}

// getDailyHistoryEntry returns null for unplayed (entity, difficulty, date).
{
  resetStorage();
  recordDailyWin("group", "easy", "Q-target", 3, "2026-05-17", { guessIds: ["Q1"] });
  assert.equal(getDailyHistoryEntry("group", "easy", "2026-05-16"), null);
  assert.equal(getDailyHistoryEntry("group", "hard", "2026-05-17"), null);
  assert.equal(getDailyHistoryEntry("idol",  "easy", "2026-05-17"), null);
}

// ─── Archive in-progress detection ─────────────────────────────────────────
//
// A row is flagged inProgress when there's an active-replay (or live
// active daily for today) with at least one guess on file. The flag
// drives the "in progress" archive label and the icon swap.

// Past date with a saved replay carrying guesses → inProgress flag set.
{
  resetStorage();
  saveActiveReplay("group", "easy", "2026-05-15", {
    targetId: "Q-T",
    guessIds: ["Q1", "Q2"],
    hintOrder: [],
    hintEvents: [],
    filterMode: false,
  });
  const archive = getDailyArchive("group", "easy", 5, "2026-05-17");
  const may15 = archive.find((r) => r.date === "2026-05-15");
  assert.ok(may15);
  assert.equal(may15.inProgress, true);
  assert.equal(may15.inProgressGuesses, 2);
}

// Empty replay (saved but no guesses yet) does NOT count as in-progress.
{
  resetStorage();
  saveActiveReplay("group", "easy", "2026-05-15", {
    targetId: "Q-T",
    guessIds: [],
    hintOrder: [],
    hintEvents: [],
    filterMode: false,
  });
  const a = getDailyArchive("group", "easy", 5, "2026-05-17");
  assert.equal(a.find((r) => r.date === "2026-05-15").inProgress, false);
}

// In-progress takes display priority even when the date was previously
// played: the row still surfaces as inProgress=true so click routing
// resumes the active replay rather than showing the past-guesses modal.
{
  resetStorage();
  recordDailyWin("group", "easy", "Q-old-target", 3, "2026-05-15", {
    guessIds: ["X", "Y", "Z"],
  });
  saveActiveReplay("group", "easy", "2026-05-15", {
    targetId: "Q-old-target",
    guessIds: ["Q1"],
    hintOrder: [],
    hintEvents: [],
    filterMode: false,
  });
  const may15 = getDailyArchive("group", "easy", 5, "2026-05-17")
    .find((r) => r.date === "2026-05-15");
  assert.equal(may15.played, true,    "played flag still reflects history");
  assert.equal(may15.inProgress, true,"in-progress takes display priority");
}

// ─── Active replay state ───────────────────────────────────────────────────
//
// Replays from the daily archive persist mid-round state per (entity,
// difficulty, date) so the player can tab between several in-progress
// replays without losing work.

// Empty by default; save+get round-trip preserves the snapshot.
{
  resetStorage();
  assert.equal(getActiveReplay("group", "easy", "2026-05-15"), null);
  saveActiveReplay("group", "easy", "2026-05-15", {
    targetId: "Q-T",
    guessIds: ["Q1", "Q2"],
    hintOrder: ["debut_year", "gender"],
    hintEvents: [{ attr: "debut_year", value: 2013, cost: 4, guessIdxAtClick: 0 }],
    filterMode: true,
  });
  const r = getActiveReplay("group", "easy", "2026-05-15");
  assert.ok(r);
  assert.equal(r.targetId, "Q-T");
  assert.deepEqual(r.guessIds, ["Q1", "Q2"]);
  assert.deepEqual(r.hintOrder, ["debut_year", "gender"]);
  assert.equal(r.hintEvents.length, 1);
  assert.equal(r.filterMode, true);
}

// Per (entity, difficulty, date) isolation — saving group/easy doesn't bleed
// into idol/easy or group/medium or the same combo on a different date.
{
  resetStorage();
  saveActiveReplay("group", "easy", "2026-05-15", { targetId: "Q1", guessIds: ["A"], hintOrder: [], hintEvents: [], filterMode: false });
  assert.deepEqual(getActiveReplay("group", "easy", "2026-05-15")?.guessIds, ["A"]);
  assert.equal(getActiveReplay("idol",  "easy", "2026-05-15"), null);
  assert.equal(getActiveReplay("group", "medium", "2026-05-15"), null);
  assert.equal(getActiveReplay("group", "easy", "2026-05-14"), null);
}

// clearActiveReplay drops just that one entry.
{
  resetStorage();
  saveActiveReplay("group", "easy", "2026-05-15", { targetId: "Q1", guessIds: ["A"], hintOrder: [], hintEvents: [], filterMode: false });
  saveActiveReplay("group", "easy", "2026-05-16", { targetId: "Q2", guessIds: ["B"], hintOrder: [], hintEvents: [], filterMode: false });
  clearActiveReplay("group", "easy", "2026-05-15");
  assert.equal(getActiveReplay("group", "easy", "2026-05-15"), null);
  assert.ok(getActiveReplay("group", "easy", "2026-05-16"));
}

// Replay states older than ARCHIVE_DAYS get pruned on the next record* call
// (via the same trim path that prunes history entries).
{
  resetStorage();
  // 25 days before our recording-date — outside the archive window.
  saveActiveReplay("group", "easy", "2026-04-22", { targetId: "Q-old", guessIds: ["A"], hintOrder: [], hintEvents: [], filterMode: false });
  saveActiveReplay("group", "easy", "2026-05-10", { targetId: "Q-fresh", guessIds: ["B"], hintOrder: [], hintEvents: [], filterMode: false });
  // Recording for today triggers trimStorageForDate → prunes the old replay.
  recordDailyWin("group", "easy", "Q-today", 3, "2026-05-17", { guessIds: ["X"] });
  assert.equal(getActiveReplay("group", "easy", "2026-04-22"), null, "25-day-old replay pruned");
  assert.ok(getActiveReplay("group", "easy", "2026-05-10"), "7-day-old replay survives");
}

// ─── export / import roundtrip ─────────────────────────────────────────────

// Empty storage → no exportable code yet.
{
  resetStorage();
  assert.equal(exportStats(), null);
}

// Record a win, export, reset, import → state is restored exactly.
{
  resetStorage();
  recordDailyWin("group", "easy", "Q1", 3, "2026-05-15");
  recordDailyWin("group", "easy", "Q2", 4, "2026-05-16");
  recordDailyWin("idol",  "hard", "Q3", 5, "2026-05-17");
  const before = getStats();

  const code = exportStats();
  assert.equal(typeof code, "string");
  assert.ok(code.length > 0);

  // Wipe + import
  resetStorage();
  assert.deepEqual(getStats().group.totals, { dailyWins: 0, dailyLosses: 0, endlessWins: 0, endlessSkips: 0 });
  importStats(code);

  const after = getStats();
  assert.deepEqual(after.group.totals, before.group.totals, "group totals roundtripped");
  assert.deepEqual(after.idol.totals,  before.idol.totals,  "idol totals roundtripped");
  assert.equal(after.group.streaks.easy.best, before.group.streaks.easy.best);
}

// parseImportedStats throws a code-specific Error.message on each failure mode.
{
  resetStorage();
  for (const [code, expected] of [
    ["",                "empty"],
    ["   ",             "empty"],
    ["not-base64-!@#",  "scramble"],
  ]) {
    let msg = null;
    try { parseImportedStats(code); } catch (e) { msg = e.message; }
    assert.equal(msg, expected, `expected error.message=${expected} for code=${JSON.stringify(code)}`);
  }
}

// Wrong-version blob → "version" error.
{
  // Build a valid-base64-scrambled payload but with version: 1.
  const { scramble } = await import("../js/scramble.js");
  const fake = scramble(JSON.stringify({ version: 1, foo: "bar" }));
  let msg = null;
  try { parseImportedStats(fake); } catch (e) { msg = e.message; }
  assert.equal(msg, "version");
}

console.log("persist.test ok");
