import { loadAll, poolFor, targetPoolFor, getById, getNumericBounds, getDataAsOfDate } from "./data.js";
import { state, resetGame, recordGuess } from "./state.js";
import { compareFor, isWin } from "./compare.js";
import { targetForDaily, randomTarget, todayUTC, yesterdayUTC } from "./seed.js";
import { attachAutocomplete } from "./autocomplete.js";
import { repoUrlFor, correctionIssueUrl } from "./share.js";
import {
  renderHeader,
  renderGuessRow,
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
import { VISIBLE_ATTRS, ENTITIES, MAX_DAILY_GUESSES, ATTR_LABEL } from "./config.js";
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
  attachSettingsMenu,
  applyTheme,
  applyCb,
  applyCalm,
  setActive,
  formatCountdownToUTCMidnight,
} from "./ui.js";
import {
  getDailyStatus,
  recordDailyWin,
  recordEndlessWin,
  recordEndlessSkip,
  getStats,
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
  markVisited,
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
  settingsBtn: null,
  settingsPanel: null,
  helpBtn: null,
  helpPanel: null,
  resetStatsBtn: null,
  giveUpBtn: null,
  replayYesterdayBtn: null,
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

function refreshByline() {
  const noun = state.entity === "idol" ? "K-pop idol" : "K-pop group";
  els.byline.textContent = `Guess the ${noun}. New daily puzzle at 00:00 UTC.`;
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
  const knowns = knownAttrs(clues, bounds);
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
  // Daily has a fixed cap, so show progress against it ("1/6 guesses"). Endless
  // is unlimited so we keep the raw count.
  const cap = state.mode === "daily" ? MAX_DAILY_GUESSES[state.difficulty] : null;
  const countText = cap != null ? `${g}/${cap}` : `${g}`;
  // When showing /N, always pluralize "guesses" — reads naturally with a denominator.
  const noun = cap == null && g === 1 ? "guess" : "guesses";
  const next =
    h === 0
      ? `${countText} ${noun}`
      : `${countText} ${noun} · +${h} hint = ${g + h}`;
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
  });
  const cost = nextHintCost(state.hintEvents, state.guesses.length);
  els.hintBtn.hidden = false;
  if (!candidate) {
    els.hintBtn.disabled = true;
    els.hintBtn.textContent = "Hint (none left)";
    return;
  }
  els.hintBtn.disabled = false;
  // Show what the next hint would reveal so players can decide if the cost is
  // worth it. Wording is short to keep the button compact.
  els.hintBtn.textContent = `Hint (+${cost}) · ${prettyLabel(candidate)}`;
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
  saveActive(state.entity, state.mode, state.difficulty, {
    targetId: state.target.id,
    guessIds: state.guesses.map((x) => x.group.id),
    hintOrder: state.hintOrder,
    hintEvents: state.hintEvents,
    filterMode: state.filterMode,
  });
  refreshClues();
  flashHintReveal(prettyLabel(attr), prettyValue(attr, value, state.entity));
}

function prettyLabel(attr) {
  return ATTR_LABEL[attr] || attr;
}

// End the current daily as a loss. Shares the same persistence + UI path that
// running out of guesses takes, so streak / history / banner stay consistent.
function forceLoss() {
  if (state.frozen) return;
  if (state.mode !== "daily") return;
  state.lost = true;
  state.frozen = true;
  els.input.disabled = true;
  els.input.placeholder = state.replayDate
    ? "Replay finished — start a new round"
    : "Come back tomorrow for a new daily puzzle";
  if (!state.replayDate) {
    clearActive(state.entity, state.mode, state.difficulty);
    const totalTries = state.guesses.length + totalHintPenalty(state.hintEvents);
    recordDailyLoss(state.entity, state.difficulty, state.target.id, totalTries);
  }
  const visible = VISIBLE_ATTRS[state.entity][state.difficulty];
  renderLossBanner(els.banner, {
    difficulty: state.difficulty,
    entity: state.entity,
    guessCount: state.guesses.length,
    hintCount: state.hintEvents.length,
    guesses: state.guesses,
    attrOrder: visible,
    target: state.target,
    dateStr: state.replayDate || todayUTC(),
    maxGuesses: MAX_DAILY_GUESSES[state.difficulty],
    suggestions: state.replayDate ? [] : buildDailyCTAs(),
  });
  updateHintButton();
  updateMetaButtons();
  renderStats();
}

