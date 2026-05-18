// Derive what's known about the target from the comparison results so far.
// Pure: takes a list of { group, comparison } and returns one info object per
// attribute. The only impurity is the optional i18n hook used by formatClues
// for display labels (lookup falls back to English keys when called outside
// the app — e.g. in unit tests).

import { t } from "./i18n.js";

function numericInit() {
  return { min: null, max: null, known: null };
}
function numericApply(info, guessValue, c) {
  if (guessValue == null) return info;
  if (c.status === "exact") {
    info.known = guessValue;
    info.min = guessValue;
    info.max = guessValue;
  } else if (c.status === "higher") {
    // target > guessValue
    const lo = guessValue + 1;
    info.min = info.min == null ? lo : Math.max(info.min, lo);
  } else if (c.status === "lower") {
    // target < guessValue
    const hi = guessValue - 1;
    info.max = info.max == null ? hi : Math.min(info.max, hi);
  }
  return info;
}

function enumInit() {
  return { known: null, excluded: new Set() };
}
function enumApply(info, guessValue, c) {
  if (guessValue == null) return info;
  if (c.status === "exact") info.known = guessValue;
  else if (c.status === "none") info.excluded.add(guessValue);
  return info;
}

function applyCompany(info, entity, c) {
  if (c.status === "exact") {
    info.known = entity.company;
    if (entity.company_parent) info.knownParent = entity.company_parent;
  } else if (c.status === "partial") {
    info.knownParent = entity.company_parent;
    info.excludedCompanies.add(entity.company);
  } else if (c.status === "none") {
    if (entity.company) info.excludedCompanies.add(entity.company);
    if (entity.company_parent) info.excludedParents.add(entity.company_parent);
  }
}

function applyGender(info, entity, c) {
  if (c.status === "exact") {
    info.known = entity.gender;
  } else if (c.status === "partial") {
    if (entity.gender === "boy" || entity.gender === "girl") {
      info.known = "coed";
    } else if (entity.gender === "coed") {
      info.impliedCoed = true;
    }
  } else if (c.status === "none" && entity.gender) {
    info.excluded.add(entity.gender);
  }
}

function applyGroupSet(info, entity, c) {
  if (c.status === "exact") {
    info.knownGroup = entity.primary_group;
    info.knownGroupId = entity.primary_group_id;
  } else if (c.status === "partial") {
    // We know the target shares at least one group with `entity` — record candidates.
    for (const id of entity.group_ids || []) info.sharedCandidateIds.add(id);
    // The primary specifically didn't match, so it's excluded as the target's primary.
    if (entity.primary_group_id) info.excludedPrimaryIds.add(entity.primary_group_id);
  } else if (c.status === "none") {
    for (const id of entity.group_ids || []) info.excludedIds.add(id);
  }
}

// Fold hint-revealed values into a clues object so formatClues displays them.
// `hintEvents` = [{ attr, value }]. Mutates the clues in-place and returns it.
export function applyHintsToClues(clues, hintEvents) {
  for (const { attr, value } of hintEvents || []) {
    if (value == null) continue;
    switch (attr) {
      case "debut_year":
      case "generation":
      case "member_count":
      case "birth_year":
        clues[attr].known = value;
        clues[attr].min = value;
        clues[attr].max = value;
        break;
      case "company":
        clues.company.known = value;
        break;
      case "gender":
        clues.gender.known = value;
        break;
      case "status":
        clues.status.known = value;
        break;
      case "country":
        clues.country.known = value;
        break;
      case "nationality":
        clues.nationality.known = value;
        break;
      case "primary_group":
        clues.primary_group.knownGroup = value;
        break;
    }
  }
  return clues;
}

