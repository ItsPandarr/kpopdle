import { loadAll, poolFor, targetPoolFor, getById, getNumericBounds, getDataAsOfDate } from "./data.js";
import { state, resetGame, recordGuess } from "./state.js";
import { compareFor, isWin } from "./compare.js";
import { targetForDaily, randomTarget, todayUTC } from "./seed.js";
import { attachAutocomplete } from "./autocomplete.js";
import { repoUrlFor, correctionIssueUrl } from "./share.js";
import { readPuzzleFromHash, clearPuzzleFromHash } from "./puzzle.js";
import { ACHIEVEMENTS, achievementById, newlyUnlocked } from "./achievements.js";
import * as i18n from "./i18n.js";
const t = i18n.t;
import {
  renderHeader,
  renderGuessRow,
  buildGuessAnnouncement,
  clearBoard,
  renderWinBanner,
  renderLossBanner,
  hideWinBanner,
  renderClues,
  flashHintReveal,
  burstConfetti,
  bumpScore,
} from "./render.js";
import { deriveClues, formatClues, applyHintsToClues, knownAttrs, whyNotMatch } from "./clues.js";
import { VISIBLE_ATTRS, MAX_DAILY_GUESSES } from "./config.js";
import {
  attrsByUniqueness,
  nextHintCost,
  nextHintAttr,
  hintValueFor,
  totalHintPenalty,
} from "./hint.js";
import {
  attachModeToggle,
  attachDifficultyToggle,
  attachEntityToggle,
  attachThemeToggle,
  attachCbToggle,
  attachCalmToggle,
  attachFilterToggle,
  attachLangToggle,
  attachSettingsMenu,
  applyTheme,
  applyCb,
  applyCalm,
  setActive,
  formatCountdownToUTCMidnight,
  showConfirm,
} from "./ui.js";
import {
  getDailyStatus,
  recordDailyWin,
  recordEndlessWin,
  recordEndlessSkip,
  getStats,
  getDailyArchive,
  getDailyHistoryEntry,
  getActiveReplay,
  saveActiveReplay,
  clearActiveReplay,
  getActive,
  saveActive,
  clearActive,
  getLastSelection,
  saveLastSelection,
  getTheme,
  saveTheme,
  getCb,
  saveCb,
  getCalm,
  saveCalm,
  getFilter,
  saveFilter,
  recordDailyLoss,
  resetAllStats,
  hasVisited,
  getUnlockedAchievements,
  markAchievement,
  getRecentEndlessTargets,
  pushRecentEndlessTarget,
  exportStats,
  importStats,
  parseImportedStats,
  markVisited,
  hasShownDetectiveHint,
  markDetectiveHintShown,
  historySummary,
} from "./persist.js";

const els = {
  entityToggle: null,
  modeToggle: null,
  difficultyToggle: null,
  themeToggle: null,
  cbToggle: null,
  calmToggle: null,
  filterToggle: null,
  langToggle: null,
  settingsBtn: null,
  settingsPanel: null,
  helpBtn: null,
  helpPanel: null,
  resetStatsBtn: null,
  giveUpBtn: null,
  byline: null,
  input: null,
  dropdown: null,
  header: null,
  board: null,
  banner: null,
  cluesPanel: null,
  guessCount: null,
  hintBtn: null,
  newRound: null,
  countdown: null,
  stats: null,
};

// Pre-computed snapshot of which attrs were known the last time we rendered the
// clues panel. Diffing against this on each render gives us the "newly-known" set
// used to drive entrance animations.
let prevKnownAttrs = new Set();

// Compute when the next daily UNLOCKS in the player's local timezone, as a
// short string like "7:00 PM" / "오후 7:00" / "19:00". The daily roll is
// always at 00:00 UTC; this just formats that moment in local time using
// the locale's clock convention (12-h vs 24-h).
//
// We build a Date at the next 00:00 UTC (rather than today's) so DST
// transitions land on the correct side. Same numeric clock face either
// way, but using a forward-looking instant makes the intent explicit:
// "this is the time the NEXT new puzzle drops, in your local time".
function formatDailyResetTime(locale) {
  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setUTCHours(24, 0, 0, 0);   // next 00:00 UTC, even if past today's
  try {
    return nextReset.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  } catch {
    // Older runtimes / unusual locale strings — fall back to UTC HH:00.
    return "00:00 UTC";
  }
}

function refreshByline() {
  const time = formatDailyResetTime(i18n.locale());
  els.byline.textContent = t(state.entity === "idol" ? "app.byline.idol" : "app.byline.group", { time });
}

let ac = null;

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function refreshClues({ animateNewlyKnown = true } = {}) {
  const clues = applyHintsToClues(deriveClues(state.guesses), state.hintEvents);
  const visible = VISIBLE_ATTRS[state.entity][state.difficulty];
  const bounds = getNumericBounds(state.entity);
  const knowns = knownAttrs(clues, bounds, state.entity);
  const hintAttrs = new Set(state.hintEvents.map((e) => e.attr));
  const newly = new Set();
  if (animateNewlyKnown) {
    for (const a of knowns) if (!prevKnownAttrs.has(a)) newly.add(a);
  }
  prevKnownAttrs = knowns;
  const lines = formatClues(clues, visible, state.entity, hintAttrs, newly, { includeEmpty: true, bounds });
  renderClues(els.cluesPanel, lines);
  updateScoreLine({ bump: animateNewlyKnown });
  updateHintButton();
}

function updateScoreLine({ bump = false } = {}) {
  const g = state.guesses.length;
  const h = totalHintPenalty(state.hintEvents);
  const cap = state.mode === "daily" ? MAX_DAILY_GUESSES[state.difficulty] : null;
  // Daily shows progress against the cap ("1/6 guesses"); endless shows the raw count.
  // When a /N denominator is shown, always pluralize — "1/6 guesses" reads better than "1/6 guess".
  let base;
  if (cap != null) {
    base = t("meta.guesses.fraction", { n: g, max: cap });
  } else {
    base = t(g === 1 ? "meta.guess" : "meta.guesses", { n: g });
  }
  const next = h === 0 ? base : base + t("meta.hint.suffix", { n: h, total: g + h });
  const changed = els.guessCount.textContent !== next;
  els.guessCount.textContent = next;
  if (bump && changed) bumpScore(els.guessCount);
}

function updateHintButton() {
  if (!els.hintBtn) return;
  if (!state.target || state.frozen) {
    els.hintBtn.disabled = true;
    els.hintBtn.hidden = true;
    return;
  }
  const clues = applyHintsToClues(deriveClues(state.guesses), state.hintEvents);
  const visible = VISIBLE_ATTRS[state.entity][state.difficulty];
  const candidate = nextHintAttr({
    order: state.hintOrder,
    events: state.hintEvents,
    clues,
    visibleAttrs: visible,
    target: state.target,
    bounds: getNumericBounds(state.entity),
    entity: state.entity,
  });
  const cost = nextHintCost(state.hintEvents, state.guesses.length);
  els.hintBtn.hidden = false;
  if (!candidate) {
    els.hintBtn.disabled = true;
    els.hintBtn.textContent = t("hint.none");
    return;
  }
  els.hintBtn.disabled = false;
  // Show what the next hint would reveal so players can decide if the cost is
  // worth it. Wording is short to keep the button compact.
  els.hintBtn.textContent = t("hint.cost", { cost, label: prettyLabel(candidate) });
}

function onHint() {
  if (state.frozen || !state.target) return;
  const clues = applyHintsToClues(deriveClues(state.guesses), state.hintEvents);
  const visible = VISIBLE_ATTRS[state.entity][state.difficulty];
  const attr = nextHintAttr({
    order: state.hintOrder,
    events: state.hintEvents,
    clues,
    visibleAttrs: visible,
    target: state.target,
    bounds: getNumericBounds(state.entity),
    entity: state.entity,
  });
  if (!attr) return;
  const cost = nextHintCost(state.hintEvents, state.guesses.length);
  const value = hintValueFor(attr, state.target);
  state.hintEvents.push({
    attr,
    value,
    cost,
    guessIdxAtClick: state.guesses.length,
  });
  snapshotProgress();
  refreshClues();
  flashHintReveal(prettyLabel(attr), prettyValue(attr, value, state.entity));
}

function prettyLabel(attr) {
  return t(`attr.${attr}`);
}

// Push text into the polite live region (#guess-announcer in index.html).
// Clearing first then re-setting on the next microtask is the standard
// trick that forces a re-announce when the same string would otherwise
// be debounced. Safe no-op if the element is missing.
function announceToSR(text) {
  const el = document.getElementById("guess-announcer");
  if (!el) return;
  el.textContent = "";
  // Defer to a microtask so the cleared state is observed before the new
  // text — without this, the assistive tech often debounces and skips.
  setTimeout(() => { el.textContent = text; }, 50);
}

// Build the extended-opts object passed to every record* call. Captures
// the raw guess count (vs. the hint-padded total), hint count, detective
// flag, and a couple of target attributes — the achievements layer reads
// these from history records to decide what to unlock.
// Persist the current in-progress round to the right storage bucket so a
// reload (or a tab back to the same archive row) resumes where the player
// left off. Three paths: custom puzzles persist nothing (one-shot),
// replays go into the per-date replay cache, normal play uses the
// existing active-daily / active-endless slots.
function snapshotProgress() {
  if (!state.target) return;
  const snap = {
    targetId: state.target.id,
    guessIds: state.guesses.map((x) => x.group.id),
    hintOrder: state.hintOrder,
    hintEvents: state.hintEvents,
    filterMode: state.filterMode,
  };
  if (state.customPuzzle) {
    // intentional no-op — friend's puzzles don't persist
  } else if (state.replayDate) {
    saveActiveReplay(state.entity, state.difficulty, state.replayDate, snap);
  } else {
    saveActive(state.entity, state.mode, state.difficulty, snap);
  }
}

