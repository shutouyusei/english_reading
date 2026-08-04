"""Tests for update_index.py."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from update_index import build_index


def write_passage(directory: Path, pid: str, added: str) -> None:
    meta = {
        "id": pid, "title": f"Title {pid}", "topic": "環境",
        "word_count": 480, "added": added,
        "body": "x", "questions": [], "vocab": {},
    }
    (directory / f"{pid}.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )


class TestBuildIndex(unittest.TestCase):
    def test_entries_sorted_by_added_descending(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            write_passage(directory, "passage_001", "2026-08-01")
            write_passage(directory, "passage_002", "2026-08-03")
            index = build_index(directory)
            self.assertEqual(
                [e["id"] for e in index["passages"]],
                ["passage_002", "passage_001"],
            )

    def test_entry_has_only_meta_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            write_passage(directory, "passage_001", "2026-08-01")
            entry = build_index(directory)["passages"][0]
            self.assertEqual(
                sorted(entry), ["added", "id", "title", "topic", "word_count"]
            )


if __name__ == "__main__":
    unittest.main()
