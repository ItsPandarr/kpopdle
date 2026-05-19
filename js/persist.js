import { STORAGE_KEY, HISTORY_CAP, DIFFICULTIES, ENTITIES } from "./config.js";
import { todayUTC, yesterdayUTC, dayBeforeYesterdayUTC } from "./seed.js";
import { scramble, unscramble } from "./scramble.js";

const EMPTY_DIFF_MAP = () => Object.fromEntries(DIFFICULTIES.map((d) => [d, {}]));

const DEFAULT_ENTITY_STATE = () => ({
  daily: EMPTY_DIFF_MAP(),
  streaks: Object.fromEntries(
    // freezeUsed: a streak gets ONE forgiven missed day per streak. When
    // it's used, this flips to true; it resets when the streak resets
    // (either by another missed day or a loss). See recordDailyWin.
    DIFFICULTIES.map((d) => [d, { current: 0, best: 0, lastWinDate: null, freezeUsed: false }])
  ),
  bests: Object.fromEntries(DIFFICULTIES.map((d) => [d, { fewestGuesses: null }])),
  endless: Object.fromEntries(DIFFICULTIES.map((d) => [d, { played: 0, bestGuesses: null }])),
  // Lifetime totals — kept separately from `history` (which caps at 100
  // entries) so achievements like "100 wins" can count past the cap.
  totals: { dailyWins: 0, dailyLosses: 0, endlessWins: 0, endlessSkips: 0 },
  history: [],
  // In-progress games. Survives tab close / reload until the user wins or rolls a new round.
  // Daily entries are tagged with `date` (UTC YYYY-MM-DD); a mismatched date is treated as no
  // active game. Endless entries are tagged with `targetId` only.
  active: {
    daily: EMPTY_DIFF_MAP(),
    endless: EMPTY_DIFF_MAP(),
    // Archive replay rounds. Shape: replays[difficulty][date] = { targetId,
    // guessIds, hintOrder, hintEvents, filterMode }. Lets the player tab
    // between several in-progress replays without losing state. Cleaned up
    // alongside history when dates age past ARCHIVE_DAYS.
    replays: EMPTY_DIFF_MAP(),
  },
});

const DEFAULT_STATE = () => ({
  version: 2,
  lastSelection: { entity: "group", mode: "daily", difficulty: "easy" },
  // Achievements blob — keyed by achievement id, valued with the ISO date
  // (YYYY-MM-DD) of unlock. Lives at the top level (not per-entity) because
  // some achievements span entity modes. Cleared on "Reset all stats".
  achievements: {},
  // Spoiler-free endless: ring buffer of the most-recent endless target IDs
  // per entity. The endless target picker filters these out so a player
  // doesn't get the same group twice in a row. Cap = RECENT_ENDLESS_CAP.
  recentEndlessTargets: { group: [], idol: [] },
  ...Object.fromEntries(ENTITIES.map((e) => [e, DEFAULT_ENTITY_STATE()])),
});

// How many recent endless targets to block from re-appearing. Small enough
// that even the easy pool (100 entities) still has ~75% of options eligible,
// but big enough that "I just saw Aespa, why is it Aespa again" never
// happens within a normal session.
export const RECENT_ENDLESS_CAP = 25;