function recordOpts() {
  return {
    rawGuesses: state.guesses.length,
    hints: state.hintEvents.length,
    filterMode: !!state.filterMode,
    nationality: state.target?.nationality ?? null,
    generation: state.target?.generation ?? null,
    // Stored so the daily archive's "view past guesses" modal can replay
    // the exact row sequence the player committed. Endless ignores it
    // (target identity isn't durable across rounds).
    guessIds: state.guesses.map((g) => g.group.id),
  };
}

// After every record* call, evaluate which achievements should now be
// unlocked and surface a toast for the ones that just transitioned. The
// modal renders the full list on demand; this is the live notification
// surface. Suppressed in calm mode by the toast helper itself.
function checkAchievementsAfterRecord() {
  const stats = getStats();
  const already = getUnlockedAchievements();
  const fresh = newlyUnlocked(stats, already);
  for (const id of fresh) {
    markAchievement(id);
    showAchievementToast(id);
  }
}

// One-shot retention nudge: when the player loses their very first daily
// (across both entities) and Detective mode is currently off, offer to
// turn it on. A first loss is the moment a new player is most likely to
// bounce; surfacing the deduction-helper feature can keep them engaged.
// Marked shown unconditionally — declining the prompt counts as having
// seen it, so we never re-ask. Replays / custom puzzles never trigger
// (they don't touch totals, so the gate wouldn't fire anyway, but
// guarded explicitly for clarity).
async function maybeShowDetectiveHint() {
  if (state.replayDate || state.customPuzzle) return;
  if (getFilter() === "on") return;
  if (hasShownDetectiveHint()) return;
  const s = getStats();
  const totalDailyLosses = s.group.totals.dailyLosses + s.idol.totals.dailyLosses;
  if (totalDailyLosses !== 1) return;
  // Mark before showing — if the player closes the tab or the modal gets
  // dismissed by a competing UI, we still honor "show at most once".
  markDetectiveHintShown();
  // Brief delay so the loss banner finishes its entrance animation before
  // we stack a modal on top of it. Empirically ~900ms is the sweet spot
  // where the banner has settled but the player hasn't started reading
  // CTAs yet.
  await new Promise((resolve) => setTimeout(resolve, 900));
  const ok = await showConfirm({
    title: t("detectiveHint.title"),
    message: t("detectiveHint.body"),
    confirmLabel: t("detectiveHint.cta"),
    cancelLabel: t("detectiveHint.dismiss"),
  });
  if (ok) {
    saveFilter("on");
    setActive(els.filterToggle, "on");
  }
}

// End the current round as a loss. Three flavors depending on mode:
//   - daily:  records a daily loss (breaks streak, hits history), uses the
//             "Out of guesses today" placeholder.
//   - endless:records a skip in the histogram (no streak/best impact), uses
//             the standard placeholder so a new round can be started cleanly.
//   - custom: friend's puzzle — no stats recorded at all. Clears the URL hash
//             so a refresh / new round doesn't re-trigger the same puzzle.
// All three share the same banner-render path so the visual feels consistent.
function forceLoss() {
  if (state.frozen) return;
  if (!state.target) return;
  const isDaily = state.mode === "daily";
  const isCustom = !!state.customPuzzle;
  state.lost = true;
  state.frozen = true;
  els.input.disabled = true;

  // Placeholder choice depends on context: daily-done vs replay-done vs
  // custom-done vs endless (no special done text — the New Round button is
  // the obvious next step).
  if (isCustom) {
    els.input.placeholder = t("input.placeholder.custom.done");
  } else if (isDaily) {
    els.input.placeholder = t(state.replayDate ? "input.placeholder.replay.done" : "input.placeholder.daily.done");
  }

  // Persistence by mode. Replays and custom puzzles are practice — no record.
  if (!isCustom && !state.replayDate) {
    clearActive(state.entity, state.mode, state.difficulty);
    const totalTries = state.guesses.length + totalHintPenalty(state.hintEvents);
    if (isDaily) {
      recordDailyLoss(state.entity, state.difficulty, state.target.id, totalTries, undefined, recordOpts());
      maybeShowDetectiveHint();
    } else if (state.guesses.length > 0) {
      // Only bother recording an endless skip if the player actually engaged;
      // an immediate "show me" from a fresh round isn't worth tracking.
      recordEndlessSkip(state.entity, state.difficulty, state.target.id, state.guesses.length, recordOpts());
    }
  } else if (state.replayDate) {
    // Replay give-up — flag the saved state done+lost so the archive row
    // shows ✗ and tapping it opens past-guesses. Without this the row would
    // silently revert to "missed" (replays don't touch history).
    saveActiveReplay(state.entity, state.difficulty, state.replayDate, {
      targetId: state.target.id,
      guessIds: state.guesses.map((x) => x.group.id),
      hintOrder: state.hintOrder,
      hintEvents: state.hintEvents,
      filterMode: state.filterMode,
      done: true,
      won: false,
    });
    checkAchievementsAfterRecord();
  } else if (isCustom) {
    // Friend's puzzle done — clear the URL so future reloads start fresh.
    clearPuzzleFromHash(location, history);
  }

  const visible = VISIBLE_ATTRS[state.entity][state.difficulty];
  const bannerMode = isCustom ? "custom" : state.mode;
  renderLossBanner(els.banner, {
    mode: bannerMode,
    difficulty: state.difficulty,
    entity: state.entity,
    guessCount: state.guesses.length,
    hintCount: state.hintEvents.length,
    guesses: state.guesses,
    attrOrder: visible,
    target: state.target,
    dateStr: state.replayDate || todayUTC(),
    // Endless / custom have no guess cap — pass null so the share text + sub
    // line skip the "/N" suffix.
    maxGuesses: isDaily ? MAX_DAILY_GUESSES[state.difficulty] : null,
    filterMode: state.filterMode,
    suggestions: state.replayDate || isCustom
      ? buildEndlessCTAs()
      : isDaily ? buildDailyCTAs() : buildEndlessCTAs(),
  });
  updateHintButton();
  updateMetaButtons();
  renderStats();
}

// Show/hide give-up based on game state. Called whenever the game
// transitions (start, win, loss, mode switch).
function updateMetaButtons() {
  // Give up: visible during any active round with a target — daily, endless,
  // replay, or friend's puzzle. Each picks its own confirm text in the click
  // handler. Hidden after win/loss or before a target is picked.
  els.giveUpBtn.hidden = state.frozen || !state.target;
}

function prettyValue(attr, value, entity) {
  if (attr === "generation") return `${t("attr.generation")} ${value}`;
  if (attr === "gender") {
    return t(`gender.${entity === "idol" ? "idol" : "group"}.${value}`) || String(value);
  }
  if (attr === "status") return t(`status.${value}`) || String(value);
  return String(value);
}

function pickTarget() {
  // Friend-supplied custom puzzle: the target is fixed by the share link.
  // If it's not in the current dataset (link references an entity removed
  // since the URL was minted), fall through to the normal random pick so
  // the player isn't stranded on a blank board.
  if (state.customPuzzle) {
    const fixed = getById(state.entity, state.customPuzzle.targetId);
    if (fixed) return fixed;
  }
  // Use the "complete data" pool for target selection so the puzzle never
  // lands on an entity that's missing one of its visible attribute values.
  // (The autocomplete still uses the full poolFor.)
  const pool = targetPoolFor(state.entity, state.difficulty);
  if (state.mode === "daily") {
    // replayDate, if set, supplies the seed date (yesterday's puzzle, etc.).
    const dateStr = state.replayDate || todayUTC();
    return targetForDaily(`${state.entity}|${dateStr}`, state.difficulty, pool);
  }
  // Endless: spoiler-free roll. Filter out the player's recent endless
  // targets (per entity, across difficulties — so switching from easy to
  // medium doesn't immediately re-roll the same group). If filtering would
  // empty the pool (very small dataset, or the recent buffer covers all of
  // it), fall back to the full pool — picking SOMETHING beats picking
  // nothing.
  const recent = new Set(getRecentEndlessTargets(state.entity));
  const fresh = pool.filter((g) => !recent.has(g.id));
  const effective = fresh.length > 0 ? fresh : pool;
  const target = randomTarget(effective);
  if (target?.id) pushRecentEndlessTarget(state.entity, target.id);
  return target;
}

