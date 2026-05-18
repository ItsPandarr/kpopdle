"""Encode data/*.json into data/*.dat so casual snoopers can't grep the
Network tab for the daily answer.

This is light obfuscation, not security. The client (js/data.js) decodes the
payload using the same scheme. Anyone determined can run the decoder; we just
want raw `groups.json` to not be a one-click cheat sheet.

Scheme: XOR each byte of the UTF-8 JSON with a repeating key, then base64.

Run:
    python3 scripts/encode_data.py

It rewrites data/groups.dat and data/idols.dat in place.
"""
import base64
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Match js/scramble.js BUILD_ID. Changing this means re-encoding AND
# updating the JS side. Named "BUILD_ID" so the JS bundle reads like a
# version constant rather than a key.
KEY = b"KPopdle 2.6.0"


def xor_bytes(buf: bytes) -> bytes:
    klen = len(KEY)
    return bytes(b ^ KEY[i % klen] for i, b in enumerate(buf))


def encode_file(src: Path, dst: Path) -> None:
    raw = src.read_text(encoding="utf-8")
    # Re-emit minified to shave bytes; the client never sees the original anyway.
    compact = json.dumps(json.loads(raw), ensure_ascii=False, separators=(",", ":"))
    payload = base64.b64encode(xor_bytes(compact.encode("utf-8"))).decode("ascii")
    dst.write_text(payload, encoding="utf-8")
    print(f"  {src.name} ({src.stat().st_size:,} B) -> {dst.name} ({dst.stat().st_size:,} B)")


def main() -> int:
    pairs = [
        (DATA / "groups.json", DATA / "groups.dat"),
        (DATA / "idols.json", DATA / "idols.dat"),
    ]
    missing = [p for p, _ in pairs if not p.exists()]
    if missing:
        print(f"Missing input files: {missing}", file=sys.stderr)
        return 1
    print("Encoding data files…")
    for src, dst in pairs:
        encode_file(src, dst)
    print("Done.")
    print("\nNext: optionally delete the source .json files so they're not served:")
    print("  rm data/groups.json data/idols.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
