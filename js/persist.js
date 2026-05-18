import { STORAGE_KEY, HISTORY_CAP, DIFFICULTIES, ENTITIES } from "./config.js";
import { todayUTC, yesterdayUTC } from "./seed.js";
import { scramble, unscramble } from "./scramble.js";

const EMPTY_DIFF_MAP = () => Object.fromEntries(DIFFICULTIES.map((d) => [d, {}]));

const DEFAULT_ENTITY_STATE = () => ({
  daily: EMPTY_DIFF_MAP(),
  streaks: Object.fromEntries(
    DIFFICULTIES.map((d) => [d, { current: 0, best: 0, lastWinDate: null }])
  ),
  bests: Object.fromEntries(DIFFICULTIES.map((d) => [d, { fewestGuesses: null }])),
  endless: Object.fromEntries(DIFFICULTIES.map((d) => [d, { played: 0, bestGuesses: null }])),
  history: [],
  // In-progress games. Survives tab close / reload until the user wins or rolls a new round.
  // Daily entries are tagged with `date` (UTC YYYY-MM-DD); a mismatched date is treated as no
  // active game. Endless entries are tagged with `targetId` only.
  active: {
    daily: EMPTY_DIFF_MAP(),
    endless: EMPTY_DIFF_MAP(),
  },
});

const DEFAULT_STATE = () => ({
  version: 2,
  lastSelection: { entity: "group", mode: "daily", difficulty: "easy" },
  ...Object.fromEntries(ENTITIES.map((e) => [e, DEFAULT_ENTITY_STATE()])),
});

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
    for (const e of ENTITIES) {
      if (!parsed[e]) parsed[e] = DEFAULT_ENTITY_STATE();
      if (!parsed[e].active) parsed[e].active = { daily: EMPTY_DIFF_MAP(), endless: EMPTY_DIFF_MAP() };
      if (!parsed[e].active.daily) parsed[e].active.daily = EMPTY_DIFF_MAP();
      if (!parsed[e].active.endless) parsed[e].active.endless = EMPTY_DIFF_MAP();
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

export function getDailyStatus(entity, difficulty, date = todayUTC()) {
  const s = read();
  const entry = s[entity].daily[difficulty];
  if (!entry || entry.lastPlayedDate !== date) return null;
  return entry;
}

export function recordDailyLoss(entity, difficulty, targetId, guessCount, date = todayUTC()) {
  const s = read();
  const bucket = s[entity];
  bucket.daily[difficulty] = {
    lastPlayedDate: date,
    guesses: guessCount,
    won: false,
    targetId,
  };
  // A loss breaks today's streak.
  bucket.streaks[difficulty].current = 0;
  bucket.streaks[difficulty].lastWinDate = bucket.streaks[difficulty].lastWinDate || null;
  bucket.history.unshift({
    entity,
    mode: "daily",
    difficulty,
    date,
    targetId,
    guesses: guessCount,
    won: false,
  });
  bucket.history = bucket.history.slice(0, HISTORY_CAP);
  write(s);
}

export function recordDailyWin(entity, difficulty, targetId, guessCount, date = todayUTC()) {
  const s = read();
  const bucket = s[entity];
  bucket.daily[difficulty] = {
    lastPlayedDate: date,
    guesses: guessCount,
    won: true,
    targetId,
  };
  const streak = bucket.streaks[difficulty];
  if (streak.lastWinDate === date) {
    // already counted today — no-op
  } else if (streak.lastWinDate === yesterdayUTC()) {
    streak.current += 1;
  } else {
    streak.current = 1;
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
    won: true,
  });
  bucket.history = bucket.history.slice(0, HISTORY_CAP);
  write(s);
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

// Endless skip: the player abandoned a round mid-game by clicking "New round".
// Doesn't move bests / streaks (endless has no streak), but counts in the
// guess-distribution histogram as a separate "S" bucket so the player can see
// how many rounds they bail on. Only called when there was at least one
// guess — instant-skip without engagement isn't worth recording.
export function recordEndlessSkip(entity, difficulty, targetId, guessCount) {
  const s = read();
  const bucket = s[entity];
  bucket.history.unshift({
    entity,
    mode: "endless",
    difficulty,
    date: todayUTC(),
    targetId,
    guesses: guessCount,
    won: false,
    skipped: true,
  });
  bucket.history = bucket.history.slice(0, HISTORY_CAP);
  write(s);
}

export function recordEndlessWin(entity, difficulty, targetId, guessCount) {
  const s = read();
  const bucket = s[entity];
  const e = bucket.endless[difficulty];
  e.played += 1;
  if (e.bestGuesses == null || guessCount < e.bestGuesses) {
    e.bestGuesses = guessCount;
  }
  bucket.history.unshift({
    entity,
    mode: "endless",
    difficulty,
    date: todayUTC(),
    targetId,
    guesses: guessCount,
    won: true,
  });
  bucket.history = bucket.history.slice(0, HISTORY_CAP);
  write(s);
}
