import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from update_writing_index import build_index

EMAIL = {
    "id": "writing_001", "type": "email", "title": "Midterm rescheduled",
    "added": "2026-08-11", "target_minutes": 7,
    "instructions": "x", "situation": "x", "recipient": "x",
    "must_include": ["x"], "discussion": None,
}
DISCUSSION = {
    "id": "writing_002", "type": "discussion", "title": "Restrict cars?",
    "added": "2026-08-12", "target_minutes": 10,
    "instructions": "x", "situation": None, "recipient": None,
    "must_include": None,
    "discussion": {"professor_post": {"name": "n", "text": "t"},
                   "student_posts": [{"name": "a", "text": "t"},
                                     {"name": "b", "text": "t"}]},
}


class BuildIndexTest(unittest.TestCase):
    def test_keeps_only_summary_fields(self):
        index = build_index([EMAIL])
        self.assertEqual(index["prompts"], [{
            "id": "writing_001", "type": "email", "title": "Midterm rescheduled",
            "target_minutes": 7, "added": "2026-08-11",
        }])

    def test_sorted_newest_first(self):
        index = build_index([EMAIL, DISCUSSION])
        self.assertEqual([p["id"] for p in index["prompts"]],
                         ["writing_002", "writing_001"])

    def test_empty_input_gives_empty_list(self):
        self.assertEqual(build_index([]), {"prompts": []})

    def test_body_fields_are_not_leaked(self):
        index = build_index([DISCUSSION])
        self.assertNotIn("discussion", index["prompts"][0])
        self.assertNotIn("instructions", index["prompts"][0])


if __name__ == "__main__":
    unittest.main()
