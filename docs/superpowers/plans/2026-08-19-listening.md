# リスニング機能 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TOEFL形式のリスニング(Conversation / Lecture)を聴いて設問に答え、台本と辞書で復習できる機能をローカルアプリに追加する。

**Architecture:** 台本JSONだけをリポジトリにコミットし、音声は初回再生時に macOS の `say` で生成して `~/Documents/TOEFLReading/audio/` にキャッシュする。キャッシュは新しい `audio://` スキームで配信し、既存 `app://` の「リポジトリ外を読めない」保証には触れない。設問の形は読解パッセージと同一にして採点UIを流用し、台本には語彙解説を持たせずシステム辞書に引かせる。

**Tech Stack:** Swift 5(swiftc 直接ビルド、Xcode なし) / WKWebView / AVFoundation / 素の JavaScript(フレームワークなし) / Python 3(標準ライブラリのみ) / node:test / unittest

**Spec:** `docs/superpowers/specs/2026-08-19-listening-design.md`

## Global Constraints

- 対象は macOS のローカルアプリのみ。**公開サイト(GitHub Pages)にリスニングUIは載せない**
- リスニング固有の JS は `app/ui/js/` に置く。`docs/js/` に置いてよいのは公開版と共用するものだけ
- 音声ファイルは**コミットしない**。`~/Documents/TOEFLReading/audio/` にのみ置く
- `say` の呼び出しには必ず `--file-format=m4af --data-format=aac` を付ける(無指定だと約8倍のサイズになる)
- `window.Audio` と `window.speechSynthesis` はブラウザ標準。**上書きしないこと**。窓口は `window.Speech`
- JS 側の窓口名: 音声生成は `speech`、学習記録は `listening`(衝突させない)
- 設問はちょうど6問。タイプは `Gist-Content` / `Gist-Purpose` / `Detail` / `Function` / `Attitude` / `Inference` の6種から3種類以上を混在させる
- `correct` は A〜D、同一文字は最大3回まで
- トピックは読解と同じ集合: `科学` / `社会` / `歴史` / `芸術` / `環境`
- 語数の範囲: lecture は 500〜700語、conversation は 300〜450語(範囲外は警告であってエラーではない)
- 解説(`explanation`)は日本語
- エラーメッセージは日本語。**音声が出ないことを黙って無視する経路を作らない**
- コミットは Conventional Commits。本文は日本語。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 各タスクの最後に必ず全テストを回す:
  `python3 -m unittest discover -s tests/python -t tests/python -q` /
  `node --test tests/js/*.test.js` / `sh app/tests/run.sh`

---

### Task 1: 台本スキーマの検証スクリプト

**Files:**
- Create: `scripts/validate_listening.py`
- Test: `tests/python/test_validate_listening.py`

**Interfaces:**
- Consumes: `scripts/extract_hard_words.py` の `WORD_RE`(語数の数え方を読解と揃えるため)
- Produces: `validate(data: dict) -> list[str]` — 問題の一覧。空リストなら妥当。
  `main()` は妥当なら `OK: <id> is valid (<語数> words, 6 questions, <type>)` を出して0を返す

- [ ] **Step 1: 失敗するテストを書く**

`tests/python/test_validate_listening.py`:

```python
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `python3 -m unittest discover -s tests/python -t tests/python -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'validate_listening'`

- [ ] **Step 3: 検証スクリプトを書く**

`scripts/validate_listening.py`:

```python
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
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `python3 -m unittest discover -s tests/python -t tests/python -q`
Expected: PASS(既存44件 + 新規19件 = 63件)

- [ ] **Step 5: コミット**