// `forceTargetId` (optional) pins the round's target to a specific entity
// regardless of the date-seed derivation in pickTarget(). Used by the
// daily-archive "Replay" path so the replay lands on the exact target
// the player originally faced — pickTarget() recomputes from
// `pool[seed % pool.length]`, which shifts when the pool size changes
// between when the player first played and when they replay.
function startGame({ replayDaily = false, replayDate = null, forceTargetId = null } = {}) {
  resetGame();
  state.replayDate = replayDate; // null for normal play
  // Snapshot the Detective-mode preference for this round. Changing the
  // setting after this point won't affect the current game. Custom puzzles
  // override with whatever the link author baked in, so the recipient plays
  // exactly the same game (toggling detective globally before clicking the
  // link won't change this round).
  state.filterMode = state.customPuzzle ? !!state.customPuzzle.filter : getFilter() === "on";
  hideWinBanner(els.banner);
  // Paint the panel with empty placeholders for the current entity/difficulty.
  // refreshClues uses VISIBLE_ATTRS, so the slot set matches the board columns.
  prevKnownAttrs = new Set();
  refreshClues({ animateNewlyKnown: false });

  // Replay rounds and friend-supplied custom puzzles bypass the "already
  // played today" check (their target is a deliberate override) and don't
  // restore in-progress state (one-shot rounds).
  if (state.mode === "daily" && !replayDaily && !state.replayDate && !state.customPuzzle) {
    const prev = getDailyStatus(state.entity, state.difficulty);
    if (prev && (prev.won || prev.won === false)) {
      state.target = getById(state.entity, prev.targetId) || pickTarget();
      state.frozen = true;
      state.won = !!prev.won;
      state.lost = !prev.won;
      renderHeader(els.header, state.entity, state.difficulty);
      clearBoard(els.board);
      const visible = VISIBLE_ATTRS[state.entity][state.difficulty];

      // Restore the actual guess sequence from the history entry's stored
      // guessIds. Without this, navigating away from a finished daily and
      // coming back wipes the board down to just the answer row, which feels
      // like the player lost their solve. Legacy saves (pre-history-guessIds
      // feature) fall back to the single reveal row for wins, empty for
      // losses — same behavior the old code shipped.
      const entry = getDailyHistoryEntry(state.entity, state.difficulty, todayUTC());
      const storedGuessIds = entry && Array.isArray(entry.guessIds) ? entry.guessIds : null;
      const restoredGuesses = [];
      if (storedGuessIds && storedGuessIds.length > 0) {
        for (const id of storedGuessIds) {
          const g = getById(state.entity, id);
          if (!g) continue;
          const cmp = compareFor(state.entity, g, state.target);
          recordGuess(g, cmp);
          renderGuessRow(els.board, g, cmp, state.entity, state.difficulty, { animate: false });
          restoredGuesses.push({ group: g, comparison: cmp });
        }
      } else if (prev.won) {
        // Legacy fallback: only the target ID survives, so reveal that.
        const reveal = compareFor(state.entity, state.target, state.target);
        renderGuessRow(els.board, state.target, reveal, state.entity, state.difficulty);
        restoredGuesses.push({ group: state.target, comparison: reveal });
      }
      // Refresh clues + autocomplete exclusions from the restored guess set
      // so the panel reflects what the player learned (modulo hints — those
      // aren't fully persisted in the history record, just their count).
      ac?.setGuessedIds(state.guesses.map((x) => x.group.id));
      prevKnownAttrs = new Set();
      const clues0 = applyHintsToClues(deriveClues(state.guesses), state.hintEvents);
      prevKnownAttrs = knownAttrs(clues0, getNumericBounds(state.entity), state.entity);
      refreshClues({ animateNewlyKnown: false });

      if (prev.won) {
        els.guessCount.textContent = t(prev.guesses === 1 ? "meta.solvedToday.one" : "meta.solvedToday.many", { n: prev.guesses });
        renderWinBanner(els.banner, {
          mode: "daily",
          difficulty: state.difficulty,
          entity: state.entity,
          guessCount: prev.guesses,
          guesses: restoredGuesses,
          attrOrder: visible,
          target: state.target,
          dateStr: todayUTC(),
          maxGuesses: MAX_DAILY_GUESSES[state.difficulty],
          filterMode: state.filterMode,
          suggestions: buildDailyCTAs(),
        });
      } else {
        els.guessCount.textContent = t("meta.outoftoday");
        renderLossBanner(els.banner, {
          mode: "daily",
          difficulty: state.difficulty,
          entity: state.entity,
          guessCount: prev.guesses,
          guesses: restoredGuesses,
          attrOrder: visible,
          target: state.target,
          dateStr: todayUTC(),
          maxGuesses: MAX_DAILY_GUESSES[state.difficulty],
          filterMode: state.filterMode,
          suggestions: buildDailyCTAs(),
        });
      }
      els.input.disabled = true;
      els.input.placeholder = t("input.placeholder.daily.done");
      els.newRound.hidden = true;
      updateMetaButtons();
      return;
    }
  }

  // Try restoring an in-progress game first. Three cases:
  //  - normal play (not a replay, not a custom puzzle) → getActive
  //  - replay (state.replayDate set) → getActiveReplay for that date
  //  - custom puzzle → no restore (one-shot, doesn't persist)
  let active = null;
  if (state.customPuzzle) {
    active = null;
  } else if (state.replayDate) {
    active = getActiveReplay(state.entity, state.difficulty, state.replayDate);
    // A `done` flag means the player already finished this replay — surfaced
    // via the past-guesses modal. If they explicitly kick off a Replay again
    // we want a clean slate, not a restored frozen game.
    if (active && active.done) {
      clearActiveReplay(state.entity, state.difficulty, state.replayDate);
      active = null;
    }
  } else {
    active = getActive(state.entity, state.mode, state.difficulty);
  }
  let restoredGuesses = [];
  if (active && active.targetId) {
    const t = getById(state.entity, active.targetId);
    if (t) {
      state.target = t;
      for (const gid of active.guessIds || []) {
        const g = getById(state.entity, gid);
        if (g) restoredGuesses.push(g);
      }
      state.hintOrder = (active.hintOrder || []).slice();
      state.hintEvents = (active.hintEvents || []).map((e) => ({ ...e }));
      // Detective mode is sticky per-round: prefer the value the puzzle was
      // started with over the current global setting. (Older saves may not
      // have this field; fall back to whatever we already captured above.)
      if (typeof active.filterMode === "boolean") state.filterMode = active.filterMode;
    } else {
      // Target no longer in the dataset (e.g., data rebuilt) — discard and start fresh.
      if (state.replayDate) clearActiveReplay(state.entity, state.difficulty, state.replayDate);
      else                  clearActive(state.entity, state.mode, state.difficulty);
    }
  }

  // Caller-supplied target ID takes precedence over pickTarget (used by the
  // archive's "Replay" path to anchor onto the exact target the player
  // originally faced). Falls through to pickTarget if the ID isn't in the
  // current dataset.
  if (!state.target && forceTargetId) {
    const fixed = getById(state.entity, forceTargetId);
    if (fixed) state.target = fixed;
  }
  if (!state.target) state.target = pickTarget();
  if (!state.target) {
    els.guessCount.textContent = "(no entities in pool)";
    return;
  }
  state.frozen = false;
  state.won = false;
  renderHeader(els.header, state.entity, state.difficulty);
  clearBoard(els.board);
  els.input.disabled = false;
  const pool = poolFor(state.entity, state.difficulty);
  const baseKey = state.entity === "idol" ? "input.placeholder.idol" : "input.placeholder.group";
  const replayTag = state.replayDate ? t("input.placeholder.replay.suffix", { date: state.replayDate }) : "";
  const customTag = state.customPuzzle ? t("input.placeholder.custom.suffix") : "";
  const filterTag = state.filterMode ? t("input.placeholder.detective.suffix") : "";
  els.input.placeholder = t(baseKey, { n: pool.length }) + replayTag + customTag + filterTag;
  els.input.value = "";
  els.input.focus();
  // Replays + friend's puzzles are one-shot, so always show "New round".
  // Standard daily play hides it (clicking it mid-game would be a footgun).
  els.newRound.hidden = state.mode === "daily" && !state.replayDate && !state.customPuzzle;

  // If hintOrder wasn't restored, build it now: least-unique attribute first,
  // most-unique last. Uses the *current* pool so the ordering reflects what
  // would actually narrow this game's candidates.
  if (!state.hintOrder || state.hintOrder.length === 0) {
    state.hintOrder = attrsByUniqueness(
      poolFor(state.entity, state.difficulty),
      VISIBLE_ATTRS[state.entity][state.difficulty],
    );
  }

  // Replay restored guesses in original order. Each render prepends, so the
  // latest replayed guess ends up on top — matching live play.
  // `animate: false` suppresses the flip-in entrance — we don't want every restored
  // guess to dramatically reveal again on page reload.
  for (const g of restoredGuesses) {
    const cmp = compareFor(state.entity, g, state.target);
    recordGuess(g, cmp);
    renderGuessRow(els.board, g, cmp, state.entity, state.difficulty, { animate: false });
  }
  ac?.setGuessedIds(state.guesses.map((x) => x.group.id));
  // Suppress the entrance animation on restore — only animate new discoveries.
  prevKnownAttrs = new Set();
  const clues0 = applyHintsToClues(deriveClues(state.guesses), state.hintEvents);
  prevKnownAttrs = knownAttrs(clues0, getNumericBounds(state.entity), state.entity);
  refreshClues({ animateNewlyKnown: false });
  updateMetaButtons();
}

