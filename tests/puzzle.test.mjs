import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodePuzzle,
  decodePuzzle,
  readPuzzleFromHash,
  buildPuzzleUrl,
  clearPuzzleFromHash,
} from "../js/puzzle.js";

test("encodePuzzle: builds compact tokens", () => {
  assert.equal(
    encodePuzzle({ entity: "group", targetId: "Q13580495", difficulty: "medium", filter: false }),
    "g.Q13580495.m.0",
  );
  assert.equal(
    encodePuzzle({ entity: "idol", targetId: "Q16236223", difficulty: "hard", filter: true }),
    "i.Q16236223.h.1",
  );
});

test("encodePuzzle: rejects invalid inputs", () => {
  assert.equal(encodePuzzle({ entity: "bogus", targetId: "Q1", difficulty: "easy" }), null);
  assert.equal(encodePuzzle({ entity: "group", targetId: "not-a-qid", difficulty: "easy" }), null);
  assert.equal(encodePuzzle({ entity: "group", targetId: "Q1", difficulty: "extreme" }), null);
  assert.equal(encodePuzzle({}), null);
  assert.equal(encodePuzzle(), null);
});

test("decodePuzzle: parses valid tokens roundtrip", () => {
  const cases = [
    { entity: "group", targetId: "Q13580495", difficulty: "easy",   filter: false },
    { entity: "group", targetId: "Q99479445", difficulty: "medium", filter: true  },
    { entity: "idol",  targetId: "Q16236223", difficulty: "hard",   filter: false },
  ];
  for (const c of cases) {
    const enc = encodePuzzle(c);
    assert.deepEqual(decodePuzzle(enc), c);
  }
});

test("decodePuzzle: rejects malformed tokens", () => {
  assert.equal(decodePuzzle(""), null);
  assert.equal(decodePuzzle("g.Q1.m"), null);            // too few fields
  assert.equal(decodePuzzle("g.Q1.m.0.x"), null);        // too many
  assert.equal(decodePuzzle("x.Q1.m.0"), null);          // bad entity
  assert.equal(decodePuzzle("g.notaqid.m.0"), null);     // bad qid
  assert.equal(decodePuzzle("g.Q1.z.0"), null);          // bad difficulty
  assert.equal(decodePuzzle("g.Q1.m.2"), null);          // bad filter
  assert.equal(decodePuzzle(null), null);
  assert.equal(decodePuzzle(42), null);
});

test("readPuzzleFromHash: parses ?p= from hash", () => {
  const loc = { hash: "#p=g.Q13580495.m.0" };
  assert.deepEqual(readPuzzleFromHash(loc), {
    entity: "group", targetId: "Q13580495", difficulty: "medium", filter: false,
  });
});

test("readPuzzleFromHash: ignores other hash params and missing", () => {
  assert.equal(readPuzzleFromHash({ hash: "" }), null);
  assert.equal(readPuzzleFromHash({ hash: "#foo=bar" }), null);
  assert.deepEqual(
    readPuzzleFromHash({ hash: "#foo=bar&p=i.Q16236223.h.1" }),
    { entity: "idol", targetId: "Q16236223", difficulty: "hard", filter: true },
  );
});

test("readPuzzleFromHash: malformed value returns null without throwing", () => {
  assert.equal(readPuzzleFromHash({ hash: "#p=garbage" }), null);
});

test("buildPuzzleUrl: composes origin + path + hash", () => {
  const url = buildPuzzleUrl(
    { entity: "group", targetId: "Q13580495", difficulty: "easy", filter: false },
    { origin: "https://kpopdle.example", pathname: "/" },
  );
  assert.equal(url, "https://kpopdle.example/#p=g.Q13580495.e.0");
});

test("buildPuzzleUrl: strips trailing index.html", () => {
  const url = buildPuzzleUrl(
    { entity: "idol", targetId: "Q16236223", difficulty: "hard", filter: true },
    { origin: "https://example.com", pathname: "/kpopdle/index.html" },
  );
  assert.equal(url, "https://example.com/kpopdle/#p=i.Q16236223.h.1");
});

test("buildPuzzleUrl: returns null for invalid puzzle, hash-only fallback otherwise", () => {
  assert.equal(buildPuzzleUrl({ entity: "bogus" }, { origin: "", pathname: "/" }), null);
  // No `loc` supplied → returns a hash-only URL so callers in odd environments
  // (worker, SSR, tests) still get something usable.
  assert.equal(
    buildPuzzleUrl({ entity: "group", targetId: "Q1", difficulty: "easy", filter: false }),
    "#p=g.Q1.e.0",
  );
});

test("clearPuzzleFromHash: removes p but keeps other params", () => {
  const calls = [];
  const hist = { replaceState: (_s, _t, url) => calls.push(url) };
  clearPuzzleFromHash(
    { hash: "#p=g.Q1.e.0&foo=bar", pathname: "/play", search: "" },
    hist,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "/play#foo=bar");
});

test("clearPuzzleFromHash: removes only p, leaves clean URL when sole param", () => {
  const calls = [];
  const hist = { replaceState: (_s, _t, url) => calls.push(url) };
  clearPuzzleFromHash(
    { hash: "#p=g.Q1.e.0", pathname: "/play", search: "?ref=x" },
    hist,
  );
  assert.equal(calls[0], "/play?ref=x");
});

test("clearPuzzleFromHash: no-op when no p", () => {
  const calls = [];
  const hist = { replaceState: (_s, _t, url) => calls.push(url) };
  clearPuzzleFromHash({ hash: "#foo=bar", pathname: "/", search: "" }, hist);
  assert.equal(calls.length, 0);
});
