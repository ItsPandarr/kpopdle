import { strict as assert } from "node:assert";
import { ACHIEVEMENTS, evaluateAchievements, newlyUnlocked } from "../js/achievements.js";

// Helper: build a minimal stats blob shaped like what persist.js's read()
// returns, with sensible empty defaults for entity buckets.
function emptyBucket() {
  return {
    daily: { easy: {}, medium: {}, hard: {} },
    streaks: {
      easy:   { current: 0, best: 0, lastWinDate: null, freezeUsed: false },
      medium: { current: 0, best: 0, lastWinDate: null, freezeUsed: false },
      hard:   { current: 0, best: 0, lastWinDate: null, freezeUsed: false },
    },
    bests: { easy: {}, medium: {}, hard: {} },
    endless: { easy: {}, medium: {}, hard: {} },
    totals: { dailyWins: 0, dailyLosses: 0, endlessWins: 0, endlessSkips: 0 },
    history: [],
  };
}
function emptyStats() {
  return { group: emptyBucket(), idol: emptyBucket(), achievements: {} };
}

// Empty stats → no condition-based achievements should fire.
{
  const got = evaluateAchievements(emptyStats());
  assert.deepEqual(got, [], "no plays → no achievements unlocked");
}

// One daily win → first_steps unlocks; ten_down does NOT (only 1 win).
{
  const s = emptyStats();
  s.group.totals.dailyWins = 1;
  s.group.history.push({
    entity: "group", mode: "daily", difficulty: "easy",
    won: true, guesses: 3, rawGuesses: 3, hints: 0,
  });
  const got = evaluateAchievements(s);
  assert.ok(got.includes("first_steps"));
  assert.ok(!got.includes("ten_down"));
}

// 10 daily wins (totals counter, not history) → ten_down. History caps at
// 100 so the counter is the authoritative source.
{
  const s = emptyStats();
  s.group.totals.dailyWins = 10;
  s.group.history.push({ mode: "daily", entity: "group", difficulty: "easy", won: true, guesses: 3, rawGuesses: 3, hints: 0 });
  const got = evaluateAchievements(s);
  assert.ok(got.includes("ten_down"));
  assert.ok(!got.includes("centurion"));
}

// 100 total wins (split across entities) → centurion. Per-entity totals sum.
{
  const s = emptyStats();
  s.group.totals.dailyWins = 60;
  s.idol.totals.dailyWins = 40;
  s.group.history.push({ mode: "daily", entity: "group", difficulty: "easy", won: true, guesses: 3, rawGuesses: 3, hints: 0 });
  s.idol.history.push({ mode: "daily", entity: "idol", difficulty: "easy", won: true, guesses: 3, rawGuesses: 3, hints: 0 });
  const got = evaluateAchievements(s);
  assert.ok(got.includes("centurion"));
  assert.ok(got.includes("both_sides"), "wins in both entities → both_sides");
}

// Streak achievements based on streaks[d].best.
{
  const s = emptyStats();
  s.group.streaks.easy.best = 7;
  s.group.totals.dailyWins = 7;
  s.group.history.push({ mode: "daily", entity: "group", difficulty: "easy", won: true, guesses: 3, rawGuesses: 3, hints: 0 });
  const got = evaluateAchievements(s);
  assert.ok(got.includes("streak_of_seven"));
  assert.ok(!got.includes("streak_of_thirty"));
}
{
  const s = emptyStats();
  s.idol.streaks.hard.best = 30;
  s.idol.totals.dailyWins = 30;
  s.idol.history.push({ mode: "daily", entity: "idol", difficulty: "hard", won: true, guesses: 3, rawGuesses: 3, hints: 0 });
  const got = evaluateAchievements(s);
  assert.ok(got.includes("streak_of_thirty"));
  assert.ok(got.includes("streak_of_seven"), "30-day implies 7-day");
}

// Cool save: any streak with freezeUsed=true.
{
  const s = emptyStats();
  s.group.streaks.medium.freezeUsed = true;
  const got = evaluateAchievements(s);
  assert.ok(got.includes("cool_save"));
}

// Hat trick: Hard daily, ≤3 actual guesses (rawGuesses).
{
  const s = emptyStats();
  s.group.totals.dailyWins = 1;
  s.group.history.push({
    mode: "daily", entity: "group", difficulty: "hard", won: true,
    guesses: 5, rawGuesses: 3, hints: 1,
  });
  const got = evaluateAchievements(s);
  assert.ok(got.includes("hat_trick"));
}
// A Hard win with rawGuesses=4 should NOT trigger hat_trick.
{
  const s = emptyStats();
  s.group.totals.dailyWins = 1;
  s.group.history.push({
    mode: "daily", entity: "group", difficulty: "hard", won: true,
    guesses: 4, rawGuesses: 4, hints: 0,
  });
  const got = evaluateAchievements(s);
  assert.ok(!got.includes("hat_trick"));
}

