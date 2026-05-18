// Hint logic. Pure.
//
// Cost model:
//   - First hint click costs 4 tries.
//   - Each guess made (since the previous "event": game start or last hint) reduces the
//     cost by 1, floored at 1 (so a hint is never free — it always costs the player
//     at least one).
//   - After the first click, the base cost drops to 2 and the same decay applies between
//     subsequent clicks.
//
// Selection model:
//   - At game start, sort visible attributes by uniqueness within the current pool
//     (least unique → most unique). The first hint reveals the attribute that
//     narrows the candidate set the least; the last hint reveals the most narrowing
//     one. This is computed per (entity, difficulty) — group and idol modes
//     naturally produce different orderings because their attribute sets differ.
//     The chosen order is persisted so reload keeps the same sequence.
//   - Each click reveals the next attribute in that order that:
//       1) is still visible at the current difficulty,
//       2) hasn't been revealed by a prior hint,
//       3) isn't already "known" from guess feedback, and
//       4) has a non-null value on the target.

export const FIRST_HINT_COST = 4;
export const SUBSEQUENT_HINT_COST = 2;

// Fisher–Yates with an injectable RNG so tests are deterministic. Retained as
// a generic utility — hint ordering itself uses `attrsByUniqueness` below.
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Order the given attributes by how many distinct values they take across the
// given pool, ascending. Treats null/undefined/empty-string as "no value" and
// excludes them from the count. Stable on ties (preserves input order), so
// callers can use the original visibleAttrs sequence as a tiebreaker.
//
// Used by main.js to build state.hintOrder at game start: first hint reveals
// the lowest-information attribute (e.g. `country` in the Group pool, which is
// usually just "KR"), last hint reveals the highest (e.g. `company`).
export function attrsByUniqueness(pool, visibleAttrs) {
  const ranked = visibleAttrs.map((attr) => {
    const seen = new Set();
    for (const e of pool) {
      const v = e?.[attr];
      if (v != null && v !== "") seen.add(v);
    }
    return { attr, count: seen.size };
  });
  ranked.sort((a, b) => a.count - b.count);
  return ranked.map((r) => r.attr);
}

export function nextHintCost(events, guessCount) {
  const isFirst = events.length === 0;
  const base = isFirst ? FIRST_HINT_COST : SUBSEQUENT_HINT_COST;
  const lastIdx = isFirst ? 0 : events[events.length - 1].guessIdxAtClick;
  const guessesSince = Math.max(0, guessCount - lastIdx);
  return Math.max(1, base - guessesSince);
}

export function totalHintPenalty(events) {
  return events.reduce((s, e) => s + (e.cost || 0), 0);
}

// True when the player's existing guesses pin this attribute's exact value.
export function attrIsKnown(attr, clues) {
  switch (attr) {
    case "debut_year":
    case "generation":
    case "member_count":
    case "birth_year": {
      const info = clues[attr];
      return Boolean(info && info.known != null);
    }
    case "company":
      return clues.company?.known != null;
    case "gender":
      return clues.gender?.known != null;
    case "status":
      return clues.status?.known != null;
    case "country":
      return clues.country?.known != null;
    case "nationality":
      return clues.nationality?.known != null;
    case "primary_group":
      return clues.primary_group?.knownGroup != null;
    default:
      return false;
  }
}

export function nextHintAttr({ order, events, clues, visibleAttrs, target }) {
  if (!target) return null;
  const revealed = new Set(events.map((e) => e.attr));
  for (const attr of order) {
    if (!visibleAttrs.includes(attr)) continue;
    if (revealed.has(attr)) continue;
    if (attrIsKnown(attr, clues)) continue;
    const value = hintValueFor(attr, target);
    if (value === null || value === undefined || value === "") continue;
    return attr;
  }
  return null;
}

// The value of `attr` we display when revealing it. For most attrs this is just `target[attr]`;
// `primary_group` returns the group's name rather than its ID.
export function hintValueFor(attr, target) {
  if (attr === "primary_group") return target.primary_group ?? null;
  return target[attr] ?? null;
}
