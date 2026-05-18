// Local-only achievements. Definitions are pure descriptions + a `check`
// function that takes the persisted stats blob (as returned by getStats())
// and returns `true` when the achievement should be unlocked.
//
// Some unlocks are event-based (player clicks the share button; player
// wins a friend's puzzle). For those the check returns false — the caller
// invokes markAchievement(id) directly at the action site.
//
// Each achievement also has a stable string id (used as the storage key)
// and an emoji icon. Names + descriptions are pulled from i18n at render
// time, keyed by `achievement.<id>.name` / `achievement.<id>.desc`.

// Helper: does the player have ANY daily win in this entity's history /
// totals? Needed because the 100-cap history might not include the very
// first win after long play.
function hasAnyDailyWin(bucket) {
  if (bucket.totals?.dailyWins > 0) return true;
  return (bucket.history || []).some((h) => h.mode === "daily" && h.won);
}

// Helper: scan history for any record matching a predicate. Used for
// skill achievements that key on attributes of a single round.
function someHistory(stats, predicate) {
  for (const entity of ["group", "idol"]) {
    const bucket = stats[entity];
    if (!bucket) continue;
    for (const h of bucket.history || []) {
      if (predicate(h)) return true;
    }
  }
  return false;
}

// Helper: max best-streak across all (entity, difficulty) combinations.
function maxBestStreak(stats) {
  let max = 0;
  for (const entity of ["group", "idol"]) {
    const streaks = stats[entity]?.streaks || {};
    for (const d of Object.keys(streaks)) {
      if (streaks[d].best > max) max = streaks[d].best;
    }
  }
  return max;
}

export const ACHIEVEMENTS = [
  // ── Starter / volume ──
  {
    id: "first_steps",
    icon: "🐣",
    check: (s) => hasAnyDailyWin(s.group) || hasAnyDailyWin(s.idol),
  },
  {
    id: "ten_down",
    icon: "🎯",
    check: (s) => (s.group?.totals?.dailyWins || 0) + (s.idol?.totals?.dailyWins || 0) >= 10,
  },
  {
    id: "centurion",
    icon: "💯",
    check: (s) => (s.group?.totals?.dailyWins || 0) + (s.idol?.totals?.dailyWins || 0) >= 100,
  },
  {
    id: "both_sides",
    icon: "🌐",
    check: (s) => hasAnyDailyWin(s.group) && hasAnyDailyWin(s.idol),
  },

  // ── Streak ──
  {
    id: "streak_of_seven",
    icon: "🔥",
    check: (s) => maxBestStreak(s) >= 7,
  },
  {
    id: "streak_of_thirty",
    icon: "🌋",
    check: (s) => maxBestStreak(s) >= 30,
  },
  {
    id: "cool_save",
    icon: "❄️",
    // Any current streak that's used its freeze. Unlocks at the moment of
    // the save and persists (the freeze flag itself is transient on the
    // streak object, but the achievement id, once written, is forever).
    check: (s) => {
      for (const entity of ["group", "idol"]) {
        const streaks = s[entity]?.streaks || {};
        for (const d of Object.keys(streaks)) {
          if (streaks[d].freezeUsed) return true;
        }
      }
      return false;
    },
  },

  // ── Skill ──
  {
    id: "hat_trick",
    icon: "🎩",
    // Hard daily, 3 or fewer ACTUAL guesses (not counting hint-cost padding).
    // `rawGuesses` was added with the achievements feature; older history
    // records don't have it — read `guesses` as a fallback so the check
    // still works on legacy data (slightly looser since `guesses` includes
    // hint penalty, but it's the best we can do).
    check: (s) => someHistory(s, (h) =>
      h.mode === "daily" && h.difficulty === "hard" && h.won &&
      (h.rawGuesses ?? h.guesses) <= 3
    ),
  },
  {
    id: "no_help",
    icon: "🦉",
    // Won any daily without clicking the hint button. Records before the
    // schema bump don't have `hints` — fall back to `guesses === rawGuesses`
    // as a proxy (true when no hint was ever used).
    check: (s) => someHistory(s, (h) =>
      h.mode === "daily" && h.won &&
      ((h.hints ?? 0) === 0) &&
      (h.rawGuesses == null || h.rawGuesses === h.guesses)
    ),
  },
  {
    id: "beginners_luck",
    icon: "🎲",
    // Hard daily, won on the first actual guess. Pure RNG — but that's
    // the point: bragging rights for a wild lucky strike.
    check: (s) => someHistory(s, (h) =>
      h.mode === "daily" && h.difficulty === "hard" && h.won &&
      (h.rawGuesses ?? h.guesses) === 1 && (h.hints ?? 0) === 0
    ),
  },
  {
    id: "detective_work",
    icon: "🔍",
    check: (s) => someHistory(s, (h) =>
      h.mode === "daily" && h.won && h.filterMode === true
    ),
  },

  // ── Variety ──
  {
    id: "around_the_world",
    icon: "🌍",
    // Won an idol round where the target was non-Korean. The nationality
    // is captured in the history record at write time so we don't have
    // to plumb the data module into the check function.
    check: (s) => someHistory(s, (h) =>
      h.won && h.entity === "idol" &&
      h.nationality != null && h.nationality !== "Korean"
    ),
  },
  {
    id: "through_the_gens",
    icon: "🎂",
    // Won at least one round in each of Gen 1-5 (across daily AND endless).
    check: (s) => {
      const seen = new Set();
      for (const entity of ["group", "idol"]) {
        for (const h of (s[entity]?.history || [])) {
          if (h.won && h.generation != null) seen.add(h.generation);
        }
      }
      for (let g = 1; g <= 5; g++) if (!seen.has(g)) return false;
      return true;
    },
  },

  // ── Custom puzzles ──
  // These two are event-based: the share-button click and the custom-
  // puzzle-win-handler call markAchievement() directly. The check here
  // is a no-op so the standard "re-evaluate after every round" pass
  // doesn't try to read state that doesn't exist.
  { id: "sharing_is_caring", icon: "📨", check: () => false },
  { id: "friends_puzzle",    icon: "🤝", check: () => false },
];

// Evaluate all condition-based achievements against the current stats.
// Returns the array of unlocked achievement IDs (any in the predicate
// set, not just newly unlocked — caller diffs against the persisted
// `achievements` blob to find which are new).
export function evaluateAchievements(stats) {
  return ACHIEVEMENTS.filter((a) => {
    try { return a.check(stats); } catch { return false; }
  }).map((a) => a.id);
}

// Compute the set of IDs that aren't already in `unlockedMap` but now
// satisfy their condition. Used by main.js after each record event to
// surface fresh toasts without re-firing for ones the player already saw.
export function newlyUnlocked(stats, unlockedMap = {}) {
  return evaluateAchievements(stats).filter((id) => !unlockedMap[id]);
}

// Lookup helper for the modal renderer.
export function achievementById(id) {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
