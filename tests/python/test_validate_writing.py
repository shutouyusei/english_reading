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
        "must_include": ["変更を依頼する理由", "代替日程の提案"],
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

    def test_email_without_situation_fails(self):
        errors = validate_prompt(email_prompt(situation=None), "writing_001")
        self.assertTrue(any("situation" in e for e in errors), errors)

    def test_email_with_empty_must_include_fails(self):
        errors = validate_prompt(email_prompt(must_include=[]), "writing_001")
        self.assertTrue(any("must_include" in e for e in errors), errors)


class ValidDiscussionTest(unittest.TestCase):
    def test_valid_discussion_passes(self):
        self.assertEqual(validate_prompt(discussion_prompt(), "writing_002"), [])

    def test_discussion_with_situation_fails(self):
        errors = validate_prompt(discussion_prompt(situation="x"), "writing_002")
        self.assertTrue(any("situation == null" in e for e in errors), errors)

    def test_discussion_with_one_student_post_fails(self):
        data = discussion_prompt()
        data["discussion"]["student_posts"] = [{"name": "Marcus", "text": "..."}]
        errors = validate_prompt(data, "writing_002")
        self.assertTrue(any("exactly 2" in e for e in errors), errors)

    def test_discussion_without_professor_text_fails(self):
        data = discussion_prompt()
        data["discussion"]["professor_post"] = {"name": "Dr. Chen"}
        errors = validate_prompt(data, "writing_002")
        self.assertTrue(any("professor_post" in e for e in errors), errors)


class CommonFieldTest(unittest.TestCase):
    def test_id_must_match_filename(self):
        errors = validate_prompt(email_prompt(), "writing_999")
        self.assertTrue(any("does not match filename" in e for e in errors), errors)

    def test_unknown_type_fails(self):
        errors = validate_prompt(email_prompt(type="essay"), "writing_001")
        self.assertTrue(any("invalid type" in e for e in errors), errors)

    def test_missing_field_fails(self):
        data = email_prompt()
        del data["instructions"]
        errors = validate_prompt(data, "writing_001")
        self.assertTrue(any("missing field instructions" in e for e in errors), errors)

    def test_zero_target_minutes_fails(self):
        errors = validate_prompt(email_prompt(target_minutes=0), "writing_001")
        self.assertTrue(any("target_minutes" in e for e in errors), errors)

    def test_bad_date_fails(self):
        errors = validate_prompt(email_prompt(added="2026/08/11"), "writing_001")
        self.assertTrue(any("YYYY-MM-DD" in e for e in errors), errors)

    def test_empty_title_fails(self):
        errors = validate_prompt(email_prompt(title="   "), "writing_001")
        self.assertTrue(any("title" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
