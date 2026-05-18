"""
Fill in official-color fields on groups and idols by querying Wikidata for
P462 (color) → P465 (sRGB hex). Writes back to data/{groups,idols}.json with
a new `colors` field — an array of "#RRGGBB" strings (deduplicated, uppercase).

Re-runs are idempotent. Entities with no color on Wikidata get no `colors`
field; the JS falls back to the default theme palette in that case.

Workflow:
    python3 scripts/fill-colors.py
    python3 scripts/encode_data.py    # re-encode the .dat bundle

Batches QIDs ~50 at a time through the public SPARQL endpoint. Polite delay
between batches; identifies via User-Agent.
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

SPARQL_URL = "https://query.wikidata.org/sparql"
UA = "KPopdle/0.1 (https://github.com/ItsPandarr/kpopdle)"
BATCH = 50
SLEEP_S = 1.0
# WDQS occasionally enters aggressive rate-limit mode (e.g. 1 req/min) during
# outages. When we see 429s, wait this long and retry up to MAX_RETRIES times.
RATE_LIMIT_WAIT_S = 70
MAX_RETRIES = 3


def run_sparql(query):
    params = urllib.parse.urlencode({"query": query, "format": "json"})
    last_err = None
    for attempt in range(MAX_RETRIES):
        req = urllib.request.Request(
            f"{SPARQL_URL}?{params}",
            headers={"User-Agent": UA, "Accept": "application/sparql-results+json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (429, 503):
                wait = RATE_LIMIT_WAIT_S
                print(f"    rate-limited ({e.code}); waiting {wait}s before retry {attempt + 1}/{MAX_RETRIES}",
                      file=sys.stderr)
                time.sleep(wait)
                continue
            raise
    raise last_err


def fetch_colors(qids):
    """Return {qid: ["#RRGGBB", ...]} for the given QIDs."""
    if not qids:
        return {}
    values = " ".join(f"wd:{q}" for q in qids)
    sparql = f"""
SELECT ?entity ?hex WHERE {{
  VALUES ?entity {{ {values} }}
  ?entity wdt:P462 ?color .
  ?color wdt:P465 ?hex .
}}
"""
    result = run_sparql(sparql)
    out = {}
    for b in result["results"]["bindings"]:
        qid = b["entity"]["value"].rsplit("/", 1)[-1]
        hex_val = b["hex"]["value"].strip().upper().lstrip("#")
        # Some Wikidata values are "fff" or "FFFFFF"; normalize to 6-digit.
        if len(hex_val) == 3:
            hex_val = "".join(c * 2 for c in hex_val)
        if len(hex_val) != 6 or not all(c in "0123456789ABCDEF" for c in hex_val):
            continue
        out.setdefault(qid, []).append(f"#{hex_val}")
    return out


def process(file_path, key, label):
    if not file_path.exists():
        print(f"!! missing {file_path} — skip", file=sys.stderr)
        return
    with file_path.open() as f:
        payload = json.load(f)
    arr = payload[key]
    qids = [e["id"] for e in arr if e.get("id")]

    print(f"\n=== {label} ({len(qids)} entities) ===")
    colors_by_qid = {}
    n_batches = (len(qids) + BATCH - 1) // BATCH
    for i in range(0, len(qids), BATCH):
        batch = qids[i:i + BATCH]
        try:
            hit = fetch_colors(batch)
        except Exception as e:
            print(f"  batch {i // BATCH + 1}/{n_batches}: error: {e}")
            time.sleep(SLEEP_S * 3)
            continue
        colors_by_qid.update(hit)
        print(f"  batch {i // BATCH + 1}/{n_batches}: {len(hit)} entities with colors")
        time.sleep(SLEEP_S)

    n_added, n_cleared, n_unchanged = 0, 0, 0
    for e in arr:
        cols = colors_by_qid.get(e["id"])
        if cols:
            new = sorted(set(cols))
            if e.get("colors") == new:
                n_unchanged += 1
            else:
                e["colors"] = new
                n_added += 1
        elif "colors" in e:
            del e["colors"]
            n_cleared += 1

    file_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"  → {n_added} new/updated, {n_cleared} removed (no color), {n_unchanged} unchanged")


def main():
    process(DATA / "groups.json", "groups", "groups")
    process(DATA / "idols.json", "idols", "idols")
    print("\nDone. Next: python3 scripts/encode_data.py")


if __name__ == "__main__":
    main()
