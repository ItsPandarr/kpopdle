import { strict as assert } from "node:assert";
import { cyrb53, targetForDaily, todayUTC, yesterdayUTC, dayBeforeYesterdayUTC } from "../js/seed.js";

// cyrb53 is deterministic.
assert.equal(cyrb53("hello"), cyrb53("hello"));
assert.notEqual(cyrb53("hello"), cyrb53("world"));
assert.equal(cyrb53(""), cyrb53(""));

// targetForDaily is deterministic per (date, difficulty).
const pool = Array.from({ length: 50 }, (_, i) => ({ id: `Q${i}` }));
const a = targetForDaily("2026-05-17", "easy", pool);
const b = targetForDaily("2026-05-17", "easy", pool);
assert.equal(a.id, b.id, "same (date, difficulty) → same target");

// Different difficulty → likely different target with a pool of 50.
const c = targetForDaily("2026-05-17", "hard", pool);
assert.notEqual(a.id, c.id, "different difficulty should usually pick a different target");

// Different date → likely different target.
const d = targetForDaily("2026-05-18", "easy", pool);
assert.notEqual(a.id, d.id, "different date should usually pick a different target");

// Empty pool returns null instead of throwing.
assert.equal(targetForDaily("2026-05-17", "easy", []), null);

// todayUTC is YYYY-MM-DD shaped.
assert.match(todayUTC(), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(todayUTC(new Date("2026-05-17T23:00:00Z")), "2026-05-17");
// UTC, not local: same point in time, different days only if local TZ shifts the date.
assert.equal(todayUTC(new Date("2026-05-17T00:00:00Z")), "2026-05-17");

// yesterdayUTC handles month rollover.
assert.equal(yesterdayUTC(new Date("2026-06-01T05:00:00Z")), "2026-05-31");
assert.equal(yesterdayUTC(new Date("2026-01-01T00:00:00Z")), "2025-12-31");

// dayBeforeYesterdayUTC handles month + year rollover.
assert.equal(dayBeforeYesterdayUTC(new Date("2026-05-18T00:00:00Z")), "2026-05-16");
assert.equal(dayBeforeYesterdayUTC(new Date("2026-06-01T05:00:00Z")), "2026-05-30");
assert.equal(dayBeforeYesterdayUTC(new Date("2026-01-01T00:00:00Z")), "2025-12-30");

console.log("seed.test ok");