```bash
git add scripts/validate_listening.py tests/python/test_validate_listening.py
git commit -m "$(cat <<'MSG'
feat: リスニング台本の検証スクリプトを追加する

台本と設問のスキーマを機械判定できるようにする。語数の数え方は
extract_hard_words.WORD_RE を共有して読解と揃える。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: マニフェスト更新スクリプト

**Files:**
- Create: `scripts/update_listening_index.py`
- Test: `tests/python/test_update_listening_index.py`

**Interfaces:**
- Consumes: なし
- Produces: `build_index(items: list[dict]) -> dict` — `{"items": [...]}` を返す。
  行は `id` / `type` / `title` / `topic` / `word_count` / `added` のみ。`added` の降順、同日は `id` の降順

- [ ] **Step 1: 失敗するテストを書く**

`tests/python/test_update_listening_index.py`:

```python
"""Tests for update_listening_index.py."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from update_listening_index import build_index


def make_item(item_id: str, added: str) -> dict:
    return {
        "id": item_id,
        "type": "lecture",
        "title": f"Title {item_id}",
        "topic": "科学",
        "added": added,
        "word_count": 600,
        "speakers": [{"id": "professor", "role": "教授", "voice": "Daniel"}],
        "script": [{"speaker": "professor", "text": "Hello."}],
        "questions": [],
    }


class BuildIndexTest(unittest.TestCase):
    def test_keeps_only_summary_fields(self):
        index = build_index([make_item("listening_001", "2026-08-19")])
        self.assertEqual(
            sorted(index["items"][0]),
            ["added", "id", "title", "topic", "type", "word_count"],
        )

    def test_sorts_newest_first(self):
        items = [
            make_item("listening_001", "2026-08-01"),
            make_item("listening_003", "2026-08-19"),
            make_item("listening_002", "2026-08-10"),
        ]
        ids = [row["id"] for row in build_index(items)["items"]]
        self.assertEqual(ids, ["listening_003", "listening_002", "listening_001"])

    def test_same_day_sorts_by_id_descending(self):
        items = [make_item("listening_001", "2026-08-19"), make_item("listening_002", "2026-08-19")]
        ids = [row["id"] for row in build_index(items)["items"]]
        self.assertEqual(ids, ["listening_002", "listening_001"])

    def test_empty_input_gives_empty_list(self):
        self.assertEqual(build_index([]), {"items": []})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `python3 -m unittest discover -s tests/python -t tests/python -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'update_listening_index'`

- [ ] **Step 3: スクリプトを書く**

`scripts/update_listening_index.py`:

```python
#!/usr/bin/env python3
"""Rebuild docs/data/listening/index.json from the item files next to it."""
import json
import sys
from pathlib import Path

SUMMARY_FIELDS = ["id", "type", "title", "topic", "word_count", "added"]
LISTENING_DIR = Path(__file__).resolve().parent.parent / "docs" / "data" / "listening"
INDEX_PATH = LISTENING_DIR / "index.json"


def build_index(items: list[dict]) -> dict:
    """Reduce full item objects to the summary rows the list screen needs."""
    rows = [{name: item[name] for name in SUMMARY_FIELDS} for item in items]
    rows.sort(key=lambda row: (row["added"], row["id"]), reverse=True)
    return {"items": rows}


def load_items(directory: Path) -> list[dict]:
    paths = sorted(p for p in directory.glob("listening_*.json"))
    return [json.loads(path.read_text(encoding="utf-8")) for path in paths]


def main() -> int:
    if not LISTENING_DIR.is_dir():
        print(f"not a directory: {LISTENING_DIR}", file=sys.stderr)
        return 1

    index = build_index(load_items(LISTENING_DIR))
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{INDEX_PATH}: {len(index['items'])} items")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `python3 -m unittest discover -s tests/python -t tests/python -q`
Expected: PASS(63 + 4 = 67件)

- [ ] **Step 5: コミット**

```bash
git add scripts/update_listening_index.py tests/python/test_update_listening_index.py
git commit -m "$(cat <<'MSG'
feat: リスニングのマニフェスト更新スクリプトを追加する

一覧画面が読む index.json を台本ファイルから組み立て直す。
update_writing_index.py と同じ形にした。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: サンプル台本を1本作る

以降のタスクが実データを必要とするため、ここで1本だけ用意する。

**Files:**
- Create: `docs/data/listening/listening_001.json`
- Create: `docs/data/listening/index.json`(スクリプトが生成する)

**Interfaces:**
- Consumes: Task 1 の `validate_listening.py`、Task 2 の `update_listening_index.py`
- Produces: `listening_001`(type=`lecture`、topic=`科学`、話者は professor 1名、voice=`Daniel`)

- [ ] **Step 1: 台本を書く**

`docs/data/listening/listening_001.json` を作る。要件:

- `id`: `listening_001`、`type`: `lecture`、`topic`: `科学`、`added`: 実装日(YYYY-MM-DD)
- `title`: 既存の読解7本と重複しないテーマ(例: `Why Some Memories Fade`)
- `speakers`: `[{"id": "professor", "role": "教授", "voice": "Daniel"}]`
- `script`: 講義を意味のまとまりで区切った行の配列。1行は1〜3文程度。**合計500〜700語**
- 講義らしい言い回しを入れる(`Okay, so last time...` `Now, here is the part I want you to focus on...`)
- `questions`: 6問。タイプは `Gist-Content` を1問目に置き、残りに `Detail` / `Function` / `Attitude` / `Inference` を混ぜる(3種類以上)
- `correct` は A〜D に散らし、同一文字は最大3回
- `explanation` は日本語。台本の該当箇所を引用して根拠を示す
- `word_count`: Step 2 の検証で実数を確認してから合わせる

- [ ] **Step 2: 検証してマニフェストを更新する**

```bash
python3 scripts/validate_listening.py docs/data/listening/listening_001.json
python3 scripts/update_listening_index.py
```

Expected: `OK: listening_001 is valid (NNN words, 6 questions, lecture)` と
`docs/data/listening/index.json: 1 items`
語数の WARNING が出たら台本を調整して再実行する。

- [ ] **Step 3: コミット**

```bash
git add docs/data/listening
git commit -m "$(cat <<'MSG'
content: リスニング001を追加する

以降の実装が実データを必要とするため、講義形式のサンプルを1本置く。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: 音声合成層

**Files:**
- Create: `app/src/SpeechSynthesizer.swift`
- Test: `app/tests/test_speech_synthesizer.swift`
- Modify: `app/tests/run.sh`(テストを1ブロック追加)
- Modify: `app/build.sh`(新規 Swift ファイルを追加)

**Interfaces:**
- Consumes: なし
- Produces:
  ```swift
  struct Utterance { let voice: String; let text: String }
  enum SpeechError: Error { case sayFailed(String), mergeFailed(String), cacheUnwritable(String) }
  final class SpeechSynthesizer {
      init(cacheDirectory: URL)
      func cachedURL(for id: String) -> URL?                       // 無ければ nil
      func synthesize(id: String, utterances: [Utterance]) throws -> URL
      func fileName(for id: String) -> String                      // "<id>.m4a"
  }
  ```

- [ ] **Step 1: 失敗するテストを書く**

`app/tests/test_speech_synthesizer.swift`:

```swift
import Foundation

var failures = 0
var skipped = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)\(detail.isEmpty ? "" : "  (\(detail))")")
        failures += 1
    }
}

func skip(_ name: String, _ reason: String) {
    print("skip - \(name) (\(reason))")
    skipped += 1
}

/// say が使えるかは実装に尋ねず外形で判定する。
/// 実装が壊れているときに「say が無い環境」を装って素通りさせないため。
func sayIsAvailable() -> Bool {
    return FileManager.default.isExecutableFile(atPath: "/usr/bin/say")
}

func fileSize(of url: URL) -> Int {
    let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
    return (attributes?[.size] as? Int) ?? 0
}

func durationSeconds(of url: URL) -> Double {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/afinfo")
    process.arguments = [url.path]
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = Pipe()
    try? process.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let text = String(data: data, encoding: .utf8) ?? ""
    for line in text.split(separator: "\n") where line.contains("estimated duration") {
        let number = line.split(separator: ":").last?.trimmingCharacters(in: .whitespaces) ?? ""
        return Double(number.replacingOccurrences(of: " sec", with: "")) ?? 0
    }
    return 0
}

@main
struct TestSpeechSynthesizer {
    static func main() {
        guard sayIsAvailable() else {
            skip("音声合成全般", "この環境に /usr/bin/say が無い")
            exit(0)
        }

        let cacheDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("speech-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cacheDir) }

        let synthesizer = SpeechSynthesizer(cacheDirectory: cacheDir)

        check("生成前はキャッシュが無い", synthesizer.cachedURL(for: "listening_900") == nil)

        // 1発話: そのまま1ファイルになる
        let single: URL
        do {
            single = try synthesizer.synthesize(
                id: "listening_900",
                utterances: [Utterance(voice: "Samantha", text: "This is a single utterance test.")])
        } catch {
            check("1発話を生成できる", false, "\(error)")
            exit(1)
        }
        check("1発話を生成できる", FileManager.default.fileExists(atPath: single.path))
        check("生成後はキャッシュが見つかる", synthesizer.cachedURL(for: "listening_900") != nil)
        check("ファイル名が <id>.m4a", single.lastPathComponent == "listening_900.m4a")

        let singleSize = fileSize(of: single)
        check("空ファイルではない", singleSize > 1000, "サイズ=\(singleSize)")

        // 核心: AAC を指定していること。非圧縮だと同じ長さで約8倍になる。
        let singleDuration = durationSeconds(of: single)
        check("音声の長さが取れる", singleDuration > 1.0, "秒=\(singleDuration)")
        let bytesPerSecond = Double(singleSize) / max(singleDuration, 0.001)
        check("AAC で圧縮されている(1秒あたり20KB未満)", bytesPerSecond < 20_000,
              "1秒あたり\(Int(bytesPerSecond))バイト")

        // 複数発話: 結合されて1ファイルになり、合計の長さになる
        let parts = [
            Utterance(voice: "Samantha", text: "Excuse me, I have a question about the deadline."),
            Utterance(voice: "Daniel", text: "Of course. The form is due at the end of the week."),
        ]
        let merged: URL
        do {
            merged = try synthesizer.synthesize(id: "listening_901", utterances: parts)
        } catch {
            check("複数発話を結合できる", false, "\(error)")
            exit(1)
        }
        check("複数発話を結合できる", FileManager.default.fileExists(atPath: merged.path))
        let mergedDuration = durationSeconds(of: merged)
        check("結合後の長さが1発話より長い", mergedDuration > singleDuration,
              "結合=\(mergedDuration) 単独=\(singleDuration)")

        // 失敗しても半端なファイルを残さない
        do {
            _ = try synthesizer.synthesize(id: "listening_902", utterances: [])
            check("発話が空なら失敗する", false, "例外が投げられなかった")
        } catch {
            check("発話が空なら失敗する", true)
        }
        check("失敗した生成のファイルが残らない",
              synthesizer.cachedURL(for: "listening_902") == nil)

        // 存在しない声は黙って別の声に差し替えず、どの声が駄目かを言って失敗する
        do {
            _ = try synthesizer.synthesize(
                id: "listening_903",
                utterances: [Utterance(voice: "NoSuchVoiceXYZ", text: "Hello.")])
            check("存在しない声では失敗する", false, "例外が投げられなかった")
        } catch {
            let text = error.localizedDescription
            check("存在しない声では失敗する", true)
            check("エラー文にどの声か書いてある", text.contains("NoSuchVoiceXYZ"), text)
        }
        check("失敗した生成のファイルが残らない(声が無い場合)",
              synthesizer.cachedURL(for: "listening_903") == nil)

        // すべてのエラーに日本語の説明がある
        let errors: [SpeechError] = [
            .sayFailed("x"), .mergeFailed("x"), .cacheUnwritable("x"),
        ]
        for error in errors {
            let text = error.localizedDescription
            let hasJapanese = text.unicodeScalars.contains {
                (0x3040...0x309F).contains($0.value) || (0x30A0...0x30FF).contains($0.value)
                    || (0x4E00...0x9FFF).contains($0.value)
            }
            check("エラーに日本語の説明がある: \(error)", hasJapanese, text)
        }

        if skipped > 0 { print("(\(skipped) 件スキップ)") }
        exit(failures == 0 ? 0 : 1)
    }
}
```

- [ ] **Step 2: テストが失敗することを確認する**

コンパイルが通る最小のスタブを置いてから走らせる(アサーションが実際に落ちるところまで見るため)。

`app/src/SpeechSynthesizer.swift`(スタブ):

```swift
import Foundation

struct Utterance { let voice: String; let text: String }

enum SpeechError: Error { case sayFailed(String), mergeFailed(String), cacheUnwritable(String) }

final class SpeechSynthesizer {
    init(cacheDirectory: URL) {}
    func fileName(for id: String) -> String { return "\(id).m4a" }
    func cachedURL(for id: String) -> URL? { return nil }
    func synthesize(id: String, utterances: [Utterance]) throws -> URL {
        throw SpeechError.sayFailed("未実装")
    }
}
```

Run:
```bash
TMP=$(mktemp -d) && swiftc -O app/src/SpeechSynthesizer.swift \
  app/tests/test_speech_synthesizer.swift -o "$TMP/t" && "$TMP/t"
```
Expected: FAIL — 「1発話を生成できる」で落ちる

- [ ] **Step 3: 実装を書く**

`app/src/SpeechSynthesizer.swift`(スタブを置き換える):

```swift
import Foundation
import AVFoundation

/// 台本の1行分。話者ごとに声が変わる。
struct Utterance {
    let voice: String
    let text: String
}

/// 音声を用意できなかった理由。画面にそのまま出せる日本語を持たせる。
enum SpeechError: Error, LocalizedError {
    case sayFailed(String)
    case mergeFailed(String)
    case cacheUnwritable(String)

    var errorDescription: String? {
        switch self {
        case .sayFailed(let detail):
            return "音声を合成できませんでした: \(detail)"
        case .mergeFailed(let detail):
            return "音声の結合に失敗しました: \(detail)"
        case .cacheUnwritable(let detail):
            return "音声の保存先に書き込めません: \(detail)"
        }
    }
}

/// macOS の say を呼んで台本を m4a にする。
/// say は1回の呼び出しで1話者しか使えないため、複数話者は個別に作って結合する。
final class SpeechSynthesizer {
    private let cacheDirectory: URL

    init(cacheDirectory: URL) {
        self.cacheDirectory = cacheDirectory
    }

    func fileName(for id: String) -> String {
        return "\(id).m4a"
    }

    /// キャッシュ済みならその場所。無ければ nil。
    func cachedURL(for id: String) -> URL? {
        let url = cacheDirectory.appendingPathComponent(fileName(for: id))
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// 台本から音声を作ってキャッシュへ置き、その場所を返す。
    /// 途中で失敗した場合、キャッシュには何も残さない。
    func synthesize(id: String, utterances: [Utterance]) throws -> URL {
        guard !utterances.isEmpty else {
            throw SpeechError.sayFailed("発話が1つもありません")
        }
        do {
            try FileManager.default.createDirectory(
                at: cacheDirectory, withIntermediateDirectories: true)
        } catch {
            throw SpeechError.cacheUnwritable(error.localizedDescription)
        }

        let workDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("speech-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: workDir) }

        var parts: [URL] = []
        for (index, utterance) in utterances.enumerated() {
            let part = workDir.appendingPathComponent("part_\(index).m4a")
            try runSay(utterance: utterance, output: part)
            parts.append(part)
        }

        // 一時ディレクトリで完成させてから移す。半端なファイルをキャッシュに残さないため。
        let staged = workDir.appendingPathComponent("final.m4a")
        if parts.count == 1 {
            try move(parts[0], to: staged)
        } else {
            try merge(parts, into: staged)
        }

        let destination = cacheDirectory.appendingPathComponent(fileName(for: id))
        try move(staged, to: destination)
        return destination
    }

    private func move(_ source: URL, to destination: URL) throws {
        do {
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: source, to: destination)
        } catch {
            throw SpeechError.cacheUnwritable(error.localizedDescription)
        }
    }

    /// AAC を必ず指定する。無指定だと非圧縮になり、同じ長さで約8倍の大きさになる。
    private func runSay(utterance: Utterance, output: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        process.arguments = [
            "-v", utterance.voice,
            "--file-format=m4af",
            "--data-format=aac",
            "-o", output.path,
            utterance.text,
        ]
        let errorPipe = Pipe()
        process.standardError = errorPipe
        process.standardOutput = Pipe()

        do {
            try process.run()
        } catch {
            throw SpeechError.sayFailed(error.localizedDescription)
        }
        let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            let detail = String(data: errorData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            // どの声で失敗したかを必ず書く。黙って別の声に差し替えると、
            // 気づかないまま違う音声で学習することになる。
            throw SpeechError.sayFailed(
                "声「\(utterance.voice)」で合成できませんでした"
                + "(終了コード \(process.terminationStatus)) \(detail)")
        }
        guard FileManager.default.fileExists(atPath: output.path) else {
            throw SpeechError.sayFailed("say がファイルを作りませんでした")
        }
    }

    private func merge(_ parts: [URL], into destination: URL) throws {
        let composition = AVMutableComposition()
        guard let track = composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw SpeechError.mergeFailed("音声トラックを作れません")
        }

        var cursor = CMTime.zero
        for part in parts {
            let asset = AVURLAsset(url: part)
            guard let source = asset.tracks(withMediaType: .audio).first else {
                throw SpeechError.mergeFailed("音声トラックが見つかりません: \(part.lastPathComponent)")
            }
            do {
                try track.insertTimeRange(
                    CMTimeRange(start: .zero, duration: asset.duration), of: source, at: cursor)
            } catch {
                throw SpeechError.mergeFailed(error.localizedDescription)
            }
            cursor = CMTimeAdd(cursor, asset.duration)
        }

        guard let export = AVAssetExportSession(
            asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
            throw SpeechError.mergeFailed("書き出しを準備できません")
        }
        export.outputURL = destination
        export.outputFileType = .m4a

        // 書き出しは非同期。呼び出し側は同期で待つ。
        let semaphore = DispatchSemaphore(value: 0)
        export.exportAsynchronously { semaphore.signal() }
        semaphore.wait()

        guard export.status == .completed else {
            throw SpeechError.mergeFailed(export.error?.localizedDescription ?? "原因不明")
        }
    }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run:
```bash
TMP=$(mktemp -d) && swiftc -O app/src/SpeechSynthesizer.swift \
  app/tests/test_speech_synthesizer.swift -o "$TMP/t" && "$TMP/t"
```
Expected: PASS(全項目 ok)

- [ ] **Step 5: ビルドとテスト実行に組み込む**

`app/build.sh` の `swiftc` 行に `app/src/SpeechSynthesizer.swift` を足す。

`app/tests/run.sh` の Swift テスト群(`# 起動から一覧描画まで` の直前)に足す:

```sh
SPEECH_SYNTHESIZER_OUT="$TMP/test_speech_synthesizer"
swiftc -O app/src/SpeechSynthesizer.swift app/tests/test_speech_synthesizer.swift \
  -o "$SPEECH_SYNTHESIZER_OUT"
"$SPEECH_SYNTHESIZER_OUT"
```

- [ ] **Step 6: 全テストを回す**

Run: `sh app/tests/run.sh && sh app/build.sh`
Expected: `Swift tests: all passed` と `ビルド完了`

- [ ] **Step 7: コミット**

```bash
git add app/src/SpeechSynthesizer.swift app/tests/test_speech_synthesizer.swift \
  app/build.sh app/tests/run.sh
git commit -m "$(cat <<'MSG'
feat: 台本から音声を合成する層を追加する

macOS の say を呼んで m4a を作る。say は1回1話者しか扱えないため、
複数話者は個別に生成して AVFoundation で結合する。
AAC を明示しないと非圧縮になり約8倍の大きさになるため必ず指定する。
途中で失敗したときにキャッシュへ半端なファイルを残さない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: audio:// スキームで音声を配信する

`ContentSchemeHandler` は既にルートを引数で受け取り、`m4a` の MIME も持っている。
新しいハンドラを書かず、キャッシュディレクトリをルートにしたインスタンスを登録する。
`resolveContentPath` がルート外への脱出を拒否するため、`app://` の保証と同じ強度になる。

**Files:**
- Modify: `app/src/ContentSchemeHandler.swift`(用途を説明するコメントのみ)
- Modify: `app/src/main.swift`(`audio` スキームの登録)
- Test: `app/tests/test_audio_scheme.swift`

**Interfaces:**
- Consumes: Task 4 が作るキャッシュディレクトリの配置(`<dataDir>/audio/<id>.m4a`)
- Produces: `audio://local/<id>.m4a` が `~/Documents/TOEFLReading/audio/<id>.m4a` を返す

- [ ] **Step 1: 失敗するテストを書く**

`app/tests/test_audio_scheme.swift`:

```swift
import Foundation

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)\(detail.isEmpty ? "" : "  (\(detail))")")
        failures += 1
    }
}

/// 音声キャッシュをルートにしたときも、ルート外へ出られないことを確かめる。
/// 経路は app:// と同じ resolveContentPath だが、根が変わるので別に確認する。
@main
struct TestAudioScheme {
    static func main() {
        let base = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("audio-scheme-\(UUID().uuidString)")
        let audioDir = base.appendingPathComponent("audio")
        defer { try? FileManager.default.removeItem(at: base) }

        try? FileManager.default.createDirectory(at: audioDir, withIntermediateDirectories: true)
        let inside = audioDir.appendingPathComponent("listening_001.m4a")
        FileManager.default.createFile(atPath: inside.path, contents: Data([0x00, 0x01]))

        // 兄弟ディレクトリに秘密のファイルを置き、.. で届かないことを確かめる
        let secret = base.appendingPathComponent("secret.txt")
        FileManager.default.createFile(atPath: secret.path, contents: Data("secret".utf8))

        let resolved = resolveContentPath(root: audioDir, requestPath: "/listening_001.m4a")
        check("キャッシュ内のファイルを解決できる", resolved?.path == inside.path,
              resolved?.path ?? "nil")

        check("`..` で親ディレクトリへ出られない",
              resolveContentPath(root: audioDir, requestPath: "/../secret.txt") == nil)
        check("多重の `..` でも出られない",
              resolveContentPath(root: audioDir, requestPath: "/../../etc/passwd") == nil)
        check("絶対パスを与えてもルート配下に閉じ込められる",
              resolveContentPath(root: audioDir, requestPath: "/etc/passwd")?.path
                  .hasPrefix(audioDir.path) == true)

        exit(failures == 0 ? 0 : 1)
    }
}
```

- [ ] **Step 2: テストが失敗しないことを確認する(既存機能の確認テスト)**

Run:
```bash
TMP=$(mktemp -d) && swiftc -O app/src/PathResolver.swift app/tests/test_audio_scheme.swift \
  -o "$TMP/t" && "$TMP/t"
```
Expected: PASS。`resolveContentPath` は既にルートを引数に取るため、ここは**既存の保証が
音声ディレクトリでも成り立つことの確認**である。落ちた場合は `PathResolver.swift` の不具合。

- [ ] **Step 3: main.swift に audio:// を登録する**

`app/src/main.swift` の `makeConfiguration` を変更する。現在:

```swift
    /// app:// の配信と、JS から呼べる4つの窓口(store / essays / grader / dictionary)を繋ぐ。
    private func makeConfiguration(root: URL, dataDir: URL) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(ContentSchemeHandler(root: root), forURLScheme: "app")
```

これを次のようにする(`audio` の登録を追加):

```swift
    /// app:// と audio:// の配信、および JS から呼べる窓口を繋ぐ。
    private func makeConfiguration(root: URL, dataDir: URL) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(ContentSchemeHandler(root: root), forURLScheme: "app")
        // 音声キャッシュはリポジトリの外にある。app:// のルートを広げると
        // 「リポジトリ外を読めない」保証が崩れるため、根を分けて別スキームで配る。
        configuration.setURLSchemeHandler(
            ContentSchemeHandler(root: dataDir.appendingPathComponent("audio")),
            forURLScheme: "audio")
```

`ContentSchemeHandler.swift` の冒頭コメントも実態に合わせる:

```swift
/// 指定したルート配下の実ファイルを、あるスキームへの要求に対して返す。
/// app:// はリポジトリルート、audio:// は音声キャッシュを根にして使う。
/// どちらの場合も resolveContentPath がルート外への脱出を拒否する。
```

- [ ] **Step 4: テスト実行に組み込んで全テストを回す**

`app/tests/run.sh` に足す:

```sh
AUDIO_SCHEME_OUT="$TMP/test_audio_scheme"
swiftc -O app/src/PathResolver.swift app/tests/test_audio_scheme.swift -o "$AUDIO_SCHEME_OUT"
"$AUDIO_SCHEME_OUT"
```

Run: `sh app/tests/run.sh && sh app/build.sh`
Expected: すべて通り、ビルドも成功する

- [ ] **Step 5: コミット**

```bash
git add app/src/ContentSchemeHandler.swift app/src/main.swift \
  app/tests/test_audio_scheme.swift app/tests/run.sh
git commit -m "$(cat <<'MSG'
feat: audio:// で音声キャッシュを配信する

キャッシュはリポジトリの外にあるため、app:// のルートを広げると
「リポジトリ外を読めない」保証が崩れる。ContentSchemeHandler は既に
ルートを引数に取るので、根を分けたインスタンスを別スキームで登録した。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: 音声生成の窓口(Swift ↔ JS)

**Files:**
- Create: `app/src/SpeechHandler.swift`
- Create: `app/ui/js/speech.native.js`
- Test: `app/tests/test_speech_handler.swift`
- Modify: `app/src/main.swift`、`app/build.sh`、`app/tests/run.sh`

**Interfaces:**
- Consumes: Task 4 の `SpeechSynthesizer`
- Produces:
  - Swift: `SpeechHandler(synthesizer:)`、`speech` という名前で登録
  - action `prepare`、引数 `id`(String)、`utterances`(`[{voice, text}]`)、`force`(Bool、省略可)、
    応答 `{ url: String }`。`force` が真ならキャッシュを無視して作り直す
  - JS: `window.Speech.prepare(id, utterances, options = {}) -> { url }`。失敗時は例外。
    `options.force` が真ならキャッシュを無視する

- [ ] **Step 1: 失敗するテストを書く**

`app/tests/test_speech_handler.swift`:

```swift
import Cocoa
import WebKit

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)\(detail.isEmpty ? "" : "  (\(detail))")")
        failures += 1
    }
}

let cacheDir = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("speech-handler-\(UUID().uuidString)")

final class HandlerDelegate: NSObject, NSApplicationDelegate {
    private var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(
            ContentSchemeHandler(root: cacheDir), forURLScheme: "audio")
        configuration.userContentController.addScriptMessageHandler(
            SpeechHandler(synthesizer: SpeechSynthesizer(cacheDirectory: cacheDir)),
            contentWorld: .page, name: "speech")

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 300),
                            configuration: configuration)
        webView.loadHTMLString("<meta charset='utf-8'><p>test</p>", baseURL: nil)

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.verify() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
            print("FAIL - 制限時間内に完了しなかった")
            exit(1)
        }
    }

    private func run(_ body: String, _ done: @escaping (String) -> Void) {
        webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): done((value as? String) ?? "文字列以外が返った")
            case .failure(let error): done("JSエラー: \(error.localizedDescription)")
            }
        }
    }

    private func modificationDate(of url: URL) -> Date? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attributes?[.modificationDate] as? Date
    }

    private func verify() {
        run("""
            const r = await window.webkit.messageHandlers.speech.postMessage({
                action: "prepare", id: "listening_900",
                utterances: [{ voice: "Samantha", text: "Hello there, this is a test." }] });
            return r.url;
            """) { url in
            check("prepare が audio:// の URL を返す", url.hasPrefix("audio://"), url)
            check("URL に id が入っている", url.contains("listening_900"), url)
            check("実ファイルが作られている",
                  FileManager.default.fileExists(
                    atPath: cacheDir.appendingPathComponent("listening_900.m4a").path))

            // 2回目はキャッシュを返す(生成し直さない)
            let cached = cacheDir.appendingPathComponent("listening_900.m4a")
            let firstModified = self.modificationDate(of: cached)
            self.run("""
                const r = await window.webkit.messageHandlers.speech.postMessage({
                    action: "prepare", id: "listening_900",
                    utterances: [{ voice: "Samantha", text: "Hello there, this is a test." }] });
                return r.url;
                """) { _ in
                let secondModified = self.modificationDate(of: cached)
                check("2回目はキャッシュを使い、作り直さない", firstModified == secondModified)
                self.verifyForce(cached: cached, before: secondModified)
            }
        }
    }

    /// 壊れたキャッシュを作り直せること。force を付けたときだけ作り直す。
    private func verifyForce(cached: URL, before: Date?) {
        run("""
            const r = await window.webkit.messageHandlers.speech.postMessage({
                action: "prepare", id: "listening_900", force: true,
                utterances: [{ voice: "Samantha", text: "Hello there, this is a test." }] });
            return r.url;
            """) { url in
            check("force でも URL を返す", url.hasPrefix("audio://"), url)
            let after = self.modificationDate(of: cached)
            check("force を付けるとキャッシュを作り直す", after != before,
                  "before=\(String(describing: before)) after=\(String(describing: after))")
            self.verifyErrors()
        }
    }

    private func verifyErrors() {
        run("""
            try {
                await window.webkit.messageHandlers.speech.postMessage({ action: "bogus" });
                return "エラーにならなかった";
            } catch (e) { return "エラー: " + e.message; }
            """) { text in
            check("未知の action はエラーになる", text.hasPrefix("エラー:"), text)

            self.run("""
                try {
                    await window.webkit.messageHandlers.speech.postMessage({
                        action: "prepare", id: "listening_901" });
                    return "エラーにならなかった";
                } catch (e) { return "エラー: " + e.message; }
                """) { text in
                check("utterances が無いとエラーになる", text.hasPrefix("エラー:"), text)

                self.run("""
                    try {
                        await window.webkit.messageHandlers.speech.postMessage({
                            action: "prepare", id: "../escape", 
                            utterances: [{ voice: "Samantha", text: "x" }] });
                        return "エラーにならなかった";
                    } catch (e) { return "エラー: " + e.message; }
                    """) { text in
                    check("id にディレクトリ区切りが混ざるとエラーになる",
                          text.hasPrefix("エラー:"), text)
                    try? FileManager.default.removeItem(at: cacheDir)
                    exit(failures == 0 ? 0 : 1)
                }
            }
        }
    }
}

@main
struct TestSpeechHandler {
    static func main() {
        let application = NSApplication.shared
        let delegate = HandlerDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}
```

- [ ] **Step 2: コンパイルできるスタブを置いて失敗を確認する**

`app/src/SpeechHandler.swift`(スタブ):

```swift
import Foundation
import WebKit

final class SpeechHandler: NSObject, WKScriptMessageHandlerWithReply {
    init(synthesizer: SpeechSynthesizer) { super.init() }
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        replyHandler(["url": ""], nil)
    }
}
```

Run:
```bash
TMP=$(mktemp -d) && swiftc -O app/src/PathResolver.swift app/src/ContentSchemeHandler.swift \
  app/src/SpeechSynthesizer.swift app/src/SpeechHandler.swift \
  app/tests/test_speech_handler.swift -o "$TMP/t" && "$TMP/t"
```
Expected: FAIL — 「prepare が audio:// の URL を返す」ほかで落ちる

- [ ] **Step 3: 実装を書く**

`app/src/SpeechHandler.swift`(スタブを置き換える):

```swift
import Foundation
import WebKit

/// JS からの音声生成要求を SpeechSynthesizer へ渡す橋渡し。
/// 判断はすべて SpeechSynthesizer 側にあり、ここは形の検査と応答の組み立てだけを行う。
///
/// 応答は `{ url }`。URL は audio:// スキームで、WKWebView の <audio> がそのまま読める。
final class SpeechHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let synthesizer: SpeechSynthesizer

    init(synthesizer: SpeechSynthesizer) {
        self.synthesizer = synthesizer
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "要求の形式が不正です")
            return
        }
        guard action == "prepare" else {
            replyHandler(nil, "未知の action: \(action)")
            return
        }
        guard let id = body["id"] as? String, isSafeIdentifier(id) else {
            replyHandler(nil, "id が不正です")
            return
        }
        guard let rawUtterances = body["utterances"] as? [[String: Any]], !rawUtterances.isEmpty else {
            replyHandler(nil, "utterances が含まれていません")
            return
        }

        var utterances: [Utterance] = []
        for raw in rawUtterances {
            guard let voice = raw["voice"] as? String, !voice.isEmpty,
                  let text = raw["text"] as? String, !text.isEmpty else {
                replyHandler(nil, "utterances の形式が不正です")
                return
            }
            utterances.append(Utterance(voice: voice, text: text))
        }

        // 再生に失敗したときに呼び直せるよう、キャッシュを無視する経路を用意する。
        let force = body["force"] as? Bool ?? false
        if !force, let cached = synthesizer.cachedURL(for: id) {
            replyHandler(["url": audioURL(for: cached)], nil)
            return
        }
        do {
            let created = try synthesizer.synthesize(id: id, utterances: utterances)
            replyHandler(["url": audioURL(for: created)], nil)
        } catch {
            replyHandler(nil, error.localizedDescription)
        }
    }

    /// id はファイル名になる。区切り文字が混ざるとキャッシュの外を指せてしまう。
    private func isSafeIdentifier(_ id: String) -> Bool {
        guard !id.isEmpty, !id.contains("/"), !id.contains("\\"), id != ".", id != ".." else {
            return false
        }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
        return id.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private func audioURL(for file: URL) -> String {
        return "audio://local/\(file.lastPathComponent)"
    }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run:
```bash
TMP=$(mktemp -d) && swiftc -O app/src/PathResolver.swift app/src/ContentSchemeHandler.swift \
  app/src/SpeechSynthesizer.swift app/src/SpeechHandler.swift \
  app/tests/test_speech_handler.swift -o "$TMP/t" && "$TMP/t"
```
Expected: PASS

- [ ] **Step 5: JS 側の窓口を書く**

`app/ui/js/speech.native.js`:

```js
"use strict";

/* 音声層(アプリ版)。Swift 側が macOS の say で m4a を作り、
   ~/Documents/TOEFLReading/audio/ に置いたものを audio:// で返す。

   注意: window.Audio はブラウザ標準の Audio コンストラクタ、
   window.speechSynthesis も標準APIである。どちらも上書きしてはならない。 */

const _urls = new Map();

window.Speech = {
  /** 台本から音声を用意して URL を返す。失敗したら例外を投げる(呼び出し側が画面に出す)。
      options.force が真なら、キャッシュが壊れている前提で作り直す。 */
  async prepare(id, utterances, options = {}) {
    const force = options.force === true;
    if (!force && _urls.has(id)) return { url: _urls.get(id) };

    const reply = await window.webkit.messageHandlers.speech.postMessage({
      action: "prepare",
      id,
      utterances,
      force,
    });
    if (!reply || !reply.url) throw new Error("音声のURLを受け取れませんでした");

    // 作り直したのに WebKit が古い中身を使い回さないよう、問い合わせ文字列を変える。
    // ContentSchemeHandler はパスだけを見るので、この付加は無害。
    const url = force ? `${reply.url}?r=${Date.now()}` : reply.url;
    _urls.set(id, url);
    return { url };
  },
};
```

- [ ] **Step 6: main.swift に登録し、ビルドとテストに組み込む**

`app/src/main.swift` の `makeConfiguration` にハンドラを足す(`dictionary` の登録の直後):

```swift
        // 音声生成。保存層は listening という名前で別に登録するため、ここは speech とする。
        configuration.userContentController.addScriptMessageHandler(
            SpeechHandler(synthesizer: SpeechSynthesizer(
                cacheDirectory: dataDir.appendingPathComponent("audio"))),
            contentWorld: .page, name: "speech")
```

`app/build.sh` の `swiftc` 行に `app/src/SpeechHandler.swift` を足す。

`app/tests/run.sh` に足す:

```sh
SPEECH_HANDLER_OUT="$TMP/test_speech_handler"
swiftc -O app/src/PathResolver.swift app/src/ContentSchemeHandler.swift \
  app/src/SpeechSynthesizer.swift app/src/SpeechHandler.swift \
  app/tests/test_speech_handler.swift -o "$SPEECH_HANDLER_OUT"
"$SPEECH_HANDLER_OUT"
```

- [ ] **Step 7: 全テストを回す**

Run: `sh app/tests/run.sh && sh app/build.sh`
Expected: すべて通る

- [ ] **Step 8: コミット**

```bash
git add app/src/SpeechHandler.swift app/ui/js/speech.native.js app/src/main.swift \
  app/tests/test_speech_handler.swift app/build.sh app/tests/run.sh
git commit -m "$(cat <<'MSG'
feat: JS から音声生成を呼べる窓口を追加する

既存の store / essays / grader / dictionary と同じ作法で speech を足す。
id はファイル名になるため、区切り文字を含むものを拒否してキャッシュの
外を指せないようにした。二度目の要求はキャッシュを返す。

window.Audio と window.speechSynthesis は標準APIのため、
JS 側の窓口は window.Speech とした。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: リスニングの学習記録層

**Files:**
- Modify: `app/src/LogHandlers.swift:12-19`(`StoreHandler` にファイル名を注入可能にする)
- Modify: `app/src/main.swift`(2つ目のインスタンスを `listening` として登録)
- Create: `app/ui/js/listening.native.js`
- Test: `tests/js/listening.native.test.js`

**Interfaces:**
- Consumes: 既存の `JSONLinesFile`
- Produces: `window.ListeningStore` — `init()` / `attempts(id)` / `latest(id)` / `saveAttempt(attempt)`。
  記録の形は `{ listeningId, score, total, elapsedSec, answers, finishedAt }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/js/listening.native.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// listening.native.js は Swift 側のブリッジ (window.webkit.messageHandlers.listening) に
// 依存する。偽のブリッジを差し込んで、グループ化・並べ替え・キャッシュ更新を確かめる。
// 一覧のバッジが「最新の」試行を示すかは init() の並べ替えだけで決まる。

function loadStore(initialAttempts, options = {}) {
  const calls = [];
  global.window = {
    webkit: {
      messageHandlers: {
        listening: {
          postMessage: async (payload) => {
            calls.push(payload);
            if (payload.action === "loadAll") {
              if (options.loadAllReturns !== undefined) return options.loadAllReturns;
              return initialAttempts;
            }
            if (payload.action === "saveAttempt") {
              if (options.saveRejects) throw new Error("書き込みに失敗しました: 権限がありません");
              return null;
            }
            throw new Error(`未知の action: ${payload.action}`);
          },
        },
      },
    },
  };
  delete require.cache[require.resolve("../../app/ui/js/listening.native.js")];
  require("../../app/ui/js/listening.native.js");
  return { ListeningStore: global.window.ListeningStore, calls };
}

const older = {
  listeningId: "listening_001", score: 3, total: 6, elapsedSec: 300,
  answers: ["A", "B", "C", "D", "A", "B"], finishedAt: "2026-08-19T00:10:00.000Z",
};
const newer = {
  listeningId: "listening_001", score: 5, total: 6, elapsedSec: 280,
  answers: ["A", "B", "C", "D", "A", "C"], finishedAt: "2026-08-19T00:30:00.000Z",
};
const other = {
  listeningId: "listening_002", score: 4, total: 6, elapsedSec: 260,
  answers: ["B", "B", "C", "D", "A", "B"], finishedAt: "2026-08-18T00:00:00.000Z",
};

test("init は loadAll を一度だけ呼ぶ", async () => {
  const { ListeningStore, calls } = loadStore([]);
  await ListeningStore.init();
  assert.deepEqual(calls, [{ action: "loadAll" }]);
});

test("履歴が無ければ空配列と null を返す", async () => {
  const { ListeningStore } = loadStore([]);
  await ListeningStore.init();
  assert.deepEqual(ListeningStore.attempts("listening_001"), []);
  assert.equal(ListeningStore.latest("listening_001"), null);
});

test("項目ごとにグループ化される", async () => {
  const { ListeningStore } = loadStore([older, other, newer]);
  await ListeningStore.init();
  assert.equal(ListeningStore.attempts("listening_001").length, 2);
  assert.equal(ListeningStore.attempts("listening_002").length, 1);
  assert.deepEqual(ListeningStore.attempts("listening_999"), []);
});

test("latest は最新の試行を返す(ファイル順に依存しない)", async () => {
  const { ListeningStore } = loadStore([older, newer]);
  await ListeningStore.init();
  assert.equal(ListeningStore.latest("listening_001").score, 5);
});

test("ファイルが新しい順に並んでいても latest は変わらない", async () => {
  const { ListeningStore } = loadStore([newer, older]);
  await ListeningStore.init();
  assert.equal(ListeningStore.latest("listening_001").finishedAt, newer.finishedAt);
});

test("saveAttempt はブリッジへ渡し、キャッシュの先頭に積む", async () => {
  const { ListeningStore, calls } = loadStore([older]);
  await ListeningStore.init();
  await ListeningStore.saveAttempt(newer);
  assert.deepEqual(calls[1], { action: "saveAttempt", attempt: newer });
  assert.equal(ListeningStore.attempts("listening_001").length, 2);
  assert.equal(ListeningStore.latest("listening_001").score, 5);
});

test("保存が失敗したらキャッシュを汚さずに reject する", async () => {
  const { ListeningStore } = loadStore([older], { saveRejects: true });
  await ListeningStore.init();
  await assert.rejects(() => ListeningStore.saveAttempt(newer), /書き込みに失敗しました/);
  assert.equal(ListeningStore.attempts("listening_001").length, 1);
});

test("loadAll が null を返しても落ちない", async () => {
  const { ListeningStore } = loadStore(null, { loadAllReturns: null });
  await ListeningStore.init();
  assert.deepEqual(ListeningStore.attempts("listening_001"), []);
});

test("init を二度呼んでも履歴が重複しない", async () => {
  const { ListeningStore } = loadStore([older, newer]);
  await ListeningStore.init();
  await ListeningStore.init();
  assert.equal(ListeningStore.attempts("listening_001").length, 2);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test tests/js/listening.native.test.js`
Expected: FAIL — `Cannot find module '../../app/ui/js/listening.native.js'`

- [ ] **Step 3: JS 側を書く**

`app/ui/js/listening.native.js`:

```js
"use strict";

/* リスニングの学習記録(アプリ版)。
   Swift 側が ~/Documents/TOEFLReading/listening.jsonl に追記する。
   読解の store.native.js と同じ形。キーが passageId ではなく listeningId である点だけが違う。 */

const _listeningAttempts = new Map();

async function _callListening(payload) {
  return window.webkit.messageHandlers.listening.postMessage(payload);
}

window.ListeningStore = {
  async init() {
    _listeningAttempts.clear();
    const all = await _callListening({ action: "loadAll" });
    for (const attempt of all || []) {
      const list = _listeningAttempts.get(attempt.listeningId) || [];
      list.push(attempt);
      _listeningAttempts.set(attempt.listeningId, list);
    }
    // 新しい順に並べる
    for (const list of _listeningAttempts.values()) {
      list.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    }
  },
  attempts(listeningId) {
    return _listeningAttempts.get(listeningId) || [];
  },
  latest(listeningId) {
    return this.attempts(listeningId)[0] || null;
  },
  async saveAttempt(attempt) {
    await _callListening({ action: "saveAttempt", attempt });
    const list = _listeningAttempts.get(attempt.listeningId) || [];
    list.unshift(attempt);
    _listeningAttempts.set(attempt.listeningId, list);
  },
};
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test tests/js/listening.native.test.js`
Expected: PASS(9件)

- [ ] **Step 5: Swift 側でファイル名を注入できるようにする**

`app/src/LogHandlers.swift` の `StoreHandler.init` を変更する。現在:

```swift
    init(dataDir: URL) {
        self.log = JSONLinesFile(directory: dataDir, filename: "attempts.jsonl")
        super.init()
    }
```

これを次のようにする:

```swift
    /// 保存先のファイル名を差し替えられるようにしてある。読解は attempts.jsonl、
    /// リスニングは listening.jsonl を使い、同じ実装を2つのインスタンスで共有する。
    init(dataDir: URL, filename: String = "attempts.jsonl") {
        self.log = JSONLinesFile(directory: dataDir, filename: filename)
        super.init()
    }
```

`app/src/main.swift` の `makeConfiguration` に足す(`store` の登録の直後):

```swift
        configuration.userContentController.addScriptMessageHandler(
            StoreHandler(dataDir: dataDir, filename: "listening.jsonl"),
            contentWorld: .page, name: "listening")
```

- [ ] **Step 6: 全テストを回す**

Run:
```bash
node --test tests/js/*.test.js && sh app/tests/run.sh && sh app/build.sh
```
Expected: JS は既存49件 + 新規9件 = 58件、Swift も全通過、ビルド成功

- [ ] **Step 7: コミット**

```bash
git add app/src/LogHandlers.swift app/src/main.swift app/ui/js/listening.native.js \
  tests/js/listening.native.test.js
git commit -m "$(cat <<'MSG'
feat: リスニングの学習記録層を追加する

StoreHandler が保存先ファイル名を固定していたため注入できるようにし、
listening.jsonl 用の2つ目のインスタンスを登録した。ハンドラを
もう1本書かずに済む。JS 側は store.native.js と同じ形にした。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: vocab.js を台本でも使えるようにする

読解専用に書かれた `renderStudy(passage)` を、**学習ソース**という共通の形を受け取る関数にする。
読解の見た目と挙動は一切変えない。

**Files:**
- Modify: `docs/js/vocab.js`
- Modify: `docs/js/reader.js`(呼び出し側)
- Test: `tests/js/study_source.test.js`

**Interfaces:**
- Consumes: 既存の `tokenize` / `findVocabKey`(`docs/js/textmatch.js`)、`Dict`(辞書層)
- Produces: 学習ソースの形と `buildStudySource`
  ```js
  // 学習ソース
  {
    id: string,             // Anki のタグと記録のキー
    title: string,          // Anki のカード表面に出る
    lines: [{ speaker: string|null, text: string }],
    vocab: object,          // 語彙辞書。リスニングは {}
    questions: array,
    latestResult: object|null,
    solveUrl: string,       // 「問題を解く」の遷移先
  }
  // 読解のパッセージから学習ソースを作る
  buildStudySource(passage, latestResult, solveUrl) -> 学習ソース
  ```

- [ ] **Step 1: 失敗するテストを書く**

`tests/js/study_source.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// vocab.js はブラウザ前提(DOM に触る)なので、純粋な部分だけを取り出して確かめる。
// buildStudySource は DOM に触れないため、この方法で検証できる。
function loadBuildStudySource() {
  const source = fs.readFileSync(
    path.join(__dirname, "../../docs/js/vocab.js"), "utf8");
  const context = { window: {}, document: undefined, module: { exports: {} } };
  vm.createContext(context);
  // 関数定義だけを評価する。トップレベルで DOM に触る文は無い。
  vm.runInContext(source + "\n;this.buildStudySource = buildStudySource;", context);
  return context.buildStudySource;
}

const passage = {
  id: "passage_001",
  title: "Peatlands",
  body: "First paragraph here.\n\nSecond paragraph here.",
  vocab: { peat: { definition: "泥炭" } },
  questions: [{ id: 1, type: "Factual" }],
};

test("本文の段落が lines になる", () => {
  const buildStudySource = loadBuildStudySource();
  const source = buildStudySource(passage, null, "reader.html?id=passage_001&mode=solve");
  assert.equal(source.lines.length, 2);
  assert.equal(source.lines[0].text, "First paragraph here.");
  assert.equal(source.lines[1].text, "Second paragraph here.");
});

test("読解の行には話者が無い", () => {
  const buildStudySource = loadBuildStudySource();
  const source = buildStudySource(passage, null, "x");
  assert.equal(source.lines[0].speaker, null);
});

test("id・title・語彙・設問がそのまま移る", () => {
  const buildStudySource = loadBuildStudySource();
  const source = buildStudySource(passage, null, "x");
  assert.equal(source.id, "passage_001");
  assert.equal(source.title, "Peatlands");
  assert.deepEqual(source.vocab, passage.vocab);
  assert.deepEqual(source.questions, passage.questions);
});

test("採点結果と遷移先が渡したものになる", () => {
  const buildStudySource = loadBuildStudySource();
  const result = { score: 3, total: 5 };
  const source = buildStudySource(passage, result, "reader.html?id=passage_001&mode=solve");
  assert.deepEqual(source.latestResult, result);
  assert.equal(source.solveUrl, "reader.html?id=passage_001&mode=solve");
});

test("空行が続いても空の段落を作らない", () => {
  const buildStudySource = loadBuildStudySource();
  const withBlanks = { ...passage, body: "A.\n\n\n\nB." };
  const source = buildStudySource(withBlanks, null, "x");
  assert.deepEqual(source.lines.map((l) => l.text), ["A.", "B."]);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node --test tests/js/study_source.test.js`
Expected: FAIL — `buildStudySource is not defined`

- [ ] **Step 3: vocab.js を書き換える**

`docs/js/vocab.js` の先頭から `renderPanel` までを、次の内容に置き換える。
**`renderVocabTab` 以降(辞書まわりを含む)は変更しない。**

```js
"use strict";

const studyState = { selectedWord: null, history: [], activeTab: "vocab" };

/* 学習ソース: 読解のパッセージとリスニングの台本の共通の形。
   { id, title, lines: [{speaker, text}], vocab, questions, latestResult, solveUrl }
   この層より下は「どちらの教材か」を知らない。 */

/** 読解のパッセージから学習ソースを作る。 */
function buildStudySource(passage, latestResult, solveUrl) {
  const lines = passage.body
    .split("\n\n")
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({ speaker: null, text }));
  return {
    id: passage.id,
    title: passage.title,
    lines,
    vocab: passage.vocab,
    questions: passage.questions,
    latestResult,
    solveUrl,
  };
}

function renderStudy(source) {
  renderClickableLines(source);
  renderPanel(source);
}

function renderClickableLines(source) {
  const keys = new Set(Object.keys(source.vocab).map((w) => w.toLowerCase()));
  const pane = qs("#passage-pane");
  pane.innerHTML = "";
  for (const line of source.lines) {
    const p = document.createElement("p");
    if (line.speaker) {
      const label = document.createElement("b");
      label.className = "speaker";
      label.textContent = `${line.speaker}: `;
      p.appendChild(label);
    }
    for (const part of tokenize(line.text)) {
      if (!part.isWord) {
        p.appendChild(document.createTextNode(part.text));
        continue;
      }
      const span = document.createElement("span");
      const key = findVocabKey(part.text, keys);
      span.textContent = part.text;
      span.className = key ? "w vocab-word" : "w";
      span.addEventListener("click", () => onWordClick(source, part.text, key, span));
      p.appendChild(span);
    }
    pane.appendChild(p);
  }
}

function onWordClick(source, surface, key, span) {
  document.querySelectorAll(".w.active").forEach((el) => el.classList.remove("active"));
  span.classList.add("active");
  studyState.selectedWord = key || surface.toLowerCase();
  studyState.activeTab = "vocab";
  if (!studyState.history.includes(studyState.selectedWord)) {
    studyState.history.unshift(studyState.selectedWord);
  }
  renderPanel(source);
  qs("#right-pane").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderPanel(source) {
  const result = source.latestResult;
  const quizLabel = result ? `問題の解説 (${result.score}/${result.total})` : "問題の解説";
  qs("#right-pane").innerHTML = `
    <div class="tabs">
      <button class="tab${studyState.activeTab === "vocab" ? " on" : ""}" data-tab="vocab">単語解説</button>
      <button class="tab${studyState.activeTab === "quiz" ? " on" : ""}" data-tab="quiz">${quizLabel}</button>
    </div>
    <div id="panel-body"></div>`;
  document.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      studyState.activeTab = btn.dataset.tab;
      renderPanel(source);
    }));
  if (studyState.activeTab === "vocab") {
    renderVocabTab(source);
  } else {
    renderQuizTab(source, result);
  }
}
```

続けて、`renderVocabTab` と `renderQuizTab` の**引数名だけ**を `passage` から `source` に変える。
本文中の `passage.vocab` は `source.vocab`、`addToAnki(passage, ...)` は `addToAnki(source, ...)`、
`renderQuizTab` 内の `window.READER_URL}?id=${passage.id}&mode=solve` は `source.solveUrl` にする。
辞書まわり(`fillDictionary` / `dictionaryHtml`)は変更しない。

`renderQuizTab` の「まだ解いていません」の行は次のようになる:

```js
    body.innerHTML = `<p class="hint">まだ解いていません。` +
      `<a href="${source.solveUrl}">問題を解く</a></p>`;
```

`addToAnki` は `passage.title` と `passage.id` を読む。学習ソースも同じ名前で持っているため、
`docs/js/anki.js` は変更不要。

- [ ] **Step 4: 呼び出し側を直す**

`docs/js/reader.js` の `startStudyMode` を変更する。現在の末尾:

```js
  renderStudy(state.passage);
```

これを次のようにする:

```js
  const solveUrl = `${window.READER_URL}?id=${state.passage.id}&mode=solve`;
  renderStudy(buildStudySource(state.passage, Store.latest(state.passage.id), solveUrl));
```

- [ ] **Step 5: テストが通り、既存も壊れていないことを確認する**

Run: `node --test tests/js/*.test.js`
Expected: PASS(58 + 5 = 63件)。**既存のテストが1件も落ちないこと**が重要。

- [ ] **Step 6: 読解が壊れていないことを実機で確認する**

Run: `sh app/build.sh && open app/build/TOEFLReading.app`
確認すること:
- パッセージを開いて解答 → 採点 → 解説モードに入れる
- 解説モードで単語をクリックすると解説が出る(収録語)
- 収録されていない語をクリックすると辞書の定義が出る
- 「問題の解説」タブが正しく出る

- [ ] **Step 7: コミット**

```bash
git add docs/js/vocab.js docs/js/reader.js tests/js/study_source.test.js
git commit -m "$(cat <<'MSG'
refactor: 単語解説の描画を学習ソース経由にする

renderStudy が読解のパッセージに直接依存していたため、台本を渡せなかった。
{ id, title, lines, vocab, questions, latestResult, solveUrl } という
共通の形を挟み、この層から下は教材の種類を知らないようにする。
話者名の表示にも対応した(読解では null なので出ない)。

読解の見た目と挙動は変えていない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: リスニングの一覧画面

**Files:**
- Create: `app/ui/listening.html`
- Create: `app/ui/js/listening-list.js`
- Modify: `app/ui/index.html`(リスニングへの導線)
- Modify: `docs/css/style.css`(話者名の見た目。Task 12 で使う)

**Interfaces:**
- Consumes: Task 2 の `index.json`、Task 7 の `window.ListeningStore`
- Produces: `app/ui/listening.html` が `?id=` 付きで `listening-player.html` へ遷移する

- [ ] **Step 1: 一覧の HTML を書く**

`app/ui/listening.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>リスニング — TOEFL Reading</title>
  <link rel="stylesheet" href="../../docs/css/style.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="index.html">📖 TOEFL Reading</a>
    <span></span>
    <span></span>
  </header>
  <main class="page">
    <h1>リスニング</h1>
    <div id="listening-list">読み込み中…</div>
  </main>
  <footer class="site-footer">
    <p>⚠️ コンテンツは全てAI生成です ・ 作成者は英語の専門家ではありません ・ ETSおよびTOEFLとは無関係の非公式教材です</p>
  </footer>
  <script src="../../docs/js/escape.js"></script>
  <script src="../../docs/js/footer.js"></script>
  <script src="js/listening.native.js"></script>
  <script>window.DATA_BASE = "../../docs/";</script>
  <script src="js/listening-list.js"></script>
</body>
</html>
```

- [ ] **Step 2: 一覧のロジックを書く**

`app/ui/js/listening-list.js`:

```js
"use strict";

/* リスニング一覧。docs/data/listening/index.json を読んでカードを並べる。 */

const WORDS_PER_MINUTE = 150;
const TYPE_LABELS = { lecture: "講義", conversation: "会話" };

function estimatedMinutes(wordCount) {
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

function cardHtml(item) {
  const latest = ListeningStore.latest(item.id);
  const badge = latest
    ? `<span class="badge done">${latest.score}/${latest.total}</span>`
    : `<span class="badge">未着手</span>`;
  const label = TYPE_LABELS[item.type] || item.type;
  return `
    <div class="card">
      <div>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="meta">${escapeHtml(label)} ・ ${escapeHtml(item.topic)} ・ 約${estimatedMinutes(item.word_count)}分</p>
      </div>
      <div class="card-actions">
        ${badge}
        <a class="button primary" href="listening-player.html?id=${encodeURIComponent(item.id)}&mode=solve">聴く</a>
        <a class="button" href="listening-player.html?id=${encodeURIComponent(item.id)}&mode=study">解説</a>
      </div>
    </div>`;
}

async function initListeningList() {
  const container = document.querySelector("#listening-list");
  try {
    await ListeningStore.init();
  } catch (err) {
    console.warn("学習記録を読み込めませんでした:", err);
  }
  try {
    // 公開後に内容を訂正した場合も確実に反映させる
    const res = await fetch(`${window.DATA_BASE || ""}data/listening/index.json`,
                            { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = await res.json();
    const items = index.items || [];
    container.innerHTML = items.length
      ? items.map(cardHtml).join("")
      : `<p class="hint">まだ問題がありません。</p>`;
  } catch (err) {
    container.innerHTML = `<p class="error">一覧を読み込めませんでした(${escapeHtml(err.message)})。</p>`;
  }
}

document.addEventListener("DOMContentLoaded", initListeningList);
```

- [ ] **Step 3: 導線と話者名のスタイルを足す**

`app/ui/index.html` のヘッダーかページ内に、リスニングへのリンクを1つ足す
(既存のライティングへの導線と同じ場所・同じ書き方に合わせる。既存の書き方を読んでから足すこと)。

`docs/css/style.css` の `.w.vocab-word` の行の直後に足す:

```css
/* 台本の話者名。本文と区別できれば十分なので色だけ変える。 */
.speaker { color: var(--muted); }
```

- [ ] **Step 4: 実機で確認する**

Run: `sh app/build.sh && open app/build/TOEFLReading.app`
確認すること:
- リスニング一覧が開き、`listening_001` のカードが1枚出る
- 種別「講義」・トピック・概算の分数が出る
- バッジが「未着手」になっている
- 「聴く」「解説」のリンクが `listening-player.html` を指している(まだ404でよい)

- [ ] **Step 5: コミット**

```bash
git add app/ui/listening.html app/ui/js/listening-list.js app/ui/index.html docs/css/style.css
git commit -m "$(cat <<'MSG'
feat: リスニングの一覧画面を追加する

読解・ライティングの一覧と同じカードの形にした。再生時間は保存せず、
語数から毎分150語で概算する(台本を直すたびに実時間と食い違わないため)。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: プレイヤー画面 — 解答モード

**Files:**
- Create: `app/ui/listening-player.html`
- Create: `app/ui/js/listening-player.js`

**Interfaces:**
- Consumes: Task 6 の `window.Speech.prepare`、Task 7 の `window.ListeningStore`、
  Task 8 の `buildStudySource` は使わない(解答モードは台本を出さない)
- Produces: `startSolveMode()` / `startStudyMode()` を持つ画面。Task 11 が `startStudyMode` を埋める

- [ ] **Step 1: HTML を書く**

`app/ui/listening-player.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>リスニング — TOEFL Reading</title>
  <link rel="stylesheet" href="../../docs/css/style.css">
</head>
<body class="reader-page">
  <header class="site-header">
    <a class="brand" href="listening.html">📖 TOEFL Reading</a>
    <span id="header-title"></span>
    <span id="header-status"></span>
  </header>
  <main id="reader-main">
    <section id="passage-pane"></section>
    <section id="right-pane"></section>
  </main>
  <footer class="site-footer">
    <p>⚠️ コンテンツは全てAI生成です ・ 作成者は英語の専門家ではありません ・ ETSおよびTOEFLとは無関係の非公式教材です</p>
  </footer>
  <div id="modal-root"></div>
  <script src="../../docs/js/escape.js"></script>
  <script src="../../docs/js/textmatch.js"></script>
  <script src="../../docs/js/footer.js"></script>
  <script src="js/listening.native.js"></script>
  <script src="js/speech.native.js"></script>
  <script src="js/dict.native.js"></script>
  <script>window.DATA_BASE = "../../docs/";</script>
  <script src="../../docs/js/anki.js"></script>
  <script src="../../docs/js/vocab.js"></script>
  <script src="js/listening-player.js"></script>
</body>
</html>
```

- [ ] **Step 2: 解答モードを書く**

`app/ui/js/listening-player.js`:

```js
"use strict";

const playerState = {
  item: null,
  current: 0,
  answers: [],
  startedAt: null,
  audioUrl: null,
  retriedAudio: false,   // 壊れたキャッシュの作り直しは1回だけ
};

function qs(sel) {
  return document.querySelector(sel);
}

function renderError(message) {
  qs("#reader-main").innerHTML =
    `<p class="error">${escapeHtml(message)} <a href="listening.html">一覧に戻る</a></p>`;
}

/** 台本を say に渡せる形にする。話者ごとに声が変わる。 */
function utterancesOf(item) {
  const voices = new Map(item.speakers.map((s) => [s.id, s.voice]));
  return item.script.map((line) => ({
    voice: voices.get(line.speaker) || "",
    text: line.text,
  }));
}

async function init() {
  try {
    await ListeningStore.init();
  } catch (err) {
    console.warn("学習記録を読み込めませんでした:", err);
  }
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || "";
  const mode = params.get("mode") === "study" ? "study" : "solve";
  if (!/^listening_\d+$/.test(id)) {
    renderError("問題が指定されていません。");
    return;
  }
  try {
    const res = await fetch(`${window.DATA_BASE || ""}data/listening/${id}.json`,
                            { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    playerState.item = await res.json();
  } catch (err) {
    renderError(`問題を読み込めませんでした(${err.message})。`);
    return;
  }
  document.title = `${playerState.item.title} — TOEFL Reading`;
  qs("#header-title").textContent = playerState.item.title;
  if (mode === "study") startStudyMode(); else startSolveMode();
}

/* ---------- 解答モード ---------- */

async function startSolveMode() {
  const item = playerState.item;
  playerState.current = 0;
  playerState.answers = item.questions.map(() => null);
  qs("#passage-pane").innerHTML =
    `<p class="hint">音声を準備しています…</p>`;
  qs("#right-pane").innerHTML = "";
  qs("#header-status").innerHTML =
    `<a href="#" id="quit-link">中断して解説モードへ</a>`;
  qs("#quit-link").addEventListener("click", (e) => {
    e.preventDefault();
    startStudyMode();
  });

  try {
    const { url } = await Speech.prepare(item.id, utterancesOf(item));
    playerState.audioUrl = url;
  } catch (err) {
    // 音声が用意できないことを黙って無視しない。解説モードへは進める。
    qs("#passage-pane").innerHTML = `
      <p class="error">音声を準備できませんでした: ${escapeHtml(err.message)}</p>
      <p><a href="#" id="to-study-on-error">台本を見て復習する</a></p>`;
    qs("#to-study-on-error").addEventListener("click", (e) => {
      e.preventDefault();
      startStudyMode();
    });
    return;
  }
  renderPlayer();
}

function renderPlayer() {
  // 本番と同じく再生は1回だけ。一時停止はできるが、巻き戻しはできない。
  qs("#passage-pane").innerHTML = `
    <div class="audio-stage">
      <p class="hint">音声は一度だけ再生されます。メモを取りながら聴いてください。</p>
      <audio id="player" src="${playerState.audioUrl}" controlslist="nodownload noplaybackrate"></audio>
      <div class="btn-row">
        <button id="play-btn" class="primary">▶ 再生する</button>
        <span id="play-state" class="hint"></span>
      </div>
    </div>`;
  const audio = qs("#player");
  const button = qs("#play-btn");
  const state = qs("#play-state");

  button.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });
  audio.addEventListener("play", () => {
    button.textContent = "⏸ 一時停止";
    state.textContent = "再生中";
  });
  audio.addEventListener("pause", () => {
    if (audio.ended) return;
    button.textContent = "▶ 続きから";
    state.textContent = "一時停止中";
  });
  audio.addEventListener("ended", () => {
    button.disabled = true;
    button.textContent = "再生終了";
    state.textContent = "設問に進んでください";
    playerState.startedAt = Date.now();
    renderQuestion();
  });
  // キャッシュが壊れていることがある。1度だけ作り直してから諦める。
  audio.addEventListener("error", async () => {
    if (playerState.retriedAudio) {
      qs("#passage-pane").innerHTML =
        `<p class="error">音声を再生できませんでした。一覧に戻ってやり直してください。</p>`;
      return;
    }
    playerState.retriedAudio = true;
    try {
      const { url } = await Speech.prepare(
        playerState.item.id, utterancesOf(playerState.item), { force: true });
      playerState.audioUrl = url;
      renderPlayer();
    } catch (err) {
      qs("#passage-pane").innerHTML =
        `<p class="error">音声を作り直せませんでした: ${escapeHtml(err.message)}</p>`;
    }
  });
}

function renderQuestion() {
  const idx = playerState.current;
  const questions = playerState.item.questions;
  const question = questions[idx];
  const isLast = idx === questions.length - 1;
  qs("#header-status").innerHTML =
    `Question ${idx + 1} of ${questions.length}`;
  const choices = ["A", "B", "C", "D"].map((letter) => {
    const selected = playerState.answers[idx] === letter ? " selected" : "";
    return `<button class="choice${selected}" data-letter="${letter}">` +
      `<b>${letter}.</b> ${escapeHtml(question.choices[letter])}</button>`;
  }).join("");
  qs("#right-pane").innerHTML = `
    <div class="question-card">
      <p><b>Q${question.id}.</b> ${escapeHtml(question.question)}</p>
      <div class="choices">${choices}</div>
      <div class="nav-row">
        <button id="back-btn" ${idx === 0 ? "disabled" : ""}>← Back</button>
        <button id="next-btn" class="primary" ${playerState.answers[idx] ? "" : "disabled"}>
          ${isLast ? "採点する" : "Next →"}</button>
      </div>
    </div>`;
  document.querySelectorAll(".choice").forEach((btn) =>
    btn.addEventListener("click", () => {
      playerState.answers[idx] = btn.dataset.letter;
      renderQuestion();
    }));
  qs("#back-btn").addEventListener("click", () => {
    playerState.current -= 1;
    renderQuestion();
  });
  qs("#next-btn").addEventListener("click", () => {
    if (isLast) {
      finishSolve();
    } else {
      playerState.current += 1;
      renderQuestion();
    }
  });
}

async function finishSolve() {
  const item = playerState.item;
  const questions = item.questions;
  const score = questions.filter((q, i) => playerState.answers[i] === q.correct).length;
  const elapsedSec = Math.floor((Date.now() - playerState.startedAt) / 1000);
  const wrong = questions
    .filter((q, i) => playerState.answers[i] !== q.correct)
    .map((q) => `Q${q.id} (${q.type})`);
  const attempt = {
    listeningId: item.id,
    score,
    total: questions.length,
    elapsedSec,
    answers: playerState.answers,
    finishedAt: new Date().toISOString(),
  };
  // 保存を待ってから描画する。待たないと直後の復習で古い結果が出る。
  let saveError = null;
  try {
    await ListeningStore.saveAttempt(attempt);
  } catch (err) {
    saveError = err;
  }
  qs("#header-status").textContent = saveError
    ? `⚠ 保存に失敗しました: ${saveError.message}`
    : "採点しました";
  qs("#right-pane").innerHTML = `
    <div class="result-card">
      <p class="score">${score} / ${questions.length} 正解</p>
      <p class="hint">${wrong.length ? `誤答: ${wrong.join(", ")}` : "🎉 全問正解"}</p>
      <button id="to-study" class="primary">📖 解説モードで復習する</button>
    </div>`;
  qs("#to-study").addEventListener("click", () => startStudyMode());
}

document.addEventListener("DOMContentLoaded", init);
```

- [ ] **Step 3: 解説モードの仮置きを足す**

Task 11 で本実装する。いまはファイル末尾(`document.addEventListener` の直前)に置く:

```js
/* ---------- 解説モード(Task 11 で実装する) ---------- */

function startStudyMode() {
  qs("#header-status").textContent = "";
  qs("#passage-pane").innerHTML = `<p class="hint">解説モードは未実装です。</p>`;
  qs("#right-pane").innerHTML = "";
}
```

- [ ] **Step 4: 音声ステージのスタイルを足す**

`docs/css/style.css` の `.dict-text` の定義の直後に足す:

```css
/* リスニングの再生画面。本文が無いので中央に寄せる。 */
.audio-stage { padding: 40px 20px; text-align: center; }
.audio-stage audio { display: none; }
```

`<audio>` を隠すのは、既定のコントロールにシークバーが出て巻き戻せてしまうためである。
再生・一時停止は自前のボタンで行う。

- [ ] **Step 5: 実機で確認する**

Run: `sh app/build.sh && open app/build/TOEFLReading.app`
確認すること:
- 一覧の「聴く」から入ると「音声を準備しています…」が出て、数秒で再生ボタンが出る
- 再生すると音声が鳴る。一時停止と再開ができる。**巻き戻せない**
- 再生が終わると設問が出る
- 6問答えると採点結果が出る
- もう一度一覧に戻ると、バッジがスコアに変わっている
- 2回目に開くと「音声を準備しています…」がほぼ一瞬で終わる(キャッシュが効いている)

- [ ] **Step 6: コミット**

```bash
git add app/ui/listening-player.html app/ui/js/listening-player.js docs/css/style.css
git commit -m "$(cat <<'MSG'
feat: リスニングの解答モードを追加する

準備→再生→設問→採点の流れ。本番に合わせて再生は1回のみとし、
既定のコントロールを隠して巻き戻せないようにした。音声を用意できない
場合は理由を画面に出し、台本での復習へ進める。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: プレイヤー画面 — 復習モード

**Files:**
- Modify: `app/ui/js/listening-player.js`(`startStudyMode` を本実装に置き換える)

**Interfaces:**
- Consumes: Task 8 の学習ソースの形と `renderStudy`、Task 6 の `window.Speech.prepare`
- Produces: なし(この画面で完結)

- [ ] **Step 1: 学習ソースを台本から作る関数を書く**

`app/ui/js/listening-player.js` の「解説モード」節を、次の内容に置き換える。

```js
/* ---------- 解説モード ---------- */

/** 台本から学習ソースを作る。語彙辞書は空なので、全語が辞書引きの経路に入る。 */
function buildListeningSource(item) {
  const roles = new Map(item.speakers.map((s) => [s.id, s.role]));
  return {
    id: item.id,
    title: item.title,
    lines: item.script.map((line) => ({
      speaker: roles.get(line.speaker) || line.speaker,
      text: line.text,
    })),
    vocab: {},
    questions: item.questions,
    latestResult: ListeningStore.latest(item.id),
    solveUrl: `listening-player.html?id=${encodeURIComponent(item.id)}&mode=solve`,
  };
}

async function startStudyMode() {
  const item = playerState.item;
  qs("#header-status").innerHTML =
    `<a href="#" id="resolve-link">🎧 もう一度解く</a>`;
  qs("#resolve-link").addEventListener("click", (e) => {
    e.preventDefault();
    startSolveMode();
  });

  renderStudy(buildListeningSource(item));
  await renderReviewPlayer(item);
}

/** 復習では自由に聴き直せる。既定のコントロールをそのまま出す。 */
async function renderReviewPlayer(item) {
  const pane = qs("#passage-pane");
  const bar = document.createElement("div");
  bar.className = "review-audio";
  bar.innerHTML = `<p class="hint">音声を準備しています…</p>`;
  pane.insertBefore(bar, pane.firstChild);

  try {
    const { url } = await Speech.prepare(item.id, utterancesOf(item));
    bar.innerHTML = `<audio controls src="${url}"></audio>`;
  } catch (err) {
    // 台本は既に出ている。音声だけが使えないことを伝えて、復習は続けられるようにする。
    bar.innerHTML =
      `<p class="error">音声を準備できませんでした: ${escapeHtml(err.message)}</p>`;
  }
}
```

- [ ] **Step 2: 復習用の音声バーのスタイルを足す**

`docs/css/style.css` の `.audio-stage` の定義の直後に足す:

```css
/* 復習モードの音声バー。台本の上に固定して、スクロールしても届くようにする。 */
.review-audio {
  position: sticky; top: 0; z-index: 1;
  background: #fff; border-bottom: 1px solid var(--border);
  padding: 8px 0; margin-bottom: 8px;
}
.review-audio audio { width: 100%; }
```

- [ ] **Step 3: 実機で確認する**

Run: `sh app/build.sh && open app/build/TOEFLReading.app`
確認すること:
- 採点結果から「解説モードで復習する」に進むと、台本が全文出る
- 各行の先頭に話者の役割(「教授」など)が出る
- 台本の上に音声バーがあり、**自由に再生・シークできる**
- 台本の単語をクリックすると、右に**システム辞書の定義**が出る(語彙解説は無いので全語が辞書経路)
- 「問題の解説」タブに6問の解説が出て、自分の回答と正解が並ぶ
- スクロールしても音声バーが上に残る
- 一覧から「解説」で直接入っても同じように動く

- [ ] **Step 4: 全テストを回す**

Run:
```bash
python3 -m unittest discover -s tests/python -t tests/python -q \
  && node --test tests/js/*.test.js && sh app/tests/run.sh
```
Expected: すべて通る

- [ ] **Step 5: コミット**

```bash
git add app/ui/js/listening-player.js docs/css/style.css
git commit -m "$(cat <<'MSG'
feat: リスニングの復習モードを追加する

台本を全文表示し、単語クリックでシステム辞書を引けるようにした。
台本に語彙解説は持たせないため、全語が辞書経路に入る。
復習では音声を自由に聴き直せる。音声が用意できなくても台本での
復習は続けられる。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: 通し確認と README の更新

**Files:**
- Modify: `README.md`
- Create: `docs/superpowers/plans/2026-08-19-listening-verification.md`(確認結果の記録)

**Interfaces:**
- Consumes: これまでのすべて
- Produces: なし

- [ ] **Step 1: 全テストを回す**

Run:
```bash
python3 -m unittest discover -s tests/python -t tests/python -q
node --test tests/js/*.test.js
sh app/tests/run.sh
sh app/build.sh
```
Expected: Python 67件、JS 63件、Swift 全通過、ビルド成功

- [ ] **Step 2: 読解とライティングが壊れていないことを確認する**

Run: `open app/build/TOEFLReading.app`
確認すること:
- 読解: 一覧 → 解答 → 採点 → 解説(単語解説と辞書の両方)
- ライティング: 一覧 → 執筆 → 採点
- リスニング: 一覧 → 聴く → 採点 → 解説

- [ ] **Step 3: 音声キャッシュの実際の大きさを測る**

```bash
du -sh ~/Documents/TOEFLReading/audio/
ls -lh ~/Documents/TOEFLReading/audio/
```
1本あたり 1〜2MB に収まっていることを確認する。大きく外れていたら
`--data-format=aac` が効いていないので Task 4 を見直す。

- [ ] **Step 4: README を更新する**

`README.md` の「ローカルアプリ(macOS)」の節に、リスニングについて2〜3行足す。
既存の書き方に合わせること。触れる内容:
- リスニングはアプリ版のみ
- 音声は macOS の `say` でローカル生成し、`~/Documents/TOEFLReading/audio/` にキャッシュする
- 音声はリポジトリにコミットしない

「テスト」の節は変更不要(コマンドは同じ)。

- [ ] **Step 5: コミット**

```bash
git add README.md
git commit -m "$(cat <<'MSG'
docs: READMEにリスニング機能を書く

音声をコミットせずローカル生成する方針を明記した。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: 問題生成コマンド `/new-listening`

**Files:**
- Create: `.claude/commands/new-listening.md`

既存の `/new-passage` `/new-writing` がどこに置かれているかを確認し、同じ場所に作ること
(`.claude/commands/` にあるとは限らない。`/new-passage` の実体を探してから合わせる)。

**Interfaces:**
- Consumes: Task 1 の `validate_listening.py`、Task 2 の `update_listening_index.py`
- Produces: なし

- [ ] **Step 1: 既存コマンドの置き場所と書き方を調べる**

```bash
grep -rl "new-passage" ~/.claude .claude 2>/dev/null | head
```
見つかったファイルを読み、見出しの立て方と手順の粒度を写す。

- [ ] **Step 2: コマンドを書く**

内容は次の手順を含めること。

1. **次のIDを決める** — `docs/data/listening/` の既存ファイルから連番の次(`listening_NNN`)。
   `docs/data/listening/index.json` で既存のトピックとテーマを確認する
2. **台本と設問を生成する**
   - `type`: `lecture`(500〜700語)または `conversation`(300〜450語)。既存で少ない方を選ぶ
   - `topic`: 科学/社会/歴史/芸術/環境 のうち既存で使用が少ないもの。テーマは既存と重複させない
   - `speakers`: lecture は1人、conversation は2人。`voice` は `say -v '?'` に出る名前
     (既定で使えるもの: `Samantha` en_US / `Daniel` en_GB / `Karen` en_AU)
   - `script`: 意味のまとまりで行に分ける。1行1〜3文
   - `questions`: 6問。`Gist-Content` / `Gist-Purpose` / `Detail` / `Function` / `Attitude` /
     `Inference` から3種類以上を混在。`correct` は A〜Dに分散(同一文字は最大3回)。
     `explanation` は日本語で、台本の根拠を引用して書く
   - `word_count`: 実際の語数、`added`: 今日の日付
3. **検証する** — `python3 scripts/validate_listening.py docs/data/listening/listening_NNN.json`
   語数の WARNING が出たら台本を調整して再実行する
4. **マニフェストを更新する** — `python3 scripts/update_listening_index.py`
5. **音声を確認する** — アプリを起動して実際に再生し、話者の切り替わりと聞き取りやすさを確かめる
6. **サマリを表示してコミット** — タイトル・種別・トピック・語数・設問タイプ内訳を出し、
   ユーザーの承認後に `git add docs/data && git commit -m "content: add listening_NNN <title>"`

- [ ] **Step 3: コマンドを実際に走らせて2本目を作る**

`/new-listening` を実行し、`listening_002` を conversation で作る。
Task 1〜11 が conversation(2話者の結合)でも動くことの確認を兼ねる。

確認すること:
- 検証が通る
- 一覧に2件出る
- 再生すると**話者が途中で切り替わる**
- 復習モードで2人の役割名が行頭に出る

- [ ] **Step 4: コミット**

```bash
git add .claude/commands/new-listening.md docs/data/listening
git commit -m "$(cat <<'MSG'
feat: リスニング問題の生成コマンドを追加する

/new-passage と /new-writing と同じ形。会話形式で2本目を作り、
複数話者の結合が実際に動くことを確認した。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## 完了の定義

- [ ] Python / JS / Swift の全テストが通る
- [ ] `sh app/build.sh` が成功する
- [ ] 読解とライティングの既存機能が壊れていない
- [ ] lecture と conversation の両方が再生でき、conversation では話者が切り替わる
- [ ] 復習モードで台本の単語をクリックすると辞書が引ける
- [ ] 音声がリポジトリにコミットされていない(`git status` に `docs/data/listening/audio` が出ない)
- [ ] 公開サイト(`docs/`)にリスニングのUIが含まれていない