export function deriveClues(guesses) {
  const clues = {
    // group-mode
    debut_year: numericInit(),
    generation: numericInit(),
    member_count: numericInit(),
    company: { known: null, knownParent: null, excludedCompanies: new Set(), excludedParents: new Set() },
    gender: { known: null, excluded: new Set(), impliedCoed: false },
    status: enumInit(),
    country: enumInit(),
    // idol-mode
    birth_year: numericInit(),
    primary_group: {
      knownGroup: null,
      knownGroupId: null,
      sharedCandidateIds: new Set(),     // group IDs the target might be in (from partials)
      excludedPrimaryIds: new Set(),     // group IDs the target's primary is NOT
      excludedIds: new Set(),            // group IDs the target is NOT in
    },
    nationality: enumInit(),
  };

  for (const { group, comparison } of guesses) {
    const e = group; // generic entity (group or idol); kept name `group` for old callers' shape
    if ("debut_year" in comparison)   numericApply(clues.debut_year,   e.debut_year,   comparison.debut_year);
    if ("generation" in comparison)   numericApply(clues.generation,   e.generation,   comparison.generation);
    if ("member_count" in comparison) numericApply(clues.member_count, e.member_count, comparison.member_count);
    if ("birth_year" in comparison)   numericApply(clues.birth_year,   e.birth_year,   comparison.birth_year);

    if ("company" in comparison) applyCompany(clues.company, e, comparison.company);
    if ("gender" in comparison)  applyGender(clues.gender, e, comparison.gender);
    if ("status" in comparison)  enumApply(clues.status, e.status, comparison.status);
    if ("country" in comparison) enumApply(clues.country, e.country, comparison.country);
    if ("nationality" in comparison) enumApply(clues.nationality, e.nationality, comparison.nationality);
    if ("primary_group" in comparison) applyGroupSet(clues.primary_group, e, comparison.primary_group);
  }

  return clues;
}

// ─── formatting ────────────────────────────────────────────────────────────────

// Format a numeric range clue. When dataset bounds are provided and a bound
// saturates against the opposite extreme (e.g. "≤ Gen 1" — there is no Gen 0),
// collapse to that single value: the dataset's natural floor/ceiling pins the
// answer. We intentionally do NOT suppress bounds that match the same-side
// extreme — the player doesn't necessarily know the dataset's min/max, so
// showing "≥ 1993" still carries information.
function fmtRange(info, bound = null) {
  if (info.known != null) return `${info.known}`;
  const { min, max } = info;
  if (bound) {
    // Upper bound saturates at-or-below dataset min → value is the dataset min.
    if (max != null && max <= bound.min) return `${bound.min}`;
    // Lower bound saturates at-or-above dataset max → value is the dataset max.
    if (min != null && min >= bound.max) return `${bound.max}`;
  }
  if (min != null && max != null) {
    if (min === max) return `${min}`;
    return `${min}–${max}`;
  }
  if (min != null) return `≥ ${min}`;
  if (max != null) return `≤ ${max}`;
  return null;
}

function fmtGender(info, entity) {
  const kind = entity === "idol" ? "idol" : "group";
  const label = (g) => t(`gender.${kind}.${g}`);
  if (info.known) return label(info.known);
  if (info.impliedCoed) return t(`gender.${kind}.maleorfemale`);
  if (info.excluded.size === 0) return null;
  // Both idol and group gender are ternary, but with different vocabularies:
  // idol = {boy, girl, nonbinary} (almost everyone is binary, but the
  // dataset includes idols who identify as nonbinary — e.g. Cocona of XG),
  // group = {boy, girl, coed} (real groups can have mixed membership). The
  // remaining-options display works the same way for both: list whatever
  // hasn't been excluded yet, dropping the universe down to a single label
  // when only one possibility is left.
  const universe = entity === "idol"
    ? ["boy", "girl", "nonbinary"]
    : ["boy", "girl", "coed"];
  const remaining = universe.filter((g) => !info.excluded.has(g));
  if (remaining.length === 1) return label(remaining[0]);
  if (remaining.length === 2) return remaining.map(label).join(" / ");
  return null;
}

function fmtCompany(info) {
  // Only emit a positive hit. Exclusions accumulate too fast to be useful here.
  if (info.known) return info.known;
  if (info.knownParent) return t("company.family", { parent: info.knownParent });
  return null;
}

function fmtEnumKnown(info, label) {
  if (info.known) return label(info.known);
  if (info.excluded.size === 0) return null;
  // For status: only 2 values {active, disbanded}. Excluding one tells us the other.
  const allStatus = ["active", "disbanded"];
  const remaining = allStatus.filter((s) => !info.excluded.has(s));
  if (remaining.length === 1) return label(remaining[0]);
  return null;
}

function fmtGroupSet(info) {
  if (info.knownGroup) return info.knownGroup;
  // We don't have a name-resolution map at this layer, so partial info is qualitative.
  if (info.sharedCandidateIds.size > 0) {
    return info.sharedCandidateIds.size === 1
      ? t("clues.partialGroup.single")
      : t("clues.partialGroup.multi");
  }
  return null;
}

