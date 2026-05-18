import { VISIBLE_ATTRS, ATTR_LABEL } from "./config.js";
import { emojiGridFor, wikipediaUrlFor, answerLabel, hintTag, buildShareText, currentPlayUrl } from "./share.js";
import { buildPuzzleUrl } from "./puzzle.js";
import { t } from "./i18n.js";

const ARROW = { up: "▲", down: "▼" };

function fmtValue(attr, value, entity) {
  if (value === null || value === undefined || value === "") return "—";
  if (attr === "member_count") return String(value);
  if (attr === "debut_year") return String(value);
  if (attr === "birth_year") return String(value);
  if (attr === "generation") return `${t("attr.generation")} ${value}`;
  if (attr === "gender") {
    const kind = entity === "idol" ? "idol" : "group";
    return t(`gender.${kind}.${value}`) || value;
  }
  if (attr === "status") return t(`status.${value}`) || value;
  if (attr === "country") return value;
  if (attr === "nationality") return value;
  if (attr === "primary_group") return value;
  return String(value);
}

export function renderHeader(headerEl, entity, difficulty) {
  headerEl.innerHTML = "";
  const nameCol = document.createElement("div");
  nameCol.className = "col col-name";
  nameCol.textContent = t(entity === "idol" ? "toggle.entity.idol" : "toggle.entity.group");
  headerEl.appendChild(nameCol);
  for (const attr of VISIBLE_ATTRS[entity][difficulty]) {
    const col = document.createElement("div");
    col.className = `col col-${attr}`;
    col.textContent = t(`attr.${attr}`);
    headerEl.appendChild(col);
  }
}

export function renderGuessRow(boardEl, guess, comparison, entity, difficulty, opts = {}) {
  const { animate = true } = opts;
  const row = document.createElement("div");
  row.className = "row guess-row" + (animate ? "" : " no-anim");

  const nameCell = document.createElement("div");
  nameCell.className = "cell cell-name";
  nameCell.textContent = guess.name;
  row.appendChild(nameCell);

  const attrs = VISIBLE_ATTRS[entity][difficulty];
  attrs.forEach((attr, idx) => {
    const c = comparison[attr] || { value: null, status: "none" };
    const cell = document.createElement("div");
    cell.className = `cell cell-${attr} status-${c.status}`;
    // Index drives the staggered flip-in delay.
    cell.style.setProperty("--col-index", String(idx));
    const text = document.createElement("span");
    text.className = "cell-text";
    text.textContent = fmtValue(attr, c.value, entity);
    cell.appendChild(text);
    if (c.direction) {
      const arrow = document.createElement("span");
      arrow.className = "cell-arrow";
      arrow.textContent = ARROW[c.direction] || "";
      cell.appendChild(arrow);
    }
    row.appendChild(cell);
  });

  // Latest guess on top.
  boardEl.prepend(row);
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Spawn N confetti pieces from somewhere near the top. Pieces auto-clean.
// Uses a fixed rainbow palette — we explored sourcing official group colors
// from Wikidata (P6364 → P465) but coverage is <1% of the catalog so the
// feature was removed as dead weight.
export function burstConfetti({
  count = 90,
  origin = null,
  durations = [2.2, 3.4],
} = {}) {
  const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return;

  const PALETTE = ["#ff5fa2", "#ff9a4e", "#ffd76b", "#6f88ff", "#5ce0d8", "#c08fff"];
  const emojis = ["✨", "💖", "⭐", "🎉", "✦", "💫"];
  const originX = origin?.x ?? window.innerWidth / 2;
  const originY = origin?.y ?? Math.min(180, window.innerHeight * 0.18);

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    const isEmoji = Math.random() < 0.18;
    piece.className = "confetti-piece" + (isEmoji ? " shape-emoji" : "");
    const w = 6 + Math.random() * 6;
    const h = 10 + Math.random() * 8;
    piece.style.width = isEmoji ? "auto" : `${w}px`;
    piece.style.height = isEmoji ? "auto" : `${h}px`;
    piece.style.background = isEmoji ? "transparent" : PALETTE[Math.floor(Math.random() * PALETTE.length)];
    piece.style.left = `${originX + (Math.random() - 0.5) * 80}px`;
    piece.style.top = `${originY}px`;
    const dx = (Math.random() - 0.5) * 600;
    const rot = (Math.random() * 1440 - 720) | 0;
    const dur = durations[0] + Math.random() * (durations[1] - durations[0]);
    piece.style.setProperty("--dx", `${dx}px`);
    piece.style.setProperty("--rot", `${rot}deg`);
    piece.style.setProperty("--dur", `${dur}s`);
    piece.style.animationDelay = `${Math.random() * 0.2}s`;
    if (isEmoji) piece.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), (dur + 0.3) * 1000);
  }
}

