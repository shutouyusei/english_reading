"""Tests for update_index.py."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from update_index import SKILLS, build_index

BODY_FIELDS = {"body": "x", "script": [], "questions": [], "instructions": "x"}


def make_item(skill_name: str, item_id: str, added: str) -> dict:
    summary = {name: f"{name} of {item_id}" for name in SKILLS[skill_name].summary_fields}
    return {**summary, **BODY_FIELDS, "id": item_id, "added": added}


class BuildIndexTest(unittest.TestCase):
    def test_keeps_only_summary_fields_for_every_skill(self):
        for name, skill in SKILLS.items():
            with self.subTest(skill=name):
                index = build_index(skill, [make_item(name, "x_001", "2026-08-01")])
                self.assertEqual(list(index), [skill.index_key])
                self.assertEqual(tuple(index[skill.index_key][0]), skill.summary_fields)

    def test_sorts_newest_first_then_by_id_descending(self):
        skill = SKILLS["listening"]
        items = [
            make_item("listening", "listening_001", "2026-08-01"),
            make_item("listening", "listening_002", "2026-08-19"),
            make_item("listening", "listening_003", "2026-08-19"),
        ]
        ids = [row["id"] for row in build_index(skill, items)["items"]]
        self.assertEqual(ids, ["listening_003", "listening_002", "listening_001"])


if __name__ == "__main__":
    unittest.main()
