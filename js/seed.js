// cyrb53 — deterministic 53-bit string hash. MIT-licensed reference impl.
// Stable across JS engines; no crypto.subtle dependency.
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function todayUTC(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function yesterdayUTC(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Two UTC days back. Used by the streak-freeze rule: if a player's last
// daily win is exactly 2 days ago (i.e. they missed yesterday), they get a
// one-time-per-streak "freeze" that lets the streak survive the gap.
export function dayBeforeYesterdayUTC(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}

export function targetForDaily(dateStr, difficulty, pool) {
  if (!pool.length) return null;
  const h = cyrb53(`${dateStr}|${difficulty}`);
  return pool[h % pool.length];
}

export function randomTarget(pool) {
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
