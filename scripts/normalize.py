"""Normalization helpers: generation, gender aggregation, company cleanup."""
from collections import Counter


def generation_from_year(year: int) -> int:
    """K-pop generation from debut year. Canonical mapping for this project."""
    if year <= 2002:
        return 1
    if year <= 2011:
        return 2
    if year <= 2017:
        return 3
    if year <= 2022:
        return 4
    return 5


def gender_from_members(genders: list[str]) -> str | None:
    """Aggregate member genders into a group label.

    `genders` is a list of strings like "male", "female" (Wikidata gender labels).
    Returns "boy" / "girl" / "coed", or None if no signal.
    """
    if not genders:
        return None
    counts = Counter(g.lower() for g in genders if g)
    males = counts.get("male", 0) + counts.get("trans man", 0) + counts.get("transgender male", 0)
    females = (
        counts.get("female", 0)
        + counts.get("trans woman", 0)
        + counts.get("transgender female", 0)
    )
    if males and not females:
        return "boy"
    if females and not males:
        return "girl"
    if males and females:
        return "coed"
    return None


_COMPANY_CANONICAL = {
    # Canonicalize common variants. Keep label-level distinctness (Big Hit vs HYBE).
    "big hit entertainment": "Big Hit Music",
    "big hit music": "Big Hit Music",
    "hybe corporation": "HYBE",
    "hybe": "HYBE",
    "hybe labels": "HYBE",
    "sm entertainment": "SM Entertainment",
    "sm": "SM Entertainment",
    "jyp entertainment": "JYP Entertainment",
    "jyp": "JYP Entertainment",
    "yg entertainment": "YG Entertainment",
    "yg": "YG Entertainment",
    "pledis entertainment": "Pledis Entertainment",
    "starship entertainment": "Starship Entertainment",
    "cube entertainment": "Cube Entertainment",
    "fnc entertainment": "FNC Entertainment",
    "ador": "ADOR",
    "source music": "Source Music",
    "belift lab": "Belift Lab",
    "kq entertainment": "KQ Entertainment",
    "fantagio": "Fantagio",
    "rbw": "RBW",
    "woollim entertainment": "Woollim Entertainment",
    "dsp media": "DSP Media",
    "wm entertainment": "WM Entertainment",
}

# Hand-curated parent groups for the conglomerates we care about.
_COMPANY_PARENT = {
    "Big Hit Music": "HYBE",
    "Pledis Entertainment": "HYBE",
    "Source Music": "HYBE",
    "Belift Lab": "HYBE",
    "ADOR": "HYBE",
    "KOZ Entertainment": "HYBE",
    "HYBE": "HYBE",
    "SM Entertainment": "SM Entertainment",
    "JYP Entertainment": "JYP Entertainment",
    "YG Entertainment": "YG Entertainment",
}


def canonical_company(name: str | None) -> str | None:
    if not name:
        return None
    key = name.strip().lower()
    return _COMPANY_CANONICAL.get(key, name.strip())


def company_parent(company: str | None) -> str | None:
    if not company:
        return None
    return _COMPANY_PARENT.get(company)
