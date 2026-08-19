#!/usr/bin/env python3
"""Rebuild docs/data/listening/index.json from the item files next to it."""
import json
import sys
from pathlib import Path

SUMMARY_FIELDS = ["id", "type", "title", "topic", "word_count", "added"]
LISTENING_DIR = Path(__file__).resolve().parent.parent / "docs" / "data" / "listening"
INDEX_PATH = LISTENING_DIR / "index.json"


def build_index(items: list[dict]) -> dict:
    """Reduce full item objects to the summary rows the list screen needs."""
    rows = [{name: item[name] for name in SUMMARY_FIELDS} for item in items]
    rows.sort(key=lambda row: (row["added"], row["id"]), reverse=True)
    return {"items": rows}


def load_items(directory: Path) -> list[dict]:
    paths = sorted(p for p in directory.glob("listening_*.json"))
    return [json.loads(path.read_text(encoding="utf-8")) for path in paths]


def main() -> int:
    if not LISTENING_DIR.is_dir():
        print(f"not a directory: {LISTENING_DIR}", file=sys.stderr)
        return 1

    index = build_index(load_items(LISTENING_DIR))
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{INDEX_PATH}: {len(index['items'])} items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
