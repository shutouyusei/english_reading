#!/usr/bin/env python3
"""Validate a listening item JSON file against the app schema."""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

from extract_hard_words import WORD_RE

REQUIRED_FIELDS = [
    "id", "type", "title", "topic", "added", "word_count", "speakers", "script", "questions",
]
QUESTION_FIELDS = ["id", "type", "question", "choices", "correct", "explanation"]
QUESTION_TYPES = {
    "Gist-Content", "Gist-Purpose", "Detail", "Function", "Attitude", "Inference",
}
TOPICS = {"科学", "社会", "歴史", "芸術", "環境"}
CHOICE_KEYS = {"A", "B", "C", "D"}
SPEAKER_COUNT = {"lecture": 1, "conversation": 2}
LENGTH_RANGE = {"lecture": (500, 700), "conversation": (300, 450)}
QUESTION_COUNT = 6
MIN_DISTINCT_TYPES = 3
MAX_SAME_CORRECT = 3
WORD_COUNT_TOLERANCE = 10
ID_RE = re.compile(r"^listening_\d{3}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def script_text(script: list[dict]) -> str:
    """台本を1つの文字列に連結する。語数はこの文字列から数える。"""
    return " ".join(str(line.get("text", "")) for line in script)


def count_words(script: list[dict]) -> int:
    return len(WORD_RE.findall(script_text(script)))


def _validate_speakers(data: dict) -> list[str]:
    errors: list[str] = []
    speakers = data["speakers"]
    if not isinstance(speakers, list):
        return ["speakers must be a list"]

    expected = SPEAKER_COUNT.get(data["type"])
    if expected is not None and len(speakers) != expected:
        errors.append(
            f"speakers must have {expected} entries for type {data['type']!r}, got {len(speakers)}"
        )
    seen: set[str] = set()
    for index, speaker in enumerate(speakers):
        if not isinstance(speaker, dict):
            errors.append(f"speakers[{index}] must be an object")
            continue
        for name in ("id", "role", "voice"):
            if not str(speaker.get(name, "")).strip():
                errors.append(f"speakers[{index}].{name} must not be empty")
        speaker_id = str(speaker.get("id", ""))
        if speaker_id in seen:
            errors.append(f"duplicate speaker id {speaker_id!r}")
        seen.add(speaker_id)
    return errors


def _validate_script(data: dict) -> list[str]:
    errors: list[str] = []
    script = data["script"]
    if not isinstance(script, list) or not script:
        return ["script must be a non-empty list"]

    known = {str(s.get("id")) for s in data["speakers"] if isinstance(s, dict)}
    for index, line in enumerate(script):
        if not isinstance(line, dict):
            errors.append(f"script[{index}] must be an object")
            continue
        speaker = str(line.get("speaker", ""))
        if speaker not in known:
            errors.append(f"script[{index}].speaker {speaker!r} is not in speakers")
        if not str(line.get("text", "")).strip():
            errors.append(f"script[{index}].text must not be empty")
    return errors


def _validate_question(question: dict, index: int) -> list[str]:
    errors: list[str] = []
    missing = [name for name in QUESTION_FIELDS if name not in question]
    if missing:
        return [f"questions[{index}] missing {', '.join(missing)}"]

    if question["type"] not in QUESTION_TYPES:
        errors.append(
            f"questions[{index}] has invalid type {question['type']!r}, "
            f"expected one of {sorted(QUESTION_TYPES)}"
        )
    choices = question["choices"]
    if not isinstance(choices, dict) or set(choices) != CHOICE_KEYS:
        errors.append(f"questions[{index}] choices must have exactly keys A, B, C, D")
    else:
        for key in sorted(CHOICE_KEYS):
            if not str(choices[key]).strip():
                errors.append(f"questions[{index}] choice {key} must not be empty")
    if question["correct"] not in CHOICE_KEYS:
        errors.append(f"questions[{index}] correct must be one of A, B, C, D")
    if not str(question["explanation"]).strip():
        errors.append(f"questions[{index}] explanation must not be empty")
    return errors


def _validate_questions(data: dict) -> list[str]:
    errors: list[str] = []
    questions = data["questions"]
    if not isinstance(questions, list):
        return ["questions must be a list"]
    if len(questions) != QUESTION_COUNT:
        errors.append(f"questions must have exactly {QUESTION_COUNT} entries, got {len(questions)}")

    for index, question in enumerate(questions):
        if isinstance(question, dict):
            errors.extend(_validate_question(question, index))
        else:
            errors.append(f"questions[{index}] must be an object")

    types = {q.get("type") for q in questions if isinstance(q, dict)}
    if len(types & QUESTION_TYPES) < MIN_DISTINCT_TYPES:
        errors.append(
            f"questions must use at least {MIN_DISTINCT_TYPES} distinct types, "
            f"got {len(types & QUESTION_TYPES)}"
        )
    counts = Counter(q.get("correct") for q in questions if isinstance(q, dict))
    for letter, count in sorted(counts.items()):
        if letter in CHOICE_KEYS and count > MAX_SAME_CORRECT:
            errors.append(f"correct answer {letter} appears {count} times (max {MAX_SAME_CORRECT})")
    return errors


def validate(data: dict) -> list[str]:
    """Return a list of problems. An empty list means the item is valid."""
    missing = [f"missing field {name}" for name in REQUIRED_FIELDS if name not in data]
    if missing:
        return missing

    errors: list[str] = []
    if not ID_RE.match(str(data["id"])):
        errors.append(f"id {data['id']!r} must look like listening_001")
    if data["type"] not in SPEAKER_COUNT:
        errors.append(
            f"invalid type {data['type']!r}, expected one of {sorted(SPEAKER_COUNT)}"
        )
    if data["topic"] not in TOPICS:
        errors.append(f"invalid topic {data['topic']!r}, expected one of {sorted(TOPICS)}")
    if not DATE_RE.match(str(data["added"])):
        errors.append(f"added must be YYYY-MM-DD, got {data['added']!r}")
    if not str(data["title"]).strip():
        errors.append("title must not be empty")

    errors.extend(_validate_speakers(data))
    errors.extend(_validate_script(data))
    errors.extend(_validate_questions(data))

    if isinstance(data["script"], list) and data["script"]:
        actual = count_words(data["script"])
        declared = data["word_count"]
        if not isinstance(declared, int) or isinstance(declared, bool):
            errors.append(f"word_count must be an integer, got {declared!r}")
        elif abs(declared - actual) > WORD_COUNT_TOLERANCE:
            errors.append(f"word_count {declared} differs from actual {actual}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("listening_json", type=Path, help="Path to a listening JSON file")
    args = parser.parse_args()
    try:
        data = json.loads(args.listening_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read listening item: {exc}", file=sys.stderr)
        return 1

    errors = validate(data)
    if isinstance(data.get("script"), list):
        actual = count_words(data["script"])
        low, high = LENGTH_RANGE.get(data.get("type"), (0, 10**9))
        if not low <= actual <= high:
            print(f"WARNING: script has {actual} words (target {low}-{high})", file=sys.stderr)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(
        f"OK: {data['id']} is valid ({count_words(data['script'])} words, "
        f"{len(data['questions'])} questions, {data['type']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