// Show/hide give-up + replay-yesterday based on game state. Called whenever
// the game transitions (start, win, loss, mode switch).
function updateMetaButtons() {
  // Give up: visible only during an active daily round (or a replay round —
  // a replay player can also bail). Hidden in endless and after win/loss.
  const inDaily = state.mode === "daily";
  els.giveUpBtn.hidden = !inDaily || state.frozen || !state.target;
  // Replay yesterday: visible only when in daily mode, not currently replaying.
  els.replayYesterdayBtn.hidden = !inDaily || !!state.replayDate;
  els.replayYesterdayBtn.textContent = `Replay yesterday's ${state.difficulty}`;
}

function prettyValue(attr, value, entity) {
  if (attr === "generation") return `Gen ${value}`;
  if (attr === "gender") {
    return entity === "idol"
      ? { boy: "Male", girl: "Female", coed: "Co-ed" }[value] || value
      : { boy: "Boy group", girl: "Girl group", coed: "Co-ed" }[value] || value;
  }
  if (attr === "status") return value === "active" ? "Active" : "Disbanded";
  return String(value);
}

function pickTarget() {
  // Use the "complete data" pool for target selection so the puzzle never
  // lands on an entity that's missing one of its visible attribute values.
  // (The autocomplete still uses the full poolFor.)
  const pool = targetPoolFor(state.entity, state.difficulty);
  if (state.mode === "daily") {
    // replayDate, if set, supplies the seed date (yesterday's puzzle, etc.).
    const dateStr = state.replayDate || todayUTC();
    return targetForDaily(`${state.entity}|${dateStr}`, state.difficulty, pool);
  }
  return randomTarget(pool);
}

function startGame({ replayDaily = false, replayDate = null } = {}) {
  resetGame();
  state.replayDate = replayDate; // null for normal play
  // Snapshot the Detective-mode preference for this round. Changing the
  // setting after this point won't affect the current game.
  state.filterMode = getFilter() === "on";
  hideWinBanner(els.banner);
  // Paint the panel with empty placeholders for the current entity/difficulty.
  // refreshClues uses VISIBLE_ATTRS, so the slot set matches the board columns.
  prevKnownAttrs = new Set();
  refreshClues({ animateNewlyKnown: false });

  // Replay rounds bypass the "already played today" check (the puzzle is from
  // a different date) and don't restore in-progress state (replays are one-shot).
  if (state.mode === "daily" && !replayDaily && !state.replayDate) {
    const prev = getDailyStatus(state.entity, state.difficulty);
    if (prev && (prev.won || prev.won === false)) {
      state.target = getById(state.entity, prev.targetId) || pickTarget();
      state.frozen = true;
      state.won = !!prev.won;
      state.lost = !prev.won;
      renderHeader(els.header, state.entity, state.difficulty);
      clearBoard(els.board);
      const visible = VISIBLE_ATTRS[state.entity][state.difficulty];
      if (prev.won) {
        const reveal = compareFor(state.entity, state.target, state.target);
        renderGuessRow(els.board, state.target, reveal, state.entity, state.difficulty);
        els.guessCount.textContent = `Solved today in ${prev.guesses} ${prev.guesses === 1 ? "guess" : "guesses"}`;
        renderWinBanner(els.banner, {
          mode: "daily",
          difficulty: state.difficulty,
          entity: state.entity,
          guessCount: prev.guesses,
          // No persisted board → emoji grid only shows the single revealed row.
          guesses: [{ group: state.target, comparison: reveal }],
          attrOrder: visible,
          target: state.target,
          dateStr: todayUTC(),
          maxGuesses: MAX_DAILY_GUESSES[state.difficulty],
          suggestions: buildDailyCTAs(),
        });
      } else {
        els.guessCount.textContent = `Out of guesses today`;
        renderLossBanner(els.banner, {
          difficulty: state.difficulty,
          entity: state.entity,
          guessCount: prev.guesses,
          guesses: [], // not persisted with the loss record
          attrOrder: visible,
          target: state.target,
          dateStr: todayUTC(),
          maxGuesses: MAX_DAILY_GUESSES[state.difficulty],
          suggestions: buildDailyCTAs(),
        });
      }
      els.input.disabled = true;
      els.input.placeholder = "Come back tomorrow for a new daily puzzle";
      els.newRound.hidden = true;
      ac?.setGuessedIds([prev.targetId]);
      updateMetaButtons();
      return;
    }
  }

  // Try restoring an in-progress game first. Skip for replays — they're
  // one-shot rounds that intentionally don't persist across reload.
  const active = state.replayDate ? null : getActive(state.entity, state.mode, state.difficulty);
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
      clearActive(state.entity, state.mode, state.difficulty);
    }
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
  const noun = state.entity === "idol" ? "K-pop idol" : "K-pop group";
  const replayTag = state.replayDate ? ` · replay ${state.replayDate}` : "";
  const filterTag = state.filterMode ? " · detective" : "";
  els.input.placeholder = `Guess a ${noun}… (${pool.length} possible)${replayTag}${filterTag}`;
  els.input.value = "";
  els.input.focus();
  // Replays are one-shot, so show "New round" (returns to today's daily).
  els.newRound.hidden = state.mode === "daily" && !state.replayDate;

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
  prevKnownAttrs = knownAttrs(clues0, getNumericBounds(state.entity));
  refreshClues({ animateNewlyKnown: false });
  updateMetaButtons();
}

