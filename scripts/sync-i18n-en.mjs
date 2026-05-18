// Regenerate js/i18n-en.js from locales/en.json. The JS file is bundled into
// the production main.min.js so t() works synchronously from module-import
// time (tests + early boot paths get English without needing fetch). The JSON
// file is the editable source of truth — this script keeps them in sync.
//
// Run as `node scripts/sync-i18n-en.mjs` or `npm run sync-i18n`. Wired into
// `npm run build` so production bundles always pick up the latest strings.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSON_PATH = path.join(ROOT, "locales", "en.json");
const JS_PATH = path.join(ROOT, "js", "i18n-en.js");

async function main() {
  const json = JSON.parse(await fs.readFile(JSON_PATH, "utf8"));
  const lines = [
    "// Inline English fallback. AUTO-GENERATED from locales/en.json by",
    "// scripts/sync-i18n-en.mjs — do not edit by hand. Run `npm run sync-i18n`",
    "// (or it'll happen as part of `npm run build`).",
    "//",
    "// Why a separate file: bundled into main.min.js so t() returns readable",
    "// English synchronously from module-import time — tests and the very first",
    "// render don't need to wait on fetch(\"locales/en.json\").",
    "export default {",
  ];
  for (const [k, v] of Object.entries(json)) {
    lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  }
  lines.push("};", "");
  await fs.writeFile(JS_PATH, lines.join("\n"));
  console.log(`  i18n  ${Object.keys(json).length} keys → ${path.relative(ROOT, JS_PATH)}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
