import { VISIBLE_ATTRS, ATTR_LABEL } from "./config.js";
import { emojiGridFor, wikipediaUrlFor, answerLabel, hintTag, buildShareText, currentPlayUrl } from "./share.js";

const ARROW = { up: "▲", down: "▼" };

function fmtValue(attr, value, entity) {
  if (value === null || value === undefined || value === "") return "—";
  if (attr === "member_count") return String(value);
  if (attr === "debut_year") return String(value);
  if (attr === "birth_year") return String(value);
  if (attr === "generation") return `Gen ${value}`;
  if (attr === "gender") {
    if (entity === "idol") {
      return { boy: "Male", girl: "Female", coed: "—" }[value] ?? value;
    }
    return { boy: "Boy group", girl: "Girl group", coed: "Co-ed" }[value] ?? value;
  }
  if (attr === "status") return value === "active" ? "Active" : "Disbanded";
  if (attr === "country") return value;
  if (attr === "nationality") return value;
  if (attr === "primary_group") return value;
  return String(value);
}

export function renderHeader(headerEl, entity, difficulty) {
  headerEl.innerHTML = "";
  const nameCol = document.createElement("div");
  nameCol.className = "col col-name";
  nameCol.textContent = entity === "idol" ? "Idol" : "Group";
  headerEl.appendChild(nameCol);
  for (const attr of VISIBLE_ATTRS[entity][difficulty]) {
    const col = document.createElement("div");
    col.className = `col col-${attr}`;
    col.textContent = ATTR_LABEL[attr] || attr;
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
export function burstConfetti({ count = 90, origin = null, durations = [2.2, 3.4] } = {}) {
  const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return;

  const palette = ["#ff5fa2", "#ff9a4e", "#ffd76b", "#6f88ff", "#5ce0d8", "#c08fff"];
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
    piece.style.background = isEmoji ? "transparent" : palette[Math.floor(Math.random() * palette.length)];
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

function appendBannerCtas(bannerEl, suggestions) {
  if (!suggestions.length) return;
  const ctaWrap = document.createElement("div");
  ctaWrap.className = "banner-ctas";

  const ctaHeading = document.createElement("p");
  ctaHeading.className = "banner-ctas-heading";
  ctaHeading.textContent = "What's next?";
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
  const label = entity === "idol" && target?.primary_group ? `Learn more about ${target.primary_group} on Wikipedia` : `Learn more about ${target?.name ?? "this"} on Wikipedia`;
  const a = document.createElement("a");
  a.className = "learn-more-link";
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label + " →";
  bannerEl.appendChild(a);
}

function appendShareButton(bannerEl, shareText) {
  const shareBtn = document.createElement("button");
  shareBtn.className = "share-btn";
  shareBtn.type = "button";
  shareBtn.textContent = "Copy result";
  shareBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      shareBtn.textContent = "Copied!";
      setTimeout(() => { shareBtn.textContent = "Copy result"; }, 1500);
    } catch {
      shareBtn.textContent = shareText;
    }
  });
  bannerEl.appendChild(shareBtn);
}

export function renderWinBanner(bannerEl, {
  mode, difficulty, entity = "group", guessCount, hintCount = 0,
  guesses = [], attrOrder = [],
  target, dateStr, suggestions = [], maxGuesses = null,
}) {
  bannerEl.hidden = false;
  bannerEl.className = "banner is-win";
  bannerEl.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent = `Got it! It was ${answerLabel(entity, target)}.`;
  bannerEl.appendChild(title);

  const sub = document.createElement("p");
  const denom = mode === "daily" && maxGuesses ? `/${maxGuesses}` : "";
  // When a denominator is shown ("1/6"), always pluralize — "1/6 guesses"
  // reads more naturally than "1/6 guess".
  const noun = denom || guessCount !== 1 ? "guesses" : "guess";
  sub.textContent = `${guessCount}${denom} ${noun}${hintTag(hintCount)} on ${mode} ${difficulty}.`;
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

  const shareText = buildShareText({
    outcome: "win", mode, difficulty, dateStr, guessCount, maxGuesses, hintCount, guesses, attrOrder,
    playUrl: currentPlayUrl(),
  });
  appendShareButton(bannerEl, shareText);
  appendLearnMoreLink(bannerEl, entity, target);
  appendBannerCtas(bannerEl, suggestions);
}

// Variant for "you ran out of guesses". Same shape as the win banner but with
// a red-tinged "out of guesses" message and no celebratory copy. Daily-only.
export function renderLossBanner(bannerEl, {
  difficulty, entity = "group", guessCount, hintCount = 0,
  guesses = [], attrOrder = [],
  target, dateStr, suggestions = [], maxGuesses,
}) {
  bannerEl.hidden = false;
  bannerEl.className = "banner is-loss";
  bannerEl.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent = `Out of guesses. It was ${answerLabel(entity, target)}.`;
  bannerEl.appendChild(title);

  const sub = document.createElement("p");
  sub.textContent = `${guessCount}/${maxGuesses}${hintTag(hintCount)} on daily ${difficulty}.`;
  bannerEl.appendChild(sub);

  if (attrOrder.length && guesses.length) {
    const grid = document.createElement("pre");
    grid.className = "emoji-grid";
    grid.setAttribute("aria-label", "Guess summary grid");
    grid.textContent = emojiGridFor(guesses, attrOrder);
    bannerEl.appendChild(grid);
  }

  const shareText = buildShareText({
    outcome: "loss", mode: "daily", difficulty, dateStr, guessCount, maxGuesses, hintCount, guesses, attrOrder,
    playUrl: currentPlayUrl(),
  });
  appendShareButton(bannerEl, shareText);
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
  title.textContent = "Known so far";
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