function onGuess(entity) {
  if (state.frozen) return;
  if (state.guesses.some((g) => g.group.id === entity.id)) return;
  const cmp = compareFor(state.entity, entity, state.target);
  recordGuess(entity, cmp);
  renderGuessRow(els.board, entity, cmp, state.entity, state.difficulty);
  ac?.setGuessedIds(state.guesses.map((x) => x.group.id));
  // Score line (including "1/6 guesses" daily progress) updates via refreshClues.
  refreshClues();
  // Replays are practice — don't snapshot progress (reload returns to today's daily).
  if (!state.replayDate) {
    saveActive(state.entity, state.mode, state.difficulty, {
      targetId: state.target.id,
      guessIds: state.guesses.map((x) => x.group.id),
      hintOrder: state.hintOrder,
      hintEvents: state.hintEvents,
      filterMode: state.filterMode,
    });
  }

  const visible = VISIBLE_ATTRS[state.entity][state.difficulty];

  if (isWin(entity, state.target)) {
    state.won = true;
    state.frozen = true;
    els.input.disabled = true;
    if (!state.replayDate) clearActive(state.entity, state.mode, state.difficulty);
    const totalTries = state.guesses.length + totalHintPenalty(state.hintEvents);
    const maxGuesses = state.mode === "daily" ? MAX_DAILY_GUESSES[state.difficulty] : null;
    // Replays are practice — don't touch stats.
    if (!state.replayDate) {
      if (state.mode === "daily") {
        recordDailyWin(state.entity, state.difficulty, state.target.id, totalTries);
      } else {
        recordEndlessWin(state.entity, state.difficulty, state.target.id, totalTries);
      }
    }
    renderWinBanner(els.banner, {
      mode: state.mode,
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
      suggestions:
        state.mode === "endless"               ? buildEndlessCTAs() :
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
      els.input.placeholder = state.replayDate
        ? "Replay finished — start a new round"
        : "Come back tomorrow for a new daily puzzle";
      if (!state.replayDate) {
        clearActive(state.entity, state.mode, state.difficulty);
        const totalTries = state.guesses.length + totalHintPenalty(state.hintEvents);
        recordDailyLoss(state.entity, state.difficulty, state.target.id, totalTries);
      }
      renderLossBanner(els.banner, {
        difficulty: state.difficulty,
        entity: state.entity,
        guessCount: state.guesses.length,
        hintCount: state.hintEvents.length,
        guesses: state.guesses,
        attrOrder: visible,
        target: state.target,
        dateStr: state.replayDate || todayUTC(),
        maxGuesses: cap,
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
      label: `Try Daily ${capitalize(d)}`,
      kind: "daily",
      onClick: () => goTo({ mode: "daily", difficulty: d }),
    });
  }
  ctas.push({
    label: `Try Endless ${capitalize(state.difficulty)}`,
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
    label: "New round",
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
      label: `Try Endless ${capitalize(d)}`,
      kind: "endless",
      onClick: () => goTo({ mode: "endless", difficulty: d }),
    });
  }
  const dailyStatus = getDailyStatus(state.entity, state.difficulty);
  if (!dailyStatus || !dailyStatus.won) {
    ctas.push({
      label: `Try Daily ${capitalize(state.difficulty)}`,
      kind: "daily",
      onClick: () => goTo({ mode: "daily", difficulty: state.difficulty }),
    });
  }
  return ctas;
}

function tickCountdown() {
  if (els.countdown && state.mode === "daily") {
    els.countdown.textContent = `Next daily in ${formatCountdownToUTCMidnight()}`;
  } else if (els.countdown) {
    els.countdown.textContent = "";
  }
}

// Wordle-style guess-distribution histogram for the current (entity, mode,
// difficulty). One row per possible outcome: 1..maxGuesses + "X" for losses
// (daily only). Bars scale to the largest count so single plays still show.
function renderHistogram(entity, mode, difficulty) {
  const { distribution, played } = historySummary(entity, mode, difficulty);
  if (played === 0) {
    return `<p class="histogram-empty">No plays yet on ${mode} ${difficulty}.</p>`;
  }
  const buckets = [];
  if (mode === "daily") {
    const max = MAX_DAILY_GUESSES[difficulty];
    for (let i = 1; i <= max; i++) buckets.push(String(i));
    buckets.push("X"); // losses
  } else {
    // Endless has no cap → show whichever guess counts have actually occurred,
    // followed by an "S" (skip) bucket if the player has abandoned any rounds.
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
    const outcome =
      k === "X" ? "no win (loss)" :
      k === "S" ? "skipped" :
      `${k} ${k === "1" ? "guess" : "guesses"}`;
    return `<div class="histogram-row">
      <span class="histogram-key">${k}</span>
      <div class="${cls}" style="width: ${pct}%" aria-label="${n} ${n === 1 ? "play" : "plays"} ${k === "X" || k === "S" ? "ended " + outcome : "won in " + outcome}"></div>
      <span class="histogram-count">${n}</span>
    </div>`;
  });
  return `<div class="histogram" role="figure" aria-label="${mode} ${difficulty} guess distribution">${rows.join("")}</div>`;
}

