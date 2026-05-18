// Pure helpers used by the win/loss banner. Live in their own module so they
// can be unit-tested without DOM mocking (render.js depends on document.*).

// Map a comparison cell status to its share-text emoji. Keeps the colorblind
// player's local palette out of the share text — the receiver sees the
// platform's native render.
const STATUS_EMOJI = {
  exact: "\u{1F7E9}",   // 🟩
  partial: "\u{1F7E8}", // 🟨
  higher: "\u{1F53A}",  // 🔺
  lower:  "\u{1F53B}",  // 🔻
  none:   "\u{1F7E5}",  // 🟥
};
const UNKNOWN_EMOJI = "\u{2B1B}"; // ⬛ — fallback for missing/unknown status

// Build a Wordle-style emoji grid from the guess list. Each row = one guess,
// one emoji per visible attribute column in the same left-to-right order the
// player saw. `attrOrder` = the visible attrs for the current entity/difficulty.
export function emojiGridFor(guesses, attrOrder) {
  const lines = [];
  for (const { comparison } of guesses) {
    const row = attrOrder
      .map((a) => STATUS_EMOJI[comparison?.[a]?.status] ?? UNKNOWN_EMOJI)
      .join("");
    lines.push(row);
  }
  return lines.join("\n");
}

// Construct a Wikipedia link for the "Learn more" post-game link.
//
// We have Wikidata QIDs for every entity, so instead of guessing a title
// (which is wrong for groups whose enwiki article lives at a disambiguated
// title — e.g. "IVE" → "Ive (group)", "Speed" → "Speed (South Korean band)"),
// we route through Wikidata's `Special:GoToLinkedPage`. That endpoint takes a
// QID + sitelink and 302-redirects to whatever Wikipedia title the language
// edition has linked to that Wikidata item. The user sees the real article
// URL after the redirect; no extra hops are visible after the click lands.
//
// For idols we link to their primary group (most idols don't have their own
// Wikipedia article). Returns null when no QID is available — caller omits
// the link.
export function wikipediaUrlFor(entity, target) {
  const qid = entity === "idol" ? target?.primary_group_id : target?.id;
  if (!qid) return null;
  return `https://www.wikidata.org/wiki/Special:GoToLinkedPage?site=enwiki&itemid=${encodeURIComponent(qid)}`;
}

// Render the answer name as "Jimin of BTS" for idols (using their primary
// group) and just "BTS" for groups. Returns "?" if the target is missing.
export function answerLabel(entity, target) {
  if (!target?.name) return "?";
  if (entity === "idol" && target.primary_group) {
    return `${target.name} of ${target.primary_group}`;
  }
  return target.name;
}

// "(2 hints)" / "(1 hint)" / "" — used in both the banner sub-text and the
// copy-paste share text so the numbers match.
export function hintTag(hintCount) {
  if (!hintCount) return "";
  return ` (${hintCount} hint${hintCount === 1 ? "" : "s"})`;
}

// Build the Wordle-style share text. Single source of truth so the banner
// preview and the clipboard copy stay aligned. `outcome` controls the trailing
// emoji / "X" marker:
//   - "win"  → "🎉"
//   - "loss" → uses "X/N" instead of the numeric "n/N", no celebratory emoji
// `mode` ∈ {"daily","endless"}.
// `playUrl` (optional) appends a "Play: <url>" line so recipients can find the
// site without already knowing it.
export function buildShareText({
  outcome,
  mode,
  difficulty,
  dateStr,
  guessCount,
  maxGuesses = null,
  hintCount = 0,
  guesses = [],
  attrOrder = [],
  playUrl = null,
}) {
  const grid = attrOrder.length && guesses.length ? emojiGridFor(guesses, attrOrder) : "";
  const denom = maxGuesses ? `/${maxGuesses}` : "";
  const tag = hintTag(hintCount);

  let header;
  if (mode === "daily") {
    const num = outcome === "loss" ? `X${denom}` : `${guessCount}${denom}`;
    header = `KPopdle Daily ${dateStr} [${difficulty}] ${num}${tag}`;
  } else {
    const noun = guessCount === 1 ? "guess" : "guesses";
    header = `KPopdle Endless [${difficulty}] ${guessCount} ${noun}${tag}`;
  }
  if (outcome === "win") header += " \u{1F389}";

  const parts = [header];
  if (grid) parts.push(grid);
  if (playUrl) parts.push(`Play: ${playUrl}`);
  return parts.join("\n");
}

// Best-guess play URL for the currently-loaded site. Returns null when running
// on localhost / 127.0.0.1 / *.local so dev sessions don't leak "Play:
// http://localhost:8123/" into the clipboard. Caller passes the result to
// buildShareText's `playUrl`.
export function currentPlayUrl(loc = typeof location === "undefined" ? null : location) {
  if (!loc) return null;
  const host = (loc.hostname || "").toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return null;
  // Strip a trailing "index.html" so the URL stays clean.
  const path = (loc.pathname || "/").replace(/index\.html$/i, "");
  return `${loc.origin}${path}`;
}
