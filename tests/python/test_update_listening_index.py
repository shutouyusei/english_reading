"""Tests for update_listening_index.py."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from update_listening_index import build_index


def make_item(item_id: str, added: str) -> dict:
    return {
        "id": item_id,
        "type": "lecture",
        "title": f"Title {item_id}",
        "topic": "科学",
        "added": added,
        "word_count": 600,
        "speakers": [{"id": "professor", "role": "教授", "voice": "Daniel"}],
        "script": [{"speaker": "professor", "text": "Hello."}],
        "questions": [],
    }


class BuildIndexTest(unittest.TestCase):
    def test_keeps_only_summary_fields(self):
        index = build_index([make_item("listening_001", "2026-08-19")])
        self.assertEqual(
            sorted(index["items"][0]),
            ["added", "id", "title", "topic", "type", "word_count"],
        )

    def test_sorts_newest_first(self):
        items = [
            make_item("listening_001", "2026-08-01"),
            make_item("listening_003", "2026-08-19"),
            make_item("listening_002", "2026-08-10"),
        ]
        ids = [row["id"] for row in build_index(items)["items"]]
        self.assertEqual(ids, ["listening_003", "listening_002", "listening_001"])

    def test_same_day_sorts_by_id_descending(self):
        items = [make_item("listening_001", "2026-08-19"), make_item("listening_002", "2026-08-19")]
        ids = [row["id"] for row in build_index(items)["items"]]
        self.assertEqual(ids, ["listening_002", "listening_001"])

    def test_empty_input_gives_empty_list(self):
        self.assertEqual(build_index([]), {"items": []})


if __name__ == "__main__":
    unittest.main()
