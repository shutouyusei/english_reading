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
            "explanation": f"Explanation {i}",
        })
    return {
        "id": "passage_900",
        "title": "Test Passage",
        "topic": "Environment",
        "body": body,
        "word_count": 15,
        "added": "2026-08-04",
        "questions": questions,
        "vocab": {
            "disequilibria": {
                "etymology": "dis- (not) + equi- (equal) + libra (balance)",
                "definition": "states of imbalance",
                "usage_in_passage": "Key word showing that recovery is unstable.",
                "related_terms": ["equilibrium", "instability"],
                "context_sentence": "Scientists observe disequilibria in reef ecosystems.",
            }
        },
    }


class TestValidate(unittest.TestCase):
    def test_valid_passage_returns_no_errors(self):
        self.assertEqual(validate(make_passage()), [])

    def test_vocab_word_must_appear_in_body(self):
        passage = make_passage()
        passage["vocab"]["nonexistent"] = passage["vocab"]["disequilibria"]
        self.assertTrue(any("nonexistent" in e for e in validate(passage)))

    def test_vocab_word_not_matchable_at_runtime_is_rejected(self):
        # Runtime (findVocabKey in textmatch.js) only strips suffixes off the
        # clicked body token -- it never adds them. So a vocab key that is a
        # *longer* inflected form than anything derivable from the body
        # (here "changed" vs. body word "change") can never be found by
        # clicking the body word, even though the old both-sides matcher
        # accepted it (candidates("changed") includes "change", which is in
        # forms). The fixed one-sided matcher must reject it.
        passage = make_passage()
        entry = passage["vocab"].pop("disequilibria")
        entry["context_sentence"] = "Scientists observe change reef ecosystems."
        passage["body"] = passage["body"].replace(
            "Scientists observe disequilibria in reef ecosystems.",
            "Scientists observe change reef ecosystems.",
        )
        passage["questions"][2]["target_word"] = "change"
        passage["vocab"]["changed"] = entry
        errors = validate(passage)
        self.assertTrue(any("'changed'" in e and "not found in body" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
