import { strict as assert } from "node:assert";
import { deriveClues, formatClues, targetMatches, whyNotMatch } from "../js/clues.js";
import { compareGroup as compare, compareIdol } from "../js/compare.js";

const BTS = {
  id: "Q12300129", name: "BTS",
  debut_year: 2013, generation: 3,
  company: "Big Hit Music", company_parent: "HYBE",
  member_count: 7, gender: "boy", status: "active", country: "KR",
};
const BLACKPINK = {
  id: "Q205662", name: "BLACKPINK",
  debut_year: 2016, generation: 3,
  company: "YG Entertainment", company_parent: "YG Entertainment",
  member_count: 4, gender: "girl", status: "active", country: "KR",
};
const NEWJEANS = {
  id: "Q113301983", name: "NewJeans",
  debut_year: 2022, generation: 4,
  company: "ADOR", company_parent: "HYBE",
  member_count: 5, gender: "girl", status: "active", country: "KR",
};
const IZONE = {
  id: "Q56402353", name: "IZ*ONE",
  debut_year: 2018, generation: 4,
  company: "Swing Entertainment", company_parent: null,
  member_count: 12, gender: "girl", status: "disbanded", country: "KR",
};

function play(target, guesses) {
  return guesses.map((g) => ({ group: g, comparison: compare(g, target) }));
}

// Guess BTS, target IZ*ONE — narrows year/gen/members up, gender=none(boy excluded), status=none(active excluded).
{
  const clues = deriveClues(play(IZONE, [BTS]));
  assert.equal(clues.debut_year.min, 2014, "target year > 2013");
  assert.equal(clues.generation.min, 4, "target gen > 3");
  assert.equal(clues.member_count.min, 8, "target members > 7");
  assert.ok(clues.gender.excluded.has("boy"));
  assert.ok(clues.status.excluded.has("active"));
  assert.ok(clues.country.known === "KR", "country exact via BTS guess");

  const lines = formatClues(clues, ["debut_year","generation","company","member_count","gender","status","country"]);
  const labels = lines.map((l) => l.label);
  assert.ok(labels.includes("Debut"));
  assert.ok(labels.includes("Gender"));     // boy or girl excluded → narrowed
  // Status with active excluded → known to be disbanded
  const status = lines.find((l) => l.label === "Status");
  assert.equal(status.value, "Disbanded");
}

// Add BLACKPINK guess → gender becomes "Girl group" (exact).
{
  const clues = deriveClues(play(IZONE, [BTS, BLACKPINK]));
  assert.equal(clues.gender.known, "girl");
  assert.equal(clues.member_count.min, 8, "members > 7 from BTS still applies");
}

// Company partial: target NewJeans (parent HYBE) guessed with BTS (parent HYBE).
{
  const clues = deriveClues(play(NEWJEANS, [BTS]));
  assert.equal(clues.company.knownParent, "HYBE");
  assert.ok(clues.company.excludedCompanies.has("Big Hit Music"));
  const lines = formatClues(clues, ["debut_year","generation","company","member_count","gender","status","country"]);
  const cmp = lines.find((l) => l.label === "Company");
  assert.match(cmp.value, /HYBE family/);
}

// Country: only one guess but exact, so known is set.
{
  const clues = deriveClues(play(BTS, [BLACKPINK]));
  assert.equal(clues.country.known, "KR");
}

// No guesses → no formatted lines.
{
  const clues = deriveClues([]);
  assert.deepEqual(formatClues(clues, ["debut_year","generation","company","member_count","gender","status","country"]), []);
}

// Difficulty filtering: hard shows only debut/company/members AT MOST. Company is
// only emitted on a positive hit (exact or known parent), so two non-matching guesses
// against an unrelated label leave Company silent.
{
  const clues = deriveClues(play(IZONE, [BTS, BLACKPINK]));
  const hardLines = formatClues(clues, ["debut_year","company","member_count"]);
  const labels = hardLines.map((l) => l.label).sort();
  assert.deepEqual(labels, ["Debut","Members"].sort());
}

// Company emits when target shares a parent (positive hit).
{
  const clues = deriveClues(play(NEWJEANS, [BTS])); // both HYBE family
  const lines = formatClues(clues, ["debut_year","company","member_count"]);
  const cmp = lines.find((l) => l.label === "Company");
  assert.equal(cmp.value, "HYBE family");
}

