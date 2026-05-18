"""Wikipedia helpers: pageviews + infobox 'agency' parsing.

Pageviews API: https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/...
Wikitext API:  https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvslots=main&rvprop=content
"""
import json
import os
import re
import time
import urllib.parse
from datetime import date, timedelta
from pathlib import Path

import requests

USER_AGENT = "KPopdle/0.1 (https://github.com/ItsPandarr/kpopdle)"
PV_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"
ENWIKI_API = "https://en.wikipedia.org/w/api.php"

CACHE_DIR = Path(__file__).parent / ".cache"
PV_CACHE = CACHE_DIR / "pageviews"
WIKITEXT_CACHE = CACHE_DIR / "wikitext"


def _ensure_cache_dirs() -> None:
    PV_CACHE.mkdir(parents=True, exist_ok=True)
    WIKITEXT_CACHE.mkdir(parents=True, exist_ok=True)


def _safe_filename(title: str) -> str:
    return urllib.parse.quote(title, safe="") + ".json"


def pageviews_90d(title: str) -> int:
    """Return the sum of last-90-day enwiki pageviews for `title`.

    Cached on disk; sleeps 100ms after each network call; exponential backoff on 429.
    Returns 0 on persistent failure (don't let one missing article kill the run).
    """
    _ensure_cache_dirs()
    cache_path = PV_CACHE / _safe_filename(title)
    if cache_path.exists():
        try:
            return json.loads(cache_path.read_text())["sum"]
        except (json.JSONDecodeError, KeyError):
            cache_path.unlink(missing_ok=True)

    today = date.today()
    end = today - timedelta(days=1)
    start = end - timedelta(days=89)
    enc_title = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = f"{PV_BASE}/en.wikipedia/all-access/user/{enc_title}/daily/{start:%Y%m%d}/{end:%Y%m%d}"

    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    backoff = 1.0
    for attempt in range(5):
        try:
            r = requests.get(url, headers=headers, timeout=30)
            if r.status_code == 404:
                cache_path.write_text(json.dumps({"sum": 0, "title": title}))
                time.sleep(0.1)
                return 0
            if r.status_code == 429:
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)
                continue
            r.raise_for_status()
            items = r.json().get("items", [])
            total = sum(int(i.get("views", 0)) for i in items)
            cache_path.write_text(json.dumps({"sum": total, "title": title}))
            time.sleep(0.1)
            return total
        except requests.RequestException:
            time.sleep(backoff)
            backoff = min(backoff * 2, 30)
    return 0