function renderStats() {
  const s = getStats();
  const bucket = s[state.entity];

  const dailyRows = ["easy", "medium", "hard"].map((d) => {
    const best = bucket.bests[d]?.fewestGuesses ?? "—";
    const streak = bucket.streaks[d]?.current ?? 0;
    const bestStreak = bucket.streaks[d]?.best ?? 0;
    const summary = historySummary(state.entity, "daily", d);
    const rateText = summary.winRatePct == null
      ? `<span class="dim">no plays</span>`
      : `${summary.wins}/${summary.played} <span class="dim">(${summary.winRatePct}%)</span>`;
    return `<dt>${d}</dt><dd>best <b>${best}</b> · streak ${streak} <span class="dim">(best ${bestStreak})</span> · won ${rateText}</dd>`;
  });

  const endlessRows = ["easy", "medium", "hard"].map((d) => {
    const best = bucket.endless[d]?.bestGuesses ?? "—";
    const played = bucket.endless[d]?.played ?? 0;
    return `<dt>${d}</dt><dd>best <b>${best}</b> · ${played} ${played === 1 ? "play" : "plays"}</dd>`;
  });

  // Histogram for the *current* mode/difficulty — switches with the toggles.
  const hist = renderHistogram(state.entity, state.mode, state.difficulty);

  els.stats.innerHTML = `
    <h3 class="stats-entity">${state.entity}</h3>
    <div class="stats-grid">
      <section class="stats-col">
        <h4 class="stats-col-title">Daily</h4>
        <dl>${dailyRows.join("")}</dl>
      </section>
      <section class="stats-col">
        <h4 class="stats-col-title">Endless</h4>
        <dl>${endlessRows.join("")}</dl>
      </section>
    </div>
    <section class="histogram-section">
      <h4 class="stats-col-title">Guess distribution · ${state.mode} ${state.difficulty}</h4>
      ${hist}
    </section>
  `;
}