// ─── idol-mode clue derivation ────────────────────────────────────────────────

const ROSE = {
  id: "QRose", name: "Rosé",
  birth_year: 1997, debut_year: 2016, generation: 3,
  primary_group: "BLACKPINK", primary_group_id: "QBP",
  group_ids: ["QBP"],
  gender: "girl", nationality: "Korean",
  company: "YG Entertainment", company_parent: "YG Entertainment",
};
const LISA2 = {
  id: "QLisa", name: "Lisa",
  birth_year: 1997, debut_year: 2016, generation: 3,
  primary_group: "BLACKPINK", primary_group_id: "QBP",
  group_ids: ["QBP"],
  gender: "girl", nationality: "Thai",
  company: "YG Entertainment", company_parent: "YG Entertainment",
};
const JIMIN_TEST = {
  id: "QJimin", name: "Jimin",
  birth_year: 1995, debut_year: 2013, generation: 3,
  primary_group: "BTS", primary_group_id: "QBTS",
  group_ids: ["QBTS"],
  gender: "boy", nationality: "Korean",
  company: "Big Hit Music", company_parent: "HYBE",
};

// Guess Jimin against Rosé.
{
  const guesses = [{ group: JIMIN_TEST, comparison: compareIdol(JIMIN_TEST, ROSE) }];
  const clues = deriveClues(guesses);
  assert.equal(clues.birth_year.min, 1996, "target born > 1995");
  assert.equal(clues.debut_year.min, 2014);
  assert.ok(clues.gender.excluded.has("boy"));
  const lines = formatClues(clues, ["birth_year","debut_year","generation","primary_group","gender","nationality","company"]);
  const labels = lines.map((l) => l.label);
  assert.ok(labels.includes("Born"));
  assert.ok(labels.includes("Nationality"));    // korean vs korean → exact
  assert.equal(lines.find((l) => l.label === "Nationality").value, "Korean");
}

// Guess Lisa against Rosé — same group exact.
{
  const guesses = [{ group: LISA2, comparison: compareIdol(LISA2, ROSE) }];
  const clues = deriveClues(guesses);
  assert.equal(clues.primary_group.knownGroup, "BLACKPINK");
  const lines = formatClues(clues, ["birth_year","primary_group","nationality","company"]);
  const grp = lines.find((l) => l.label === "Group");
  assert.equal(grp.value, "BLACKPINK");
}

// ─── numeric bound suppression ─────────────────────────────────────────────────

// Builds a clue object with no info on any attr. Tests below mutate it.
function emptyClues() {
  return {
    debut_year: { min: null, max: null, known: null },
    generation: { min: null, max: null, known: null },
    member_count: { min: null, max: null, known: null },
    birth_year: { min: null, max: null, known: null },
    company: { known: null, knownParent: null, excludedCompanies: new Set(), excludedParents: new Set() },
    gender: { known: null, excluded: new Set(), impliedCoed: false },
    status: { known: null, excluded: new Set() },
    country: { known: null, excluded: new Set() },
    primary_group: { knownGroup: null, knownGroupId: null, sharedCandidateIds: new Set(), excludedPrimaryIds: new Set(), excludedIds: new Set() },
    nationality: { known: null, excluded: new Set() },
  };
}

const GROUP_BOUNDS = {
  generation: { min: 1, max: 5 },
  debut_year: { min: 1993, max: 2026 },
  member_count: { min: 1, max: 26 },
};

// Target Gen 1 vs guess Gen 2 → max=1. Without bounds we'd print "≤ 1";
// with bounds we collapse to known dataset min.
{
  const clues = emptyClues();
  clues.generation.max = 1;
  const lines = formatClues(clues, ["generation"], "group", new Set(), new Set(), { bounds: GROUP_BOUNDS });
  const gen = lines.find((l) => l.label === "Gen");
  assert.equal(gen.value, "Gen 1", "max-saturates-min collapses to known dataset min");
  assert.ok(gen.isConfirmed, "should also be marked confirmed");
}

// Symmetric: min saturates against dataset max.
{
  const clues = emptyClues();
  clues.generation.min = 5;
  const lines = formatClues(clues, ["generation"], "group", new Set(), new Set(), { bounds: GROUP_BOUNDS });
  const gen = lines.find((l) => l.label === "Gen");
  assert.equal(gen.value, "Gen 5");
  assert.ok(gen.isConfirmed);
}

