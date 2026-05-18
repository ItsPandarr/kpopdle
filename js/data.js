import { inPool, VISIBLE_ATTRS } from "./config.js";
import { unscramble } from "./scramble.js";

const _entities = { group: null, idol: null };
const _byId = { group: new Map(), idol: new Map() };
const _meta = { group: null, idol: null };

export async function loadAll() {
  await Promise.all([loadEntity("group"), loadEntity("idol")]);
}

async function loadEntity(entity) {
  if (_entities[entity]) return;
  const file = entity === "idol" ? "data/idols.dat" : "data/groups.dat";
  const key = entity === "idol" ? "idols" : "groups";
  const res = await fetch(file);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  const payload = JSON.parse(unscramble(await res.text()));
  _entities[entity] = payload[key];
  _byId[entity] = new Map(_entities[entity].map((e) => [e.id, e]));
  _meta[entity] = { generated_at: payload.generated_at || null, version: payload.version };
}

// Latest "generated_at" timestamp across both datasets. Used by the footer's
// "Data current as of …" label. Returns null if data hasn't loaded yet.
export function getDataAsOfDate() {
  const stamps = [];
  for (const k of ["group", "idol"]) {
    const ts = _meta[k]?.generated_at;
    if (ts) stamps.push(new Date(ts));
  }
  if (!stamps.length) return null;
  return new Date(Math.max(...stamps.map((d) => d.getTime())));
}

export function getById(entity, id) {
  return _byId[entity]?.get(id) ?? null;
}

export function poolFor(entity, difficulty) {
  return _entities[entity].filter((e) => inPool(e, difficulty));
}

// Subset of the difficulty pool eligible to be the puzzle target. Same tier
// inclusion as poolFor, but additionally requires the entity to have a value
// for every visible attribute at this difficulty. Without this filter the
// daily seed could land on an entry with `company: null` (e.g. Forestella),
// which produces an empty COMPANY column in every guess row AND a dead-end
// hint button — the player has no way to learn the answer. The autocomplete
// keeps using the full pool so players can still type these as guesses.
export function targetPoolFor(entity, difficulty) {
  const visible = VISIBLE_ATTRS[entity]?.[difficulty] || [];
  return _entities[entity].filter(
    (e) => inPool(e, difficulty) && visible.every((a) => e[a] != null && e[a] !== ""),
  );
}

// Cached per-entity numeric bounds, used by the clue formatter to suppress
// nonsensical bounds like "≤ Gen 1" (there is no Gen 0). Lazily computed on
// first access — needs loadAll() to have completed.
const _bounds = { group: null, idol: null };
const NUMERIC_ATTRS = {
  group: ["debut_year", "generation", "member_count"],
  idol: ["birth_year", "debut_year", "generation"],
};
export function getNumericBounds(entity) {
  if (_bounds[entity]) return _bounds[entity];
  const arr = _entities[entity];
  if (!arr) return null;
  const out = {};
  for (const attr of NUMERIC_ATTRS[entity]) {
    let min = Infinity;
    let max = -Infinity;
    for (const e of arr) {
      const v = e[attr];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min !== Infinity) out[attr] = { min, max };
  }
  _bounds[entity] = out;
  return out;
}
