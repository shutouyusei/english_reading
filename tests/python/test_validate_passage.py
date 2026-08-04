"""Tests for validate_passage.py."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from validate_passage import validate


def make_passage() -> dict:
    body = (
        "Coral reefs recover slowly. Scientists observe disequilibria "
        "in reef ecosystems. Recovery depends on many factors."
    )
    types = ["Factual", "Inference", "Vocabulary", "Reference", "Rhetorical Purpose"]
    corrects = ["A", "B", "C", "D", "A"]
    questions = []
    for i, (qtype, correct) in enumerate(zip(types, corrects), start=1):
        questions.append({
            "id": i,
            "type": qtype,
            "question": f"Question {i}?",
            "target_word": "disequilibria" if qtype == "Vocabulary" else None,
            "choices": {"A": "a", "B": "b", "C": "c", "D": "d"},
            "correct": correct,
            "explanation": f"解説{i}",
        })
    return {
        "id": "passage_900",
        "title": "Test Passage",
        "topic": "環境",
        "body": body,
        "word_count": 15,
        "added": "2026-08-04",
        "questions": questions,
        "vocab": {
            "disequilibria": {
                "etymology": "dis-(否定) + equi-(等しい) + librium(天秤)",
                "definition": "不均衡状態",
                "usage_in_passage": "回復の不安定さを示すキーワード。",
                "related_terms": ["equilibrium", "instability"],
                "context_sentence": "Scientists observe disequilibria in reef ecosystems.",
            }
        },
    }


class TestValidate(unittest.TestCase):
    def test_valid_passage_returns_no_errors(self):
        self.assertEqual(validate(make_passage()), [])

    def test_missing_top_level_field(self):
        passage = make_passage()
        del passage["title"]
        self.assertTrue(any("title" in e for e in validate(passage)))

    def test_correct_answers_too_concentrated(self):
        passage = make_passage()
        for q in passage["questions"]:
            q["correct"] = "A"
        self.assertTrue(any("used 5 times" in e for e in validate(passage)))

    def test_vocab_word_must_appear_in_body(self):
        passage = make_passage()
        passage["vocab"]["nonexistent"] = passage["vocab"]["disequilibria"]
        self.assertTrue(any("nonexistent" in e for e in validate(passage)))

    def test_vocabulary_question_requires_target_word(self):
        passage = make_passage()
        passage["questions"][2]["target_word"] = None
        self.assertTrue(any("target_word" in e for e in validate(passage)))

    def test_word_count_mismatch(self):
        passage = make_passage()
        passage["word_count"] = 100
        self.assertTrue(any("word_count" in e for e in validate(passage)))


if __name__ == "__main__":
    unittest.main()