def fetch_wikitext_batch(titles: list[str]) -> dict[str, str]:
    """Fetch raw wikitext for up to 50 titles in one Wikipedia API call. Cached per title."""
    _ensure_cache_dirs()
    result: dict[str, str] = {}
    uncached: list[str] = []
    for t in titles:
        cache_path = WIKITEXT_CACHE / _safe_filename(t)
        if cache_path.exists():
            try:
                result[t] = json.loads(cache_path.read_text())["wikitext"]
                continue
            except (json.JSONDecodeError, KeyError):
                cache_path.unlink(missing_ok=True)
        uncached.append(t)

    for batch_start in range(0, len(uncached), 50):
        batch = uncached[batch_start : batch_start + 50]
        params = {
            "action": "query",
            "format": "json",
            "prop": "revisions",
            "rvprop": "content",
            "rvslots": "main",
            "redirects": 1,
            "titles": "|".join(batch),
        }
        headers = {"User-Agent": USER_AGENT}
        try:
            r = requests.get(ENWIKI_API, params=params, headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
        except requests.RequestException as e:
            print(f"  wikitext batch failed: {e!r}")
            time.sleep(2)
            continue

        # Map normalized → original
        normalized = {n["to"]: n["from"] for n in data.get("query", {}).get("normalized", [])}
        redirects = {rd["to"]: rd["from"] for rd in data.get("query", {}).get("redirects", [])}

        for page in data.get("query", {}).get("pages", {}).values():
            page_title = page.get("title", "")
            revs = page.get("revisions", [])
            if not revs:
                continue
            text = revs[0].get("slots", {}).get("main", {}).get("*", "")
            # Resolve back to the original requested title
            orig = page_title
            while orig in redirects:
                orig = redirects[orig]
            while orig in normalized:
                orig = normalized[orig]
            result[orig] = text
            cache_path = WIKITEXT_CACHE / _safe_filename(orig)
            cache_path.write_text(json.dumps({"wikitext": text}))
        time.sleep(0.2)

    return result


# Regex helpers for infobox parsing -----------------------------------------

_INFOBOX_RE = re.compile(r"\{\{\s*Infobox\s+musical artist\b", re.IGNORECASE)
_FIELD_RE = re.compile(r"^\s*\|\s*([A-Za-z0-9_]+)\s*=\s*(.*?)$", re.MULTILINE)


def _extract_infobox_block(wikitext: str) -> str | None:
    """Return the text inside the first {{Infobox musical artist ... }} block (brace-balanced)."""
    m = _INFOBOX_RE.search(wikitext)
    if not m:
        return None
    i = m.start()
    depth = 0
    j = i
    while j < len(wikitext):
        if wikitext[j : j + 2] == "{{":
            depth += 1
            j += 2
        elif wikitext[j : j + 2] == "}}":
            depth -= 1
            j += 2
            if depth == 0:
                return wikitext[i:j]
        else:
            j += 1
    return None


def _strip_wikilinks(s: str) -> str:
    """[[Target|Display]] → Target; [[Page]] → Page.

    We prefer the link TARGET, not the display text, because the target is
    the canonical Wikipedia title (e.g. 'Big Hit Music' even when displayed as 'Big Hit').
    """
    s = re.sub(r"\[\[([^\]\|]+)\|[^\]]+\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    return s


def _strip_templates(s: str) -> str:
    """Remove simple {{...}} templates, repeatedly to handle nesting."""
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"\{\{[^{}]*\}\}", " ", s)
    return s


def _parse_infobox_field(block: str, field: str) -> str | None:
    """Extract the first meaningful value from an infobox field.

    Strategy: take the first wikilink target inside the field (canonical),
    fall back to first non-empty line of cleaned-up plain text.
    """
    m = re.search(
        rf"^\s*\|\s*{re.escape(field)}\s*=\s*(.*?)(?=^\s*\|\s*\w+\s*=|^\s*\}}\}})",
        block,
        flags=re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    if not m:
        return None
    raw = m.group(1)
    # Strip refs and comments first.
    raw = re.sub(r"<ref[^>]*?>.*?</ref>", "", raw, flags=re.DOTALL)
    raw = re.sub(r"<ref[^/]*?/>", "", raw)
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.DOTALL)

    # Prefer the first wikilink target — that's the canonical entity name,
    # robust to list templates ({{hlist|...}}, {{flatlist}}...{{endflatlist}}).
    for link_m in re.finditer(r"\[\[([^\]\|]+?)(?:\|[^\]]+)?\]\]", raw):
        target = link_m.group(1).strip()
        if target.lower().startswith(("file:", "image:", "category:")):
            continue
        # Strip section anchors: [[Hybe#Music]] → "Hybe".
        target = target.split("#", 1)[0].strip()
        # Strip Wikipedia disambiguation suffixes: "RBW (company)" → "RBW".
        target = re.sub(
            r"\s*\((?:company|band|group|musician|musical group|record label|label)\)\s*$",
            "",
            target,
            flags=re.IGNORECASE,
        ).strip()
        if target:
            return target

    # No wikilinks: fall back to cleaned plain-text first line.
    raw = _strip_templates(raw)
    raw = _strip_wikilinks(raw)
    raw = re.sub(r"<[^>]+>", "", raw)
    first = next(
        (
            line.strip().lstrip("*").strip()
            for line in raw.splitlines()
            if line.strip() and line.strip() not in {"*", "{|", "|}"}
        ),
        "",
    )
    first = re.sub(r"\s*\([^)]*\)\s*$", "", first).strip()
    first = first.rstrip(",;")
    return first or None


def parse_agency(wikitext: str) -> str | None:
    """Extract the group's company. Tries 'agency' first (Korean idol convention),
    then 'label' (used in most {{Infobox musical artist}} K-pop articles).
    """
    block = _extract_infobox_block(wikitext)
    if not block:
        return None
    return _parse_infobox_field(block, "agency") or _parse_infobox_field(block, "label")


def _members_field_count(block: str, field: str) -> int:
    m = re.search(
        rf"^\s*\|\s*{re.escape(field)}\s*=\s*(.*?)(?=^\s*\|\s*\w+\s*=|^\s*\}}\}})",
        block,
        flags=re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    if not m:
        return 0
    raw = m.group(1)
    raw = re.sub(r"<ref[^>]*?>.*?</ref>", "", raw, flags=re.DOTALL)
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.DOTALL)
    # Count distinct wikilinks (each member is typically [[Name]]).
    links = re.findall(r"\[\[([^\]\|]+?)(?:\|[^\]]+)?\]\]", raw)
    members = [
        t.split("#", 1)[0].strip()
        for t in links
        if not t.lower().startswith(("file:", "image:", "category:"))
    ]
    return len({m for m in members if m})


def parse_years_active(wikitext: str) -> int | None:
    """First 4-digit year from the infobox 'years_active' field.

    Handles "2015–present", "2018–2021", "2014–", etc. Returns None if absent
    or unparseable.
    """
    block = _extract_infobox_block(wikitext)
    if not block:
        return None
    m = re.search(
        r"^\s*\|\s*years_active\s*=\s*(.*?)(?=^\s*\|\s*\w+\s*=|^\s*\}\})",
        block,
        flags=re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    if not m:
        return None
    raw = m.group(1)
    raw = re.sub(r"<ref[^>]*?>.*?</ref>", "", raw, flags=re.DOTALL)
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.DOTALL)
    year_m = re.search(r"\b(19\d{2}|20\d{2})\b", raw)
    if not year_m:
        return None
    try:
        return int(year_m.group(1))
    except ValueError:
        return None


def parse_member_count(wikitext: str) -> int | None:
    """Count current_members + past_members entries in the infobox. None if neither field exists."""
    block = _extract_infobox_block(wikitext)
    if not block:
        return None
    current = _members_field_count(block, "current_members")
    past = _members_field_count(block, "past_members")
    total = current + past
    return total if total > 0 else None
