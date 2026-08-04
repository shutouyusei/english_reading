#!/usr/bin/env python3
"""Rebuild docs/data/index.json from the passage files."""
import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
PASSAGES_DIR = DATA_DIR / "passages"
INDEX_PATH = DATA_DIR / "index.json"
META_FIELDS = ["id", "title", "topic", "word_count", "added"]


def build_index(passages_dir: Path) -> dict:
    """Collect meta fields from every passage file, newest first."""
    entries = []
    for path in sorted(passages_dir.glob("passage_*.json")):
        passage = json.loads(path.read_text(encoding="utf-8"))
        entries.append({field: passage[field] for field in META_FIELDS})
    entries.sort(key=lambda e: (e["added"], e["id"]), reverse=True)
    return {"passages": entries}


def main() -> int:
    if not PASSAGES_DIR.is_dir():
        print(f"ERROR: {PASSAGES_DIR} not found", file=sys.stderr)
        return 1
    index = build_index(PASSAGES_DIR)
    INDEX_PATH.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {INDEX_PATH} ({len(index['passages'])} passages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