export function bumpScore(el) {
  if (!el) return;
  el.classList.remove("is-bumped");
  void el.offsetWidth; // restart animation
  el.classList.add("is-bumped");
  setTimeout(() => el.classList.remove("is-bumped"), 450);
}

export function clearBoard(boardEl) {
  boardEl.innerHTML = "";
}

// Localized banner title. Three flavors:
//   - "win"     → "Got it! …"
//   - "loss"    → "Out of guesses. It was …"  (daily-only — they actually
//                  ran out)
//   - "giveup"  → "It was …"                  (endless / custom / replay
//                  where the player chose to reveal)
// Picks the idol-specific key when entity is "idol" with a primary_group so
// "It was Jimin of BTS." reads naturally in every language.
function bannerTitle(outcome, entity, target) {
  const isIdolWithGroup = entity === "idol" && target?.primary_group;
  const key = `banner.${outcome}.${isIdolWithGroup ? "titleIdol" : "title"}`;
  return t(key, { name: target?.name ?? "?", group: target?.primary_group ?? "" });
}

// Pick the right "{difficulty} · N guesses" line for the situation.
// `mode` is logical: "daily" | "endless" | "custom". "custom" suppresses the
// guess cap (custom puzzles have no daily limit) and uses friend's-puzzle
// copy so the player knows their score isn't being recorded.
function bannerSub({ mode, difficulty, guessCount, hintCount, maxGuesses, outcome }) {
  const params = {
    count: guessCount,
    max: maxGuesses,
    hintTag: hintTag(hintCount),
    difficulty: t(`toggle.difficulty.${difficulty}`),
  };
  if (mode === "custom") {
    const stem = outcome === "loss" ? "banner.sub.custom.loss" : "banner.sub.custom.win";
    return t(guessCount === 1 ? `${stem}.one` : `${stem}.many`, params);
  }
  if (outcome === "loss") {
    if (mode === "endless") {
      return t(guessCount === 1 ? "banner.sub.endless.loss.one" : "banner.sub.endless.loss.many", params);
    }
    return t("banner.sub.loss", params);
  }
  if (mode === "daily") return t("banner.sub.daily", params);
  return t(guessCount === 1 ? "banner.sub.endless.one" : "banner.sub.endless.many", params);
}

function appendBannerCtas(bannerEl, suggestions) {
  if (!suggestions.length) return;
  const ctaWrap = document.createElement("div");
  ctaWrap.className = "banner-ctas";

  const ctaHeading = document.createElement("p");
  ctaHeading.className = "banner-ctas-heading";
  ctaHeading.textContent = t("banner.whatsnext");
  ctaWrap.appendChild(ctaHeading);

  const ctaList = document.createElement("div");
  ctaList.className = "banner-cta-list";
  for (const s of suggestions) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `cta-chip cta-${s.kind || "daily"}`;
    b.textContent = s.label;
    b.addEventListener("click", () => s.onClick?.());
    ctaList.appendChild(b);
  }
  ctaWrap.appendChild(ctaList);
  bannerEl.appendChild(ctaWrap);
}

