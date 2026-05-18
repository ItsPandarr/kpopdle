"""
Identify entries in data/{groups,idols}.json that are missing values for one
or more of the attributes the game cares about, then attempt to backfill from
Wikipedia's infobox. Writes proposed patches to scripts/proposed-patches.json
for review before they touch the live data.

Two-step flow:

  1. python3 scripts/fill-gaps.py fetch
     - Walks both datasets, finds gaps, queries Wikipedia for each.
     - Writes scripts/proposed-patches.json and a sibling .md summary.
     - Skips entries with no proposed values (Wikipedia had nothing useful).

  2. (Review scripts/proposed-patches.md and edit proposed-patches.json
     to remove or change anything you don't trust.)

  3. python3 scripts/fill-gaps.py apply
     - Updates data/groups.json + data/idols.json in place.
     - Merges into scripts/overrides.json so re-scrapes keep the fixes.
     - Re-runs encode_data.py so the .dat bundles match.

Implementation notes:

  - Uses the existing scripts/wikipedia.py helpers where applicable.
    `parse_agency` already knows how to read the agency/label field; we wrap
    its lookup with a fetch-by-title against the MediaWiki action API
    (no API key needed; user-agent string set so Wikipedia doesn't 403 us).
  - For gender we look at the wikitext for explicit "boy band" / "girl group" /
    "co-ed" / member-pronoun cues. Anything ambiguous is skipped — better to
    leave a gap than confidently fill in the wrong value.
  - For numeric fields (birth_year, debut_year) and nationality, we parse the
    obvious infobox fields with conservative regex. Skips on doubt.
  - Polite: 350ms sleep between requests, one in-flight at a time.
"""

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PROPOSED_JSON = ROOT / "scripts" / "proposed-patches.json"
PROPOSED_MD = ROOT / "scripts" / "proposed-patches.md"
OVERRIDES = ROOT / "scripts" / "overrides.json"

# Reuse the existing infobox parser where possible.
sys.path.insert(0, str(ROOT / "scripts"))
try:
    from wikipedia import parse_agency  # type: ignore
except Exception:
    parse_agency = None  # we'll fall back to local regex

UA = "KPopdle-fill-gaps/1.0 (https://github.com; data backfill)"
SLEEP_S = 0.35

VISIBLE_ATTRS = {
    "group": ["debut_year", "generation", "company", "member_count",
              "gender", "status", "country"],
    "idol":  ["birth_year", "debut_year", "generation", "primary_group",
              "gender", "nationality", "company"],
}

# Only try to backfill these fields. (We don't touch generation / member_count
# / debut_year for groups via this tool — those are reliably scraped from
# Wikidata. Things Wikidata typically misses are agency/label and gender.)
BACKFILL = {
    "group": ["company", "gender"],
    "idol":  ["company", "gender", "nationality", "birth_year"],
}

# ─── HTTP ──────────────────────────────────────────────────────────────────────

def http_get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_wikitext_by_qid(qid):
    """Resolve QID → enwiki title → wikitext. Returns (title, wikitext) or (None, None)."""
    sl = http_get_json(
        f"https://www.wikidata.org/w/api.php?action=wbgetentities"
        f"&ids={urllib.parse.quote(qid)}&props=sitelinks&format=json&sitefilter=enwiki"
    )
    title = sl.get("entities", {}).get(qid, {}).get("sitelinks", {}).get("enwiki", {}).get("title")
    if not title:
        return None, None
    page = http_get_json(
        "https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext"
        f"&page={urllib.parse.quote(title)}"
    )
    wt = page.get("parse", {}).get("wikitext", {}).get("*")
    return title, wt


# ─── Field extractors (conservative — return None if not certain) ──────────────

def _slice_infobox(wt):
    if not wt:
        return ""
    # First {{Infobox ... }} block. Robust enough for our needs; doesn't handle
    # heavily-nested templates but the K-pop infoboxes are typically flat.
    m = re.search(r"\{\{[Ii]nfobox[^|]*\|", wt)
    if not m:
        return wt[:6000]  # fall back to a chunk
    start = m.start()
    depth = 0
    i = start
    while i < len(wt):
        if wt[i:i+2] == "{{": depth += 1; i += 2; continue
        if wt[i:i+2] == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return wt[start:i]
            continue
        i += 1
    return wt[start:start + 6000]


