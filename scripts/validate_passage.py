#!/usr/bin/env python3
"""Validate a passage JSON file against the app schema."""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from extract_hard_words import WORD_RE, candidates

REQUIRED_FIELDS = ["id", "title", "topic", "body", "word_count", "added", "questions", "vocab"]
QUESTION_FIELDS = ["id", "type", "question", "target_word", "choices", "correct", "explanation"]
QUESTION_TYPES = {"Factual", "Inference", "Vocabulary", "Reference", "Rhetorical Purpose"}
TOPICS = {"科学", "社会", "歴史", "芸術", "環境"}
VOCAB_FIELDS = ["etymology", "definition", "usage_in_passage", "related_terms", "context_sentence"]
CHOICE_KEYS = {"A", "B", "C", "D"}
MAX_SAME_CORRECT = 3
WORD_COUNT_TOLERANCE = 10
TARGET_LENGTH_RANGE = (400, 600)


def body_word_forms(body: str) -> set[str]:
    """All lowercase tokens in body plus their suffix-stripped forms."""
    forms: set[str] = set()
    for token in WORD_RE.findall(body):
        forms.update(candidates(token))
    return forms


def _validate_question(q: dict, forms: set[str]) -> list[str]:
    errors: list[str] = []
    qid = q.get("id", "?")
    for field in QUESTION_FIELDS:
        if field not in q:
            errors.append(f"question {qid}: missing field {field}")
    if q.get("type") not in QUESTION_TYPES:
        errors.append(f"question {qid}: invalid type {q.get('type')!r}")
    if set(q.get("choices", {})) != CHOICE_KEYS:
        errors.append(f"question {qid}: choices must have exactly keys A-D")
    if q.get("correct") not in CHOICE_KEYS:
        errors.append(f"question {qid}: correct must be one of A-D")
    if q.get("type") == "Vocabulary":
        target = q.get("target_word")
        if not target:
            errors.append(f"question {qid}: Vocabulary question requires target_word")
        elif not any(form in forms for form in candidates(target)):
            errors.append(f"question {qid}: target_word {target!r} not found in body")
    return errors


def _validate_vocab(word: str, entry: dict, forms: set[str]) -> list[str]:
    errors: list[str] = []
    for field in VOCAB_FIELDS:
        if field not in entry:
            errors.append(f"vocab {word!r}: missing field {field}")
    if not any(form in forms for form in candidates(word)):
        errors.append(f"vocab {word!r}: not found in body")
    if word.lower() not in entry.get("context_sentence", "").lower():
        errors.append(f"vocab {word!r}: context_sentence does not contain the word")
    return errors


def validate(passage: dict) -> list[str]:
    """Return a list of error messages. Empty list means valid."""
    errors = [f"missing field: {f}" for f in REQUIRED_FIELDS if f not in passage]
    if errors:
        return errors

    if passage["topic"] not in TOPICS:
        errors.append(f"topic must be one of {sorted(TOPICS)}: got {passage['topic']!r}")

    actual = len(WORD_RE.findall(passage["body"]))
    if abs(actual - passage["word_count"]) > WORD_COUNT_TOLERANCE:
        errors.append(f"word_count {passage['word_count']} differs from actual {actual}")

    questions = passage["questions"]
    if len(questions) != 5:
        errors.append(f"expected 5 questions, got {len(questions)}")
    forms = body_word_forms(passage["body"])
    for q in questions:
        errors.extend(_validate_question(q, forms))
    counts = Counter(q.get("correct") for q in questions)
    for letter, n in counts.items():
        if letter in CHOICE_KEYS and n > MAX_SAME_CORRECT:
            errors.append(f"correct answer {letter} used {n} times (max {MAX_SAME_CORRECT})")

    for word, entry in passage["vocab"].items():
        errors.extend(_validate_vocab(word, entry, forms))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("passage_json", type=Path, help="Path to a passage JSON file")
    args = parser.parse_args()
    try:
        passage = json.loads(args.passage_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read passage: {exc}", file=sys.stderr)
        return 1
    errors = validate(passage)
    actual = len(WORD_RE.findall(passage.get("body", "")))
    low, high = TARGET_LENGTH_RANGE
    if not low <= actual <= high:
        print(f"WARNING: body has {actual} words (target 450-500)", file=sys.stderr)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(
        f"OK: {passage['id']} is valid ({actual} words, "
        f"{len(passage['questions'])} questions, {len(passage['vocab'])} vocab entries)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