// Output: [{ label, value, attr, isConfirmed?, isHint?, isNewlyKnown?, isEmpty? }]
// `hintAttrs` — Set of attr keys that came from hint reveals.
// `newlyKnown` — Set of attr keys that just became known on this render pass.
// `confirmed`  — Set of attr keys whose exact value is locked in (any source).
// `opts.includeEmpty` — when true, emit one entry per visible attr even when no
//   info is known yet (renders as a placeholder slot). When false (default),
//   keeps the original behavior of only emitting attrs with a value.
export function formatClues(clues, visibleAttrs, entity = "group", hintAttrs = new Set(), newlyKnown = new Set(), opts = {}) {
  const { includeEmpty = false, bounds = null } = opts;
  // Pass entity so idol rounds count gender as "confirmed" when binary
  // elimination has pinned it (excluded.size >= 1 → other gender is known).
  const confirmed = knownAttrs(clues, bounds, entity);
  const out = [];
  const push = (label, attr, value) => {
    if (value != null) {
      out.push({
        label,
        attr,
        value,
        isConfirmed: confirmed.has(attr),
        isHint: hintAttrs.has(attr),
        isNewlyKnown: newlyKnown.has(attr),
      });
    } else if (includeEmpty) {
      out.push({
        label,
        attr,
        value: null,
        isConfirmed: false,
        isHint: false,
        isNewlyKnown: false,
        isEmpty: true,
      });
    }
  };

  if (visibleAttrs.includes("debut_year")) push(t("attr.debut_year"), "debut_year", fmtRange(clues.debut_year, bounds?.debut_year));
  if (visibleAttrs.includes("birth_year")) push(t("attr.birth_year"), "birth_year", fmtRange(clues.birth_year, bounds?.birth_year));
  if (visibleAttrs.includes("generation")) {
    // The label column already shows "Gen" / "세대" — don't repeat it inside
    // the value, otherwise the panel renders "Gen Gen 3" / "세대 세대 3".
    push(t("attr.generation"), "generation", fmtRange(clues.generation, bounds?.generation));
  }
  if (visibleAttrs.includes("company")) push(t("attr.company"), "company", fmtCompany(clues.company));
  if (visibleAttrs.includes("member_count")) push(t("attr.member_count"), "member_count", fmtRange(clues.member_count, bounds?.member_count));
  if (visibleAttrs.includes("gender")) push(t("attr.gender"), "gender", fmtGender(clues.gender, entity));
  if (visibleAttrs.includes("status")) {
    push(
      t("attr.status"),
      "status",
      fmtEnumKnown(clues.status, (s) => t(`status.${s}`))
    );
  }
  if (visibleAttrs.includes("country")) push(t("attr.country"), "country", clues.country.known || null);
  if (visibleAttrs.includes("nationality")) push(t("attr.nationality"), "nationality", clues.nationality.known || null);
  if (visibleAttrs.includes("primary_group")) push(t("attr.primary_group"), "primary_group", fmtGroupSet(clues.primary_group));

  return out;
}

// Set of attrs that are currently "known" (exact value pinned) from the given clues.
// Mirrors `attrIsKnown` in hint.js but operates over the whole clues object at once.
// When `bounds` is provided, a numeric attr is also counted as known when its
// inferred range collapses against the dataset extremes (e.g. max=1 and the
// dataset min is 1 → value must be 1). `entity` controls binary-elimination
// for gender — idol gender is binary, so excluding one value pins the other.
export function knownAttrs(clues, bounds = null, entity = "group") {
  const out = new Set();
  for (const [attr, info] of [
    ["debut_year", clues.debut_year],
    ["birth_year", clues.birth_year],
    ["generation", clues.generation],
    ["member_count", clues.member_count],
  ]) {
    if (!info) continue;
    if (info.known != null) { out.add(attr); continue; }
    if (info.min != null && info.max != null && info.min === info.max) { out.add(attr); continue; }
    const b = bounds?.[attr];
    if (b) {
      if (info.max != null && info.max <= b.min) { out.add(attr); continue; }
      if (info.min != null && info.min >= b.max) { out.add(attr); continue; }
    }
  }
  if (clues.company?.known != null) out.add("company");
  if (clues.gender?.known != null) {
    out.add("gender");
  } else if (entity === "idol" && (clues.gender?.excluded?.size ?? 0) >= 2) {
    // Idol gender is one of {boy, girl, nonbinary}. Excluding any TWO of
    // them leaves the third known by elimination, and the clues panel
    // should mark it confirmed (✓) just like a direct hit. One exclusion
    // alone isn't enough — two options are still in play.
    out.add("gender");
  }
  if (clues.status?.known != null) out.add("status");
  if (clues.country?.known != null) out.add("country");
  if (clues.nationality?.known != null) out.add("nationality");
  if (clues.primary_group?.knownGroup != null) out.add("primary_group");
  return out;
}

