import { strict as assert } from "node:assert";
import { compareGroup as compare, compareIdol, isWin } from "../js/compare.js";

const BTS = {
  id: "Q12300129",
  name: "BTS",
  debut_year: 2013,
  generation: 3,
  company: "Big Hit Music",
  company_parent: "HYBE",
  member_count: 7,
  gender: "boy",
  status: "active",
  country: "KR",
};
const BLACKPINK = {
  id: "Q205662",
  name: "BLACKPINK",
  debut_year: 2016,
  generation: 3,
  company: "YG Entertainment",
  company_parent: null,
  member_count: 4,
  gender: "girl",
  status: "active",
  country: "KR",
};
const NEWJEANS = {
  id: "Q113301983",
  name: "NewJeans",
  debut_year: 2022,
  generation: 4,
  company: "ADOR",
  company_parent: "HYBE",
  member_count: 5,
  gender: "girl",
  status: "active",
  country: "KR",
};

// Guess BLACKPINK targeting BTS — the canonical spec example.
{
  const r = compare(BLACKPINK, BTS);
  assert.equal(r.debut_year.status, "lower", "BLACKPINK 2016 > BTS 2013 → arrow down");
  assert.equal(r.debut_year.direction, "down");
  assert.equal(r.generation.status, "exact", "both 3rd gen");
  assert.equal(r.company.status, "none", "YG vs Big Hit, no shared parent");
  assert.equal(r.member_count.status, "higher", "guess 4 < target 7 → arrow up");
  assert.equal(r.member_count.direction, "up");
  assert.equal(r.gender.status, "none", "girl vs boy");
  assert.equal(r.status.status, "exact");
  assert.equal(r.country.status, "exact");
}

// Sibling labels under HYBE → company should be "partial".
{
  const r = compare(NEWJEANS, BTS);
  assert.equal(r.company.status, "partial", "ADOR and Big Hit share HYBE parent");
}

// Coed × girl is partial.
{
  const COED = { ...BLACKPINK, gender: "coed" };
  const r = compare(COED, BLACKPINK);
  assert.equal(r.gender.status, "partial");
}

// Self compare = all exact.
{
  const r = compare(BTS, BTS);
  for (const k of Object.keys(r)) {
    assert.equal(r[k].status, "exact", `${k} should be exact on self-compare`);
  }
  assert.equal(isWin(BTS, BTS), true);
  assert.equal(isWin(BLACKPINK, BTS), false);
}

// Missing attribute on either side → "none".
{
  const NULL_COMPANY = { ...BLACKPINK, company: null };
  const r = compare(NULL_COMPANY, BTS);
  assert.equal(r.company.status, "none");
}

// ─── idol mode ─────────────────────────────────────────────────────────────────

const JIMIN = {
  id: "QJimin", name: "Jimin",
  birth_year: 1995, debut_year: 2013, generation: 3,
  primary_group: "BTS", primary_group_id: "QBTS",
  group_ids: ["QBTS"],
  gender: "boy", nationality: "Korean",
  company: "Big Hit Music", company_parent: "HYBE",
};
const JENNIE = {
  id: "QJennie", name: "Jennie",
  birth_year: 1996, debut_year: 2016, generation: 3,
  primary_group: "BLACKPINK", primary_group_id: "QBP",
  group_ids: ["QBP"],
  gender: "girl", nationality: "Korean",
  company: "YG Entertainment", company_parent: "YG Entertainment",
};
const LISA = {
  id: "QLisa", name: "Lisa",
  birth_year: 1997, debut_year: 2016, generation: 3,
  primary_group: "BLACKPINK", primary_group_id: "QBP",
  group_ids: ["QBP"],
  gender: "girl", nationality: "Thai",
  company: "YG Entertainment", company_parent: "YG Entertainment",
};
const TAEYONG = {
  id: "QTaeyong", name: "Taeyong",
  birth_year: 1995, debut_year: 2016, generation: 3,
  primary_group: "NCT 127", primary_group_id: "QNCT127",
  group_ids: ["QNCT127", "QNCT", "QSuperM"],  // shares sub-units
  gender: "boy", nationality: "Korean",
  company: "SM Entertainment", company_parent: "SM Entertainment",
};
const MARK = {
  id: "QMark", name: "Mark",
  birth_year: 1999, debut_year: 2016, generation: 3,
  primary_group: "NCT Dream", primary_group_id: "QNCTDream",
  group_ids: ["QNCTDream", "QNCT", "QNCT127", "QSuperM"],
  gender: "boy", nationality: "Canadian",
  company: "SM Entertainment", company_parent: "SM Entertainment",
};

// Guess Jimin targeting Jennie — different group, gender, company.
{
  const r = compareIdol(JIMIN, JENNIE);
  assert.equal(r.birth_year.status, "higher", "Jimin 1995 < Jennie 1996");
  assert.equal(r.debut_year.status, "higher", "Jimin 2013 < Jennie 2016");
  assert.equal(r.generation.status, "exact");
  assert.equal(r.primary_group.status, "none");
  assert.equal(r.gender.status, "none");
  assert.equal(r.nationality.status, "exact");
  assert.equal(r.company.status, "none");
}

// Guess Lisa targeting Jennie — same group (exact), different nationality.
{
  const r = compareIdol(LISA, JENNIE);
  assert.equal(r.primary_group.status, "exact");
  assert.equal(r.gender.status, "exact");
  assert.equal(r.nationality.status, "none", "Thai vs Korean");
  assert.equal(r.company.status, "exact");
}

// Guess Taeyong targeting Mark — sub-unit overlap → partial group.
{
  const r = compareIdol(TAEYONG, MARK);
  assert.equal(r.primary_group.status, "partial", "different primary, but NCT/NCT 127 overlap");
  assert.equal(r.nationality.status, "none", "Korean vs Canadian");
  assert.equal(r.company.status, "exact");
}

// Idol gender comparison is strict exact-match — no partial-match logic
// (that's a groups-only concept for coed overlap). Holds across the full
// {boy, girl, nonbinary} vocabulary: anything other than exact equality
// produces "none".
{
  const NB_IDOL = { ...JIMIN, gender: "nonbinary" };
  const r1 = compareIdol(NB_IDOL, JENNIE);                       // nonbinary vs girl
  assert.equal(r1.gender.status, "none");
  const r2 = compareIdol(JIMIN, { ...JENNIE, gender: "nonbinary" }); // boy vs nonbinary
  assert.equal(r2.gender.status, "none");
  // Self-compare on a nonbinary idol → exact.
  const r3 = compareIdol(NB_IDOL, NB_IDOL);
  assert.equal(r3.gender.status, "exact");
  // Even if a "coed" value somehow snuck into idol data (data error), the
  // result is still strictly "none" — no partial-match leakage.
  const COED_IDOL = { ...JIMIN, gender: "coed" };
  assert.equal(compareIdol(COED_IDOL, JENNIE).gender.status, "none");
}

console.log("compare.test ok");