def _strip_wiki(s):
    # [[Article|display]] → display ; [[Article]] → Article ; remove refs / templates
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<ref[^/]*/>", "", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"'''?", "", s)
    s = s.replace("&nbsp;", " ").strip()
    s = re.sub(r"\s+", " ", s)
    return s.strip(", ;")


def _get_field(infobox, *names):
    for name in names:
        m = re.search(
            rf"\n\s*\|\s*{re.escape(name)}\s*=\s*([^\n|][^\n]*)",
            infobox,
            re.IGNORECASE,
        )
        if m:
            val = _strip_wiki(m.group(1))
            if val:
                return val
    return None


def extract_company(wt):
    """Returns a single-line company string, or None."""
    if parse_agency:
        v = parse_agency(wt)
        if v:
            return v
    ib = _slice_infobox(wt)
    raw = _get_field(ib, "agency", "label", "labels", "current_members_label",
                     "associated_acts")
    if not raw:
        return None
    # Take the first label if comma/slash-separated.
    raw = re.split(r"[/,;]| and ", raw)[0].strip()
    # Strip parens.
    raw = re.sub(r"\([^)]*\)", "", raw).strip()
    return raw or None


def extract_gender(wt):
    """Returns 'boy', 'girl', 'coed', or None. Conservative — leaves ambiguous unset."""
    ib = _slice_infobox(wt).lower()
    if re.search(r"\bgirl[- ]?group\b|\bfemale[- ]?(?:vocal )?group\b", ib):
        return "girl"
    if re.search(r"\bboy[- ]?(?:band|group)\b|\bmale[- ]?(?:vocal )?group\b", ib):
        return "boy"
    if re.search(r"\bco[-]?ed\b|\bmixed[- ]gender\b", ib):
        return "coed"
    # Body text fallback.
    body = wt[:6000].lower()
    if "girl group" in body and "boy" not in body[:body.find("girl group")][-80:]:
        return "girl"
    if "boy band" in body or "boy group" in body:
        return "boy"
    if "co-ed group" in body or "coed group" in body:
        return "coed"
    return None


def extract_nationality(wt):
    ib = _slice_infobox(wt)
    raw = _get_field(ib, "nationality", "birth_place", "origin")
    if not raw:
        return None
    raw = raw.lower()
    if "south korea" in raw or "korea" in raw: return "Korean"
    if "japan" in raw: return "Japanese"
    if "china" in raw or "chinese" in raw: return "Chinese"
    if "thailand" in raw or "thai" in raw: return "Thai"
    if "vietnam" in raw: return "Vietnamese"
    if "taiwan" in raw: return "Taiwanese"
    if "philippines" in raw or "filipino" in raw: return "Filipino"
    if "united states" in raw or "american" in raw: return "American"
    if "canada" in raw or "canadian" in raw: return "Canadian"
    if "australia" in raw or "australian" in raw: return "Australian"
    return None


def extract_birth_year(wt):
    ib = _slice_infobox(wt)
    raw = _get_field(ib, "birth_date", "born")
    if not raw:
        return None
    m = re.search(r"(19|20)\d{2}", raw)
    return int(m.group(0)) if m else None


EXTRACTORS = {
    "company": extract_company,
    "gender": extract_gender,
    "nationality": extract_nationality,
    "birth_year": extract_birth_year,
}


# ─── Workflows ─────────────────────────────────────────────────────────────────

def fetch_proposals():
    proposals = []  # one entry per record with at least one filled field
    for kind in ("group", "idol"):
        file = DATA / f"{kind}s.json"
        if not file.exists():
            print(f"!! missing {file} — skip", file=sys.stderr)
            continue
        with file.open() as f:
            payload = json.load(f)
        arr = payload["groups" if kind == "group" else "idols"]
        gaps = []
        for e in arr:
            missing = [a for a in BACKFILL[kind] if not e.get(a)]
            if missing:
                gaps.append((e, missing))
        print(f"{kind}: {len(gaps)} entries with one or more gaps")
        for i, (e, missing) in enumerate(gaps, 1):
            qid = e["id"]
            try:
                title, wt = fetch_wikitext_by_qid(qid)
            except Exception as ex:
                print(f"  [{i}/{len(gaps)}] {e['name']} ({qid}): fetch error: {ex}")
                time.sleep(SLEEP_S)
                continue
            if not wt:
                print(f"  [{i}/{len(gaps)}] {e['name']} ({qid}): no enwiki page")
                time.sleep(SLEEP_S)
                continue
            patch = {}
            for attr in missing:
                fn = EXTRACTORS.get(attr)
                if not fn:
                    continue
                val = fn(wt)
                if val is not None:
                    patch[attr] = val
            if patch:
                proposals.append({
                    "kind": kind,
                    "id": qid,
                    "name": e["name"],
                    "title": title,
                    "patch": patch,
                    "missing": missing,
                })
                print(f"  [{i}/{len(gaps)}] {e['name']}: {patch}")
            else:
                print(f"  [{i}/{len(gaps)}] {e['name']}: no extractable fields")
            time.sleep(SLEEP_S)
    # Persist.
    PROPOSED_JSON.write_text(json.dumps(proposals, ensure_ascii=False, indent=2))
    md = ["# Proposed patches\n",
          f"Generated by `scripts/fill-gaps.py fetch`. Review then run `apply`.\n",
          f"\n**Total proposals:** {len(proposals)}\n"]
    for p in proposals:
        md.append(f"\n## {p['name']} ({p['kind']}, {p['id']})\n")
        md.append(f"- enwiki: <https://en.wikipedia.org/wiki/{urllib.parse.quote(p['title'].replace(' ', '_'))}>\n")
        md.append(f"- missing: {', '.join(p['missing'])}\n")
        md.append(f"- proposed patch:\n")
        for k, v in p["patch"].items():
            md.append(f"  - `{k}`: `{v!r}`\n")
    PROPOSED_MD.write_text("".join(md))
    print(f"\n→ wrote {PROPOSED_JSON} and {PROPOSED_MD}")
    print(f"  review the .md, edit the .json if needed, then run:")
    print(f"    python3 scripts/fill-gaps.py apply")


def apply_proposals():
    if not PROPOSED_JSON.exists():
        print(f"!! {PROPOSED_JSON} not found — run `fetch` first", file=sys.stderr)
        sys.exit(1)
    proposals = json.loads(PROPOSED_JSON.read_text())
    if not proposals:
        print("nothing to apply")
        return

    # 1) Patch data/{groups,idols}.json
    for kind in ("group", "idol"):
        file = DATA / f"{kind}s.json"
        with file.open() as f:
            payload = json.load(f)
        arr = payload["groups" if kind == "group" else "idols"]
        idx = {e["id"]: e for e in arr}
        n = 0
        for p in proposals:
            if p["kind"] != kind: continue
            e = idx.get(p["id"])
            if not e: continue
            for k, v in p["patch"].items():
                e[k] = v
            n += 1
        file.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        print(f"patched {n} {kind} entries in {file.name}")

    # 2) Merge into overrides.json (so future scrapes keep these fixes)
    if OVERRIDES.exists():
        existing = json.loads(OVERRIDES.read_text())
    else:
        existing = {}
    for p in proposals:
        cur = existing.get(p["id"], {"name": p["name"]})
        cur.update(p["patch"])
        cur.setdefault("name", p["name"])
        existing[p["id"]] = cur
    OVERRIDES.write_text(json.dumps(existing, ensure_ascii=False, indent=2))
    print(f"merged into {OVERRIDES.name} ({len(existing)} total overrides)")

    # 3) Re-encode .dat
    print("re-encoding .dat …")
    import subprocess
    subprocess.run([sys.executable, str(ROOT / "scripts" / "encode_data.py")], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["fetch", "apply"])
    args = ap.parse_args()
    if args.action == "fetch":
        fetch_proposals()
    else:
        apply_proposals()


if __name__ == "__main__":
    main()
