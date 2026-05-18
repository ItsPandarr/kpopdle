export const DIFFICULTIES = ["easy", "medium", "hard"];
export const MODES = ["daily", "endless"];
export const ENTITIES = ["group", "idol"];

// Pool inclusion rule: a difficulty's pool is all entities whose tier is at or below it.
export const TIER_RANK = { easy: 0, medium: 1, hard: 2 };

export function inPool(entity, difficulty) {
  return TIER_RANK[entity.tier] <= TIER_RANK[difficulty];
}

// Attribute columns shown per (entity, difficulty). The name column is implicit.
// All difficulties show the same column set — what makes Medium/Hard harder is
// the much larger candidate pool, not column reduction.
const GROUP_ATTRS = ["debut_year", "generation", "company", "member_count", "gender", "status", "country"];
const IDOL_ATTRS  = ["birth_year", "debut_year", "generation", "primary_group", "gender", "nationality", "company"];
export const VISIBLE_ATTRS = {
  group: { easy: GROUP_ATTRS, medium: GROUP_ATTRS, hard: GROUP_ATTRS },
  idol:  { easy: IDOL_ATTRS,  medium: IDOL_ATTRS,  hard: IDOL_ATTRS  },
};

export const ATTR_LABEL = {
  debut_year: "Debut",
  generation: "Gen",
  company: "Company",
  member_count: "Members",
  gender: "Gender",
  status: "Status",
  country: "Country",
  birth_year: "Born",
  primary_group: "Group",
  nationality: "Nationality",
};

export const STORAGE_KEY = "kpopdle:v2";
export const HISTORY_CAP = 100;

// Max guesses per Daily puzzle. Tuned to the data:
//   - Easy: 100 candidates × 7 visible attrs → median ~3-4 guesses
//   - Medium: 300 candidates × 5 attrs → median ~5-6
//   - Hard: 405 groups / 1330 idols × 3-4 attrs → median ~7-9
// Endless mode has no cap — it's the practice mode.
export const MAX_DAILY_GUESSES = {
  easy: 6,
  medium: 8,
  hard: 10,
};