// A min at the dataset min is still shown — the player doesn't know the
// dataset bounds, so "≥ 1993" is meaningful information.
{
  const clues = emptyClues();
  clues.debut_year.min = 1994;
  let lines = formatClues(clues, ["debut_year"], "group", new Set(), new Set(), { bounds: GROUP_BOUNDS });
  assert.equal(lines.find((l) => l.label === "Debut").value, "≥ 1994");

  clues.debut_year.min = 1993;
  lines = formatClues(clues, ["debut_year"], "group", new Set(), new Set(), { bounds: GROUP_BOUNDS });
  assert.equal(lines.find((l) => l.label === "Debut").value, "≥ 1993", "still informative for the player");
}

// Without bounds, fall back to the old "≤ N" / "≥ N" behavior — preserved for
// callers/tests that don't pass bounds.
{
  const clues = emptyClues();
  clues.generation.max = 1;
  const lines = formatClues(clues, ["generation"], "group");
  assert.equal(lines.find((l) => l.label === "Gen").value, "Gen ≤ 1");
}

// ─── targetMatches (Detective mode candidate filter) ──────────────────────────

// Numeric range constraints: a candidate outside the inferred range is excluded.
{
  const clues = emptyClues();
  clues.debut_year.min = 2020;
  const old = { id: "Q1", debut_year: 2018, generation: 3, gender: "boy", status: "active", country: "KR", member_count: 5, company: "X", company_parent: null };
  const fresh = { ...old, id: "Q2", debut_year: 2022 };
  assert.equal(targetMatches(old, clues), false, "below min excluded");
  assert.equal(targetMatches(fresh, clues), true);
}
{
  const clues = emptyClues();
  clues.debut_year.max = 2015;
  clues.generation.known = 3;
  const a = { id: "Q1", debut_year: 2014, generation: 3, gender: "boy", status: "active", country: "KR", member_count: 7, company: "Y", company_parent: null };
  const b = { ...a, id: "Q2", debut_year: 2016 };
  const c = { ...a, id: "Q3", generation: 4 };
  assert.equal(targetMatches(a, clues), true);
  assert.equal(targetMatches(b, clues), false, "above max excluded");
  assert.equal(targetMatches(c, clues), false, "wrong gen excluded");
}

// Gender: known + impliedCoed + excluded interactions.
{
  const base = { id: "Q1", debut_year: 2018, generation: 4, status: "active", country: "KR", member_count: 5, company: "X", company_parent: null };
  // Known = "boy" → only boys pass.
  {
    const clues = emptyClues();
    clues.gender.known = "boy";
    assert.equal(targetMatches({ ...base, gender: "boy" }, clues), true);
    assert.equal(targetMatches({ ...base, gender: "girl" }, clues), false);
  }
  // impliedCoed (saw a partial against a boy/girl guess) → target is NOT coed.
  {
    const clues = emptyClues();
    clues.gender.impliedCoed = true;
    assert.equal(targetMatches({ ...base, gender: "coed" }, clues), false);
    assert.equal(targetMatches({ ...base, gender: "boy" }, clues), true);
  }
  // Excluded set drops a value.
  {
    const clues = emptyClues();
    clues.gender.excluded = new Set(["girl"]);
    assert.equal(targetMatches({ ...base, gender: "girl" }, clues), false);
    assert.equal(targetMatches({ ...base, gender: "boy" }, clues), true);
  }
}

// Company family: a partial-matched parent narrows the pool to that label group.
{
  const clues = emptyClues();
  clues.company.knownParent = "HYBE";
  const hybe = { id: "Q1", debut_year: 2018, generation: 4, gender: "boy", status: "active", country: "KR", member_count: 5, company: "Big Hit Music", company_parent: "HYBE" };
  const sm = { ...hybe, id: "Q2", company: "SM", company_parent: "SM Entertainment" };
  assert.equal(targetMatches(hybe, clues), true);
  assert.equal(targetMatches(sm, clues), false);
}