// No help: daily win with hints=0.
{
  const s = emptyStats();
  s.group.totals.dailyWins = 1;
  s.group.history.push({
    mode: "daily", entity: "group", difficulty: "easy", won: true,
    guesses: 4, rawGuesses: 4, hints: 0,
  });
  assert.ok(evaluateAchievements(s).includes("no_help"));
}
// A win with hints=1 should NOT trigger no_help.
{
  const s = emptyStats();
  s.group.totals.dailyWins = 1;
  s.group.history.push({
    mode: "daily", entity: "group", difficulty: "easy", won: true,
    guesses: 6, rawGuesses: 5, hints: 1,
  });
  assert.ok(!evaluateAchievements(s).includes("no_help"));
}

// Beginner's luck: Hard daily, rawGuesses=1, no hints.
{
  const s = emptyStats();
  s.group.totals.dailyWins = 1;
  s.group.history.push({
    mode: "daily", entity: "group", difficulty: "hard", won: true,
    guesses: 1, rawGuesses: 1, hints: 0,
  });
  assert.ok(evaluateAchievements(s).includes("beginners_luck"));
}

// Detective work: any daily win with filterMode=true.
{
  const s = emptyStats();
  s.group.totals.dailyWins = 1;
  s.group.history.push({
    mode: "daily", entity: "group", difficulty: "easy", won: true,
    guesses: 3, rawGuesses: 3, hints: 0, filterMode: true,
  });
  assert.ok(evaluateAchievements(s).includes("detective_work"));
}

// Around the world: idol win, target nationality ≠ Korean.
{
  const s = emptyStats();
  s.idol.totals.dailyWins = 1;
  s.idol.history.push({
    mode: "daily", entity: "idol", difficulty: "easy", won: true,
    guesses: 3, rawGuesses: 3, hints: 0, nationality: "Japanese",
  });
  assert.ok(evaluateAchievements(s).includes("around_the_world"));
}
// Korean target → not unlocked.
{
  const s = emptyStats();
  s.idol.totals.dailyWins = 1;
  s.idol.history.push({
    mode: "daily", entity: "idol", difficulty: "easy", won: true,
    guesses: 3, rawGuesses: 3, hints: 0, nationality: "Korean",
  });
  assert.ok(!evaluateAchievements(s).includes("around_the_world"));
}

// Through the gens: requires wins covering generations 1-5.
{
  const s = emptyStats();
  for (let gen = 1; gen <= 5; gen++) {
    s.group.totals.dailyWins += 1;
    s.group.history.push({
      mode: "daily", entity: "group", difficulty: "easy", won: true,
      guesses: 3, rawGuesses: 3, hints: 0, generation: gen,
    });
  }
  assert.ok(evaluateAchievements(s).includes("through_the_gens"));
}
// Missing gen 5 → not yet.
{
  const s = emptyStats();
  for (let gen = 1; gen <= 4; gen++) {
    s.group.totals.dailyWins += 1;
    s.group.history.push({
      mode: "daily", entity: "group", difficulty: "easy", won: true,
      guesses: 3, rawGuesses: 3, hints: 0, generation: gen,
    });
  }
  assert.ok(!evaluateAchievements(s).includes("through_the_gens"));
}

// Event-based achievements (sharing_is_caring, friends_puzzle) NEVER fire
// from evaluateAchievements — their check returns false. They're only
// marked imperatively at the moment of action.
{
  const s = emptyStats();
  // Even with maximum stats, these two shouldn't be in the unlocked set.
  s.group.totals.dailyWins = 1000;
  s.idol.totals.dailyWins = 1000;
  s.group.streaks.hard.best = 365;
  const got = evaluateAchievements(s);
  assert.ok(!got.includes("sharing_is_caring"));
  assert.ok(!got.includes("friends_puzzle"));
}

// newlyUnlocked diffs against the already-recorded set.
{
  const s = emptyStats();
  s.group.totals.dailyWins = 1;
  s.group.history.push({ mode: "daily", entity: "group", difficulty: "easy", won: true, guesses: 3, rawGuesses: 3, hints: 0 });
  const fresh1 = newlyUnlocked(s, {});
  assert.ok(fresh1.includes("first_steps"));
  // Once recorded, the same call returns the diff against existing.
  const fresh2 = newlyUnlocked(s, { first_steps: "2026-05-18" });
  assert.ok(!fresh2.includes("first_steps"), "already-unlocked shouldn't reappear");
}

// Every achievement has a stable id, icon, and check function.
{
  const ids = new Set();
  for (const a of ACHIEVEMENTS) {
    assert.equal(typeof a.id, "string");
    assert.equal(typeof a.icon, "string");
    assert.equal(typeof a.check, "function");
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
    ids.add(a.id);
  }
  assert.equal(ACHIEVEMENTS.length, 15, "15 achievements total");
}

console.log("achievements.test ok");