function onGuess(entity) {
  if (state.frozen) return;
  if (state.guesses.some((g) => g.group.id === entity.id)) return;
  const cmp = compareFor(state.entity, entity, state.target);
  recordGuess(entity, cmp);
  renderGuessRow(els.board, entity, cmp, state.entity, state.difficulty);
  // Push a one-line summary into the polite live region so screen readers
  // hear "BTS. Debut 2013, answer is later. Generation 3, exact match. …"
  // right after the row appears. Clearing first ensures the same summary
  // would re-fire on a subsequent (different) guess.
  announceToSR(buildGuessAnnouncement(entity, cmp, state.entity, state.difficulty));
  ac?.setGuessedIds(state.guesses.map((x) => x.group.id));
  // Score line (including "1/6 guesses" daily progress) updates via refreshClues.
  refreshClues();
  snapshotProgress();
  // Re-render the archive so the row for whatever the player is currently
  // playing flips to "in progress" the moment they make their first guess.
  // Without this it doesn't update until something else triggers renderStats
  // (visibility change, win/loss banner, etc.). Cheap — just innerHTML.
  renderStats();

  const visible = VISIBLE_ATTRS[state.entity][state.difficulty];

  if (isWin(entity, state.target)) {
    state.won = true;
    state.frozen = true;
    els.input.disabled = true;
    const isCustom = !!state.customPuzzle;
    if (!state.replayDate && !isCustom) clearActive(state.entity, state.mode, state.difficulty);
    else if (state.replayDate) {
      // Replay win: keep the saved state but mark it done+won so the archive
      // row surfaces a ✓ and tapping it opens the past-guesses modal. Without
      // this, a "missed day → replayed → won" would silently revert to
      // "missed" since replays don't touch history.
      saveActiveReplay(state.entity, state.difficulty, state.replayDate, {
        targetId: state.target.id,
        guessIds: state.guesses.map((x) => x.group.id),
        hintOrder: state.hintOrder,
        hintEvents: state.hintEvents,
        filterMode: state.filterMode,
        done: true,
        won: true,
      });
    }
    const totalTries = state.guesses.length + totalHintPenalty(state.hintEvents);
    const maxGuesses = state.mode === "daily" && !isCustom ? MAX_DAILY_GUESSES[state.difficulty] : null;
    // Replays + custom puzzles are practice — don't touch stats. Custom
    // puzzles DO unlock the "friend's puzzle" achievement though, since
    // playing one is the qualifying event.
    if (!state.replayDate && !isCustom) {
      if (state.mode === "daily") {
        recordDailyWin(state.entity, state.difficulty, state.target.id, totalTries, undefined, recordOpts());
      } else {
        recordEndlessWin(state.entity, state.difficulty, state.target.id, totalTries, recordOpts());
      }
      checkAchievementsAfterRecord();
    } else if (isCustom) {
      // Event-based achievement — fires once, persists.
      if (markAchievement("friends_puzzle")) showAchievementToast("friends_puzzle");
    }
    // Friend's puzzle done — clear the URL so a refresh starts fresh next
    // time and the share button's "send this to a friend" URL is the canonical
    // re-share for this target rather than the hash they just played.
    if (isCustom) clearPuzzleFromHash(location, history);
    renderWinBanner(els.banner, {
      mode: isCustom ? "custom" : state.mode,
      difficulty: state.difficulty,
      entity: state.entity,
      // Display the actual guess count against the cap. Hint penalty is shown
      // separately in the live score line during play and folded into the
      // persisted total-tries stat — we don't conflate them here, otherwise
      // a "5/6 guesses" display can spike past the cap (e.g. "8/6") when the
      // player used a hint, which looks broken.
      guessCount: state.guesses.length,
      hintCount: state.hintEvents.length,
      guesses: state.guesses,
      attrOrder: visible,
      target: state.target,
      dateStr: state.replayDate || todayUTC(),
      maxGuesses,
      filterMode: state.filterMode,
      suggestions:
        isCustom                              ? buildEndlessCTAs() :
        state.mode === "endless"              ? buildEndlessCTAs() :
        (state.mode === "daily" && !state.replayDate) ? buildDailyCTAs() :
        /* daily replay */                      [],
    });
    // Big celebratory confetti from roughly above the banner.
    const bRect = els.banner.getBoundingClientRect();
    burstConfetti({
      count: 110,
      origin: { x: bRect.left + bRect.width / 2, y: Math.max(60, bRect.top) },
    });
    updateHintButton();
    updateMetaButtons();
    renderStats();
    return;
  }

  // Loss check: daily only, when actual guess count hits the cap with no win.
  if (state.mode === "daily") {
    const cap = MAX_DAILY_GUESSES[state.difficulty];
    if (state.guesses.length >= cap) {
      state.lost = true;
      state.frozen = true;
      els.input.disabled = true;
      els.input.placeholder = t(state.replayDate ? "input.placeholder.replay.done" : "input.placeholder.daily.done");
      if (!state.replayDate) {
        clearActive(state.entity, state.mode, state.difficulty);
        const totalTries = state.guesses.length + totalHintPenalty(state.hintEvents);
        recordDailyLoss(state.entity, state.difficulty, state.target.id, totalTries, undefined, recordOpts());
        checkAchievementsAfterRecord();
        maybeShowDetectiveHint();
      } else {
        // Replay ran out of guesses — keep the saved state but flag it
        // done+lost so the archive row shows ✗ and tapping it opens
        // past-guesses instead of trying to resume a dead round.
        saveActiveReplay(state.entity, state.difficulty, state.replayDate, {
          targetId: state.target.id,
          guessIds: state.guesses.map((x) => x.group.id),
          hintOrder: state.hintOrder,
          hintEvents: state.hintEvents,
          filterMode: state.filterMode,
          done: true,
          won: false,
        });
      }
      renderLossBanner(els.banner, {
        mode: "daily",
        difficulty: state.difficulty,
        entity: state.entity,
        guessCount: state.guesses.length,
        hintCount: state.hintEvents.length,
        guesses: state.guesses,
        attrOrder: visible,
        target: state.target,
        dateStr: state.replayDate || todayUTC(),
        maxGuesses: cap,
        filterMode: state.filterMode,
        suggestions: state.replayDate ? [] : buildDailyCTAs(),
      });
      updateHintButton();
      updateMetaButtons();
      renderStats();
    }
  }
}

// Visual juice: when a toggle button activates, give it a pop. CSS keys off
// `.is-clicked`, and we remove the class after the animation so it can fire again.
function popToggle(rootEl) {
  const btn = rootEl?.querySelector(".toggle-btn.is-active");
  if (!btn) return;
  btn.classList.remove("is-clicked");
  void btn.offsetWidth;
  btn.classList.add("is-clicked");
  setTimeout(() => btn.classList.remove("is-clicked"), 350);
}

// Programmatic switcher used by the post-daily-win CTAs. Syncs the toggle UI,
// persists the selection, and starts a fresh game in the new combo.
function goTo({ entity = state.entity, mode = state.mode, difficulty = state.difficulty } = {}) {
  state.entity = entity;
  state.mode = mode;
  state.difficulty = difficulty;
  setActive(els.entityToggle, entity);
  setActive(els.modeToggle, mode);
  setActive(els.difficultyToggle, difficulty);
  popToggle(els.modeToggle);
  saveLastSelection({ entity, mode, difficulty });
  refreshByline();
  startGame();
  renderStats();
  tickCountdown();
}

const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

function buildDailyCTAs() {
  const ctas = [];
  for (const d of ["easy", "medium", "hard"]) {
    if (d === state.difficulty) continue;
    const status = getDailyStatus(state.entity, d);
    if (status && status.won) continue; // already finished today; skip
    ctas.push({
      label: t("banner.cta.dailyDifficulty", { difficulty: t(`toggle.difficulty.${d}`) }),
      kind: "daily",
      onClick: () => goTo({ mode: "daily", difficulty: d }),
    });
  }
  ctas.push({
    label: t("banner.cta.endlessDifficulty", { difficulty: t(`toggle.difficulty.${state.difficulty}`) }),
    kind: "endless",
    onClick: () => goTo({ mode: "endless", difficulty: state.difficulty }),
  });
  return ctas;
}

// "What's next?" chips after an endless win. Mirror the daily flow:
//   - Primary: another endless round at the same difficulty (the obvious
//     next action — "play again").
//   - The two other endless difficulties.
//   - Cross-promotion: today's daily at the current difficulty, but only if
//     the player hasn't already won it.
function buildEndlessCTAs() {
  const ctas = [];
  ctas.push({
    label: t("banner.cta.newround"),
    kind: "endless",
    onClick: () => {
      clearActive(state.entity, state.mode, state.difficulty);
      state.target = null;
      startGame();
      renderStats();
    },
  });
  for (const d of ["easy", "medium", "hard"]) {
    if (d === state.difficulty) continue;
    ctas.push({
      label: t("banner.cta.endlessDifficulty", { difficulty: t(`toggle.difficulty.${d}`) }),
      kind: "endless",
      onClick: () => goTo({ mode: "endless", difficulty: d }),
    });
  }
  const dailyStatus = getDailyStatus(state.entity, state.difficulty);
  if (!dailyStatus || !dailyStatus.won) {
    ctas.push({
      label: t("banner.cta.dailyDifficulty", { difficulty: t(`toggle.difficulty.${state.difficulty}`) }),
      kind: "daily",
      onClick: () => goTo({ mode: "daily", difficulty: state.difficulty }),
    });
  }
  return ctas;
}

function tickCountdown() {
  if (els.countdown && state.mode === "daily") {
    els.countdown.textContent = t("meta.next.daily", { time: formatCountdownToUTCMidnight() });
  } else if (els.countdown) {
    els.countdown.textContent = "";
  }
}

// Wordle-style guess-distribution histogram for the current (entity, mode,
// difficulty). One row per possible outcome: 1..maxGuesses + "X" for losses
// (daily only). Bars scale to the largest count so single plays still show.
function renderHistogram(entity, mode, difficulty) {
  const { distribution, played } = historySummary(entity, mode, difficulty);
  const modeLbl = t(`toggle.mode.${mode}`);
  const diffLbl = t(`toggle.difficulty.${difficulty}`);
  if (played === 0) {
    return `<p class="histogram-empty">${t("stats.histogram.empty", { mode: modeLbl, difficulty: diffLbl })}</p>`;
  }
  const buckets = [];
  if (mode === "daily") {
    const max = MAX_DAILY_GUESSES[difficulty];
    for (let i = 1; i <= max; i++) buckets.push(String(i));
    buckets.push("X");
  } else {
    const seen = Object.keys(distribution)
      .filter((k) => k !== "X" && k !== "S")
      .map(Number)
      .sort((a, b) => a - b);
    for (const n of seen) buckets.push(String(n));
    if (distribution.S) buckets.push("S");
  }
  const counts = buckets.map((k) => distribution[k] || 0);
  const peak = Math.max(1, ...counts);
  const rows = buckets.map((k, i) => {
    const n = counts[i];
    const pct = (n / peak) * 100;
    const cls =
      k === "X" ? "histogram-bar is-loss" :
      k === "S" ? "histogram-bar is-skip" :
      "histogram-bar";
    // ARIA label kept in English — screen readers handle the language attribute
    // and this is a derived structural label, not a translated UI string. We
    // could localize it later if needed.
    return `<div class="histogram-row">
      <span class="histogram-key">${k}</span>
      <div class="${cls}" style="width: ${pct}%"></div>
      <span class="histogram-count">${n}</span>
    </div>`;
  });
  return `<div class="histogram" role="figure">${rows.join("")}</div>`;
}

