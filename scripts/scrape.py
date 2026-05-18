#!/usr/bin/env python3
"""KPopdle scrape pipeline.

Pulls K-pop groups from Wikidata, enriches with Wikipedia infobox + pageviews,
and writes data/groups.json + data/groups.index.json.

Usage:
    python3 scripts/scrape.py [--limit N]

Output is atomic: writes data/groups.json.tmp then renames on success only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Allow running as `python3 scripts/scrape.py` from project root.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sparql import run_sparql, qid  # noqa: E402
from wikipedia import (  # noqa: E402
    pageviews_90d,
    fetch_wikitext_batch,
    parse_agency,
    parse_member_count,
    parse_years_active,
)
from normalize import (  # noqa: E402
    generation_from_year,
    gender_from_members,
    canonical_company,
    company_parent,
)

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUT_FULL = DATA_DIR / "groups.json"
OUT_INDEX = DATA_DIR / "groups.index.json"
OUT_IDOLS = DATA_DIR / "idols.json"
OUT_IDOL_INDEX = DATA_DIR / "idols.index.json"
TIER_EASY = 100
TIER_MEDIUM = 300
IDOL_TIER_EASY = 100
IDOL_TIER_MEDIUM = 300

# Shared WHERE clause that anchors a "K-pop group" candidate set.
#
# Two UNION branches:
#  (1) any musical-group entity whose genre includes K-pop (Q213665) — catches BTS, BLACKPINK,
#      TWICE, Red Velvet, Treasure, …
#  (2) any South Korean group whose P31 is one of {girl group, boy band, idol group, K-pop musical
#      group} — catches groups whose Wikidata page hasn't been genre-tagged (e.g. MAMAMOO).
#
# Q-IDs used:
#   Q213665   = K-pop                          (genre)
#   Q215380   = musical group                  (class root)
#   Q641066   = girl group                     (the music-ensemble sense — what K-pop uses)
#   Q216337   = boy band                       (ditto)
#   Q188651   = girl group                     (Wikipedia-category sense; kept as fallback)
#   Q26505968 = boy band                       (ditto)
#   Q1063268  = idol group
#   Q5741069  = K-pop musical group
#   Q884      = South Korea                    (country of origin)
_ANCHOR = """
  {
    ?group wdt:P136 wd:Q213665 .
    ?group wdt:P31 ?type .
    ?type (wdt:P279)* wd:Q215380 .
  } UNION {
    ?group wdt:P495 wd:Q884 .
    ?group wdt:P31 ?type .
    VALUES ?type {
      wd:Q641066 wd:Q216337            # girl group, boy band (real Q-IDs)
      wd:Q188651 wd:Q26505968          # girl group, boy band (Wikipedia-category Q-IDs)
      wd:Q1063268 wd:Q5741069          # idol group, K-pop musical group
      wd:Q119183009                    # male idol group (catches BoyNextDoor)
    }
  } UNION {
    # Manual force-include: K-pop-ecosystem groups whose Wikidata tags don't fit the
    # above (Japan/China based, weird P31, missing English label, etc.).
    # Note: scope is "groups people would expect to see in a K-pop guessing
    # game" — produced in K-pop style, by Korean labels (HYBE/SM/JYP/etc.)
    # or via K-pop survival-show pipelines, even when the members or release
    # market are Japan/US-centric.
    VALUES ?group {
      wd:Q118178306    # BoyNextDoor (no enLabel, p31=male idol group, SK)
      wd:Q112834233    # &TEAM       (HYBE, Japan-based, J-pop tagged)
      wd:Q60062907     # WayV        (SM, China-based, C-pop tagged)
      wd:Q111419721    # XG          (XGALX, Japan-based, J-pop tagged)
      wd:Q116767949    # Misamo      (Twice sub-unit, Japan-based)
      wd:Q123480242    # Katseye     (HYBE × Geffen, US-based)
      wd:Q122763643    # VCHA/Girlset (JYP USA)
      wd:Q78297569     # JO1         (Produce 101 Japan winners)
      wd:Q107248914    # INI         (Produce 101 Japan S2 winners)
      wd:Q123859475    # ME:I        (Produce 101 Japan The Girls winners)
      wd:Q116770778    # DXTEEN      (Japan-based, Boys Planet alumni)
      wd:Q109362306    # BUDDiiS     (Japan-based, K-pop adjacent)
      wd:Q135921764    # Saja Boys   (fictional KPop Demon Hunters group)
      wd:Q119025962    # Plave       (Korean virtual idol group)
    }
    ?group wdt:P31 ?type .
  }