// How many days back the daily archive can show + how long we keep daily
// history entries' rich payload (guess IDs + metadata) before pruning. The
// archive UI uses this same constant for its display window so an entry
// that disappears here also disappears from the archive list.
export const ARCHIVE_DAYS = 14;

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE();
    // New blobs are scrambled; accept legacy plain JSON for one read cycle so
    // existing players don't lose their stats on upgrade.
    let parsed;
    try {
      parsed = JSON.parse(unscramble(raw));
    } catch {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return DEFAULT_STATE();
      }
    }
    if (parsed.version !== 2) return DEFAULT_STATE();
    // Fill in missing sub-trees in case schema grew.
    if (!parsed.lastSelection) parsed.lastSelection = { entity: "group", mode: "daily", difficulty: "easy" };
    if (!parsed.achievements || typeof parsed.achievements !== "object") parsed.achievements = {};
    if (!parsed.recentEndlessTargets || typeof parsed.recentEndlessTargets !== "object") {
      parsed.recentEndlessTargets = { group: [], idol: [] };
    } else {
      // Make sure both buckets exist on older blobs that only had one entity's list.
      for (const e of ENTITIES) {
        if (!Array.isArray(parsed.recentEndlessTargets[e])) parsed.recentEndlessTargets[e] = [];
      }
    }
    for (const e of ENTITIES) {
      if (!parsed[e]) parsed[e] = DEFAULT_ENTITY_STATE();
      if (!parsed[e].active) parsed[e].active = { daily: EMPTY_DIFF_MAP(), endless: EMPTY_DIFF_MAP(), replays: EMPTY_DIFF_MAP() };
      if (!parsed[e].active.daily) parsed[e].active.daily = EMPTY_DIFF_MAP();
      if (!parsed[e].active.endless) parsed[e].active.endless = EMPTY_DIFF_MAP();
      if (!parsed[e].active.replays) parsed[e].active.replays = EMPTY_DIFF_MAP();
      // Ensure each difficulty bucket exists as a date-keyed map.
      for (const d of DIFFICULTIES) {
        if (!parsed[e].active.replays[d] || typeof parsed[e].active.replays[d] !== "object") {
          parsed[e].active.replays[d] = {};
        }
      }
      // Streaks gained a `freezeUsed` field in the streak-freeze feature.
      // Older blobs don't have it — default to false so the player's next
      // missed day gets the freebie they wouldn't have had under the old rule.
      for (const d of DIFFICULTIES) {
        if (parsed[e].streaks && parsed[e].streaks[d] && parsed[e].streaks[d].freezeUsed === undefined) {
          parsed[e].streaks[d].freezeUsed = false;
        }
      }
      // Lifetime totals — added with the achievements feature. Seed from
      // existing history so a player who's already racked up wins doesn't
      // start at zero. History caps at 100 entries so this isn't fully
      // accurate retroactively, but better than 0.
      if (!parsed[e].totals || typeof parsed[e].totals !== "object") {
        const seed = { dailyWins: 0, dailyLosses: 0, endlessWins: 0, endlessSkips: 0 };
        for (const h of (parsed[e].history || [])) {
          if (h.mode === "daily")  seed[h.won ? "dailyWins"  : "dailyLosses"] += 1;
          if (h.mode === "endless") seed[h.won ? "endlessWins" : "endlessSkips"] += 1;
        }
        parsed[e].totals = seed;
      }
    }
    return parsed;
  } catch {
    return DEFAULT_STATE();
  }
}

function write(data) {
  try {
    localStorage.setItem(STORAGE_KEY, scramble(JSON.stringify(data)));
  } catch (e) {
    console.warn("persist write failed:", e);
  }
}

export function getStats() {
  return read();
}

// Achievement unlocks blob — { [id]: ISO_DATE_UNLOCKED }.
export function getUnlockedAchievements() {
  return read().achievements || {};
}

// Idempotent: marks the achievement if not already unlocked, returns true
// if it was newly unlocked (the caller uses this to fire a toast on the
// transition; an already-unlocked re-mark is a silent no-op).
export function markAchievement(id, date = todayUTC()) {
  const s = read();
  if (!s.achievements) s.achievements = {};
  if (s.achievements[id]) return false;
  s.achievements[id] = date;
  write(s);
  return true;
}

// Spoiler-free endless: the most-recent target IDs the player saw, newest
// first, capped at RECENT_ENDLESS_CAP. Returns a fresh array; mutation by
// the caller doesn't bleed back into storage.
export function getRecentEndlessTargets(entity) {
  const s = read();
  const list = s.recentEndlessTargets?.[entity];
  return Array.isArray(list) ? list.slice() : [];
}

// Push a new target ID to the front of the ring buffer, dedupe (in case
// the picker falls back to allowing repeats), and trim to RECENT_ENDLESS_CAP.
export function pushRecentEndlessTarget(entity, id) {
  if (!id) return;
  const s = read();
  if (!s.recentEndlessTargets) s.recentEndlessTargets = { group: [], idol: [] };
  if (!Array.isArray(s.recentEndlessTargets[entity])) s.recentEndlessTargets[entity] = [];
  const list = s.recentEndlessTargets[entity];
  // Remove any prior occurrence of this id (so an old appearance doesn't
  // hold onto a "recent" slot when the ring buffer rotates).
  const filtered = list.filter((x) => x !== id);
  filtered.unshift(id);
  s.recentEndlessTargets[entity] = filtered.slice(0, RECENT_ENDLESS_CAP);
  write(s);
}