function appendLearnMoreLink(bannerEl, entity, target) {
  const href = wikipediaUrlFor(entity, target);
  if (!href) return;
  const name = entity === "idol" && target?.primary_group ? target.primary_group : (target?.name ?? "");
  const label = t("banner.learnmore", { name });
  const a = document.createElement("a");
  a.className = "learn-more-link";
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label + " →";
  bannerEl.appendChild(a);
}

// Try the platform's native share sheet first (Web Share API — pops Messages /
// Mail / Discord / etc. on mobile, plus a small picker on desktop Chrome).
// Fall back to clipboard copy when the API is missing or the call fails for
// any reason other than the user dismissing the sheet.
//
// Returns one of:
//   "shared"   — the OS share sheet handled it (or the user cancelled —
//                we can't distinguish, and we shouldn't show extra feedback
//                either way because the sheet *was* the feedback).
//   "copied"   — clipboard fallback succeeded.
//   "fallback" — both paths failed; caller surfaces the text inline as
//                a last resort so the user can copy it by hand.
async function sharePayload({ title, text, url }) {
  // navigator.share rejects (NotAllowedError) without a transient activation
  // — so this MUST be called from a click handler, which all our callers are.
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      // User dismissed the sheet — count as success (no fallback needed).
      if (err && err.name === "AbortError") return "shared";
      // Any other error (NotAllowedError, TypeError on bad payload, browser
      // bug) falls through to clipboard so the user still gets something.
    }
  }
  try {
    // Combine text + url for the clipboard path — keeps the share string
    // self-contained when it lands in a chat window.
    const blob = [text, url].filter(Boolean).join(text && url ? "\n" : "");
    await navigator.clipboard.writeText(blob || url || text || "");
    return "copied";
  } catch {
    return "fallback";
  }
}

// "Copy result" button — wordle-style emoji grid + score + play URL.
function appendShareButton(bannerEl, shareText) {
  const shareBtn = document.createElement("button");
  shareBtn.className = "share-btn";
  shareBtn.type = "button";
  const copyLabel = t("banner.share.copy");
  const copiedLabel = t("banner.share.copied");
  shareBtn.textContent = copyLabel;
  shareBtn.addEventListener("click", async () => {
    // shareText already includes the "Play: URL" line, so we hand the whole
    // thing in as `text` and skip the separate `url` field. Avoids the URL
    // appearing twice in chat apps that render link previews.
    const result = await sharePayload({ text: shareText });
    if (result === "copied") {
      shareBtn.textContent = copiedLabel;
      setTimeout(() => { shareBtn.textContent = copyLabel; }, 1500);
    } else if (result === "fallback") {
      // Both Share API and clipboard failed — show the raw text so the
      // user can long-press and copy by hand.
      shareBtn.textContent = shareText;
    }
    // result === "shared": the OS sheet was the feedback, nothing to do.
  });
  bannerEl.appendChild(shareBtn);
}

// "Send this puzzle to a friend" button — copies a URL that boots the same
// target as a one-off endless round (no stats). Hidden when we can't build a
// link (e.g. target missing a QID, or running on localhost where we'd ship a
// non-shareable origin).
function appendPuzzleShareButton(bannerEl, { entity, target, difficulty, filter }) {
  if (!target?.id) return;
  const url = buildPuzzleUrl(
    { entity, targetId: target.id, difficulty, filter: !!filter },
    typeof location === "undefined" ? null : location,
  );
  if (!url) return;
  // Localhost is fine for testing but the link won't be useful to anyone else
  // — still surface it so the dev path works; players on a public host will
  // get a sharable absolute URL.
  const btn = document.createElement("button");
  btn.className = "share-btn share-btn-puzzle";
  btn.type = "button";
  const idle = t("banner.share.puzzle");
  const copied = t("banner.share.puzzle.copied");
  btn.textContent = idle;
  btn.addEventListener("click", async () => {
    // For the puzzle URL we DO use the separate `url` field — chat apps
    // render link previews from it nicely. We deliberately skip `text` here:
    // the URL alone is the whole payload (Open Graph tags supply the
    // preview), and the clipboard fallback writes just the URL so it pastes
    // cleanly into any chat.
    const result = await sharePayload({
      title: t("app.title"),
      url,
    });
    if (result === "copied") {
      btn.textContent = copied;
      setTimeout(() => { btn.textContent = idle; }, 1500);
    } else if (result === "fallback") {
      // Surface the URL so the user can copy it manually.
      btn.textContent = url;
    }
  });
  bannerEl.appendChild(btn);
}

