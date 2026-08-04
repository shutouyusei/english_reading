#!/usr/bin/env python3
"""Extract vocabulary from a passage that is not in the common-words list."""
import argparse
import json
import re
import sys
from pathlib import Path

COMMON_WORDS_PATH = Path(__file__).resolve().parent / "common_words.txt"
WORD_RE = re.compile(r"[A-Za-z]+(?:['-][A-Za-z]+)*")
SUFFIXES = ("ing", "ed", "es", "s")
MIN_STEM_LEN = 3
MIN_WORD_LEN = 4


def load_common_words(path: Path) -> set[str]:
    """Load the common-words list as a lowercase set."""
    words = {line.strip().lower() for line in path.read_text(encoding="utf-8").splitlines()}
    words.discard("")
    return words


def candidates(token: str) -> list[str]:
    """Return the token plus naive suffix-stripped base forms (all lowercase)."""
    lowered = token.lower()
    forms = [lowered]
    for suffix in SUFFIXES:
        if lowered.endswith(suffix) and len(lowered) - len(suffix) >= MIN_STEM_LEN:
            stem = lowered[: -len(suffix)]
            forms.append(stem)
            if suffix in ("ing", "ed"):
                forms.append(stem + "e")  # changed -> change, attributed -> attribute
    return forms


def extract_hard_words(body: str, common: set[str]) -> list[str]:
    """Return unique lowercase words in body not covered by the common list."""
    hard: list[str] = []
    seen: set[str] = set()
    for token in WORD_RE.findall(body):
        lowered = token.lower()
        if len(lowered) < MIN_WORD_LEN or lowered in seen:
            continue
        seen.add(lowered)
        if any(form in common for form in candidates(lowered)):
            continue
        hard.append(lowered)
    return hard


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("passage_json", type=Path, help="Path to a passage JSON file")
    args = parser.parse_args()
    try:
        passage = json.loads(args.passage_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read passage: {exc}", file=sys.stderr)
        return 1
    common = load_common_words(COMMON_WORDS_PATH)
    for word in extract_hard_words(passage["body"], common):
        print(word)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