export function getDailyStatus(entity, difficulty, date = todayUTC()) {
  const s = read();
  const entry = s[entity].daily[difficulty];
  if (!entry || entry.lastPlayedDate !== date) return null;
  return entry;
}

// Look up a single completed daily entry, including the player's stored
// guess IDs if any. Returns null when the player didn't play that
// (entity, difficulty, date) combination or when the entry has aged out
// of the archive window.
export function getDailyHistoryEntry(entity, difficulty, date) {
  const s = read();
  const bucket = s[entity];
  if (!bucket) return null;
  for (const h of bucket.history || []) {
    if (h.mode === "daily" && h.difficulty === difficulty && h.date === date) {
      return h;
    }
  }
  return null;
}

// Last-N-days daily archive for the given (entity, difficulty). Each entry
// describes whether that day was played and the outcome — used by the stats
// panel's "last 14 days" strip so the player can spot missed days and tap
// to replay them. Replays don't touch stats (handled in main.js).
//
// `today` is injectable for testing; defaults to wall-clock UTC. `days`
// controls window length (default 14).
//
// Returns newest-first: index 0 is today, index 1 is yesterday, etc.
export function getDailyArchive(entity, difficulty, days = ARCHIVE_DAYS, today = todayUTC()) {
  const s = read();
  const bucket = s[entity];
  // Index daily-mode history by date for O(1) lookup. The history array can
  // contain both daily and endless entries; we filter to the (entity, mode,
  // difficulty) tuple. Newest-first is the natural order of the array, so
  // the first hit per date wins (which is what we want if a day was somehow
  // replayed locally and pushed twice).
  const byDate = new Map();
  for (const h of bucket.history || []) {
    if (h.mode !== "daily") continue;
    if (h.difficulty !== difficulty) continue;
    // The history entry's `entity` should already match because we're reading
    // from bucket = s[entity], but double-check defensively.
    if (h.entity && h.entity !== entity) continue;
    if (!byDate.has(h.date)) byDate.set(h.date, h);
  }
  // For the in-progress flag we peek at the live active states alongside the
  // history lookup: today's active daily, and the per-date active replays.
  const activeToday = bucket.active?.daily?.[difficulty];
  const replaysByDifficulty = bucket.active?.replays?.[difficulty] || {};
  const out = [];
  const todayDate = new Date(today + "T00:00:00Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(todayDate);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry = byDate.get(dateStr);
    const isToday = dateStr === today;
    // In-progress detection. For today's row: live in-progress daily that
    // hasn't been recorded yet (no history entry). For past rows: an
    // in-progress replay with at least one guess on file — even if the
    // day was originally played and has a history entry, the in-progress
    // replay takes display priority since clicking the row resumes it.
    //
    // Completed-replay detection. When the player wins or loses a replay,
    // we leave the saved state in place with `done: true` so we can surface
    // the outcome on the archive (otherwise a "missed → replayed → won" day
    // would silently revert to "missed"). Only surfaces when there's no real
    // history entry — a legitimate live play of that day always takes
    // precedence over a practice replay.
    let inProgress = false;
    let inProgressGuesses = 0;
    let replayDone = false;
    let replayWon = null;
    let replayGuessCount = null;
    let replayTargetId = null;
    if (isToday) {
      if (activeToday?.targetId && (activeToday.guessIds?.length || 0) > 0 && !entry) {
        inProgress = true;
        inProgressGuesses = activeToday.guessIds.length;
      }
    } else {
      const r = replaysByDifficulty[dateStr];
      if (r?.targetId && (r.guessIds?.length || 0) > 0) {
        if (r.done) {
          if (!entry) {
            replayDone = true;
            replayWon = !!r.won;
            replayGuessCount = r.guessIds.length;
            replayTargetId = r.targetId;
          }
        } else {
          inProgress = true;
          inProgressGuesses = r.guessIds.length;
        }
      }
    }
    out.push({
      date: dateStr,
      isToday,
      played: !!entry,
      won: entry?.won ?? null,
      guesses: entry?.guesses ?? null,
      targetId: entry?.targetId ?? null,
      inProgress,
      inProgressGuesses,
      replayDone,
      replayWon,
      replayGuessCount,
      replayTargetId,
    });
  }
  return out;
}

