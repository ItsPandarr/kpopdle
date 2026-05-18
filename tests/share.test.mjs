import { strict as assert } from "node:assert";
import { emojiGridFor, wikipediaUrlFor, answerLabel, hintTag, buildShareText, currentPlayUrl, repoUrlFor, correctionIssueUrl } from "../js/share.js";

// ─── emojiGridFor ──────────────────────────────────────────────────────────────

// One row per guess, one emoji per visible attribute, in the given order.
{
  const guesses = [
    {
      comparison: {
        debut_year: { status: "higher" },
        company:    { status: "none" },
        gender:     { status: "exact" },
      },
    },
    {
      comparison: {
        debut_year: { status: "exact" },
        company:    { status: "partial" },
        gender:     { status: "exact" },
      },
    },
  ];
  const grid = emojiGridFor(guesses, ["debut_year", "company", "gender"]);
  assert.equal(grid, "\u{1F53A}\u{1F7E5}\u{1F7E9}\n\u{1F7E9}\u{1F7E8}\u{1F7E9}");
}

// Unknown / missing status falls back to the black-square sentinel rather than
// emitting "undefined" into the grid.
{
  const guesses = [
    { comparison: { gender: { status: "exact" }, /* debut_year missing */ } },
  ];
  const grid = emojiGridFor(guesses, ["debut_year", "gender"]);
  assert.equal(grid, "\u{2B1B}\u{1F7E9}", "missing status → fallback");
}

// Empty guesses → empty string (no trailing newline).
assert.equal(emojiGridFor([], ["x"]), "");

// Defensive: null comparison object shouldn't crash.
{
  const grid = emojiGridFor([{ comparison: null }], ["x"]);
  assert.equal(grid, "\u{2B1B}");
}

// Row order preserves attrOrder, not the keys' iteration order on the
// comparison object.
{
  const guesses = [{ comparison: {
    a: { status: "exact" }, b: { status: "none" }, c: { status: "partial" },
  } }];
  assert.equal(emojiGridFor(guesses, ["c", "a", "b"]), "\u{1F7E8}\u{1F7E9}\u{1F7E5}");
}

// ─── wikipediaUrlFor ───────────────────────────────────────────────────────────

// Groups: routed via Wikidata's Special:GoToLinkedPage so the QID resolves to
// whatever Wikipedia title the article actually lives at (avoids the "IVE →
// disambig" / "Speed → physics" footguns of guessing titles from names).
assert.equal(
  wikipediaUrlFor("group", { id: "Q13580495", name: "BTS" }),
  "https://www.wikidata.org/wiki/Special:GoToLinkedPage?site=enwiki&itemid=Q13580495",
);
assert.equal(
  wikipediaUrlFor("group", { id: "Q109571132", name: "IVE" }),
  "https://www.wikidata.org/wiki/Special:GoToLinkedPage?site=enwiki&itemid=Q109571132",
  "uses the QID, not the disambig-prone name",
);

// Idols always link to their primary group's QID, not the idol's own.
assert.equal(
  wikipediaUrlFor("idol", { id: "Q20947093", name: "Jimin", primary_group_id: "Q13580495", primary_group: "BTS" }),
  "https://www.wikidata.org/wiki/Special:GoToLinkedPage?site=enwiki&itemid=Q13580495",
);

// No link when QID is missing.
assert.equal(wikipediaUrlFor("group", { name: "Mystery" /* no id */ }), null);
assert.equal(wikipediaUrlFor("idol", { name: "Solo Artist" /* no primary_group_id */ }), null);
assert.equal(wikipediaUrlFor("idol", null), null);

// ─── answerLabel ───────────────────────────────────────────────────────────────

assert.equal(answerLabel("group", { name: "BTS" }), "BTS");
assert.equal(
  answerLabel("idol", { name: "Jimin", primary_group: "BTS" }),
  "Jimin of BTS",
);
// Idol with no group falls back to bare name.
assert.equal(answerLabel("idol", { name: "Solo Artist" }), "Solo Artist");
// Missing target.
assert.equal(answerLabel("group", null), "?");
assert.equal(answerLabel("group", {}), "?");
assert.equal(answerLabel("idol", { primary_group: "BTS" /* no name */ }), "?");

// ─── hintTag ───────────────────────────────────────────────────────────────────

assert.equal(hintTag(0), "");
assert.equal(hintTag(1), " (1 hint)");
assert.equal(hintTag(2), " (2 hints)");
assert.equal(hintTag(null), "", "null guard");
assert.equal(hintTag(undefined), "", "undefined guard");

// ─── buildShareText ────────────────────────────────────────────────────────────

// Daily win, no hints, no grid → simplest case.
assert.equal(
  buildShareText({ outcome: "win", mode: "daily", difficulty: "easy", dateStr: "2026-05-18", guessCount: 2, maxGuesses: 6 }),
  "KPopdle Daily 2026-05-18 [easy] 2/6 \u{1F389}",
);

// Daily win with hint count → "(2 hints)" tag included.
assert.equal(
  buildShareText({ outcome: "win", mode: "daily", difficulty: "hard", dateStr: "2026-05-18", guessCount: 5, maxGuesses: 10, hintCount: 2 }),
  "KPopdle Daily 2026-05-18 [hard] 5/10 (2 hints) \u{1F389}",
);

// Daily loss → "X/N" prefix, no celebratory emoji, optional hint tag.
assert.equal(
  buildShareText({ outcome: "loss", mode: "daily", difficulty: "easy", dateStr: "2026-05-18", guessCount: 6, maxGuesses: 6, hintCount: 1 }),
  "KPopdle Daily 2026-05-18 [easy] X/6 (1 hint)",
);

