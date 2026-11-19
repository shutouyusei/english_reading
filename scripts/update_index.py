#!/usr/bin/env python3
"""Rebuild docs/data/<skill>/index.json from the item files next to it.

Usage: update_index.py [skill ...]   (no argument rebuilds every skill)
"""
import json
import sys
from dataclasses import dataclass
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"


@dataclass(frozen=True)
class Skill:
    """How one skill's folder maps to its index.json."""

    file_prefix: str
    index_key: str
    summary_fields: tuple[str, ...]


SKILLS = {
    "reading": Skill("passage", "passages", ("id", "title", "topic", "word_count", "added")),
    "listening": Skill("listening", "items", ("id", "type", "title", "topic", "word_count", "added")),
    "writing": Skill("writing", "prompts", ("id", "type", "title", "target_minutes", "added")),
}


def build_index(skill: Skill, items: list[dict]) -> dict:
    """Reduce full item objects to the summary rows the list screen needs, newest first."""
    rows = [{name: item[name] for name in skill.summary_fields} for item in items]
    rows.sort(key=lambda row: (row["added"], row["id"]), reverse=True)
    return {skill.index_key: rows}


def load_items(directory: Path, skill: Skill) -> list[dict]:
    paths = sorted(directory.glob(f"{skill.file_prefix}_*.json"))
    return [json.loads(path.read_text(encoding="utf-8")) for path in paths]


def main(argv: list[str]) -> int:
    names = argv[1:] or list(SKILLS)
    unknown = [name for name in names if name not in SKILLS]
    if unknown:
        print(f"unknown skill: {', '.join(unknown)} (known: {', '.join(SKILLS)})", file=sys.stderr)
        return 1

    for name in names:
        skill = SKILLS[name]
        directory = DATA_DIR / name
        if not directory.is_dir():
            print(f"not a directory: {directory}", file=sys.stderr)
            return 1
        index = build_index(skill, load_items(directory, skill))
        index_path = directory / "index.json"
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{index_path}: {len(index[skill.index_key])} {skill.index_key}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