// `opts` (all optional) supplies the richer per-round metadata that some
// achievements need:
//   rawGuesses  — actual guess count without the hint-cost penalty
//                 (defaults to guessCount, matching pre-extension behavior)
//   hints       — number of hint clicks this round (default 0)
//   filterMode  — was Detective mode on for this round (default false)
//   nationality — target's nationality (e.g. "Korean", "Japanese") — used
//                 by the "around the world" achievement check
//   generation  — target's generation 1-5 — used by "through the gens"
// All defaults preserve old call sites that haven't been updated yet.
export function recordDailyLoss(entity, difficulty, targetId, guessCount, date = todayUTC(), opts = {}) {
  const s = read();
  const bucket = s[entity];
  bucket.daily[difficulty] = {
    lastPlayedDate: date,
    guesses: guessCount,
    won: false,
    targetId,
  };
  // A loss is a hard break — fully resets the streak's state so the next
  // win starts fresh. Clearing lastWinDate is what makes that work: without
  // it the day-before-yesterday check below would still match the pre-loss
  // win and silently extend the dead streak via the freeze.
  bucket.streaks[difficulty].current = 0;
  bucket.streaks[difficulty].lastWinDate = null;
  bucket.streaks[difficulty].freezeUsed = false;
  bucket.totals.dailyLosses += 1;
  bucket.history.unshift({
    entity,
    mode: "daily",
    difficulty,
    date,
    targetId,
    guesses: guessCount,
    rawGuesses: opts.rawGuesses ?? guessCount,
    hints: opts.hints ?? 0,
    filterMode: !!opts.filterMode,
    nationality: opts.nationality ?? null,
    generation: opts.generation ?? null,
    // Captured for the daily archive's "view past guesses" modal. Stored
    // as IDs only; comparisons are recomputed from target+guess at view
    // time since they're cheap and pure (compareFor).
    guessIds: Array.isArray(opts.guessIds) ? opts.guessIds.slice() : [],
    won: false,
  });
  trimStorageForDate(s, entity, date);
  write(s);
}

export function recordDailyWin(entity, difficulty, targetId, guessCount, date = todayUTC(), opts = {}) {
  const s = read();
  const bucket = s[entity];
  bucket.daily[difficulty] = {
    lastPlayedDate: date,
    guesses: guessCount,
    won: true,
    targetId,
  };
  bucket.totals.dailyWins += 1;
  // Streak progression with a one-per-streak "freeze" that forgives a single
  // missed day. The rule:
  //   - already won today → no-op
  //   - last win was yesterday → +1 (normal continuation, freeze untouched)
  //   - last win was 2 days ago AND freeze is unused → +1 AND consume freeze
  //   - otherwise → streak resets to 1, freeze re-arms for the new streak
  // Date math uses the same `date` parameter we're recording, not real
  // wall-clock now — keeps the rule testable with arbitrary dates.
  const streak = bucket.streaks[difficulty];
  // Treat `date` as authoritative "today" for relative-date math, so unit
  // tests can pass any date and the comparison still works.
  const yesterday = yesterdayUTC(new Date(date + "T00:00:00Z"));
  const dayBefore = dayBeforeYesterdayUTC(new Date(date + "T00:00:00Z"));
  if (streak.lastWinDate === date) {
    // already counted today — no-op
  } else if (streak.lastWinDate === yesterday) {
    streak.current += 1;
  } else if (streak.lastWinDate === dayBefore && !streak.freezeUsed) {
    streak.current += 1;
    streak.freezeUsed = true;
  } else {
    streak.current = 1;
    streak.freezeUsed = false;
  }
  streak.lastWinDate = date;
  if (streak.current > streak.best) streak.best = streak.current;

  const best = bucket.bests[difficulty];
  if (best.fewestGuesses == null || guessCount < best.fewestGuesses) {
    best.fewestGuesses = guessCount;
  }

  bucket.history.unshift({
    entity,
    mode: "daily",
    difficulty,
    date,
    targetId,
    guesses: guessCount,
    rawGuesses: opts.rawGuesses ?? guessCount,
    hints: opts.hints ?? 0,
    filterMode: !!opts.filterMode,
    nationality: opts.nationality ?? null,
    generation: opts.generation ?? null,
    guessIds: Array.isArray(opts.guessIds) ? opts.guessIds.slice() : [],
    won: true,
  });
  trimStorageForDate(s, entity, date);
  write(s);
}