// Idol primary_group: excludedPrimaryIds rules out groups already tried.
{
  const clues = emptyClues();
  clues.primary_group.excludedPrimaryIds = new Set(["Q_BTS"]);
  const inBts = { id: "I1", birth_year: 1995, debut_year: 2013, generation: 3, gender: "boy", nationality: "Korean", primary_group_id: "Q_BTS", group_ids: ["Q_BTS"], company: "X", company_parent: null };
  const inOther = { ...inBts, id: "I2", primary_group_id: "Q_X", group_ids: ["Q_X"] };
  assert.equal(targetMatches(inBts, clues, "idol"), false);
  assert.equal(targetMatches(inOther, clues, "idol"), true);
}

// Idol shared-group: partial match means target shares ≥1 group with prior guess.
// We only know the *union* of candidate IDs (clues approximate), so the test
// asserts: idol passes iff at least one of their group_ids is in sharedCandidateIds.
{
  const clues = emptyClues();
  clues.primary_group.sharedCandidateIds = new Set(["Q_GROUP_A", "Q_GROUP_B"]);
  const shares = { id: "I1", birth_year: 1996, debut_year: 2015, generation: 3, gender: "girl", nationality: "Korean", primary_group_id: "Q_GROUP_A", group_ids: ["Q_GROUP_A"], company: "X", company_parent: null };
  const noShare = { ...shares, id: "I2", primary_group_id: "Q_OTHER", group_ids: ["Q_OTHER"] };
  assert.equal(targetMatches(shares, clues, "idol"), true);
  assert.equal(targetMatches(noShare, clues, "idol"), false);
}

// Empty clues → every candidate passes (no constraints to violate).
{
  const candidate = { id: "Q1", debut_year: 2020, generation: 4, gender: "boy", status: "active", country: "KR", member_count: 7, company: "X", company_parent: null };
  assert.equal(targetMatches(candidate, emptyClues()), true);
}

// ─── whyNotMatch (Detective-mode reason strings) ──────────────────────────────

// Valid candidate → null.
{
  const candidate = { id: "Q1", debut_year: 2020, generation: 4, gender: "boy", status: "active", country: "KR", member_count: 7, company: "X", company_parent: null };
  assert.equal(whyNotMatch(candidate, emptyClues()), null);
}

// Company family violation surfaces a readable reason.
{
  const clues = emptyClues();
  clues.company.knownParent = "HYBE";
  const sm = { id: "Q1", debut_year: 2018, generation: 4, gender: "boy", status: "active", country: "KR", member_count: 5, company: "SM", company_parent: "SM Entertainment" };
  assert.equal(whyNotMatch(sm, clues), "Not in HYBE family");
}

// Gender mismatch.
{
  const clues = emptyClues();
  clues.gender.known = "girl";
  const boy = { id: "Q1", debut_year: 2018, generation: 4, gender: "boy", status: "active", country: "KR", member_count: 5, company: "X", company_parent: null };
  assert.equal(whyNotMatch(boy, clues, "group"), "Boy group");
  assert.equal(whyNotMatch(boy, clues, "idol"), "Male");
}

// Numeric range violation with "need ≥/≤" suffix.
{
  const clues = emptyClues();
  clues.debut_year.min = 2020;
  const old = { id: "Q1", debut_year: 2013, generation: 4, gender: "boy", status: "active", country: "KR", member_count: 5, company: "X", company_parent: null };
  assert.equal(whyNotMatch(old, clues), "Debut 2013 · need ≥2020");
}

// First violation found wins. Order: company > primary_group > gender > enum > numeric.
{
  const clues = emptyClues();
  clues.company.knownParent = "HYBE";       // most narrowing — should surface
  clues.gender.known = "girl";              // also violated by the candidate
  clues.debut_year.min = 2020;              // also violated
  const wrong = { id: "Q1", debut_year: 2013, generation: 3, gender: "boy", status: "active", country: "KR", member_count: 5, company: "SM", company_parent: "SM Entertainment" };
  assert.equal(whyNotMatch(wrong, clues), "Not in HYBE family", "company family checked first");
}

// Idol: wrong primary group when knownGroupId is pinned.
{
  const clues = emptyClues();
  clues.primary_group.knownGroupId = "Q_BTS";
  const ive = { id: "I1", birth_year: 2003, debut_year: 2021, generation: 4, gender: "girl", nationality: "Korean", primary_group_id: "Q_IVE", group_ids: ["Q_IVE"], company: "Y", company_parent: null };
  assert.equal(whyNotMatch(ive, clues, "idol"), "Wrong group");
}

console.log("clues.test ok");