function renderStats() {
  const s = getStats();
  const bucket = s[state.entity];
  const entityLabel = t(`toggle.entity.${state.entity}`);

  const dailyRows = ["easy", "medium", "hard"].map((d) => {
    const best = bucket.bests[d]?.fewestGuesses ?? "—";
    const streak = bucket.streaks[d]?.current ?? 0;
    const bestStreak = bucket.streaks[d]?.best ?? 0;
    // Streak-freeze indicator: a tiny snowflake appears next to the streak
    // count when this streak has already consumed its one freebie. Hover/
    // long-press surfaces the explanation. Hidden when the freeze is still
    // available (no visual noise until it actually triggered).
    const freezeUsed = bucket.streaks[d]?.freezeUsed === true && streak > 0;
    const freezeIcon = freezeUsed
      ? ` <span class="streak-freeze" title="${t("stats.streak.freeze.title")}" aria-label="${t("stats.streak.freeze.aria")}">${t("stats.streak.freeze.icon")}</span>`
      : "";
    const summary = historySummary(state.entity, "daily", d);
    const rateText = summary.winRatePct == null
      ? `<span class="dim">${t("stats.noPlays")}</span>`
      : `${summary.wins}/${summary.played} <span class="dim">(${summary.winRatePct}%)</span>`;
    return `<dt>${t(`toggle.difficulty.${d}`)}</dt><dd>${t("stats.best")} <b>${best}</b> · ${t("stats.streak")} ${streak}${freezeIcon} <span class="dim">${t("stats.bestStreak", { n: bestStreak })}</span> · ${t("stats.won")} ${rateText}</dd>`;
  });

  const endlessRows = ["easy", "medium", "hard"].map((d) => {
    const best = bucket.endless[d]?.bestGuesses ?? "—";
    const played = bucket.endless[d]?.played ?? 0;
    const playsText = played === 1 ? t("stats.plays.one", { n: played }) : t("stats.plays.many", { n: played });
    return `<dt>${t(`toggle.difficulty.${d}`)}</dt><dd>${t("stats.best")} <b>${best}</b> · ${playsText}</dd>`;
  });

  const hist = renderHistogram(state.entity, state.mode, state.difficulty);
  const histTitle = t("stats.histogram.title", {
    mode: t(`toggle.mode.${state.mode}`),
    difficulty: t(`toggle.difficulty.${state.difficulty}`),
  });

  const archiveHtml = renderArchive(state.entity, state.difficulty);

  els.stats.innerHTML = `
    <h3 class="stats-entity">${entityLabel}</h3>
    <div class="stats-grid">
      <section class="stats-col">
        <h4 class="stats-col-title">${t("stats.daily")}</h4>
        <dl>${dailyRows.join("")}</dl>
      </section>
      <section class="stats-col">
        <h4 class="stats-col-title">${t("stats.endless")}</h4>
        <dl>${endlessRows.join("")}</dl>
      </section>
    </div>
    <section class="histogram-section">
      <h4 class="stats-col-title">${histTitle}</h4>
      ${hist}
    </section>
    ${archiveHtml}
  `;

  // Wire up archive row clicks. Routing in priority order:
  //   1. Clicking today's row while the player is currently somewhere else
  //      (mid-replay or in a friend's puzzle) → exit that and return to
  //      today's live daily.
  //   2. Past day with an in-progress (non-`done`) replay → resume it so
  //      the player's in-flight guesses come back.
  //   3. Past day with a done replay → open the past-guesses modal showing
  //      the replay (no Replay button — they already finished).
  //   4. Player has a real history entry for that day → open the modal so
  //      they can revisit the original guesses; the "Replay" button starts
  //      a fresh stats-neutral attempt.
  //   5. Missed / unplayed past day → tap goes straight to fresh replay.
  for (const row of els.stats.querySelectorAll(".archive-row.is-clickable")) {
    row.addEventListener("click", () => {
      const date = row.dataset.date;
      if (!date) return;
      const isToday = date === todayUTC();

      // Returning to today from a replay or custom puzzle. startGame()
      // handles "today already played" by restoring the won/lost banner;
      // if today's still live it just restores the in-progress state.
      if (isToday && (state.replayDate || state.customPuzzle)) {
        returnToToday();
        return;
      }

      const replay = !isToday && getActiveReplay(state.entity, state.difficulty, date);
      if (replay && Array.isArray(replay.guessIds) && replay.guessIds.length > 0) {
        if (replay.done) {
          openPastGuessesModal(replayAsEntry(date, replay));
        } else {
          replayArchivedDaily(date);
        }
        return;
      }
      const entry = getDailyHistoryEntry(state.entity, state.difficulty, date);
      if (entry && Array.isArray(entry.guessIds) && entry.guessIds.length > 0) {
        openPastGuessesModal(entry);
      } else if (!isToday) {
        replayArchivedDaily(date);
      }
    });
  }
}

// Build a history-entry-shaped object from a stored done replay, so the
// past-guesses modal can render it with no special-casing. Used when the
// player taps an archive row whose only record is a completed replay (no
// official live play of that day).
function replayAsEntry(date, replay) {
  return {
    entity: state.entity,
    mode: "daily",
    difficulty: state.difficulty,
    date,
    targetId: replay.targetId,
    won: !!replay.won,
    guesses: replay.guessIds.length,
    rawGuesses: replay.guessIds.length,
    hints: (replay.hintEvents || []).length,
    filterMode: !!replay.filterMode,
    guessIds: replay.guessIds,
  };
}

// Return to today's live game from a replay or custom puzzle. Exits the
// replay/custom state, then re-runs the standard startGame() flow which
// will restore an in-progress live daily, surface a finished-today banner,
// or land on a fresh round depending on what's saved.
function returnToToday() {
  if (state.customPuzzle) {
    state.customPuzzle = null;
    clearPuzzleFromHash(location, history);
  }
  state.replayDate = null;
  startGame();
  renderStats();
  els.board?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Build the "last 14 days" strip. Per row:
//   - Date label, formatted in the current locale (weekday + short month/day).
//   - Status icon: ✓ won, ✗ lost, ● today (in-progress / unplayed), ⊘ skipped.
//   - Score: e.g. "3/6", "X/6" for losses, "—" for skipped, blank for today.
//   - Target name when known (i.e. the player already played that day —
//     showing it for skipped days would spoil the answer).
// Today's row is never interactive (clicking it is a no-op); past days are
// clickable to replay.
function renderArchive(entity, difficulty) {
  const archive = getDailyArchive(entity, difficulty);
  const cap = MAX_DAILY_GUESSES[difficulty];
  const locale = i18n.locale();
  // The "current" row is whatever date the player is on right now — either
  // today (live daily) or the date of an in-progress replay. Used to drive
  // the visual highlight so the player can tell at a glance which row in
  // the archive matches the board above.
  const currentDate = state.replayDate || todayUTC();
  const rows = archive.map((row) => {
    // Date label: "Mon, May 17" / "5월 17일 (월)" depending on locale.
    // Force timeZone=UTC so the label matches the daily seed's UTC date —
    // otherwise a player west of UTC would see the previous day on every row.
    const d = new Date(row.date + "T00:00:00Z");
    const dateLabel = d.toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });

    let icon, score, name;
    if (row.inProgress) {
      // Player has at least one guess on this date but hasn't finished —
      // could be today's live daily mid-round, or a past day's replay
      // they're tabbing through. Click resumes via the active-replay
      // path. Hide the target name so we don't spoil the answer.
      icon = `<span class="archive-icon is-progress" aria-label="${t("stats.archive.inprogress.aria")}">◐</span>`;
      score = `<span class="dim">${t("stats.archive.inprogress")}</span>`;
      name = "";
    } else if (row.replayDone) {
      // Completed replay of a day the player never officially played. Same
      // visual treatment as a real win/loss — we have the target ID and
      // outcome, so show them just like a history-backed row.
      if (row.replayWon) {
        icon = `<span class="archive-icon is-win" aria-label="${t("stats.archive.won.aria")}">✓</span>`;
        score = `${row.replayGuessCount}/${cap}`;
      } else {
        icon = `<span class="archive-icon is-loss" aria-label="${t("stats.archive.lost.aria")}">✗</span>`;
        score = `X/${cap}`;
      }
      const targetName = nameOf(entity, row.replayTargetId);
      name = targetName ? `<span class="archive-name">${escapeHTML(targetName)}</span>` : "";
    } else if (row.isToday && !row.played) {
      icon = `<span class="archive-icon is-today" aria-label="${t("stats.archive.today.aria")}">●</span>`;
      score = `<span class="dim">${t("stats.archive.today")}</span>`;
      name = "";
    } else if (!row.played) {
      icon = `<span class="archive-icon is-skip" aria-label="${t("stats.archive.skipped.aria")}">⊘</span>`;
      score = `<span class="dim">${t("stats.archive.missed")}</span>`;
      name = "";
    } else if (row.won) {
      icon = `<span class="archive-icon is-win" aria-label="${t("stats.archive.won.aria")}">✓</span>`;
      score = `${row.guesses}/${cap}`;
      const targetName = nameOf(entity, row.targetId);
      name = targetName ? `<span class="archive-name">${escapeHTML(targetName)}</span>` : "";
    } else {
      icon = `<span class="archive-icon is-loss" aria-label="${t("stats.archive.lost.aria")}">✗</span>`;
      score = `X/${cap}`;
      const targetName = nameOf(entity, row.targetId);
      name = targetName ? `<span class="archive-name">${escapeHTML(targetName)}</span>` : "";
    }

    // Past days are clickable to either resume a replay, open past-guesses
    // (if there's a stored entry or done replay), or kick off a fresh
    // replay (missed days). Today is clickable in three cases:
    //   1. The player has already played today (clicking shows past guesses).
    //   2. They have an in-progress daily on it.
    //   3. They're currently elsewhere (in a replay or custom puzzle) so
    //      clicking today is how they navigate back.
    // Otherwise today stays non-interactive — they're already on it and
    // the regular play flow is doing its job.
    const clickable = !row.isToday
      || row.played
      || row.inProgress
      || !!state.replayDate
      || !!state.customPuzzle;
    const klass = ["archive-row"];
    if (clickable) klass.push("is-clickable");
    if (row.isToday) klass.push("is-today-row");
    if (row.date === currentDate) klass.push("is-current-row");
    if (row.played && row.won === false) klass.push("is-loss-row");

    return `<li class="${klass.join(" ")}" data-date="${row.date}"${clickable ? ` tabindex="0" role="button" aria-label="${t("stats.archive.replay.aria", { date: dateLabel })}"` : ""}>
      ${icon}<span class="archive-date">${dateLabel}</span>${score ? `<span class="archive-score">${score}</span>` : ""}${name}
    </li>`;
  });

  return `
    <section class="archive-section">
      <h4 class="stats-col-title">${t("stats.archive.title", { difficulty: t(`toggle.difficulty.${difficulty}`) })}</h4>
      <ul class="archive-list">${rows.join("")}</ul>
      <p class="archive-hint dim">${t("stats.archive.hint")}</p>
    </section>
  `;
}

