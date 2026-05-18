// Custom-puzzle URL helpers. Encodes a target + difficulty + detective-mode
// flag into a URL hash so a player can send a friend the exact puzzle they
// just played. Recipients open the link and play it as a one-off endless
// round — stats and streaks are not affected.
//
// Format (intentionally tiny so links survive copy-paste through chat):
//
//   #p=<entity>.<qid>.<difficulty>.<filter>
//      g.Q13580495.m.0
//      i.Q16236223.h.1
//
// Field count is the version: a parser that sees the wrong arity refuses to
// decode and the caller falls back to a normal round. To extend later, append
// new fields and update the parser to accept both arities.

const E_SHORT = { group: "g", idol: "i" };
const E_LONG = { g: "group", i: "idol" };
const D_SHORT = { easy: "e", medium: "m", hard: "h" };
const D_LONG = { e: "easy", m: "medium", h: "hard" };

// Encode a puzzle to the compact hash-fragment value. Returns null on any
// invalid input so the caller can decide what to show (we never silently
// substitute a wrong field).
export function encodePuzzle({ entity, targetId, difficulty, filter } = {}) {
  if (!E_SHORT[entity]) return null;
  if (!D_SHORT[difficulty]) return null;
  if (typeof targetId !== "string" || !/^Q\d+$/.test(targetId)) return null;
  const f = filter ? "1" : "0";
  return `${E_SHORT[entity]}.${targetId}.${D_SHORT[difficulty]}.${f}`;
}

// Decode a hash-fragment value. Returns null on any parse failure (caller
// silently falls back to normal play).
export function decodePuzzle(s) {
  if (typeof s !== "string") return null;
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const [e, qid, d, f] = parts;
  if (!E_LONG[e]) return null;
  if (!D_LONG[d]) return null;
  if (!/^Q\d+$/.test(qid)) return null;
  if (f !== "0" && f !== "1") return null;
  return {
    entity: E_LONG[e],
    targetId: qid,
    difficulty: D_LONG[d],
    filter: f === "1",
  };
}

// Read a "#p=..." parameter from the URL hash and return the decoded puzzle,
// or null if absent / invalid. Pure: doesn't mutate the URL — caller decides
// when to clear (typically after the round ends, see clearPuzzleFromHash).
export function readPuzzleFromHash(loc) {
  const hash = (loc?.hash || "").replace(/^#/, "");
  if (!hash) return null;
  let params;
  try { params = new URLSearchParams(hash); } catch { return null; }
  const p = params.get("p");
  if (!p) return null;
  return decodePuzzle(p);
}

// Build an absolute URL for the current site with `#p=<encoded>` appended.
// Returns null if the encoding fails. The caller (banner button) passes the
// result to navigator.clipboard.writeText.
export function buildPuzzleUrl(puzzle, loc) {
  const encoded = encodePuzzle(puzzle);
  if (!encoded) return null;
  if (!loc) return `#p=${encoded}`;
  const origin = loc.origin || "";
  const path = (loc.pathname || "/").replace(/index\.html$/i, "");
  return `${origin}${path}#p=${encoded}`;
}

// Remove a "#p=..." from the URL without triggering a reload, preserving any
// other hash params. Use after a custom round finishes so a "New round" click
// doesn't loop the player into the same friend-supplied puzzle.
export function clearPuzzleFromHash(loc, hist) {
  if (!loc || !hist) return;
  const hash = (loc.hash || "").replace(/^#/, "");
  if (!hash) return;
  let params;
  try { params = new URLSearchParams(hash); } catch { return; }
  if (!params.has("p")) return;
  params.delete("p");
  const rest = params.toString();
  const newHash = rest ? `#${rest}` : "";
  hist.replaceState(null, "", `${loc.pathname}${loc.search}${newHash}`);
}