// Run all of the date-based and cap-based prunes for a single bucket +
// the full state's replay cache. Called from every record* path so storage
// can't grow unboundedly.
function trimStorageForDate(s, entity, today) {
  trimHistory(s[entity], today);
  pruneOldReplays(s, today);
}

// Trim a history array after a new record. Two cuts:
//   1. The hard FIFO cap (HISTORY_CAP=100) — keeps the localStorage blob
//      from growing unboundedly across years of play. Endless records use
//      this exclusively.
//   2. Daily entries older than ARCHIVE_DAYS — the archive UI can't show
//      them anyway, so the rich payload (guessIds) just wastes space.
//      We compute the cutoff relative to the supplied `today` so unit
//      tests with frozen dates produce deterministic output.
function trimHistory(bucket, today) {
  const cutoff = new Date(today + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - ARCHIVE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  bucket.history = bucket.history.filter((h) => {
    // Endless entries don't use date-based expiry — they age out via the cap.
    if (h.mode !== "daily") return true;
    // Daily entries older than the archive window are no longer surfaceable;
    // drop them entirely. The aggregate counters (totals.*) and streaks.best
    // capture the long-tail stats that survive across the window.
    return h.date >= cutoffStr;
  });
  if (bucket.history.length > HISTORY_CAP) {
    bucket.history = bucket.history.slice(0, HISTORY_CAP);
  }
}

// ─── last-used selection (entity/mode/difficulty) ────────────────────────────

export function getLastSelection() {
  return read().lastSelection;
}

export function saveLastSelection({ entity, mode, difficulty }) {
  const s = read();
  s.lastSelection = { entity, mode, difficulty };
  write(s);
}

// ─── appearance prefs (kept in dedicated plain keys so the inline <head>
//     pre-paint script can read them synchronously without touching the
//     scrambled main blob) ───────────────────────────────────────────────────

const THEME_KEY = "kpopdle:theme"; // "light" | "dark" | unset (= auto)
const CB_KEY = "kpopdle:cb";       // "on" | unset (= off)
const CALM_KEY = "kpopdle:calm";   // "on" | unset (= off)
const FILTER_KEY = "kpopdle:filter"; // "on" | unset (= off) — Detective mode
const VISITED_KEY = "kpopdle:visited"; // "1" once the player has seen the help modal at least once
const DETECTIVE_HINT_KEY = "kpopdle:detectiveHinted"; // "1" once the "try Detective mode?" tip has been offered

export function getTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}
export function saveTheme(theme) {
  try {
    if (theme === "light" || theme === "dark") localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch { /* localStorage blocked */ }
}
export function getCb() {
  try {
    return localStorage.getItem(CB_KEY) === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}
export function saveCb(cb) {
  try {
    if (cb === "on") localStorage.setItem(CB_KEY, "on");
    else localStorage.removeItem(CB_KEY);
  } catch { /* localStorage blocked */ }
}
export function getCalm() {
  try {
    return localStorage.getItem(CALM_KEY) === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}
export function saveCalm(calm) {
  try {
    if (calm === "on") localStorage.setItem(CALM_KEY, "on");
    else localStorage.removeItem(CALM_KEY);
  } catch { /* localStorage blocked */ }
}
export function getFilter() {
  try {
    return localStorage.getItem(FILTER_KEY) === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}
export function saveFilter(filter) {
  try {
    if (filter === "on") localStorage.setItem(FILTER_KEY, "on");
    else localStorage.removeItem(FILTER_KEY);
  } catch { /* localStorage blocked */ }
}

// Wipe streak, bests, history, and any in-progress game. Keeps appearance
// preferences (theme/cb/calm) — those live in separate keys and aren't stats.
export function resetAllStats() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* localStorage blocked */ }
}

// ─── Export / Import ──────────────────────────────────────────────────────
//
// The scrambled localStorage blob is base64 + a fixed XOR mask — already
// suitable for copy-paste through any chat or notes app. Export hands it
// out as-is; import validates the round trip before overwriting.

// Return the player's stats blob as a string suitable for copy-paste,
// or null if there's nothing to export.
export function exportStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && raw.trim().length > 0 ? raw : null;
  } catch { return null; }
}

