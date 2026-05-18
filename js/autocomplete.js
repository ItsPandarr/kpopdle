// Autocomplete input. Searches the current difficulty's pool only.
//
// Match priority: name startsWith → alias startsWith → name/alias substring.
// Capped at MAX_SUGGESTIONS.
// Emits a "commit" CustomEvent on the input element with detail = { group }.

const MAX_SUGGESTIONS = 8;

function normalize(s) {
  return (s || "").toLowerCase().trim();
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

function findMatches(pool, query) {
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

function whichAlias(group, query) {
  const q = normalize(query);
  if (normalize(group.name).includes(q)) return null;
  return (group.aliases || []).find((a) => normalize(a).includes(q)) || null;
}

// `getReason(group) → string|null` (optional) lets the caller tag matches as
// invalid: a non-null reason renders the row in a dimmed, non-clickable state
// with the reason text inline. Used by Detective mode in main.js.
export function attachAutocomplete({ input, dropdown, getPool, onCommit, getReason }) {
  let suggestions = [];
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
