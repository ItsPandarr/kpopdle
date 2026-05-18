# KPopdle

A Loldle-style guessing game for K-pop groups and idols. Pure static site — no backend, no accounts, no analytics. Personal bests live in your browser's localStorage.

UI is available in **English** and **한국어** (auto-detected from `navigator.language`, manually overridable from Settings).

## Run it

```bash
# 1. Static server (any will do; this matches the included launch script).
python3 scripts/serve.py 8123
# 2. Open http://127.0.0.1:8123/
```

ES modules require an http(s) origin — opening `index.html` via `file://` will fail.

## Play

- **Entity**: pick **Group** (guess the band) or **Idol** (guess the individual member). Each mode has its own attribute set and personal bests.
- **Daily**: one shared target per UTC day. Same entity + difficulty + date = same target across every player and browser. Guess cap: easy 6 / medium 8 / hard 10.
- **Endless**: random target per round. No guess cap. Hit "New round" to reroll or "Give up" to reveal.
- **Difficulty** only scales the candidate pool — every difficulty shows the full attribute set:
  - **Easy** — top 100 most popular entities.
  - **Medium** — top 300.
  - **Hard** — all entities.
- Type to autocomplete; arrow keys + Enter pick a suggestion. In idol mode, the dropdown shows each idol's primary group inline (italic) since 20+ stage names are shared across multiple people (e.g. three "Nana"s, two "Soobin"s — TXT *and* WJSN).
- **Hints** (gear in the score line) reveal one attribute at a time at a small guess-cost.
- **Detective mode** (Settings) hides candidates that can't be the answer given accumulated clues.
- **Calm mode** (Settings) stops animations, shimmer, confetti, and the drifting background.
- **Colorblind mode** (Settings) swaps the red/green palette for a deuteranopia-safe one. Symbols (✓ ◐ ✗ ▲ ▼) are always shown.

### Sharing a puzzle

After any win or loss, two share buttons appear on the banner:

- **Copy result** — a Wordle-style emoji grid + numbers, for boasting in chat.
- **Send this puzzle to a friend** — copies a URL like `…/#p=g.Q13580495.m.0` that boots the recipient directly into the same target as a one-off endless round. Recipient's stats and streaks aren't affected; the hash clears itself once the puzzle ends.

### Group attributes
Debut date, generation (1st–5th), company (with HYBE/SM/JYP/YG parent-family partial matches), member count, gender (boy/girl/coed), status (active/disbanded), country.

### Idol attributes
Birth year, debut year (inherited from earliest group), generation, primary group (exact match, or partial when sub-units overlap — e.g. NCT 127 vs NCT Dream both share NCT), gender (male/female — strictly binary; "co-ed" is a group-only concept and excluding one gender pins the other by elimination), nationality (Korean, Japanese, Thai, Australian, Canadian, …), company (inherited from primary group, same parent-family rules as group mode).

## Refreshing the dataset