function nameOf(entity, id) {
  if (!id) return null;
  return getById(entity, id)?.name ?? null;
}

// ─── Achievements UI ────────────────────────────────────────────────────────

// Open a modal listing every achievement, locked and unlocked. Locked rows
// show the icon at low opacity + a "Locked" label. Unlocked rows show the
// unlock date.
// "Past guesses" modal for the daily archive. Shows the player's original
// guess rows for a stored daily entry — same comparison-grid format as the
// live game — plus the outcome, plus a "Replay" button so they can take
// another swing (stats-neutral).
function openPastGuessesModal(entry) {
  const { entity, difficulty, date, targetId, won, guesses: guessCount,
          guessIds = [], hints = 0 } = entry;
  const target = getById(entity, targetId);
  const isToday = date === todayUTC();

  const prev = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const card = document.createElement("div");
  card.className = "modal-card modal-card-past-guesses";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  const d = new Date(date + "T00:00:00Z");
  const dateLabel = d.toLocaleDateString(i18n.locale(), {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
  const diffLabel = t(`toggle.difficulty.${difficulty}`);
  const titleText = `${dateLabel} · ${t("stats.daily")} ${diffLabel}`;

  // Outcome line: win / loss with the target name + guess count.
  const cap = MAX_DAILY_GUESSES[difficulty];
  let outcomeKey, name = target ? target.name : (t("clues.empty"));
  if (won)        outcomeKey = "pastGuesses.outcome.win";
  else            outcomeKey = "pastGuesses.outcome.loss";
  const outcomeText = t(outcomeKey, {
    name,
    guesses: guessCount,
    max: cap,
    hintTag: hints > 0 ? t(hints === 1 ? "hint.tag.one" : "hint.tag.many", { n: hints }) : "",
  });

  card.innerHTML = `
    <h3 class="modal-title">${escapeHTML(titleText)}</h3>
    <p class="modal-message">${escapeHTML(outcomeText)}</p>
    <div class="past-guesses-board" aria-hidden="true">
      <div class="board-header past-guesses-header"></div>
      <div class="board past-guesses-rows"></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="modal-btn modal-cancel" id="past-guesses-close-btn">${escapeHTML(t("achievements.close"))}</button>
      ${isToday ? "" : `<button type="button" class="modal-btn modal-confirm" id="past-guesses-replay-btn">${escapeHTML(t("pastGuesses.replay"))}</button>`}
    </div>
  `;
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  // Render the original guess rows using the same renderHeader / renderGuessRow
  // helpers the live game uses. compareFor is pure so we can rebuild
  // comparisons on the fly from the stored target+guess IDs.
  const headerEl = card.querySelector(".past-guesses-header");
  const rowsEl = card.querySelector(".past-guesses-rows");
  renderHeader(headerEl, entity, difficulty);
  if (target) {
    // Render in the order they were committed. renderGuessRow prepends
    // (newest-first) so iterate the stored array forwards to end with
    // the latest guess at top — matching the in-game layout.
    for (const id of guessIds) {
      const g = getById(entity, id);
      if (!g) continue;
      const cmp = compareFor(entity, g, target);
      renderGuessRow(rowsEl, g, cmp, entity, difficulty, { animate: false });
    }
  }

  function close() {
    if (!backdrop.parentNode) return;
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    if (prev && typeof prev.focus === "function") {
      try { prev.focus(); } catch { /* ignore */ }
    }
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  document.addEventListener("keydown", onKey, true);

  const closeBtn = card.querySelector("#past-guesses-close-btn");
  const replayBtn = card.querySelector("#past-guesses-replay-btn");
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  // Replay button is omitted for today's row (daily is locked until next
  // UTC midnight). For other dates, clicking it kicks off a fresh replay.
  replayBtn?.addEventListener("click", () => {
    close();
    replayArchivedDaily(date);
  });
  requestAnimationFrame(() => closeBtn.focus());
}

function openAchievementsModal() {
  const unlocked = getUnlockedAchievements();
  const earned = Object.keys(unlocked).length;
  const total = ACHIEVEMENTS.length;

  // Reuse the existing themed-modal backdrop+card pattern (showConfirm),
  // but render our own contents — showConfirm is single-message + two
  // buttons, which doesn't fit a grid layout.
  const prev = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.setAttribute("role", "presentation");

  const card = document.createElement("div");
  card.className = "modal-card modal-card-achievements";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "achievements-title");

  const title = document.createElement("h3");
  title.className = "modal-title";
  title.id = "achievements-title";
  title.textContent = `${t("achievements.title")} (${earned}/${total})`;
  card.appendChild(title);

  const grid = document.createElement("ul");
  grid.className = "achievement-grid";
  for (const a of ACHIEVEMENTS) {
    const li = document.createElement("li");
    const isUnlocked = !!unlocked[a.id];
    li.className = "achievement-item" + (isUnlocked ? " is-unlocked" : " is-locked");
    li.innerHTML = `
      <span class="achievement-icon" aria-hidden="true">${a.icon}</span>
      <div class="achievement-text">
        <div class="achievement-name">${escapeHTML(t(`achievement.${a.id}.name`))}</div>
        <div class="achievement-desc">${escapeHTML(t(`achievement.${a.id}.desc`))}</div>
        <div class="achievement-meta">${
          isUnlocked
            ? escapeHTML(t("achievements.unlocked", { date: unlocked[a.id] }))
            : escapeHTML(t("achievements.locked"))
        }</div>
      </div>
    `;
    grid.appendChild(li);
  }
  card.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal-btn modal-confirm";
  closeBtn.textContent = t("achievements.close");
  actions.appendChild(closeBtn);
  card.appendChild(actions);

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  function close() {
    if (!backdrop.parentNode) return;
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    if (prev && typeof prev.focus === "function") {
      try { prev.focus(); } catch { /* ignore */ }
    }
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  }
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", onKey, true);

  requestAnimationFrame(() => closeBtn.focus());
}

// Brief toast notification when an achievement just unlocked. Stacks if
// multiple unlock in quick succession (rare but possible — e.g. a 7-day
// streak might also satisfy ten_down on the same win). Suppressed in calm
// mode entirely; suppressed for the modal-only "event" achievements that
// surface via the modal itself anyway is NOT done here — they get toasts
// too, since the player clicked something and expects feedback.
function showAchievementToast(id) {
  if (getCalm() === "on") return;
  const a = achievementById(id);
  if (!a) return;
  let container = document.getElementById("achievement-toasts");
  if (!container) {
    container = document.createElement("div");
    container.id = "achievement-toasts";
    container.className = "achievement-toasts";
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = "achievement-toast";
  toast.innerHTML = `
    <span class="achievement-toast-icon" aria-hidden="true">${a.icon}</span>
    <div class="achievement-toast-text">
      <div class="achievement-toast-label">${escapeHTML(t("achievements.unlockedToast"))}</div>
      <div class="achievement-toast-name">${escapeHTML(t(`achievement.${id}.name`))}</div>
    </div>
  `;
  container.appendChild(toast);
  // Trigger the enter animation on the next frame so the class swap takes effect.
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  // Auto-dismiss after a few seconds, then remove from the DOM after the
  // exit animation completes.
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 400);
  }, 3600);
}

// ─── Stats export / import ──────────────────────────────────────────────────