// Short labels for the "why-not" reasons surfaced by Detective mode.
function _genderLabel(g, entity) {
  if (entity === "idol") return ({ boy: "Male", girl: "Female", nonbinary: "Nonbinary" })[g] || g;
  return ({ boy: "Boy group", girl: "Girl group", coed: "Co-ed" })[g] || g;
}
function _statusLabel(s) {
  return s === "active" ? "Active" : s === "disbanded" ? "Disbanded" : s;
}

// Detective-mode "why is this candidate impossible?" helper. Returns a short
// human-readable string explaining the first constraint the candidate fails,
// or null when the candidate is still a valid pick. Order is tuned for
// usefulness — most narrowing checks first (known company / primary group /
// gender) so the reason tells the player something concrete.
export function whyNotMatch(candidate, clues, entity = "group") {
  if (!candidate) return "no data";

  // Known company / parent / exclusions — usually the most informative.
  const c = clues.company;
  if (c) {
    if (c.known != null && candidate.company !== c.known) {
      return `Company: ${candidate.company || "—"}`;
    }
    if (c.knownParent != null && candidate.company_parent !== c.knownParent) {
      return `Not in ${c.knownParent} family`;
    }
    if (c.excludedCompanies && c.excludedCompanies.has(candidate.company)) {
      return `Company ${candidate.company} ruled out`;
    }
    if (c.excludedParents && candidate.company_parent && c.excludedParents.has(candidate.company_parent)) {
      return `${candidate.company_parent} family ruled out`;
    }
  }

  // Idol primary_group constraints.
  const pg = clues.primary_group;
  if (pg) {
    if (pg.knownGroupId != null && candidate.primary_group_id !== pg.knownGroupId) {
      return `Wrong group`;
    }
    if (pg.excludedPrimaryIds && candidate.primary_group_id && pg.excludedPrimaryIds.has(candidate.primary_group_id)) {
      return `${candidate.primary_group || "Group"} already tried`;
    }
    if (pg.excludedIds && pg.excludedIds.size > 0) {
      const ids = candidate.group_ids || [];
      for (const id of ids) if (pg.excludedIds.has(id)) return `In a ruled-out group`;
    }
    if (pg.sharedCandidateIds && pg.sharedCandidateIds.size > 0) {
      const ids = candidate.group_ids || [];
      let shared = false;
      for (const id of ids) {
        if (pg.sharedCandidateIds.has(id)) { shared = true; break; }
      }
      if (!shared) return `Not in target's group`;
    }
  }

  // Gender.
  const g = clues.gender;
  if (g) {
    if (g.known != null && candidate.gender !== g.known) {
      return _genderLabel(candidate.gender, entity);
    }
    if (g.impliedCoed && candidate.gender === "coed") {
      return `Co-ed (target isn't)`;
    }
    if (g.excluded && g.excluded.has(candidate.gender)) {
      return _genderLabel(candidate.gender, entity);
    }
  }

  // Enum attrs: status / country / nationality.
  if (clues.status?.known != null && candidate.status !== clues.status.known) {
    return _statusLabel(candidate.status);
  }
  if (clues.country?.known != null && candidate.country !== clues.country.known) {
    return `Country: ${candidate.country}`;
  }
  if (clues.nationality?.known != null && candidate.nationality !== clues.nationality.known) {
    return `Nationality: ${candidate.nationality}`;
  }
  if (clues.status?.excluded?.has(candidate.status)) return _statusLabel(candidate.status);
  if (clues.country?.excluded?.has(candidate.country)) return `Country: ${candidate.country}`;
  if (clues.nationality?.excluded?.has(candidate.nationality)) return `Nationality: ${candidate.nationality}`;

  // Numeric ranges (debut, born, gen, member count).
  const numeric = entity === "idol"
    ? [["birth_year", "Born"], ["debut_year", "Debut"], ["generation", "Gen"]]
    : [["debut_year", "Debut"], ["generation", "Gen"], ["member_count", "Members"]];
  for (const [attr, label] of numeric) {
    const info = clues[attr];
    if (!info) continue;
    const v = candidate[attr];
    if (v == null) continue;
    const valLabel = attr === "generation" ? `Gen ${v}` : `${label} ${v}`;
    if (info.known != null && v !== info.known) return valLabel;
    if (info.min != null && v < info.min) return `${valLabel} · need ≥${info.min}`;
    if (info.max != null && v > info.max) return `${valLabel} · need ≤${info.max}`;
  }

  return null;
}

