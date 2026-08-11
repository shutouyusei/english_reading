#!/usr/bin/env python3
"""Validate a writing prompt JSON file against the app schema."""
import argparse
import json
import re
import sys
from pathlib import Path

REQUIRED_FIELDS = [
    "id", "type", "title", "added", "target_minutes",
    "instructions", "situation", "recipient", "must_include", "discussion",
]
TYPES = {"email", "discussion"}
EMAIL_ONLY_FIELDS = ["situation", "recipient", "must_include"]
NON_EMPTY_TEXT_FIELDS = ["title", "instructions"]
STUDENT_POST_COUNT = 2
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_prompt(data: dict, filename_stem: str) -> list[str]:
    """Return a list of problems. An empty list means the prompt is valid."""
    missing = [f"missing field {name}" for name in REQUIRED_FIELDS if name not in data]
    if missing:
        return missing

    errors: list[str] = []
    if data["id"] != filename_stem:
        errors.append(f"id {data['id']!r} does not match filename {filename_stem!r}")
    if not isinstance(data["target_minutes"], int) or isinstance(data["target_minutes"], bool) or data["target_minutes"] <= 0:
        errors.append(f"target_minutes must be a positive integer, got {data['target_minutes']!r}")
    if not DATE_RE.match(str(data["added"])):
        errors.append(f"added must be YYYY-MM-DD, got {data['added']!r}")
    for name in NON_EMPTY_TEXT_FIELDS:
        if not str(data[name]).strip():
            errors.append(f"{name} must not be empty")

    if data["type"] == "email":
        errors.extend(_validate_email(data))
    elif data["type"] == "discussion":
        errors.extend(_validate_discussion(data))
    else:
        errors.append(f"invalid type {data['type']!r}, expected one of {sorted(TYPES)}")
    return errors


def _validate_email(data: dict) -> list[str]:
    errors: list[str] = []

    # Validate situation
    situation = data["situation"]
    if situation is None:
        errors.append("email prompt requires situation")
    elif not isinstance(situation, str) or not situation.strip():
        errors.append("situation must be a non-empty string")

    # Validate recipient
    recipient = data["recipient"]
    if recipient is None:
        errors.append("email prompt requires recipient")
    elif not isinstance(recipient, str) or not recipient.strip():
        errors.append("recipient must be a non-empty string")

    # Validate must_include
    must_include = data["must_include"]
    if must_include is None:
        errors.append("email prompt requires must_include")
    elif not isinstance(must_include, list) or not must_include:
        errors.append("must_include must be a non-empty list")
    elif not all(isinstance(item, str) and item.strip() for item in must_include):
        errors.append("must_include entries must be non-empty strings")

    # Validate discussion is null
    if data["discussion"] is not None:
        errors.append("email prompt must have discussion == null")

    return errors


def _validate_discussion(data: dict) -> list[str]:
    errors: list[str] = []
    for name in EMAIL_ONLY_FIELDS:
        if data[name] is not None:
            errors.append(f"discussion prompt must have {name} == null")
    discussion = data["discussion"]
    if not isinstance(discussion, dict):
        errors.append("discussion prompt requires a discussion object")
        return errors
    errors.extend(_validate_post(discussion.get("professor_post"), "discussion.professor_post"))
    posts = discussion.get("student_posts")
    if not isinstance(posts, list) or len(posts) != STUDENT_POST_COUNT:
        count = len(posts) if isinstance(posts, list) else "none"
        errors.append(f"discussion.student_posts must have exactly {STUDENT_POST_COUNT} entries, got {count}")
    else:
        for index, post in enumerate(posts):
            errors.extend(_validate_post(post, f"discussion.student_posts[{index}]"))
    return errors


def _validate_post(post, label: str) -> list[str]:
    if not isinstance(post, dict) or not str(post.get("name", "")).strip() \
            or not str(post.get("text", "")).strip():
        return [f"{label} requires a non-empty name and text"]
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="path to a writing_NNN.json file")
    args = parser.parse_args()

    try:
        data = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"{args.path.name}: cannot read as JSON: {error}", file=sys.stderr)
        return 1

    errors = validate_prompt(data, args.path.stem)
    for error in errors:
        print(f"{args.path.name}: {error}", file=sys.stderr)
    if errors:
        return 1
    print(f"{args.path.name}: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