// Endless win → no denominator, raw guess count, plural noun handled.
assert.equal(
  buildShareText({ outcome: "win", mode: "endless", difficulty: "medium", guessCount: 1 }),
  "KPopdle Endless [medium] 1 guess \u{1F389}",
);
assert.equal(
  buildShareText({ outcome: "win", mode: "endless", difficulty: "medium", guessCount: 7, hintCount: 1 }),
  "KPopdle Endless [medium] 7 guesses (1 hint) \u{1F389}",
);

// Grid appended on its own line when guesses + attrOrder are provided.
{
  const guesses = [
    { comparison: { debut_year: { status: "higher" }, gender: { status: "exact" } } },
  ];
  const text = buildShareText({
    outcome: "win", mode: "daily", difficulty: "easy", dateStr: "2026-05-18",
    guessCount: 1, maxGuesses: 6, guesses, attrOrder: ["debut_year", "gender"],
  });
  assert.ok(text.includes("\n\u{1F53A}\u{1F7E9}"), "grid follows the header on a new line");
}

// Play URL: appended on its own line when supplied; omitted otherwise.
{
  const base = { outcome: "win", mode: "daily", difficulty: "easy", dateStr: "2026-05-18", guessCount: 1, maxGuesses: 6 };
  const without = buildShareText(base);
  const withUrl = buildShareText({ ...base, playUrl: "https://example.com/kpopdle/" });
  assert.ok(!without.includes("Play:"), "no Play: line when playUrl is null");
  assert.ok(withUrl.endsWith("\nPlay: https://example.com/kpopdle/"), "Play: line trails the header");
}

// Play URL combines with grid as final line.
{
  const guesses = [{ comparison: { gender: { status: "exact" } } }];
  const text = buildShareText({
    outcome: "win", mode: "endless", difficulty: "hard", guessCount: 4,
    guesses, attrOrder: ["gender"], playUrl: "https://example.com/",
  });
  const lines = text.split("\n");
  assert.equal(lines.length, 3, "header + grid + play line");
  assert.equal(lines[2], "Play: https://example.com/");
}

// ─── currentPlayUrl ────────────────────────────────────────────────────────────

// Localhost / dev hosts → null (no leaked "Play: localhost" in clipboard).
for (const host of ["localhost", "127.0.0.1", "myproject.local"]) {
  assert.equal(
    currentPlayUrl({ hostname: host, origin: `http://${host}:8123`, pathname: "/" }),
    null,
    `dev host ${host} should not produce a play URL`,
  );
}

// Real host → origin + pathname.
assert.equal(
  currentPlayUrl({ hostname: "example.github.io", origin: "https://example.github.io", pathname: "/kpopdle/" }),
  "https://example.github.io/kpopdle/",
);

// Strips a trailing index.html so the URL stays clean.
assert.equal(
  currentPlayUrl({ hostname: "example.com", origin: "https://example.com", pathname: "/sub/index.html" }),
  "https://example.com/sub/",
);

// Missing location object → null (defensive for non-browser environments).
assert.equal(currentPlayUrl(null), null);

// ─── repoUrlFor ────────────────────────────────────────────────────────────────

// Explicit override always wins; trailing slashes stripped.
assert.equal(
  repoUrlFor({ hostname: "example.com", pathname: "/" }, "https://github.com/x/y/"),
  "https://github.com/x/y",
);

// Project page: user.github.io/repo/ → github.com/user/repo
assert.equal(
  repoUrlFor({ hostname: "someone.github.io", pathname: "/kpopdle/" }),
  "https://github.com/someone/kpopdle",
);

// User page: user.github.io (no project segment) → github.com/user/user.github.io
assert.equal(
  repoUrlFor({ hostname: "someone.github.io", pathname: "/" }),
  "https://github.com/someone/someone.github.io",
);

// Non-github host without an override → null (footer link stays hidden).
assert.equal(repoUrlFor({ hostname: "localhost", pathname: "/" }), null);
assert.equal(repoUrlFor({ hostname: "example.com", pathname: "/" }), null);

// Missing location → null.
assert.equal(repoUrlFor(null), null);

// ─── correctionIssueUrl ────────────────────────────────────────────────────────

// No repo → null.
assert.equal(correctionIssueUrl(null), null);

// Builds a /issues/new URL with title + body + labels params.
{
  const url = correctionIssueUrl("https://github.com/someone/kpopdle");
  assert.ok(url.startsWith("https://github.com/someone/kpopdle/issues/new?"));
  const u = new URL(url);
  assert.equal(u.searchParams.get("title"), "Data correction: ");
  assert.equal(u.searchParams.get("labels"), "data");
  const body = u.searchParams.get("body");
  assert.ok(body.includes("**Field:**"));
  assert.ok(body.includes("**Source:**"));
}

// Context fields land in the body where provided.
{
  const url = correctionIssueUrl("https://github.com/someone/kpopdle", {
    entity: "group",
    name: "BTS",
    field: "company",
    currentValue: "Big Hit Music",
    source: "https://en.wikipedia.org/wiki/BTS",
  });
  const body = new URL(url).searchParams.get("body");
  assert.ok(body.includes("**Entity:** Group"));
  assert.ok(body.includes("**Name:** BTS"));
  assert.ok(body.includes("**Field:** company"));
  assert.ok(body.includes("**Current value (what the app shows):** Big Hit Music"));
  assert.ok(body.includes("https://en.wikipedia.org/wiki/BTS"));
}

console.log("share.test ok");
