// In-memory game state. Owned by main.js; everything else reads.
export const state = {
  entity: "group",     // "group" | "idol"
  mode: "daily",       // "daily" | "endless"
  difficulty: "easy",  // "easy" | "medium" | "hard"
  target: null,        // the hidden entity
  guesses: [],         // [{ group, comparison }]  — `group` is the legacy field name for the guessed entity (group or idol)
  won: false,
  lost: false,         // true when daily ran out of guesses without winning
  frozen: false,       // true after a win/loss or when re-showing a finished daily
  hintOrder: [],       // attrs ordered least-unique → most-unique for the current pool; persisted
  hintEvents: [],      // [{ attr, value, cost, guessIdxAtClick }] — one per click
  // When set (YYYY-MM-DD), the current round uses that date's seed instead of
  // today's, doesn't check daily-already-played, and doesn't write to stats.
  // Used by the "Replay yesterday's daily" feature.
  replayDate: null,
  // Captured at startGame from the user's Detective mode preference. Held on
  // state (not re-read every keystroke) so toggling mid-game has no effect
  // until the next puzzle.
  filterMode: false,
};

export function resetGame() {
  state.target = null;
  state.guesses = [];
  state.won = false;
  state.lost = false;
  state.frozen = false;
  state.hintOrder = [];
  state.hintEvents = [];
  state.replayDate = null;
  state.filterMode = false;
}

export function recordGuess(group, comparison) {
  state.guesses.push({ group, comparison });
}