// Show the player's encoded stats in a read-only textarea so they can copy
// it to another browser or device. Empty case (never played) renders a
// note instead of a copyable code.
function openExportStatsModal() {
  const code = exportStats();
  const prev = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const card = document.createElement("div");
  card.className = "modal-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  card.innerHTML = `
    <h3 class="modal-title">${escapeHTML(t("settings.export"))}</h3>
    <p class="modal-message">${escapeHTML(code ? t("export.hint") : t("export.empty"))}</p>
    ${code ? `<textarea class="modal-code" readonly aria-label="${escapeHTML(t("settings.export"))}">${escapeHTML(code)}</textarea>` : ""}
    <div class="modal-actions">
      ${code ? `<button type="button" class="modal-btn modal-confirm" id="export-copy-btn">${escapeHTML(t("export.copy"))}</button>` : ""}
      <button type="button" class="modal-btn modal-cancel" id="export-close-btn">${escapeHTML(t("achievements.close"))}</button>
    </div>
  `;
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  function close() {
    if (!backdrop.parentNode) return;
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    if (prev && typeof prev.focus === "function") {
      try { prev.focus(); } catch { /* ignore */ }
    }
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  document.addEventListener("keydown", onKey, true);

  const closeBtn = card.querySelector("#export-close-btn");
  const copyBtn = card.querySelector("#export-copy-btn");
  const textarea = card.querySelector(".modal-code");
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  if (copyBtn && textarea) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = t("banner.share.copied");
        setTimeout(() => { copyBtn.textContent = t("export.copy"); }, 1500);
      } catch {
        // Clipboard blocked — fall back to selecting the textarea so the user
        // can ctrl/cmd-C manually.
        textarea.focus();
        textarea.select();
      }
    });
  }
  requestAnimationFrame(() => (copyBtn || closeBtn).focus());
}

// Paste-target modal. On submit, parse → preview summary → confirm
// (destructive) → write → reload. Parse failures surface a localized
// error inline rather than closing the modal.
function openImportStatsModal() {
  const prev = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const card = document.createElement("div");
  card.className = "modal-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  card.innerHTML = `
    <h3 class="modal-title">${escapeHTML(t("settings.import"))}</h3>
    <p class="modal-message">${escapeHTML(t("import.hint"))}</p>
    <textarea class="modal-code" id="import-textarea" aria-label="${escapeHTML(t("settings.import"))}" placeholder="${escapeHTML(t("import.placeholder"))}"></textarea>
    <p class="modal-error" id="import-error" hidden></p>
    <div class="modal-actions">
      <button type="button" class="modal-btn modal-cancel" id="import-cancel-btn">${escapeHTML(t("modal.cancel"))}</button>
      <button type="button" class="modal-btn modal-confirm is-destructive" id="import-submit-btn">${escapeHTML(t("settings.import"))}</button>
    </div>
  `;
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  function close() {
    if (!backdrop.parentNode) return;
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    if (prev && typeof prev.focus === "function") {
      try { prev.focus(); } catch { /* ignore */ }
    }
  }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  document.addEventListener("keydown", onKey, true);

  const cancelBtn = card.querySelector("#import-cancel-btn");
  const submitBtn = card.querySelector("#import-submit-btn");
  const textarea = card.querySelector("#import-textarea");
  const errorP = card.querySelector("#import-error");

  cancelBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  submitBtn.addEventListener("click", async () => {
    errorP.hidden = true;
    const code = textarea.value;
    let parsed;
    try {
      parsed = parseImportedStats(code);
    } catch (err) {
      errorP.textContent = t(`import.error.${err.message}`) || t("import.error.unknown");
      errorP.hidden = false;
      return;
    }
    // Build a short summary so the user knows what they're about to overwrite.
    const summary = describeImportedStats(parsed);
    close();
    const ok = await showConfirm({
      message: t("import.confirm", { summary }),
      confirmLabel: t("settings.import"),
      destructive: true,
    });
    if (!ok) return;
    try {
      importStats(code);
    } catch {
      // Storage write failed (private mode, quota?) — surface an alert.
      // Rare enough that we don't bother with i18n here.
      alert(t("import.error.write"));
      return;
    }
    location.reload();
  });

  requestAnimationFrame(() => textarea.focus());
}

// One-line summary string built from a parsed (but not yet applied) stats
// blob — used in the import-confirm message so the user sees what's about
// to overwrite their current stats.
function describeImportedStats(s) {
  const dailyWins = (s.group?.totals?.dailyWins || 0) + (s.idol?.totals?.dailyWins || 0);
  let bestStreak = 0;
  for (const e of ["group", "idol"]) {
    const streaks = s[e]?.streaks || {};
    for (const d of Object.keys(streaks)) {
      if (streaks[d].best > bestStreak) bestStreak = streaks[d].best;
    }
  }
  const achievements = Object.keys(s.achievements || {}).length;
  return t("import.summary", { wins: dailyWins, streak: bestStreak, achievements });
}

// Tiny HTML-escape for target names we're injecting into the archive markup.
// K-pop names usually contain no special characters but defensively encode
// in case a future dataset has an ampersand or quote (e.g. "Stray Kids & ...").
function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Replay a specific past date from the archive. Switches to daily mode if
// the player happened to be in endless / custom, and clears any active
// in-progress state so the replay starts cleanly. Replays don't touch
// stats — same one-shot semantic as the "Replay yesterday" button.
//
// If we have a stored history entry for that date (player has played it
// before), we anchor the replay to the original target ID. Without this,
// pickTarget() would re-derive from `pool[seed % pool.length]` — and the
// pool size has grown since the data was last scraped, so the modulus
// lands on a DIFFERENT group than the player originally faced.
function replayArchivedDaily(dateStr) {
  // If they were in a custom puzzle, drop it (and its hash) — they're
  // leaving the custom round to revisit a past daily.
  if (state.customPuzzle) {
    state.customPuzzle = null;
    clearPuzzleFromHash(location, history);
  }
  // Make sure we're on Daily; the archive only makes sense from there but
  // the player may have been browsing stats from endless.
  if (state.mode !== "daily") {
    state.mode = "daily";
    setActive(els.modeToggle, "daily");
    saveLastSelection({ entity: state.entity, mode: "daily", difficulty: state.difficulty });
  }
  // Anchor to the stored target if we have one (played-day replays). For
  // missed days the entry is null and startGame falls through to the
  // standard seed-based pick — that's the best we can do without history.
  const entry = getDailyHistoryEntry(state.entity, state.difficulty, dateStr);
  startGame({ replayDate: dateStr, forceTargetId: entry?.targetId ?? null });
  renderStats();
  // Scroll the board into view so the player sees the new round, since the
  // archive sits below the fold in the stats panel.
  els.board?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function init() {
  els.entityToggle = $("entity-toggle");
  els.modeToggle = $("mode-toggle");
  els.difficultyToggle = $("difficulty-toggle");
  els.themeToggle = $("theme-toggle");
  els.cbToggle = $("cb-toggle");
  els.calmToggle = $("calm-toggle");
  els.filterToggle = $("filter-toggle");
  els.langToggle = $("lang-toggle");
  els.settingsBtn = $("settings-btn");
  els.settingsPanel = $("settings-panel");
  els.helpBtn = $("help-btn");
  els.helpPanel = $("help-panel");
  els.achievementsBtn = $("achievements-btn");
  els.resetStatsBtn = $("reset-stats-btn");
  els.exportStatsBtn = $("export-stats-btn");
  els.importStatsBtn = $("import-stats-btn");
  els.giveUpBtn = $("give-up-btn");
  els.byline = $("byline");
  els.input = $("guess-input");
  els.dropdown = $("autocomplete");
  els.header = $("board-header");
  els.board = $("board");
  els.banner = $("win-banner");
  els.cluesPanel = $("clues-panel");
  els.guessCount = $("guess-count");
  els.hintBtn = $("hint-btn");
  els.newRound = $("new-round");
  els.countdown = $("countdown");
  els.stats = $("stats");
  els.installBtn = $("install-btn");
  els.installLine = els.installBtn?.parentElement ?? null;

  // i18n: load the chosen locale + the English fallback before any text is
  // displayed. applyToDom() then translates every static [data-i18n] element
  // in one pass. Dynamic strings (built in JS) use t() inline.
  await i18n.init();
  i18n.applyToDom();

  await loadAll();

  // Restore last selection (entity / mode / difficulty) before wiring toggles so the
  // UI reflects it immediately on reload.
  const last = getLastSelection();
  state.entity = last.entity;
  state.mode = last.mode;
  state.difficulty = last.difficulty;

  const persistSelection = () =>
    saveLastSelection({
      entity: state.entity,
      mode: state.mode,
      difficulty: state.difficulty,
    });

  // Helper: if the player navigates away from a friend's puzzle (changes
  // entity/mode/difficulty), drop the custom-puzzle context and the URL hash
  // so the new round is a normal one.
  const exitCustomPuzzle = () => {
    if (!state.customPuzzle) return;
    state.customPuzzle = null;
    clearPuzzleFromHash(location, history);
  };

  attachEntityToggle(els.entityToggle, state.entity, (e) => {
    if (e === state.entity) return;
    state.entity = e;
    setActive(els.entityToggle, e);
    popToggle(els.entityToggle);
    exitCustomPuzzle();
    persistSelection();
    refreshByline();
    startGame();
    renderStats();
  });

  attachModeToggle(els.modeToggle, state.mode, (m) => {
    if (m === state.mode) return;
    state.mode = m;
    setActive(els.modeToggle, m);
    popToggle(els.modeToggle);
    exitCustomPuzzle();
    persistSelection();
    startGame();
    tickCountdown();
    renderStats();
  });

  attachDifficultyToggle(els.difficultyToggle, state.difficulty, (d) => {
    if (d === state.difficulty) return;
    state.difficulty = d;
    setActive(els.difficultyToggle, d);
    popToggle(els.difficultyToggle);
    exitCustomPuzzle();
    persistSelection();
    startGame();
    renderStats();
  });

  // Settings: theme + colorblind. Apply current prefs, wire toggles, then mount
  // the popover behavior (open/close/outside-click/Esc).
  const currentTheme = getTheme();
  const currentCb = getCb();
  attachThemeToggle(els.themeToggle, currentTheme, (t) => {
    applyTheme(t);
    saveTheme(t);
    setActive(els.themeToggle, t);
  });
  attachCbToggle(els.cbToggle, currentCb, (v) => {
    applyCb(v);
    saveCb(v);
    setActive(els.cbToggle, v);
  });
  const currentCalm = getCalm();
  attachCalmToggle(els.calmToggle, currentCalm, (v) => {
    applyCalm(v);
    saveCalm(v);
    setActive(els.calmToggle, v);
  });
  // Detective mode is captured at startGame and held in state.filterMode for
  // the current round. Changing it mid-round only persists to localStorage;
  // the effect kicks in next puzzle.
  attachFilterToggle(els.filterToggle, getFilter(), (v) => {
    saveFilter(v);
    setActive(els.filterToggle, v);
  });
  // Language toggle: changing reloads the page so every string repaints
  // cleanly in the new locale (active-game state is restored from localStorage
  // on reload, so the player doesn't lose mid-round progress).
  attachLangToggle(els.langToggle, i18n.localePreference(), async (v) => {
    setActive(els.langToggle, v);
    await i18n.setLocale(v);
    location.reload();
  });
  attachSettingsMenu({ button: els.settingsBtn, panel: els.settingsPanel });
  attachSettingsMenu({ button: els.helpBtn, panel: els.helpPanel });
  els.achievementsBtn?.addEventListener("click", openAchievementsModal);

  // The puzzle-share button dispatches "kpopdle:puzzle-shared" — we listen
  // here so the achievements layer can unlock the "sharing is caring" badge
  // without render.js having to know about persistence.
  document.addEventListener("kpopdle:puzzle-shared", () => {
    if (markAchievement("sharing_is_caring")) showAchievementToast("sharing_is_caring");
  });

  els.resetStatsBtn.addEventListener("click", async () => {
    const ok = await showConfirm({
      message: t("settings.reset.confirm"),
      confirmLabel: t("settings.reset"),
      destructive: true,
    });
    if (!ok) return;
    resetAllStats();
    // Re-init the game with a fresh persisted state.
    startGame();
    renderStats();
  });

  els.exportStatsBtn?.addEventListener("click", openExportStatsModal);
  els.importStatsBtn?.addEventListener("click", openImportStatsModal);

  // Give-up: reveal the answer and end the round. Confirm text varies by
  // mode — daily warns about the streak, endless calls it a "skip", custom
  // just confirms the reveal.
  els.giveUpBtn.addEventListener("click", async () => {
    if (state.frozen) return;
    const key = state.customPuzzle
      ? "meta.giveup.confirm.custom"
      : state.mode === "daily" && !state.replayDate
      ? "meta.giveup.confirm"
      : "meta.giveup.confirm.endless";
    // Custom puzzles aren't destructive (no stats to lose); daily / endless
    // give-up both count against something so the confirm button is red.
    const destructive = !state.customPuzzle;
    const ok = await showConfirm({
      message: t(key),
      confirmLabel: t("meta.giveup"),
      destructive,
    });
    if (!ok) return;
    forceLoss();
  });

  ac = attachAutocomplete({
    input: els.input,
    dropdown: els.dropdown,
    getPool: () => poolFor(state.entity, state.difficulty),
    // Detective mode: keep impossible candidates in the dropdown but tag them
    // with a short reason so the player learns *why* they can't be chosen.
    // Returning null = candidate is still valid (no annotation).
    getReason: (entity) => {
      if (!state.filterMode) return null;
      const clues = applyHintsToClues(deriveClues(state.guesses), state.hintEvents);
      return whyNotMatch(entity, clues, state.entity);
    },
    didYouMeanLabel: t("autocomplete.didyoumean"),
    onCommit: onGuess,
  });

  els.newRound.addEventListener("click", () => {
    // Endless: clicking "New round" with guesses already on the board counts
    // as a skip — record it so the histogram reflects the abandonment.
    // (Daily can't reach New Round mid-game; clicking it during a replay or
    // custom puzzle doesn't touch stats since those are practice.)
    if (
      state.mode === "endless" &&
      !state.customPuzzle &&
      state.guesses.length > 0 &&
      !state.frozen &&
      state.target
    ) {
      recordEndlessSkip(state.entity, state.difficulty, state.target.id, state.guesses.length, recordOpts());
      checkAchievementsAfterRecord();
    }
    // Custom puzzle finished or abandoned — drop the hash so the next New
    // Round starts a normal endless round and refreshes don't re-trigger.
    if (state.customPuzzle) {
      clearPuzzleFromHash(location, history);
      state.customPuzzle = null;
    }
    // Mid-replay "New round" → abandon the replay's saved state too, so
    // the archive row that pointed to it doesn't keep offering to resume.
    // BUT: if the replay is already finished (state.frozen — win or loss),
    // the saved state is a "done" record that the archive uses to show
    // the outcome. Don't wipe it; the player has moved on, not abandoned.
    if (state.replayDate && !state.frozen) {
      clearActiveReplay(state.entity, state.difficulty, state.replayDate);
    }
    clearActive(state.entity, state.mode, state.difficulty);
    state.target = null;
    startGame();
    renderStats();
  });

  els.hintBtn.addEventListener("click", onHint);

  // Custom puzzle from a shared URL? Parse the hash before the first
  // startGame() so the boot lands directly in the friend's puzzle, with the
  // right entity/difficulty/detective state and toggles synced. Invalid hash
  // values are silently ignored (we just start a normal game). The hash
  // itself stays in the URL until the round ends, so a refresh mid-round
  // resumes the same puzzle.
  const puzzle = readPuzzleFromHash(location);
  if (puzzle) {
    const candidate = getById(puzzle.entity, puzzle.targetId);
    if (candidate) {
      state.entity = puzzle.entity;
      state.difficulty = puzzle.difficulty;
      state.mode = "endless";
      state.customPuzzle = { ...puzzle };
      // Reflect the puzzle's settings in the toggles so the player can see
      // what they're playing. We don't persist these as the player's "last
      // selection" — that happens when they make a real choice.
      setActive(els.entityToggle, state.entity);
      setActive(els.modeToggle, state.mode);
      setActive(els.difficultyToggle, state.difficulty);
      setActive(els.filterToggle, puzzle.filter ? "on" : "off");
    } else {
      // Link points at an entity we don't have (data shifted, or someone
      // mistyped). Strip the hash and tell the player.
      clearPuzzleFromHash(location, history);
      // Defer alert: we want it visible after the page paints, not during init.
      setTimeout(() => alert(t("puzzle.invalid")), 0);
    }
  }

  refreshByline();
  startGame();
  tickCountdown();
  setInterval(tickCountdown, 1000);
  renderStats();
  document.addEventListener("visibilitychange", renderStats);

  // Footer stamp: "Data current as of <Month YYYY>". Pulled from the dataset's
  // generated_at timestamp so it auto-updates when scrape.py + encode_data.py
  // are re-run.
  const asof = getDataAsOfDate();
  const asofEl = document.getElementById("data-asof");
  if (asof && asofEl) {
    const label = asof.toLocaleDateString(i18n.locale(), { month: "long", year: "numeric" });
    asofEl.textContent = t("footer.dataAsOf", { date: label });
  }

  // "Report a data correction" footer link → pre-filled GitHub issue. Hidden
  // when we can't determine the repo (e.g. localhost dev with no override).
  // Override at deploy time by setting <meta name="kpopdle:repo" content="...">.
  const repoOverride = document.querySelector('meta[name="kpopdle:repo"]')?.content?.trim() || null;
  const repo = repoUrlFor(location, repoOverride);
  const reportLine = document.getElementById("report-line");
  const reportLink = document.getElementById("report-link");
  if (repo && reportLink && reportLine) {
    // Reveal the whole "Spot wrong data? Open a correction on GitHub →"
    // line as a unit. Hiding only the link leaves the orphan prompt text
    // on screen with no answer, which reads as a dangling question.
    reportLink.href = correctionIssueUrl(repo);
    reportLine.hidden = false;
  }

  // PWA install hint. Browsers that consider the site install-eligible AND
  // not already installed (Chrome/Edge/Samsung Internet — Safari doesn't
  // support this) fire `beforeinstallprompt` shortly after load. We stash
  // the event, reveal the footer link, then call event.prompt() on click.
  // After ANY user choice we hide the link AND remember the dismissal so
  // the same browser doesn't pester on every visit. The browser's own
  // engagement heuristics already throttle re-firing, but this belt-and-
  // suspenders ensures a polite hint that never becomes annoying.
  if (els.installBtn && els.installLine) {
    let deferredPrompt = null;
    const dismissed = (() => {
      try { return localStorage.getItem("kpopdle:installDismissed") === "1"; }
      catch { return false; }
    })();
    if (!dismissed) {
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;
        els.installLine.hidden = false;
      });
    }
    // If the user installs through the OS / browser UI directly (not via
    // our button), hide the hint immediately and stop trying.
    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      els.installLine.hidden = true;
      try { localStorage.setItem("kpopdle:installDismissed", "1"); } catch {}
    });
    els.installBtn.addEventListener("click", async () => {
      if (!deferredPrompt) {
        els.installLine.hidden = true;
        return;
      }
      try {
        deferredPrompt.prompt();
        // userChoice resolves regardless of accepted/dismissed; either way
        // we don't want to surface the hint again on this device.
        await deferredPrompt.userChoice;
      } catch { /* ignore */ }
      deferredPrompt = null;
      els.installLine.hidden = true;
      try { localStorage.setItem("kpopdle:installDismissed", "1"); } catch {}
    });
  }

  // First-visit onboarding: brand-new players land on a board with no
  // explanation of the cell colors. Pop the help modal once; subsequent
  // visits get no auto-open. Wrapped in rAF so the help button has settled.
  if (!hasVisited()) {
    requestAnimationFrame(() => {
      els.helpBtn.click();
      markVisited();
    });
  }
}

// PWA: register the service worker so the game works offline after first
// load. No-op on environments that don't support service workers (e.g. some
// in-app webviews). Skipped on localhost / *.local — during development the
// SW's stale-while-revalidate cache hides freshly-edited code on reload, and
// the offline benefit is irrelevant when you're already running the dev
// server. Production hosts (everything else) get the SW as normal.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const host = (location.hostname || "").toLowerCase();
    const isDev = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local") || host === "";
    if (isDev) {
      // Also unregister any SW from a previous (pre-this-change) dev session
      // so the next reload doesn't keep serving stale cached assets.
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => { /* swallow */ });
      return;
    }
    navigator.serviceWorker.register("./sw.js").catch(() => { /* swallow */ });
  });
}

init().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<pre style="color:#c33;padding:1rem">${String(e)}</pre>`
  );
});