// Detective-mode candidate filter. Returns true when `candidate` is still
// consistent with every inferred constraint in `clues`. Used by the
// autocomplete to hide impossible picks when the player opts in.
//
// Each attribute has its own constraint shape — numeric (min/max/known),
// enum (excluded/known), gender (with implied-coed), company (parent +
// excludes), and the idol-only primary_group set. Anything not constrained
// passes by default.
export function targetMatches(candidate, clues, entity = "group") {
  if (!candidate) return false;

  // Numeric attrs: known wins, otherwise must fall within [min, max].
  const numeric = entity === "idol"
    ? ["birth_year", "debut_year", "generation"]
    : ["debut_year", "generation", "member_count"];
  for (const attr of numeric) {
    const info = clues[attr];
    if (!info) continue;
    const v = candidate[attr];
    if (v == null) continue; // missing field — don't reject on absent data
    if (info.known != null && v !== info.known) return false;
    if (info.min != null && v < info.min) return false;
    if (info.max != null && v > info.max) return false;
  }

  // Gender: known pins it exactly; impliedCoed means we saw a partial against
  // a boy/girl guess, so the target is NOT coed (must be boy or girl).
  const g = clues.gender;
  if (g) {
    if (g.known != null && candidate.gender !== g.known) return false;
    if (g.impliedCoed && candidate.gender === "coed") return false;
    if (g.excluded && g.excluded.has(candidate.gender)) return false;
  }

  // Status / country / nationality: simple enum excludes + known.
  for (const attr of ["status", "country", "nationality"]) {
    const info = clues[attr];
    if (!info) continue;
    const v = candidate[attr];
    if (info.known != null && v !== info.known) return false;
    if (info.excluded && info.excluded.has(v)) return false;
  }

  // Company: known company OR known parent-label, with exclusion sets.
  const c = clues.company;
  if (c) {
    if (c.known != null && candidate.company !== c.known) return false;
    if (c.knownParent != null && candidate.company_parent !== c.knownParent) return false;
    if (c.excludedCompanies && c.excludedCompanies.has(candidate.company)) return false;
    if (c.excludedParents && candidate.company_parent && c.excludedParents.has(candidate.company_parent)) return false;
  }

  // primary_group set (idol mode):
  //   - knownGroupId: the candidate's primary must be exactly this group.
  //   - sharedCandidateIds: the candidate must share at least one group ID
  //     with a prior partial-matched guess. (Approximation — the union of
  //     all prior partials' group sets, intersected with the candidate's.)
  //   - excludedPrimaryIds: candidate's primary must not be in here.
  //   - excludedIds: candidate must not belong to any of these groups.
  const pg = clues.primary_group;
  if (pg) {
    if (pg.knownGroupId != null && candidate.primary_group_id !== pg.knownGroupId) return false;
    if (pg.excludedPrimaryIds && candidate.primary_group_id && pg.excludedPrimaryIds.has(candidate.primary_group_id)) return false;
    if (pg.excludedIds && pg.excludedIds.size > 0) {
      const ids = candidate.group_ids || [];
      for (const id of ids) if (pg.excludedIds.has(id)) return false;
    }
    if (pg.sharedCandidateIds && pg.sharedCandidateIds.size > 0) {
      const ids = candidate.group_ids || [];
      let shared = false;
      for (const id of ids) {
        if (pg.sharedCandidateIds.has(id)) { shared = true; break; }
      }
      if (!shared) return false;
    }
  }

  return true;
}