The dataset (`data/groups.json` + `data/idols.json`, plus their encoded `.dat` counterparts) is pre-built and committed. To regenerate from source:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/scrape.py        # full run — pageviews dominate runtime
```

Subsequent runs are fast: pageview totals and Wikipedia wikitext are cached on disk under `scripts/.cache/`. Delete the cache to force a refetch.

Flags:
- `--limit N` — cap total groups (handy for iterating).
- `--skip-pageviews` — skip popularity API; all popularity = 0.
- `--skip-wikitext` — skip Wikipedia infobox parsing; company info left to overrides.

The script is atomic: it writes `data/groups.json.tmp` and renames only on success, so an interrupted run never corrupts the shipped data.

## Methodology

**Data sources**:
- [Wikidata SPARQL endpoint](https://query.wikidata.org/sparql) — group label, debut date (`P571`), dissolution date (`P576`), member list (`P527`), genders (`P21`), aliases (`skos:altLabel`).
- Wikipedia (English) — infobox `agency` / `label` field for company, pageviews REST API for popularity.
- `scripts/overrides.json` — manual fixes for groups where Wikidata's label is wrong or the infobox parser misses.

### Idols
After the group scrape, the pipeline pulls `wdt:P527` (members) of every kept group and enriches each member with:
- **birth_year** from `P569` (date of birth)
- **gender** from `P21`
- **nationality** from `P27` (citizenship) — prefers a non-Korean citizenship when multiple are present, since "Korean" is the K-pop default and a non-Korean tag is the more disambiguating clue
- **groups** they belong to (all P527 backlinks across the 405 groups)
- **debut_year** = min(group debut years they're in) → **generation** derived
- **primary_group / company** = inherited from their most popular group

Idols are popularity-tiered by their most popular group's pageviews. Output: `data/idols.json` (~1.3k idols) and `data/idols.index.json`.

**Inclusion criteria** (in `scripts/scrape.py`):
- Either (a) tagged with K-pop genre `wdt:P136 wd:Q213665`, **or** (b) South Korean with a K-pop-shaped P31 (`girl group` Q641066, `boy band` Q216337, `male idol group`, etc.), **or** (c) on the short hand-picked Q-ID allowlist (HYBE/SM sub-units operating from Japan or China — `&TEAM`, `WayV`, `XG`, `BoyNextDoor`).
- Has either an English or Korean Wikipedia article.
- Has a debut year — taken from Wikidata `P571` (inception) or, if absent, the first year in the Wikipedia infobox `years_active` field.
- Has a member count — taken from Wikidata `P527` (member list) or, if absent, by counting wikilinks in the infobox `current_members` + `past_members` fields.

**Generation cutoffs** (canonical for this project; fan discourse varies):

| Gen | Debut year |
|-----|------------|
| 1   | ≤ 2002     |
| 2   | 2003–2011  |
| 3   | 2012–2017  |
| 4   | 2018–2022  |
| 5   | 2023+      |

**Status**: groups with a dissolution date (`P576`) are marked `disbanded`; others are `active`. Hiatus is not reliably derivable from Wikidata, so it's collapsed into `active`.

**Popularity**: sum of the last 90 days of English Wikipedia pageviews. Drives the tier ranking (top 100 → easy, top 300 → medium, the rest → hard).

## Architecture

```
KPopdle/
├── index.html              # Single entry
├── css/                    # reset + layout + cell styles
├── js/                     # ES modules, loaded as <script type="module">
│   ├── main.js             # boot + wiring
│   ├── config.js           # tier rules, visible attrs per difficulty
│   ├── data.js             # fetch(data/groups.json + data/idols.json)
│   ├── seed.js             # cyrb53 hash + UTC date helpers (pure)
│   ├── compare.js          # per-attribute comparison (pure)
│   ├── clues.js            # derives & formats the "Known so far" panel (pure)
│   ├── hint.js             # hint cost, ordering, attr-known logic (pure)
│   ├── share.js            # emoji grid + clipboard text + URL helpers (pure)
│   ├── puzzle.js           # custom-puzzle URL hash encode/decode (pure)
│   ├── i18n.js             # tiny synchronous t() + locale loader
│   ├── i18n-en.js          # English fallback bundled inline (auto-generated)
│   ├── autocomplete.js     # tier-restricted prefix/alias/substring search
│   ├── render.js           # the only DOM writer
│   ├── state.js            # in-memory session state
│   ├── persist.js          # the only localStorage writer
│   └── ui.js               # toggles + settings popover + countdown
├── locales/                # en.json + ko.json (UI translations)
├── data/                   # generated; commit to repo
└── scripts/                # offline scrape pipeline (Python) + build helpers (Node)
```

Pure modules (`compare`, `seed`, `clues`, `hint`, `share`, `puzzle`) have unit tests under `tests/`. The rest is UI plumbing.

## Tests

```bash
npm test                    # node --test tests/*.test.mjs (currently 7 suites: clues, compare, hint, persist, puzzle, seed, share)
```

(`package.json` declares `"type": "module"` so the `.js` files run as ESM under Node 20+.)

## Persistence

Game data is in `localStorage` under `kpopdle:v2`, with one bucket per entity (`group`, `idol`):

- `daily[difficulty]` — last played date, guess count, target id for "already played today" detection.
- `streaks[difficulty]` — current and best daily streak.
- `bests[difficulty]` — fewest guesses ever recorded.
- `endless[difficulty]` — plays + best guess count.
- `active[mode][difficulty]` — in-progress round (guesses + hint reveals + detective flag) so a reload mid-game resumes seamlessly.
- `history` — last 100 results (including endless skips and give-ups).

Preferences are split into their own keys so resetting stats doesn't wipe your theme:

- `kpopdle:theme` — `auto` / `light` / `dark`
- `kpopdle:cb` — colorblind palette on/off
- `kpopdle:calm` — reduced-motion mode on/off
- `kpopdle:filter` — detective mode on/off
- `kpopdle:lang` — `auto` / `en` / `ko`
- `kpopdle:lastSelection` — last entity/mode/difficulty combo, restored on reload
- `kpopdle:visited` — first-visit help-modal flag

"Reset all stats" (Settings) clears just `kpopdle:v2`; preferences are kept.

## Hosting

It's a static site. You can either:

1. **Deploy the source directly.** The repo as-is can be served by any static host — no build required for it to work.
2. **Run the build for a smaller bundle** (recommended for prod):

   ```sh
   npm install        # one-time, installs esbuild
   npm run build      # produces dist/
   npm run preview    # builds + serves dist/ on :8124 for a smoke test
   ```

   `dist/` contains a minified single-file JS bundle, a concatenated minified CSS file, a stripped HTML, plus the encoded data, favicon, manifest, and service worker. Drop `dist/` on GitHub Pages, Netlify, Cloudflare Pages, etc.

Typical reduction: JS ~58% smaller, CSS ~32% smaller, fewer HTTP round-trips (one CSS + one JS instead of three CSS + a dozen ES modules).

### GitHub Pages (automated)

A workflow at [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds and publishes the minified `dist/` to GitHub Pages on every push to `main`. One-time setup:

1. Push the repo to GitHub.
2. In the repo: **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
3. Push (or merge) to `main`. The workflow installs deps, runs unit tests, builds `dist/`, and deploys.
4. After the first successful run, the site URL appears in the Actions summary and on the Pages settings page (typically `https://<user>.github.io/<repo>/`).