// Small "this is a custom puzzle, your stats aren't affected" note, shown
// above the share buttons so the player understands why their streak didn't
// move.
function appendCustomNote(bannerEl) {
  const p = document.createElement("p");
  p.className = "banner-custom-note";
  p.textContent = t("banner.custom.note");
  bannerEl.appendChild(p);
}

export function renderWinBanner(bannerEl, {
  mode, difficulty, entity = "group", guessCount, hintCount = 0,
  guesses = [], attrOrder = [],
  target, dateStr, suggestions = [], maxGuesses = null,
  filterMode = false,
}) {
  bannerEl.hidden = false;
  bannerEl.className = "banner is-win" + (mode === "custom" ? " is-custom" : "");
  bannerEl.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent = bannerTitle("win", entity, target);
  bannerEl.appendChild(title);

  const sub = document.createElement("p");
  sub.textContent = bannerSub({ mode, difficulty, guessCount, hintCount, maxGuesses, outcome: "win" });
  bannerEl.appendChild(sub);

  // Emoji grid (only when we have visible attrs to render). Renders before the
  // share button so a user reading top-to-bottom sees their result first.
  if (attrOrder.length && guesses.length) {
    const grid = document.createElement("pre");
    grid.className = "emoji-grid";
    grid.setAttribute("aria-label", "Guess summary grid");
    grid.textContent = emojiGridFor(guesses, attrOrder);
    bannerEl.appendChild(grid);
  }

  if (mode === "custom") appendCustomNote(bannerEl);

  // For custom puzzles we *don't* offer the wordle-style "Copy result" — there's
  // no shared puzzle for the recipient to compare against. Replace it with the
  // puzzle-link share button so friends can play the same target.
  if (mode === "custom") {
    appendPuzzleShareButton(bannerEl, { entity, target, difficulty, filter: filterMode });
  } else {
    const shareText = buildShareText({
      outcome: "win", mode, difficulty, dateStr, guessCount, maxGuesses, hintCount, guesses, attrOrder,
      playUrl: currentPlayUrl(),
    });
    appendShareButton(bannerEl, shareText);
    appendPuzzleShareButton(bannerEl, { entity, target, difficulty, filter: filterMode });
  }
  appendLearnMoreLink(bannerEl, entity, target);
  appendBannerCtas(bannerEl, suggestions);
}