async function init() {
  els.entityToggle = $("entity-toggle");
  els.modeToggle = $("mode-toggle");
  els.difficultyToggle = $("difficulty-toggle");
  els.themeToggle = $("theme-toggle");
  els.cbToggle = $("cb-toggle");
  els.calmToggle = $("calm-toggle");
  els.filterToggle = $("filter-toggle");
  els.settingsBtn = $("settings-btn");
  els.settingsPanel = $("settings-panel");
  els.helpBtn = $("help-btn");
  els.helpPanel = $("help-panel");
  els.resetStatsBtn = $("reset-stats-btn");
  els.giveUpBtn = $("give-up-btn");
  els.replayYesterdayBtn = $("replay-yesterday-btn");
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

  attachEntityToggle(els.entityToggle, state.entity, (e) => {
    if (e === state.entity) return;
    state.entity = e;
    setActive(els.entityToggle, e);
    popToggle(els.entityToggle);
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
  attachSettingsMenu({ button: els.settingsBtn, panel: els.settingsPanel });
  attachSettingsMenu({ button: els.helpBtn, panel: els.helpPanel });

  els.resetStatsBtn.addEventListener("click", () => {
    if (!confirm("Reset all stats? This clears streaks, history, and any in-progress games. Theme and accessibility preferences are kept. This can't be undone.")) return;
    resetAllStats();
    // Re-init the game with a fresh persisted state.
    startGame();
    renderStats();
  });

  // Give-up: ends the current daily as a loss. Endless / replays don't get
  // this (no streak to break, can just start a new round).
  els.giveUpBtn.addEventListener("click", () => {
    if (state.frozen) return;
    if (!confirm("Give up? Today's daily counts as a loss and breaks your streak.")) return;
    forceLoss();
  });

  // "Replay yesterday's daily" — same difficulty, yesterday's seed. Doesn't
  // touch streak/bests/history.
  els.replayYesterdayBtn.addEventListener("click", () => {
    startGame({ replayDate: yesterdayUTC() });
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
    onCommit: onGuess,
  });

  els.newRound.addEventListener("click", () => {
    // Endless: clicking "New round" with guesses already on the board counts
    // as a skip — record it so the histogram reflects the abandonment.
    // (Daily can't reach New Round mid-game; clicking it during a replay
    // round doesn't touch stats since replays are practice.)
    if (
      state.mode === "endless" &&
      state.guesses.length > 0 &&
      !state.frozen &&
      state.target
    ) {
      recordEndlessSkip(state.entity, state.difficulty, state.target.id, state.guesses.length);
    }
    clearActive(state.entity, state.mode, state.difficulty);
    state.target = null;
    startGame();
    renderStats();
  });

  els.hintBtn.addEventListener("click", onHint);

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
    const label = asof.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    asofEl.textContent = `Data current as of ${label}.`;
  }

  // "Report a data correction" footer link → pre-filled GitHub issue. Hidden
  // when we can't determine the repo (e.g. localhost dev with no override).
  // Override at deploy time by setting <meta name="kpopdle:repo" content="...">.
  const repoOverride = document.querySelector('meta[name="kpopdle:repo"]')?.content?.trim() || null;
  const repo = repoUrlFor(location, repoOverride);
  const reportLink = document.getElementById("report-link");
  if (repo && reportLink) {
    reportLink.href = correctionIssueUrl(repo);
    reportLink.hidden = false;
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
// in-app webviews).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
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
