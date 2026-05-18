// Pure comparison logic. Each function returns { value, status, direction? } where:
//   status    ∈ "exact" | "higher" | "lower" | "partial" | "none"
//   direction ∈ "up" | "down"   (only set when status is "higher" or "lower")
//
// Two public entry points:
//   compareGroup(guess, target) — group-mode attributes
//   compareIdol(guess, target)  — idol-mode attributes
//
// render.js decides which keys to display based on (entity, difficulty).

function numeric(guess, target) {
  if (guess === null || guess === undefined || target === null || target === undefined) {
    return { value: guess, status: "none" };
  }
  if (guess === target) return { value: guess, status: "exact" };
  return guess < target
    ? { value: guess, status: "higher", direction: "up" }
    : { value: guess, status: "lower", direction: "down" };
}

function companyCompare(guess, target) {
  if (!guess.company || !target.company) {
    return { value: guess.company ?? null, status: "none" };
  }
  if (guess.company === target.company) return { value: guess.company, status: "exact" };
  if (
    guess.company_parent &&
    target.company_parent &&
    guess.company_parent === target.company_parent
  ) {
    return { value: guess.company, status: "partial" };
  }
  return { value: guess.company, status: "none" };
}

function genderCompare(g, t) {
  if (!g || !t) return { value: g ?? null, status: "none" };
  if (g === t) return { value: g, status: "exact" };
  // coed overlaps with boy and with girl: partial signal.
  if (g === "coed" && (t === "boy" || t === "girl")) return { value: g, status: "partial" };
  if (t === "coed" && (g === "boy" || g === "girl")) return { value: g, status: "partial" };
  return { value: g, status: "none" };
}

function enumExact(g, t) {
  if (g === null || g === undefined) return { value: g ?? null, status: "none" };
  if (g === t) return { value: g, status: "exact" };
  return { value: g, status: "none" };
}

// For idol "primary_group": exact match if same primary group id;
// partial if ANY group_ids overlap (idols often share multiple groups across sub-units);
// none otherwise. Displayed value is the guess's primary group name.
function groupSetCompare(guess, target) {
  const gPrimary = guess.primary_group_id;
  const tPrimary = target.primary_group_id;
  const gSet = new Set(guess.group_ids || []);
  const tSet = new Set(target.group_ids || []);
  const value = guess.primary_group || null;
  if (!gPrimary || !tPrimary) return { value, status: "none" };
  if (gPrimary === tPrimary) return { value, status: "exact" };
  for (const x of gSet) {
    if (tSet.has(x)) return { value, status: "partial" };
  }
  return { value, status: "none" };
}

export function compareGroup(guess, target) {
  return {
    debut_year: numeric(guess.debut_year, target.debut_year),
    generation: numeric(guess.generation, target.generation),
    company: companyCompare(guess, target),
    member_count: numeric(guess.member_count, target.member_count),
    gender: genderCompare(guess.gender, target.gender),
    status: enumExact(guess.status, target.status),
    country: enumExact(guess.country, target.country),
  };
}

export function compareIdol(guess, target) {
  return {
    birth_year: numeric(guess.birth_year, target.birth_year),
    debut_year: numeric(guess.debut_year, target.debut_year),
    generation: numeric(guess.generation, target.generation),
    primary_group: groupSetCompare(guess, target),
    // Idol gender is strictly binary (no individual person is "co-ed" — that
    // term only applies to groups composed of male+female members). Use the
    // exact-only comparator so partial-match logic, which is meaningful for
    // groups, never kicks in for idols.
    gender: enumExact(guess.gender, target.gender),
    nationality: enumExact(guess.nationality, target.nationality),
    company: companyCompare(guess, target),
  };
}

export function compareFor(entity, guess, target) {
  return entity === "idol" ? compareIdol(guess, target) : compareGroup(guess, target);
}

export function isWin(guess, target) {
  return guess.id === target.id;
}