// Variant for "you ran out of guesses" (daily) and "I give up" (endless /
// custom). Same shape as the win banner but with a red-tinged title and no
// celebratory copy. `mode` ∈ {"daily","endless","custom"} so the sub-text
// reads correctly in each case.
export function renderLossBanner(bannerEl, {
  mode = "daily", difficulty, entity = "group", guessCount, hintCount = 0,
  guesses = [], attrOrder = [],
  target, dateStr, suggestions = [], maxGuesses,
  filterMode = false,
}) {
  bannerEl.hidden = false;
  bannerEl.className = "banner is-loss" + (mode === "custom" ? " is-custom" : "");
  bannerEl.innerHTML = "";

  // Daily losses use "Out of guesses. It was X" because the player actually
  // hit the cap. Endless / custom give-up use the gentler "It was X" — they
  // chose to reveal, they didn't fail.
  const titleVariant = mode === "daily" ? "loss" : "giveup";
  const title = document.createElement("h2");
  title.textContent = bannerTitle(titleVariant, entity, target);
  bannerEl.appendChild(title);

  const sub = document.createElement("p");
  sub.textContent = bannerSub({ mode, difficulty, guessCount, hintCount, maxGuesses, outcome: "loss" });
  bannerEl.appendChild(sub);

  if (attrOrder.length && guesses.length) {
    const grid = document.createElement("pre");
    grid.className = "emoji-grid";
    grid.setAttribute("aria-label", "Guess summary grid");
    grid.textContent = emojiGridFor(guesses, attrOrder);
    bannerEl.appendChild(grid);
  }

  if (mode === "custom") appendCustomNote(bannerEl);

  if (mode === "custom") {
    // No wordle-style share for custom: there's no shared puzzle to compare
    // to. Just the puzzle-link button so the friend can play the same target.
    appendPuzzleShareButton(bannerEl, { entity, target, difficulty, filter: filterMode });
  } else {
    const shareText = buildShareText({
      outcome: "loss", mode, difficulty, dateStr, guessCount, maxGuesses, hintCount, guesses, attrOrder,
      playUrl: currentPlayUrl(),
    });
    appendShareButton(bannerEl, shareText);
    appendPuzzleShareButton(bannerEl, { entity, target, difficulty, filter: filterMode });
  }
  appendLearnMoreLink(bannerEl, entity, target);
  appendBannerCtas(bannerEl, suggestions);
}

export function hideWinBanner(bannerEl) {
  bannerEl.hidden = true;
  bannerEl.innerHTML = "";
}

// lines: [{ label, value, attr, isHint?, isNewlyKnown?, isEmpty? }]
// Panel always renders; empty entries get a muted placeholder so all attribute
// slots are visible from the start of a game.
export function renderClues(panelEl, lines) {
  panelEl.hidden = false;
  panelEl.innerHTML = "";

  const title = document.createElement("h2");
  title.className = "clues-title";
  title.textContent = t("clues.title");
  panelEl.appendChild(title);

  const list = document.createElement("div");
  list.className = "clues-list";
  for (const { label, value, isConfirmed, isHint, isNewlyKnown, isEmpty } of lines) {
    const item = document.createElement("div");
    const classes = ["clue-item"];
    if (isEmpty) classes.push("is-empty");
    if (isConfirmed) classes.push("is-confirmed");
    if (isHint) classes.push("is-hint");
    if (isNewlyKnown) classes.push("is-new");
    item.className = classes.join(" ");
    // Icon: hint reveals win, otherwise a confirmed check.
    if (isHint) {
      const star = document.createElement("span");
      star.className = "clue-icon";
      star.textContent = "✨";
      item.appendChild(star);
    } else if (isConfirmed) {
      const check = document.createElement("span");
      check.className = "clue-icon clue-icon-check";
      check.textContent = "✓";
      item.appendChild(check);
    }
    const lab = document.createElement("span");
    lab.className = "clue-label";
    lab.textContent = label;
    const val = document.createElement("span");
    val.className = "clue-value";
    val.textContent = isEmpty ? "—" : value;
    item.appendChild(lab);
    item.appendChild(val);
    list.appendChild(item);
  }
  panelEl.appendChild(list);
}

// Big celebratory overlay when a hint reveals a new fact. Auto-disposes.
export function flashHintReveal(label, value) {
  const root = document.body;
  const overlay = document.createElement("div");
  overlay.className = "hint-flash";
  overlay.innerHTML = `
    <div class="hint-flash-card">
      <div class="hint-flash-sparkles">
        <span>✦</span><span>✧</span><span>★</span><span>✦</span><span>✧</span>
      </div>
      <div class="hint-flash-label">${escapeHTML(label)}</div>
      <div class="hint-flash-value">${escapeHTML(String(value))}</div>
    </div>
  `;
  root.appendChild(overlay);
  // Trigger transition.
  requestAnimationFrame(() => overlay.classList.add("is-on"));
  setTimeout(() => {
    overlay.classList.add("is-out");
    setTimeout(() => overlay.remove(), 600);
  }, 1400);
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
