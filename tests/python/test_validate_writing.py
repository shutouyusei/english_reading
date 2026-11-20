import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from validate_writing import validate_prompt


def email_prompt(**overrides):
    data = {
        "id": "writing_001",
        "type": "email",
        "title": "Midterm rescheduled to Saturday",
        "added": "2026-08-11",
        "target_minutes": 7,
        "instructions": "Read the situation and write an email.",
        "situation": "Your professor moved the midterm to Saturday.",
        "recipient": "Professor Alvarez",
        "must_include": ["explain why you need a change", "propose an alternative date"],
        "discussion": None,
    }
    data.update(overrides)
    return data


def discussion_prompt(**overrides):
    data = {
        "id": "writing_002",
        "type": "discussion",
        "title": "Should cities restrict private cars downtown?",
        "added": "2026-08-11",
        "target_minutes": 10,
        "instructions": "Write a response that contributes to the discussion.",
        "situation": None,
        "recipient": None,
        "must_include": None,
        "discussion": {
            "professor_post": {"name": "Dr. Chen", "text": "Several cities have..."},
            "student_posts": [
                {"name": "Marcus", "text": "I think restrictions..."},
                {"name": "Priya", "text": "Marcus overlooks..."},
            ],
        },
    }
    data.update(overrides)
    return data


class ValidEmailTest(unittest.TestCase):
    def test_valid_email_passes(self):
        self.assertEqual(validate_prompt(email_prompt(), "writing_001"), [])

    def test_email_with_discussion_fails(self):
        data = email_prompt(discussion={"professor_post": {}, "student_posts": []})
        errors = validate_prompt(data, "writing_001")
        self.assertTrue(any("discussion == null" in e for e in errors), errors)


class ValidDiscussionTest(unittest.TestCase):
    def test_valid_discussion_passes(self):
        self.assertEqual(validate_prompt(discussion_prompt(), "writing_002"), [])


class CommonFieldTest(unittest.TestCase):
    def test_id_must_match_filename(self):
        errors = validate_prompt(email_prompt(), "writing_999")
        self.assertTrue(any("does not match filename" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
