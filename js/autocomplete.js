// Autocomplete input. Searches the current difficulty's pool only.
//
// Match priority: name startsWith → alias startsWith → name/alias substring.
// Capped at MAX_SUGGESTIONS.
// Emits a "commit" CustomEvent on the input element with detail = { group }.

const MAX_SUGGESTIONS = 8;

// Normalize a name/alias/query into a form where superficial differences
// don't block a match. Specifically:
//
//   - NFKD-then-strip-then-NFC pulls combining marks off Latin diacritics
//     while leaving Hangul precomposed (jamo recompose under NFC), so
//     "Beyoncé" and "beyonce" hash the same and Hangul stays intact.
//   - Whitespace is removed entirely, so "Black Pink" matches "blackpink"
//     and the Hangul alias "블랙 핑크" (with the unhelpful space we got
//     from Wikidata) matches a user typing "블랙핑크" without one.
//   - Lowercased for ASCII case-insensitivity.
//
// Exported for unit tests.
export function normalize(s) {
  return (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")  // strip combining marks (accents)
    .normalize("NFC")                 // recompose Hangul syllables
    .toLowerCase()
    .replace(/\s+/g, "");
}

function rank(group, q) {
  const name = normalize(group.name);
  if (name.startsWith(q)) return 0;
  for (const a of group.aliases || []) {
    if (normalize(a).startsWith(q)) return 1;
  }
  if (name.includes(q)) return 2;
  for (const a of group.aliases || []) {
    if (normalize(a).includes(q)) return 3;
  }
  return -1;
}

// Exported so tests can drive matching with a controlled pool. (The DOM-bound
// attachAutocomplete wraps this with input/dropdown plumbing.)
export function findMatches(pool, query) {
  const q = normalize(query);
  if (!q) return [];
  const scored = [];
  for (const g of pool) {
    const r = rank(g, q);
    if (r >= 0) scored.push([r, g]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, MAX_SUGGESTIONS).map(([, g]) => g);
}

// Levenshtein edit distance with early termination. Iterates by code-point
// (Array.from), so multi-byte sequences like Hangul syllables count as one
// unit — typing "방탕" vs "방탄" reads as a single substitution.
function levenshtein(a, b, max = Infinity) {
  const A = Array.from(a);
  const B = Array.from(b);
  if (!A.length) return B.length;
  if (!B.length) return A.length;
  if (Math.abs(A.length - B.length) > max) return max + 1;
  let prev = new Array(B.length + 1);
  let curr = new Array(B.length + 1);
  for (let j = 0; j <= B.length; j++) prev[j] = j;
  for (let i = 1; i <= A.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;  // every cell exceeds max → bail
    [prev, curr] = [curr, prev];
  }
  return prev[B.length];
}

// Fuzzy fallback for when findMatches() returns nothing. Surfaces names /
// aliases within `maxDistance` edits of the query, ranked by closeness then
// name. Only used by the dropdown's "Did you mean…?" path; we deliberately
// skip very short queries (< minQuery chars) because edit distance on 1-2
// chars is just noise.
//
// Exported for tests.
export function findFuzzyMatches(pool, query, opts = {}) {
  const { maxDistance = 2, max = 3, minQuery = 3 } = opts;
  const q = normalize(query);
  if (q.length < minQuery) return [];
  const ranked = [];
  for (const g of pool) {
    const candidates = [g.name, ...(g.aliases || [])];
    let best = Infinity;
    for (const c of candidates) {
      const n = normalize(c);
      // Skip if normal substring would have caught it — findMatches handles those.
      if (n.includes(q)) { best = -1; break; }
      const d = levenshtein(q, n, maxDistance);
      if (d < best) best = d;
    }
    if (best > 0 && best <= maxDistance) {
      ranked.push([best, g]);
    }
  }
  ranked.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return ranked.slice(0, max).map(([, g]) => g);
}

function whichAlias(group, query) {
  const q = normalize(query);
  if (normalize(group.name).includes(q)) return null;
  return (group.aliases || []).find((a) => normalize(a).includes(q)) || null;
}

// `getReason(group) → string|null` (optional) lets the caller tag matches as
// invalid: a non-null reason renders the row in a dimmed, non-clickable state
// with the reason text inline. Used by Detective mode in main.js.
export function attachAutocomplete({ input, dropdown, getPool, onCommit, getReason, didYouMeanLabel }) {
  let suggestions = [];
  let isFuzzy = false;   // true when `suggestions` came from the "Did you mean…?" fallback
  let highlighted = -1;
  let guessedIds = new Set();

  function reasonFor(g) {
    return typeof getReason === "function" ? getReason(g) : null;
  }

  function firstValidIndex() {
    for (let i = 0; i < suggestions.length; i++) {
      if (!reasonFor(suggestions[i])) return i;
    }
    return -1;
  }

  function render() {
    dropdown.innerHTML = "";
    // "Did you mean…?" header — only when the suggestions list came from
    // the fuzzy fallback. Non-interactive (aria-disabled), not in the
    // arrow-key cycle, just a visual hint above the suggestions.
    if (isFuzzy && suggestions.length > 0 && didYouMeanLabel) {
      const hdr = document.createElement("li");
      hdr.className = "autocomplete-didyoumean";
      hdr.setAttribute("aria-disabled", "true");
      hdr.textContent = didYouMeanLabel;
      dropdown.appendChild(hdr);
    }
    suggestions.forEach((g, i) => {
      const reason = reasonFor(g);
      const li = document.createElement("li");
      const classes = ["autocomplete-item"];
      if (i === highlighted) classes.push("is-highlighted");
      if (reason) classes.push("is-invalid");
      li.className = classes.join(" ");
      li.dataset.id = g.id;
      if (reason) {
        li.setAttribute("aria-disabled", "true");
        li.title = reason;
      }

      const nameEl = document.createElement("span");
      nameEl.className = "ac-name";
      nameEl.textContent = g.name;
      li.appendChild(nameEl);

      // Idols only: 20 stage names in the dataset are shared by 2-3 different
      // people (e.g. three "Nana"s, two "Soobin"s — TXT *and* WJSN). Show the
      // primary group inline so the dropdown row is unambiguous before the
      // player commits. Groups don't have this problem; skip there.
      if (g.primary_group) {
        const groupEl = document.createElement("span");
        groupEl.className = "ac-group";
        groupEl.textContent = g.primary_group;
        li.appendChild(groupEl);
      }

      const alias = whichAlias(g, input.value);
      if (alias) {
        const aliasEl = document.createElement("span");
        aliasEl.className = "ac-alias";
        aliasEl.textContent = `(${alias})`;
        li.appendChild(aliasEl);
      }
      if (reason) {
        const why = document.createElement("span");
        why.className = "ac-reason";
        why.textContent = reason;
        li.appendChild(why);
      } else {
        const tierEl = document.createElement("span");
        tierEl.className = `ac-tier ac-tier-${g.tier}`;
        tierEl.textContent = g.tier;
        li.appendChild(tierEl);
      }

      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (reason) {
          // Not commitable in Detective mode — shake to signal "no".
          shake();
          return;
        }
        commit(g);
      });
      dropdown.appendChild(li);
    });
    dropdown.hidden = suggestions.length === 0;
  }

  function updateSuggestions() {
    const all = findMatches(getPool(), input.value);
    suggestions = all.filter((g) => !guessedIds.has(g.id));
    isFuzzy = false;
    // Zero direct hits + non-trivial query → try a fuzzy fallback so the
    // dropdown isn't just empty when the player typos something. The fuzzy
    // helper has its own minQuery floor (3 chars) to avoid noise on short
    // input.
    if (suggestions.length === 0 && (input.value || "").trim().length > 0) {
      const fuzzy = findFuzzyMatches(getPool(), input.value)
        .filter((g) => !guessedIds.has(g.id));
      if (fuzzy.length > 0) {
        suggestions = fuzzy;
        isFuzzy = true;
      }
    }
    // Sort valid candidates first so the player sees pickable options on top,
    // while still seeing the ruled-out ones below with their reason. Stable
    // within each group so the original rank order is preserved.
    suggestions.sort((a, b) => {
      const ra = reasonFor(a) ? 1 : 0;
      const rb = reasonFor(b) ? 1 : 0;
      return ra - rb;
    });
    // Initial highlight lands on the first valid suggestion; if none exist,
    // fall back to the first item so the dropdown is still keyboard-navigable.
    highlighted = firstValidIndex();
    if (highlighted < 0 && suggestions.length) highlighted = 0;
    render();
  }

  function commit(group) {
    onCommit(group);
    input.value = "";
    suggestions = [];
    isFuzzy = false;
    highlighted = -1;
    render();
  }

  function shake() {
    input.classList.remove("shake");
    // force reflow to restart animation
    void input.offsetWidth;
    input.classList.add("shake");
  }

  input.addEventListener("input", updateSuggestions);
  input.addEventListener("focus", updateSuggestions);
  input.addEventListener("blur", () => {
    setTimeout(() => { dropdown.hidden = true; }, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length) {
        highlighted = (highlighted + 1) % suggestions.length;
        render();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length) {
        highlighted = (highlighted - 1 + suggestions.length) % suggestions.length;
        render();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = highlighted >= 0 ? suggestions[highlighted] : null;
      if (pick && !reasonFor(pick)) {
        commit(pick);
      } else {
        // Invalid (Detective-mode ruled out) or no selection → shake.
        shake();
      }
    } else if (e.key === "Escape") {
      suggestions = [];
      highlighted = -1;
      render();
    }
  });

  return {
    setGuessedIds(ids) {
      guessedIds = new Set(ids);
      updateSuggestions();
    },
    refresh: updateSuggestions,
  };
}