// Validate an imported code without applying it. Returns the parsed stats
// object on success; throws an Error with a code-safe `.message` if the
// input is empty, can't be unscrambled, isn't valid JSON, or carries an
// unexpected version.
export function parseImportedStats(code) {
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new Error("empty");
  }
  let plain;
  try { plain = unscramble(code.trim()); } catch { throw new Error("scramble"); }
  let obj;
  try { obj = JSON.parse(plain); } catch { throw new Error("json"); }
  if (!obj || typeof obj !== "object") throw new Error("shape");
  if (obj.version !== 2) throw new Error("version");
  return obj;
}

// Apply a previously-validated stats code. Idempotent across reloads —
// after this, getStats() returns what was just imported. The caller
// (main.js) typically reloads the page right after so every in-memory
// piece resyncs with the imported blob.
export function importStats(code) {
  parseImportedStats(code);  // re-validates; throws on bad input
  try {
    localStorage.setItem(STORAGE_KEY, code.trim());
  } catch (e) {
    throw new Error("write");
  }
}

// First-visit detection: drives the auto-open of the help modal so brand-new
// players aren't dropped into a blank board with no explanation.
export function hasVisited() {
  try {
    return localStorage.getItem(VISITED_KEY) === "1";
  } catch {
    return true; // treat blocked storage as "visited" so we don't pester
  }
}
export function markVisited() {
  try {
    localStorage.setItem(VISITED_KEY, "1");
  } catch { /* localStorage blocked */ }
}

// One-time tip on the player's first daily loss: "try Detective mode?".
// Tracked in its own plain key (not the scrambled stats blob) so a stats
// reset doesn't make us nag the player a second time — the tip is a UX
// onboarding step, not a stat. Defaults to "shown" when storage is
// blocked so private-browsing users don't get re-prompted every visit.
export function hasShownDetectiveHint() {
  try {
    return localStorage.getItem(DETECTIVE_HINT_KEY) === "1";
  } catch {
    return true;
  }
}
export function markDetectiveHintShown() {
  try {
    localStorage.setItem(DETECTIVE_HINT_KEY, "1");
  } catch { /* localStorage blocked */ }
}

// ─── Stats helpers (derived views over `history`) ────────────────────────────

// Pure summarizer over a history array. Exposed for unit tests + reused by the
// localStorage-backed `historySummary` below.
//   { played, wins, winRatePct, distribution: { 1: n, ..., X: lossCount, S: skipCount } }
// Daily losses → "X" bucket. Endless skips (abandoned mid-round) → "S" bucket.
// Wins → numeric guess-count bucket.
export function summarizeHistory(history, mode, difficulty) {
  const hist = (history || []).filter(
    (h) => h.mode === mode && h.difficulty === difficulty,
  );
  const distribution = {};
  let wins = 0;
  for (const h of hist) {
    if (h.won) {
      wins += 1;
      const k = String(h.guesses);
      distribution[k] = (distribution[k] || 0) + 1;
    } else if (h.skipped) {
      distribution.S = (distribution.S || 0) + 1;
    } else {
      distribution.X = (distribution.X || 0) + 1;
    }
  }
  const played = hist.length;
  const winRatePct = played === 0 ? null : Math.round((wins / played) * 100);
  return { played, wins, winRatePct, distribution };
}

// localStorage-backed wrapper — what main.js calls. Tests use the pure form
// above so they don't need to mock storage.
export function historySummary(entity, mode, difficulty) {
  const s = read();
  return summarizeHistory(s[entity]?.history || [], mode, difficulty);
}

// ─── in-progress (active) game state ──────────────────────────────────────────

export function getActive(entity, mode, difficulty) {
  const s = read();
  const entry = s[entity]?.active?.[mode]?.[difficulty];
  if (!entry || !entry.targetId) return null;
  if (mode === "daily" && entry.date !== todayUTC()) return null;
  return entry; // { date?: "YYYY-MM-DD", targetId, guessIds: string[] }
}

export function saveActive(entity, mode, difficulty, { targetId, guessIds, hintOrder, hintEvents, filterMode }) {
  if (!targetId) return;
  const s = read();
  const entry = {
    targetId,
    guessIds: guessIds.slice(),
    hintOrder: (hintOrder || []).slice(),
    hintEvents: (hintEvents || []).map((e) => ({ ...e })),
    // Sticky setting captured at the start of the round, persisted so the
    // mode survives mode/difficulty switches and reloads. Otherwise toggling
    // Detective off and back to a saved puzzle would re-read the global
    // preference and silently downgrade the in-progress game.
    filterMode: !!filterMode,
  };
  if (mode === "daily") entry.date = todayUTC();
  s[entity].active[mode][difficulty] = entry;
  write(s);
}

