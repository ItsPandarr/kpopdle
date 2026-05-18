"""Wikidata SPARQL helpers with retry and a polite User-Agent."""
import time
import requests

ENDPOINT = "https://query.wikidata.org/sparql"
USER_AGENT = "KPopdle/0.1 (https://github.com/ItsPandarr/kpopdle)"


def run_sparql(query: str, *, retries: int = 3, backoff: float = 2.0) -> list[dict]:
    """Execute a SPARQL SELECT and return a list of binding dicts (key -> string value)."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/sparql-results+json",
    }
    last_exc = None
    for attempt in range(retries):
        try:
            r = requests.get(
                ENDPOINT,
                params={"query": query},
                headers=headers,
                timeout=120,
            )
            if r.status_code == 429:
                wait = backoff ** (attempt + 1)
                print(f"  SPARQL 429, sleeping {wait:.1f}s")
                time.sleep(wait)
                continue
            r.raise_for_status()
            data = r.json()
            return [
                {k: v["value"] for k, v in row.items()}
                for row in data["results"]["bindings"]
            ]
        except (requests.RequestException, ValueError) as e:
            last_exc = e
            wait = backoff ** (attempt + 1)
            print(f"  SPARQL error ({e!r}), retrying in {wait:.1f}s")
            time.sleep(wait)
    raise RuntimeError(f"SPARQL failed after {retries} attempts: {last_exc!r}")


def qid(uri: str) -> str:
    """Convert a Wikidata entity URI to its Q-ID."""
    return uri.rsplit("/", 1)[-1]