"""

SPARQL_GROUPS = f"""
SELECT ?group ?groupLabel ?typeLabel ?inception ?dissolution ?enwikiName ?kowikiName WHERE {{
  {_ANCHOR}
  OPTIONAL {{ ?group wdt:P571 ?inception }}
  OPTIONAL {{ ?group wdt:P576 ?dissolution }}
  OPTIONAL {{
    ?enwiki schema:about ?group ;
            schema:isPartOf <https://en.wikipedia.org/> ;
            schema:name ?enwikiName .
  }}
  OPTIONAL {{
    ?kowiki schema:about ?group ;
            schema:isPartOf <https://ko.wikipedia.org/> ;
            schema:name ?kowikiName .
  }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" . }}
  FILTER(BOUND(?enwikiName) || BOUND(?kowikiName))
}}
"""

SPARQL_MEMBERS = f"""
SELECT ?group (COUNT(DISTINCT ?member) AS ?memberCount)
       (GROUP_CONCAT(DISTINCT ?genderLabel; separator="|") AS ?genders)
WHERE {{
  {_ANCHOR}
  ?group wdt:P527 ?member .
  OPTIONAL {{
    ?member wdt:P21 ?gender .
    ?gender rdfs:label ?genderLabel . FILTER(LANG(?genderLabel)="en")
  }}
}}
GROUP BY ?group
"""

SPARQL_ALIASES = f"""
SELECT ?group ?alias WHERE {{
  {_ANCHOR}
  ?group skos:altLabel ?alias .
  FILTER(LANG(?alias) IN ("en", "ko"))
}}
"""


def load_overrides() -> dict:
    path = Path(__file__).parent / "overrides.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {k: v for k, v in data.items() if not k.startswith("_")}


def load_idol_overrides() -> dict:
    """Per-idol manual overrides keyed by Q-ID. Same shape as group overrides;
    only the keys present override (everything else from the scrape is kept).
    Comment fields (anything starting with "_") are stripped."""
    path = Path(__file__).parent / "idol-overrides.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    out = {}
    for k, v in data.items():
        if k.startswith("_"):
            continue
        # Drop comment-style keys inside individual entries too (e.g. "_label", "_note")
        clean = {kk: vv for kk, vv in v.items() if not kk.startswith("_")}
        out[k] = clean
    return out


def parse_year(iso: str | None) -> int | None:
    if not iso:
        return None
    m = re.match(r"(-?\d{1,4})", iso)
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def parse_iso_date(iso: str | None) -> str | None:
    """Wikidata dates come as 1996-01-01T00:00:00Z; we want YYYY-MM-DD."""
    if not iso:
        return None
    m = re.match(r"(-?\d{1,4})-(\d{2})-(\d{2})", iso)
    if m:
        return f"{m.group(1).zfill(4)}-{m.group(2)}-{m.group(3)}"
    return None


# Citizenship → demonym. The pool covers all common K-pop idol nationalities.
# We pick the first non-Korean if multiple are listed (more disambiguating); else Korean.
_NATIONALITY = {
    "South Korea": "Korean",
    "Japan": "Japanese",
    "China": "Chinese",
    "People's Republic of China": "Chinese",
    "Thailand": "Thai",
    "United States of America": "American",
    "Taiwan": "Taiwanese",
    "Hong Kong": "Hong Konger",
    "Vietnam": "Vietnamese",
    "Australia": "Australian",
    "Canada": "Canadian",
    "Indonesia": "Indonesian",
    "Singapore": "Singaporean",
    "Philippines": "Filipino",
    "Malaysia": "Malaysian",
    "Mongolia": "Mongolian",
    "Macau": "Macanese",
}


def pick_nationality(citizenships: list[str]) -> str | None:
    """From a list of citizenship country labels, return one demonym.

    Prefers a non-Korean citizenship if present (more disambiguating for K-pop guessing),
    otherwise returns Korean. Returns None if no recognized citizenship is in the list.
    """
    mapped = [_NATIONALITY.get(c) for c in citizenships if c]
    mapped = [m for m in mapped if m]
    if not mapped:
        return None
    non_kor = [m for m in mapped if m != "Korean"]
    return non_kor[0] if non_kor else "Korean"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Cap groups (for dev iterations)")
    parser.add_argument(
        "--skip-pageviews",
        action="store_true",
        help="Skip the pageviews API (fast smoke test). Resulting popularity = 0 for all.",
    )
    parser.add_argument(
        "--skip-wikitext",
        action="store_true",
        help="Skip Wikipedia infobox parsing (companies left as None unless override).",
    )
    parser.add_argument(
        "--skip-idols",
        action="store_true",
        help="Skip the idol scrape (just rebuild groups).",
    )
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("Querying Wikidata for K-pop groups...")
    rows = run_sparql(SPARQL_GROUPS)
    print(f"  got {len(rows)} group rows")

    # The UNION query can emit one row per (group, type) — dedupe by Q-ID and remember P31 type.
    groups: dict[str, dict] = {}
    p31_types: dict[str, set[str]] = {}
    for row in rows:
        gid = qid(row["group"])
        if t := row.get("typeLabel"):
            p31_types.setdefault(gid, set()).add(t)
        if gid in groups:
            continue
        debut_iso = parse_iso_date(row.get("inception"))
        debut_year = parse_year(row.get("inception"))
        diss_year = parse_year(row.get("dissolution"))
        enwiki = row.get("enwikiName")
        kowiki = row.get("kowikiName")
        # debut_year is the primary identifier — but it may come from infobox later.
        # Require either Wikidata P571 OR an enwiki article we can parse.
        if debut_year is None and not enwiki:
            continue
        # Wikidata sometimes lacks an English label; fall back to the enwiki page title.
        name = row.get("groupLabel") or enwiki or kowiki or gid
        if name.startswith("Q") and name[1:].isdigit():
            name = enwiki or kowiki or name
            if name.startswith("Q") and name[1:].isdigit():
                continue  # really no usable name anywhere — skip
        groups[gid] = {
            "id": gid,
            "name": name,
            "aliases": [],
            "debut_date": debut_iso,
            "debut_year": debut_year,
            "generation": generation_from_year(debut_year) if debut_year else None,
            "company": None,
            "company_parent": None,
            "member_count": None,
            "gender": None,
            "status": "disbanded" if diss_year is not None else "active",
            "country": "KR",
            "popularity": 0,
            "tier": "hard",
            "_enwikiName": enwiki,
            "_kowikiName": kowiki,
        }
    print(f"  retained {len(groups)} candidate groups")

    print("Querying member counts + gender aggregation...")
    member_rows = run_sparql(SPARQL_MEMBERS)
    for row in member_rows:
        gid = qid(row["group"])
        if gid not in groups:
            continue
        try:
            groups[gid]["member_count"] = int(row["memberCount"])
        except (ValueError, KeyError):
            pass
        gender_str = row.get("genders", "")
        genders = [g for g in gender_str.split("|") if g]
        groups[gid]["gender"] = gender_from_members(genders)

    # P31 type fallback for gender ("girl group" → girl, "boy band" → boy).
    type_to_gender = {
        "girl group": "girl",
        "boy band": "boy",
        "boy group": "boy",
        "girl band": "girl",
        "male idol group": "boy",
        "female idol group": "girl",
    }
    for gid, types in p31_types.items():
        if gid not in groups:
            continue
        if groups[gid]["gender"]:
            continue
        for t in types:
            g = type_to_gender.get(t.lower())
            if g:
                groups[gid]["gender"] = g
                break

    print("Querying aliases...")
    alias_rows = run_sparql(SPARQL_ALIASES)
    for row in alias_rows:
        gid = qid(row["group"])
        if gid not in groups:
            continue
        alias = row.get("alias", "").strip()
        if not alias:
            continue
        existing = groups[gid]["aliases"]
        if alias != groups[gid]["name"] and alias not in existing:
            existing.append(alias)
    # Cap aliases per group to keep payload small.
    for g in groups.values():
        g["aliases"] = g["aliases"][:6]

    if not args.skip_wikitext:
        print("Fetching Wikipedia infoboxes for company + member-count + debut-year fallback...")
        titles = [g["_enwikiName"] for g in groups.values() if g.get("_enwikiName")]
        wikitexts = fetch_wikitext_batch(titles)
        for g in groups.values():
            t = g.get("_enwikiName")
            if not t or t not in wikitexts:
                continue
            wt = wikitexts[t]
            agency = parse_agency(wt)
            if agency:
                g["company"] = canonical_company(agency)
                g["company_parent"] = company_parent(g["company"])
            if not g["member_count"]:
                mc = parse_member_count(wt)
                if mc:
                    g["member_count"] = mc
            if not g["debut_year"]:
                yr = parse_years_active(wt)
                if yr:
                    g["debut_year"] = yr
                    g["generation"] = generation_from_year(yr)
                    g["debut_date"] = f"{yr:04d}-01-01"  # year-precision only

    if not args.skip_pageviews:
        print("Fetching Wikipedia pageviews (90d)... this is the slow part.")
        n = len(groups)
        for i, g in enumerate(groups.values(), 1):
            t = g.get("_enwikiName")
            if not t:
                continue
            g["popularity"] = pageviews_90d(t)
            if i % 50 == 0:
                print(f"  pageviews {i}/{n}")

    # Drop groups with no debut year (Wikidata + infobox both empty).
    before = len(groups)
    groups = {gid: g for gid, g in groups.items() if g["debut_year"]}
    print(f"  dropped {before - len(groups)} with no debut year after fallback")
    # Drop groups where member_count is still unknown after both Wikidata and infobox fallback —
    # comparison cells would otherwise show "—" for every guess.
    before = len(groups)
    groups = {gid: g for gid, g in groups.items() if (g["member_count"] or 0) >= 1}
    print(f"  dropped {before - len(groups)} with no member count after fallback")

    # Apply manual overrides last.
    overrides = load_overrides()
    for gid, ov in overrides.items():
        if gid in groups:
            for k, v in ov.items():
                if k == "extra_aliases":
                    # Special-cased: extend the existing aliases list rather
                    # than replacing it. Used to backfill commonly-typed
                    # Hangul names (e.g. 방탄소년단 for BTS) without losing
                    # the Wikidata-sourced ones.
                    existing = groups[gid].get("aliases") or []
                    extras = list(v or [])
                    # De-dupe while preserving order
                    seen = set(existing)
                    merged = list(existing)
                    for x in extras:
                        if x not in seen:
                            merged.append(x)
                            seen.add(x)
                    groups[gid]["aliases"] = merged
                elif v is not None:
                    groups[gid][k] = v
            if "company" in ov and "company_parent" not in ov:
                groups[gid]["company_parent"] = company_parent(ov["company"])

    # Drop internal fields and finalize.
    final = []
    for g in groups.values():
        g.pop("_enwikiName", None)
        g.pop("_kowikiName", None)
        final.append(g)

    # Apply --limit AFTER sorting, so the highest-popularity groups survive.
    final.sort(key=lambda g: (-g["popularity"], g["name"]))
    if args.limit:
        final = final[: args.limit]
    for rank, g in enumerate(final):
        if rank < TIER_EASY:
            g["tier"] = "easy"
        elif rank < TIER_MEDIUM:
            g["tier"] = "medium"
        else:
            g["tier"] = "hard"

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tier_thresholds": {"easy": TIER_EASY, "medium": TIER_MEDIUM},
        "groups": final,
    }
    index_payload = [
        {"id": g["id"], "name": g["name"], "aliases": g["aliases"], "tier": g["tier"]}
        for g in final
    ]

    tmp_full = OUT_FULL.with_suffix(".json.tmp")
    tmp_index = OUT_INDEX.with_suffix(".json.tmp")
    tmp_full.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    tmp_index.write_text(json.dumps(index_payload, ensure_ascii=False, indent=2))
    shutil.move(tmp_full, OUT_FULL)
    shutil.move(tmp_index, OUT_INDEX)

    # Sanity summary. Pools are cumulative (easy ⊂ medium ⊂ hard), so report POOL sizes.
    pool_easy = sum(1 for g in final if g["tier"] == "easy")
    pool_medium = sum(1 for g in final if g["tier"] in ("easy", "medium"))
    pool_hard = len(final)
    missing_company_easy = sum(1 for g in final if g["tier"] == "easy" and not g["company"])
    missing_company_med = sum(
        1 for g in final if g["tier"] in ("easy", "medium") and not g["company"]
    )
    print()
    print(f"  total groups: {len(final)}")
    print(f"  pool sizes: easy={pool_easy}  medium={pool_medium}  hard={pool_hard}")
    print(f"  easy missing company: {missing_company_easy}")
    print(f"  medium missing company: {missing_company_med}")
    print(f"  wrote {OUT_FULL.relative_to(ROOT)} and {OUT_INDEX.relative_to(ROOT)}")

    if not args.skip_idols:
        scrape_idols(final)


def scrape_idols(groups: list[dict]) -> None:
    """Pull the membership of every group we kept, then enrich each member.

    Output: data/idols.json, data/idols.index.json.

    Derived per idol:
        - debut_year = min(group.debut_year for groups they're in)
        - generation = generation_from_year(debut_year)
        - company / company_parent = inherited from the most popular group they're in
        - nationality = non-Korean if any, else Korean
        - popularity = max(group.popularity for groups they're in)
    """
    print("\nScraping idol members for every kept group...")
    group_by_id = {g["id"]: g for g in groups}
    gids = sorted(group_by_id)
    if not gids:
        print("  no groups — skipping idol scrape")
        return

    # Batch the VALUES list — Wikidata SPARQL can choke on a single 400+ VALUES block.
    BATCH = 80
    members: dict[str, dict] = {}  # idol Q-ID → {group_ids:set, fields...}
    for i in range(0, len(gids), BATCH):
        batch = gids[i : i + BATCH]
        values = " ".join(f"wd:{g}" for g in batch)
        q = f"""
SELECT ?idol ?idolLabel ?group ?enwikiName ?birth ?genderLabel ?citizenshipLabel WHERE {{
  VALUES ?group {{ {values} }}
  ?group wdt:P527 ?idol .
  ?idol wdt:P31 wd:Q5 .   # human (filters out sub-units / instruments)
  OPTIONAL {{ ?idol wdt:P569 ?birth }}
  OPTIONAL {{ ?idol wdt:P21 ?gender . ?gender rdfs:label ?genderLabel . FILTER(LANG(?genderLabel)="en") }}
  OPTIONAL {{ ?idol wdt:P27 ?citizenship . ?citizenship rdfs:label ?citizenshipLabel . FILTER(LANG(?citizenshipLabel)="en") }}
  OPTIONAL {{
    ?enwiki schema:about ?idol ;
            schema:isPartOf <https://en.wikipedia.org/> ;
            schema:name ?enwikiName .
  }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" . }}
}}
"""
        for row in run_sparql(q):
            iid = qid(row["idol"])
            grp = qid(row["group"])
            entry = members.setdefault(
                iid,
                {
                    "id": iid,
                    "name": None,
                    "aliases": [],
                    "birth_year": None,
                    "group_ids": set(),
                    "genders": set(),
                    "citizenships": set(),
                    "_enwikiName": None,
                },
            )
            entry["group_ids"].add(grp)
            if not entry["name"]:
                label = row.get("idolLabel") or ""
                # Skip Q-ID-only labels.
                if not (label.startswith("Q") and label[1:].isdigit()):
                    entry["name"] = label or row.get("enwikiName")
            if not entry["_enwikiName"] and row.get("enwikiName"):
                entry["_enwikiName"] = row["enwikiName"]
            if not entry["birth_year"] and row.get("birth"):
                yr = parse_year(row["birth"])
                if yr:
                    entry["birth_year"] = yr
            if g := row.get("genderLabel"):
                entry["genders"].add(g)
            if c := row.get("citizenshipLabel"):
                entry["citizenships"].add(c)
        print(f"  idol query batch {i // BATCH + 1}/{(len(gids) + BATCH - 1) // BATCH}: cumulative {len(members)} idols")

    if not members:
        print("  no idols found")
        return

    # Aliases — one batched query.
    print(f"  fetching aliases for {len(members)} idols...")
    iids = sorted(members)
    for i in range(0, len(iids), 200):
        batch = iids[i : i + 200]
        values = " ".join(f"wd:{x}" for x in batch)
        q = f"""
SELECT ?idol ?alias WHERE {{
  VALUES ?idol {{ {values} }}
  ?idol skos:altLabel ?alias .
  FILTER(LANG(?alias) IN ("en", "ko"))
}}
"""
        for row in run_sparql(q):
            iid = qid(row["idol"])
            if iid in members:
                a = row.get("alias", "").strip()
                if a and a != members[iid]["name"] and a not in members[iid]["aliases"]:
                    members[iid]["aliases"].append(a)
    for m in members.values():
        m["aliases"] = m["aliases"][:5]

    # Derive remaining fields per idol from their groups.
    idols: list[dict] = []
    for m in members.values():
        if not m["name"]:
            continue
        gids_for = sorted(m["group_ids"])
        gs = [group_by_id[g] for g in gids_for if g in group_by_id]
        if not gs:
            continue
        debut_year = min((g["debut_year"] for g in gs if g.get("debut_year")), default=None)
        # Most popular group → primary company assignment.
        primary = max(gs, key=lambda g: g.get("popularity", 0))
        gender = gender_from_members(list(m["genders"]))
        nationality = pick_nationality(list(m["citizenships"]))
        popularity = max((g.get("popularity", 0) for g in gs), default=0)
        idols.append({
            "id": m["id"],
            "name": m["name"],
            "aliases": m["aliases"],
            "birth_year": m["birth_year"],
            "debut_year": debut_year,
            "generation": generation_from_year(debut_year) if debut_year else None,
            "gender": gender,
            "nationality": nationality,
            "group_ids": gids_for,
            "group_names": [g["name"] for g in gs],
            "primary_group": primary["name"],
            "primary_group_id": primary["id"],
            "company": primary.get("company"),
            "company_parent": primary.get("company_parent"),
            "popularity": popularity,
            "tier": "hard",
        })

    # Apply manual per-idol overrides (gender backfills, name fixes, etc.).
    # Done before sort/tier so any popularity changes still bucket correctly.
    idol_overrides = load_idol_overrides()
    for x in idols:
        if x["id"] in idol_overrides:
            x.update(idol_overrides[x["id"]])

    # Sort by popularity desc, then name.
    idols.sort(key=lambda x: (-(x.get("popularity") or 0), x["name"]))
    for rank, x in enumerate(idols):
        if rank < IDOL_TIER_EASY:
            x["tier"] = "easy"
        elif rank < IDOL_TIER_MEDIUM:
            x["tier"] = "medium"
        else:
            x["tier"] = "hard"

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tier_thresholds": {"easy": IDOL_TIER_EASY, "medium": IDOL_TIER_MEDIUM},
        "idols": idols,
    }
    index_payload = [
        {"id": x["id"], "name": x["name"], "aliases": x["aliases"], "tier": x["tier"]}
        for x in idols
    ]

    tmp_full = OUT_IDOLS.with_suffix(".json.tmp")
    tmp_index = OUT_IDOL_INDEX.with_suffix(".json.tmp")
    tmp_full.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    tmp_index.write_text(json.dumps(index_payload, ensure_ascii=False, indent=2))
    shutil.move(tmp_full, OUT_IDOLS)
    shutil.move(tmp_index, OUT_IDOL_INDEX)

    # Summary.
    pool_easy = sum(1 for x in idols if x["tier"] == "easy")
    pool_medium = sum(1 for x in idols if x["tier"] in ("easy", "medium"))
    missing_birth = sum(1 for x in idols if not x["birth_year"])
    missing_gender = sum(1 for x in idols if not x["gender"])
    missing_nat = sum(1 for x in idols if not x["nationality"])
    print(f"  total idols: {len(idols)}")
    print(f"  pool sizes: easy={pool_easy}  medium={pool_medium}  hard={len(idols)}")
    print(f"  missing birth_year: {missing_birth}  gender: {missing_gender}  nationality: {missing_nat}")
    print(f"  wrote {OUT_IDOLS.relative_to(ROOT)} and {OUT_IDOL_INDEX.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