export function clearActive(entity, mode, difficulty) {
  const s = read();
  if (s[entity]?.active?.[mode]?.[difficulty]) {
    s[entity].active[mode][difficulty] = {};
    write(s);
  }
}

// ─── Active archive replays ────────────────────────────────────────────────
//
// Replays from the daily archive (or "Replay yesterday") used to be
// memory-only — making a guess mid-replay and then tapping a different
// archive row lost the progress. These helpers persist replay state per
// (entity, difficulty, date) so the player can tab between several
// in-progress replays without losing work.

export function getActiveReplay(entity, difficulty, date) {
  const s = read();
  return s[entity]?.active?.replays?.[difficulty]?.[date] || null;
}

export function saveActiveReplay(entity, difficulty, date, { targetId, guessIds, hintOrder, hintEvents, filterMode, done = false, won = false }) {
  const s = read();
  if (!s[entity]?.active?.replays?.[difficulty]) return;  // schema missing — defensive
  // `done` (with `won`) marks a finished replay whose state we keep around so
  // the archive row still shows the outcome and tapping it opens the
  // past-guesses modal. When a replay was practice for a day that the player
  // never officially played, this is the only record that the round happened.
  s[entity].active.replays[difficulty][date] = {
    targetId,
    guessIds,
    hintOrder,
    hintEvents,
    filterMode,
    done,
    won,
  };
  write(s);
}

export function clearActiveReplay(entity, difficulty, date) {
  const s = read();
  if (s[entity]?.active?.replays?.[difficulty]?.[date]) {
    delete s[entity].active.replays[difficulty][date];
    write(s);
  }
}

// Prune replay states whose date has aged past ARCHIVE_DAYS. Called from
// trimHistory so it runs on every record* path — entries can't outlive
// the archive that surfaces them.
function pruneOldReplays(s, today) {
  const cutoff = new Date(today + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - ARCHIVE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const e of ENTITIES) {
    const replays = s[e]?.active?.replays;
    if (!replays) continue;
    for (const d of DIFFICULTIES) {
      const byDate = replays[d];
      if (!byDate) continue;
      for (const date of Object.keys(byDate)) {
        if (date < cutoffStr) delete byDate[date];
      }
    }
  }
}

// Endless skip: the player abandoned a round mid-game by clicking "New round".
// Doesn't move bests / streaks (endless has no streak), but counts in the
// guess-distribution histogram as a separate "S" bucket so the player can see
// how many rounds they bail on. Only called when there was at least one
// guess — instant-skip without engagement isn't worth recording.
export function recordEndlessSkip(entity, difficulty, targetId, guessCount, opts = {}) {
  const s = read();
  const bucket = s[entity];
  bucket.totals.endlessSkips += 1;
  bucket.history.unshift({
    entity,
    mode: "endless",
    difficulty,
    date: todayUTC(),
    targetId,
    guesses: guessCount,
    rawGuesses: opts.rawGuesses ?? guessCount,
    hints: opts.hints ?? 0,
    filterMode: !!opts.filterMode,
    nationality: opts.nationality ?? null,
    generation: opts.generation ?? null,
    won: false,
    skipped: true,
  });
  trimStorageForDate(s, entity, todayUTC());
  write(s);
}

export function recordEndlessWin(entity, difficulty, targetId, guessCount, opts = {}) {
  const s = read();
  const bucket = s[entity];
  const e = bucket.endless[difficulty];
  e.played += 1;
  if (e.bestGuesses == null || guessCount < e.bestGuesses) {
    e.bestGuesses = guessCount;
  }
  bucket.totals.endlessWins += 1;
  bucket.history.unshift({
    entity,
    mode: "endless",
    difficulty,
    date: todayUTC(),
    targetId,
    guesses: guessCount,
    rawGuesses: opts.rawGuesses ?? guessCount,
    hints: opts.hints ?? 0,
    filterMode: !!opts.filterMode,
    nationality: opts.nationality ?? null,
    generation: opts.generation ?? null,
    won: true,
  });
  trimStorageForDate(s, entity, todayUTC());
  write(s);
}
