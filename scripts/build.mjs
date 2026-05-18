// Build a deployable, minified copy of the site under dist/.
//
//   - JS:    bundles all ES modules from js/main.js into a single
//            minified js/main.min.js (with the inline pre-paint script
//            in index.html left untouched).
//   - CSS:   concatenates reset → layout → cells, runs them through
//            esbuild's CSS minifier, writes css/styles.min.css.
//   - HTML:  rewrites the three <link rel="stylesheet"> tags into one,
//            points the module script at the bundled file, strips HTML
//            comments and collapses whitespace.
//   - Data:  copies the encoded .dat files (we deliberately do NOT
//            re-encode here; that's a separate step run by
//            scripts/encode_data.py whenever the source JSON changes).
//   - Misc:  copies favicon.svg.
//
// Output: dist/  →  deploy this directory to any static host.

import { build, transform } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

function rel(p) {
  return path.relative(ROOT, p);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function clean() {
  await fs.rm(DIST, { recursive: true, force: true });
  await ensureDir(DIST);
}

async function buildJS() {
  const entry = path.join(ROOT, "js/main.js");
  const out = path.join(DIST, "js/main.min.js");
  await ensureDir(path.dirname(out));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "esm",
    target: ["es2020"],
    outfile: out,
    sourcemap: false,
    legalComments: "none",
    write: true,
    logLevel: "warning",
    metafile: true,
  });
  const raw = (await fs.stat(entry)).size;
  const min = (await fs.stat(out)).size;
  // Sum sizes of every module that landed in the bundle for a fair "before".
  const totalIn = Object.values(result.metafile.inputs)
    .map((m) => m.bytes)
    .reduce((a, b) => a + b, 0);
  console.log(
    `  JS  ${rel(entry)} (+ ${Object.keys(result.metafile.inputs).length - 1} modules, ${fmt(totalIn)}) → ${rel(out)} (${fmt(min)}, ${pct(min, totalIn)})`,
  );
}

async function buildCSS() {
  const files = ["css/reset.css", "css/layout.css", "css/cells.css"];
  const parts = await Promise.all(
    files.map((f) => fs.readFile(path.join(ROOT, f), "utf8")),
  );
  const combined = parts.join("\n");
  const { code } = await transform(combined, { loader: "css", minify: true });
  const out = path.join(DIST, "css/styles.min.css");
  await ensureDir(path.dirname(out));
  await fs.writeFile(out, code);
  console.log(`  CSS ${files.join(" + ")} (${fmt(combined.length)}) → ${rel(out)} (${fmt(code.length)}, ${pct(code.length, combined.length)})`);
}

async function buildHTML() {
  const src = path.join(ROOT, "index.html");
  const out = path.join(DIST, "index.html");
  let html = await fs.readFile(src, "utf8");
  // Replace three stylesheet links with one minified bundle.
  html = html.replace(
    /\s*<link rel="stylesheet" href="css\/reset\.css"[^>]*\/?>\s*<link rel="stylesheet" href="css\/layout\.css"[^>]*\/?>\s*<link rel="stylesheet" href="css\/cells\.css"[^>]*\/?>/,
    '\n    <link rel="stylesheet" href="css/styles.min.css" />',
  );
  // Point the module script at the bundled JS.
  html = html.replace(/js\/main\.js/g, "js/main.min.js");
  // Strip HTML comments (we keep the pre-paint <script> intact since it's
  // delimited by tags, not comments).
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  // Collapse leading whitespace on now-empty lines.
  html = html.replace(/\n[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  await fs.writeFile(out, html);
  const before = (await fs.stat(src)).size;
  const after = (await fs.stat(out)).size;
  console.log(`  HTML ${rel(src)} (${fmt(before)}) → ${rel(out)} (${fmt(after)}, ${pct(after, before)})`);
}

async function copyAssets() {
  // Root-level static files used as-is in production.
  for (const f of ["favicon.svg", "manifest.webmanifest", "sw.js"]) {
    await fs.copyFile(path.join(ROOT, f), path.join(DIST, f));
  }
  await ensureDir(path.join(DIST, "data"));
  for (const f of ["groups.dat", "idols.dat"]) {
    const src = path.join(ROOT, "data", f);
    const dst = path.join(DIST, "data", f);
    try {
      await fs.copyFile(src, dst);
    } catch (e) {
      if (e.code === "ENOENT") {
        throw new Error(
          `Missing data/${f}. Run 'python3 scripts/encode_data.py' first.`,
        );
      }
      throw e;
    }
  }
  // Locale JSON files (English is also bundled inline via js/i18n-en.js so
  // t() works synchronously; these are fetched at runtime when switching
  // language). Copy every *.json under locales/.
  const localesSrc = path.join(ROOT, "locales");
  const localesDst = path.join(DIST, "locales");
  await ensureDir(localesDst);
  const localeFiles = (await fs.readdir(localesSrc)).filter((f) =>
    f.endsWith(".json"),
  );
  for (const f of localeFiles) {
    await fs.copyFile(path.join(localesSrc, f), path.join(localesDst, f));
  }
  console.log(
    `  assets favicon.svg + manifest + sw + data/*.dat + ${localeFiles.length} locales copied`,
  );
}

function fmt(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${n}B`;
}
function pct(after, before) {
  if (!before) return "n/a";
  return `${Math.round((1 - after / before) * 100)}% smaller`;
}

async function main() {
  const t0 = Date.now();
  console.log("Building → dist/");
  await clean();
  await Promise.all([buildJS(), buildCSS(), buildHTML(), copyAssets()]);
  console.log(`Done in ${Date.now() - t0}ms.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