Manual re-deploy is available from the **Actions** tab → "Build and deploy to GitHub Pages" → **Run workflow**.

A separate [.github/workflows/test.yml](.github/workflows/test.yml) runs `npm test` and a build dry-run on every pull request, so you get an early signal before merging.

**Notes for project pages (`/<repo>/` path):**

- All asset paths in `index.html` are relative (`js/main.min.js`, not `/js/...`), so the bundle works at root *or* a subpath without changes.
- The manifest's `start_url` / `scope` are `"./"`, so PWA install works at the subpath too.
- The service worker is registered with a relative `./sw.js`, scoped to wherever it sits. Bump `VERSION` in [sw.js](sw.js) when you ship a change that needs to invalidate users' caches — old caches are pruned in `activate`.

### Updating the dataset

To refresh from Wikidata + Wikipedia:

```sh
npm run scrape     # writes data/groups.json + data/idols.json
npm run encode     # encodes them into data/groups.dat + data/idols.dat
npm run build      # produces dist/ with the new encoded data
```

Both the human-readable `.json` and the encoded `.dat` files are tracked in the repo. Only the `.dat` files are copied into `dist/` — that's the light obfuscation that keeps the answer out of the Network tab on the deployed site. The `.json` files are useful for diffing data changes, manual inspection, or re-encoding with a different key.

## Internationalization

The UI ships English (bundled inline so `t()` works synchronously from import time) plus a fetch-loaded Korean translation. Entity names stay romanized in every locale — only chrome (labels, buttons, banners, settings, help, footer) is translated.

```
locales/
├── en.json           # source of truth (147 keys)
└── ko.json           # 한국어
```

`js/i18n-en.js` mirrors `locales/en.json` and is **auto-generated** by `scripts/sync-i18n-en.mjs` — never hand-edit it. The generator runs as a pre-step of `npm run build` and `npm run preview`, or invoke directly:

```sh
npm run sync-i18n
```

To add a new locale:

1. Copy `locales/en.json` to `locales/<code>.json` and translate the values.
2. Add the code to `SUPPORTED` in `js/i18n.js`.
3. Add a button label entry in `attachLangToggle` (`js/ui.js`).

The language toggle lives in **Settings → Language**. Changing it triggers a `location.reload()` so every dynamic string repaints cleanly in the new locale; the in-progress round is restored from localStorage on reload, so the player doesn't lose progress.

## Roadmap

- Album / single mode.
- Hiatus detection.
- More locales (Japanese, Spanish).

## Authorship

This project was written by **Claude** (Anthropic), through extended conversations with the Claude Code CLI. The code, data scrapers, build pipeline, unit tests, translations, service worker, and this README were all generated by the model. A human collaborator made the product decisions, curated data overrides for known edge cases, drove the testing loop, and reviewed each change before commit — but the artifacts themselves are Claude's work.

Commits authored during this collaboration carry a `Co-Authored-By: Claude` trailer so the provenance is preserved in `git log`.

## License

The code is released into the public domain via [The Unlicense](LICENSE). Do whatever you want with it.

The data shipped in `data/*.dat` is derived from [Wikidata](https://www.wikidata.org) (CC0) and [Wikipedia](https://en.wikipedia.org) (CC BY-SA 4.0). The extracted facts (debut years, member counts, etc.) aren't copyrightable in most jurisdictions; attribution is provided in the app footer as a courtesy. See [LICENSE](LICENSE) for the longer note.
