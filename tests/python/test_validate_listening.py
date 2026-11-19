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
            "explanation": "An explanation.",
        }
        for i, (qtype, correct) in enumerate(zip(TYPES, CORRECTS), start=1)
    ]


def make_lecture() -> dict:
    # The word count may be outside the target range (the range is a warning, not an error).
    return {
        "id": "listening_001",
        "type": "lecture",
        "title": "Coral Reefs and Repeated Stress",
        "topic": "Science",
        "added": "2026-08-19",
        "word_count": 12,
        "speakers": [{"id": "professor", "role": "Professor", "voice": "Daniel"}],
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
        {"id": "student", "role": "Student", "voice": "Samantha"},
        {"id": "advisor", "role": "Office staff", "voice": "Daniel"},
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

    def test_lecture_must_have_one_speaker(self):
        data = make_lecture()
        data["speakers"].append({"id": "student", "role": "Student", "voice": "Samantha"})
        self.assertTrue(any("speakers" in e for e in validate(data)))

    def test_conversation_must_have_two_speakers(self):
        data = make_conversation()
        data["speakers"] = data["speakers"][:1]
        self.assertTrue(any("speakers" in e for e in validate(data)))

    def test_unknown_speaker_in_script_is_reported(self):
        data = make_lecture()
        data["script"][0]["speaker"] = "student"
        self.assertTrue(any("speaker" in e for e in validate(data)))

    def test_word_count_mismatch_is_reported(self):
        data = make_lecture()
        data["word_count"] = 999
        self.assertTrue(any("word_count" in e for e in validate(data)))

    def test_question_count_must_be_six(self):
        data = make_lecture()
        data["questions"] = data["questions"][:5]
        self.assertTrue(any("questions" in e for e in validate(data)))

    def test_invalid_correct_letter_is_reported(self):
        data = make_lecture()
        data["questions"][0]["correct"] = "E"
        self.assertTrue(any("correct" in e for e in validate(data)))

    def test_speakers_none_does_not_crash(self):
        data = make_lecture()
        data["speakers"] = None
        errors = validate(data)
        self.assertTrue(any("speakers" in e for e in errors))
        self.assertIsInstance(errors, list)

    def test_same_correct_letter_four_times_is_reported(self):
        data = make_lecture()
        # Set questions 0, 1, 2 to A to get 4 A's total (0, 1, 2, 4 from fixture)
        data["questions"][0]["correct"] = "A"
        data["questions"][1]["correct"] = "A"
        data["questions"][2]["correct"] = "A"
        data["questions"][3]["correct"] = "B"
        data["questions"][5]["correct"] = "C"
        # Now we have 4 A's - should error
        self.assertTrue(any("correct" in e for e in validate(data)))

    # --- Does every double-quoted text in an explanation exist in the script? ---
    # Guards against fixing the script and forgetting the quote in the explanation, which
    # really happened in listening_002. Double quotes mean a verbatim quote and are
    # checked; single quotes mean a paraphrase or a term and are not.
    # The fixture script is "Today we look at how reefs respond to repeated stress over many years."

    def test_explanation_quoting_the_script_is_allowed(self):
        data = make_lecture()
        data["questions"][0]["explanation"] = (
            'The opening line, "Today we look at how reefs respond", is the evidence. '
            "The speaker treats the damage as 'cumulative'."
        )
        self.assertEqual(validate(data), [])

    def test_explanation_quoting_text_absent_from_script_is_reported(self):
        data = make_lecture()
        explanations = {
            "straight": 'At the end the speaker says "I will go down there now."',
            "curly": "At the end the speaker says \u201cI will go down there now.\u201d",
        }
        for style, explanation in explanations.items():
            with self.subTest(quotes=style):
                data["questions"][0]["explanation"] = explanation
                errors = validate(data)
                self.assertTrue(any("does not appear in the script" in e for e in errors), errors)
                self.assertTrue(any("questions[0]" in e for e in errors), errors)

    def test_quotation_spanning_two_script_lines_is_allowed(self):
        data = make_lecture()
        data["questions"][0]["explanation"] = 'The speaker says "repeated stress over many years".'
        self.assertEqual(validate(data), [])


if __name__ == "__main__":
    unittest.main()
