// Tiny i18n. Loads a locale JSON, exposes a synchronous `t(key, params?)`
// lookup, and lets callers switch locale at runtime.
//
// Design choices:
//   - Locale dicts are flat (single-level keys like "help.daily.note") rather
//     than nested objects. Easier to scan; missing keys are obvious.
//   - Interpolation: "{{name}}" placeholders. Counts/plurals are handled by
//     the caller (separate keys for "guess" vs "guesses") — keeps the runtime
//     minuscule and the strings translatable as written.
//   - English is bundled inline in this file so `t()` works synchronously
//     from module-import time. Tests + clues.js don't need async setup.
//   - Locale JSON files (locales/en.json, locales/ko.json) extend / override
//     the bundled English at runtime — keeping the wire format human-editable
//     while the JS still works standalone for unit tests.

import EN from "./i18n-en.js";

const STORAGE_KEY = "kpopdle:lang";   // "auto" | "en" | "ko"
const SUPPORTED = ["en", "ko"];
const DEFAULT = "en";

const _locales = { en: EN };
let _current = DEFAULT;

function pickInitial() {
  let pref = "auto";
  try { pref = localStorage.getItem(STORAGE_KEY) || "auto"; } catch {}
  if (SUPPORTED.includes(pref)) return pref;
  const nav = (typeof navigator !== "undefined" ? navigator.language : "") || "";
  const base = nav.toLowerCase().split("-")[0];
  return SUPPORTED.includes(base) ? base : DEFAULT;
}

// Load a locale JSON, merging into the in-memory dict. Idempotent.
async function loadLocale(lang) {
  if (_locales[lang] && lang === DEFAULT) return _locales[lang];
  if (_locales[lang] && lang !== DEFAULT) return _locales[lang];
  try {
    const res = await fetch(`locales/${lang}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _locales[lang] = await res.json();
  } catch (e) {
    console.warn(`i18n: failed to load locale ${lang}:`, e);
    _locales[lang] = {};
  }
  return _locales[lang];
}

// Initialize. Resolves with the active locale code. The bundled English
// dict is already available before this runs, so calls to t() before init()
// resolves still return readable strings (just always in English).
export async function init() {
  _current = pickInitial();
  if (_current !== DEFAULT) {
    await loadLocale(_current);
  }
  if (typeof document !== "undefined") document.documentElement.lang = _current;
  return _current;
}

export async function setLocale(lang) {
  if (lang === "auto") {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    lang = pickInitial();
  } else if (SUPPORTED.includes(lang)) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
  } else {
    return;
  }
  await loadLocale(lang);
  _current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  applyToDom();
}

export function locale() { return _current; }

export function localePreference() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && SUPPORTED.includes(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

// Lookup. Falls back: current locale → English → key.
// `params` interpolates "{{foo}}" with String(params.foo).
export function t(key, params) {
  const cur = _locales[_current] || {};
  let template = cur[key];
  if (template == null) template = EN[key];
  if (template == null) return key;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : `{{${name}}}`
  );
}

export function applyToDom(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    const attr = el.getAttribute("data-i18n-attr");
    const value = t(key);
    if (attr) el.setAttribute(attr, value);
    else el.textContent = value;
  }
}
