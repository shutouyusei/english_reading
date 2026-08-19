"""Tests for validate_listening.py."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from validate_listening import validate

TYPES = ["Gist-Content", "Detail", "Function", "Attitude", "Inference", "Detail"]
CORRECTS = ["A", "B", "C", "D", "A", "B"]


def make_questions() -> list[dict]:
    return [
        {
            "id": i,
            "type": qtype,
            "question": f"Question {i}?",
            "choices": {"A": "a", "B": "b", "C": "c", "D": "d"},
            "correct": correct,
            "explanation": "日本語の解説。",
        }
        for i, (qtype, correct) in enumerate(zip(TYPES, CORRECTS), start=1)
    ]


def make_lecture() -> dict:
    # 語数は範囲外でよい(範囲は警告であってエラーではない)
    return {
        "id": "listening_001",
        "type": "lecture",
        "title": "Coral Reefs and Repeated Stress",
        "topic": "科学",
        "added": "2026-08-19",
        "word_count": 12,
        "speakers": [{"id": "professor", "role": "教授", "voice": "Daniel"}],
        "script": [
            {"speaker": "professor", "text": "Today we look at how reefs respond to repeated"},
            {"speaker": "professor", "text": "stress over many years."},
        ],
        "questions": make_questions(),
    }


def make_conversation() -> dict:
    data = make_lecture()
    data["id"] = "listening_002"
    data["type"] = "conversation"
    data["speakers"] = [
        {"id": "student", "role": "学生", "voice": "Samantha"},
        {"id": "advisor", "role": "事務員", "voice": "Daniel"},
    ]
    data["script"] = [
        {"speaker": "student", "text": "Excuse me, I wanted to ask about the deadline"},
        {"speaker": "advisor", "text": "for the housing application form."},
    ]
    return data


class ValidateListeningTest(unittest.TestCase):
    def test_valid_lecture_has_no_errors(self):
        self.assertEqual(validate(make_lecture()), [])

    def test_valid_conversation_has_no_errors(self):
        self.assertEqual(validate(make_conversation()), [])

    def test_missing_field_is_reported(self):
        data = make_lecture()
        del data["speakers"]
        self.assertTrue(any("speakers" in e for e in validate(data)))

    def test_invalid_id_shape_is_reported(self):
        data = make_lecture()
        data["id"] = "listening_1"
        self.assertTrue(any("id" in e for e in validate(data)))

    def test_invalid_type_is_reported(self):
        data = make_lecture()
        data["type"] = "dictation"
        self.assertTrue(any("type" in e for e in validate(data)))

    def test_unknown_topic_is_reported(self):
        data = make_lecture()
        data["topic"] = "音楽"
        self.assertTrue(any("topic" in e for e in validate(data)))

    def test_lecture_must_have_one_speaker(self):
        data = make_lecture()
        data["speakers"].append({"id": "student", "role": "学生", "voice": "Samantha"})
        self.assertTrue(any("speakers" in e for e in validate(data)))

    def test_conversation_must_have_two_speakers(self):
        data = make_conversation()
        data["speakers"] = data["speakers"][:1]
        self.assertTrue(any("speakers" in e for e in validate(data)))

    def test_empty_voice_is_reported(self):
        data = make_lecture()
        data["speakers"][0]["voice"] = "  "
        self.assertTrue(any("voice" in e for e in validate(data)))

    def test_unknown_speaker_in_script_is_reported(self):
        data = make_lecture()
        data["script"][0]["speaker"] = "student"
        self.assertTrue(any("speaker" in e for e in validate(data)))

    def test_empty_script_is_reported(self):
        data = make_lecture()
        data["script"] = []
        self.assertTrue(any("script" in e for e in validate(data)))

    def test_empty_line_text_is_reported(self):
        data = make_lecture()
        data["script"][1]["text"] = "   "
        self.assertTrue(any("text" in e for e in validate(data)))

    def test_word_count_mismatch_is_reported(self):
        data = make_lecture()
        data["word_count"] = 999
        self.assertTrue(any("word_count" in e for e in validate(data)))

    def test_question_count_must_be_six(self):
        data = make_lecture()
        data["questions"] = data["questions"][:5]
        self.assertTrue(any("questions" in e for e in validate(data)))

    def test_unknown_question_type_is_reported(self):
        data = make_lecture()
        data["questions"][0]["type"] = "Vocabulary"
        self.assertTrue(any("type" in e for e in validate(data)))

    def test_too_few_distinct_types_is_reported(self):
        data = make_lecture()
        for q in data["questions"]:
            q["type"] = "Detail"
        self.assertTrue(any("distinct" in e for e in validate(data)))

    def test_same_correct_letter_four_times_is_reported(self):
        data = make_lecture()
        for q in data["questions"][:4]:
            q["correct"] = "A"
        self.assertTrue(any("correct" in e for e in validate(data)))

    def test_missing_choice_key_is_reported(self):
        data = make_lecture()
        del data["questions"][0]["choices"]["D"]
        self.assertTrue(any("choices" in e for e in validate(data)))

    def test_empty_explanation_is_reported(self):
        data = make_lecture()
        data["questions"][2]["explanation"] = ""
        self.assertTrue(any("explanation" in e for e in validate(data)))


if __name__ == "__main__":
    unittest.main()
