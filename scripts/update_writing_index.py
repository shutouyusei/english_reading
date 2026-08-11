#!/usr/bin/env python3
"""Rebuild docs/data/writing/index.json from the prompt files next to it."""
import argparse
import json
import sys
from pathlib import Path

SUMMARY_FIELDS = ["id", "type", "title", "target_minutes", "added"]
DEFAULT_DIR = Path("docs/data/writing")


def build_index(prompts: list[dict]) -> dict:
    """Reduce full prompt objects to the summary rows the list screen needs."""
    rows = [{name: prompt[name] for name in SUMMARY_FIELDS} for prompt in prompts]
    rows.sort(key=lambda row: row["id"])
    return {"prompts": rows}


def load_prompts(directory: Path) -> list[dict]:
    paths = sorted(p for p in directory.glob("writing_*.json"))
    return [json.loads(path.read_text(encoding="utf-8")) for path in paths]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    args = parser.parse_args()

    if not args.dir.is_dir():
        print(f"not a directory: {args.dir}", file=sys.stderr)
        return 1

    index = build_index(load_prompts(args.dir))
    target = args.dir / "index.json"
    target.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{target}: {len(index['prompts'])} prompts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
