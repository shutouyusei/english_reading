# TOEFL Reading Vocab App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TOEFL形式のリーディング教材静的サイト(解答モード/解説モード、単語クリック日本語解説、AnkiConnect連携)と、Claude Codeサブスク枠で動くコンテンツ生成パイプラインを構築する。

**Architecture:** GitHub Pages(`docs/`)で配信する完全静的サイト。パッセージは事前生成JSONで、`docs/data/index.json` がマニフェスト。生成はスラッシュコマンド `/new-passage`(Claudeが内容生成、Pythonが検証・抽出・index更新)。フロントは Vanilla JS 4ファイル + CSS 1ファイル。

**Tech Stack:** HTML/CSS/Vanilla JS(外部ライブラリなし)、Python 3.13(標準ライブラリのみ)、テストは `unittest` と `node --test`(Node 25)。

**Spec:** `docs/superpowers/specs/2026-08-04-toefl-vocab-app-design.md`

## Global Constraints

- `docs/` 以下は静的ファイルのみ。ビルドツール・npm・外部CDN・外部ライブラリ禁止
- サイト内リンク・fetchは全て相対パス(GitHub Pagesのサブパス配信で壊れないため)
- Pythonは標準ライブラリのみ。`ANTHROPIC_API_KEY` 不使用
- UIテキストは日本語、パッセージ本文は英語
- 1ファイル200〜400行目安、800行超え禁止
- コミットは Conventional Commits、メッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Pythonテスト実行: `python3 -m unittest discover -s tests/python -v`(プロジェクトルートから)
- JSテスト実行: `node --test tests/js/`
- ローカル動作確認: `python3 -m http.server 8000 -d docs`(`file://` 直開きはfetchが失敗するため不可)
- localStorageアクセスは try/catch で包む(プライベートモード対策)

---

### Task 1: スキャフォールディングと頻出語リスト

**Files:**
- Create: `LICENSE`
- Create: `scripts/common_words.txt`
- Create: `docs/data/passages/.gitkeep`

**Interfaces:**
- Produces: `scripts/common_words.txt`(小文字英単語を1行1語、約3000語)。Task 2が読み込む

- [ ] **Step 1: ディレクトリと LICENSE を作成**

`LICENSE` (MIT):

```text
MIT License

Copyright (c) 2026 yaai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

```bash
mkdir -p docs/data/passages docs/js docs/css scripts tests/python tests/js .claude/commands
touch docs/data/passages/.gitkeep
```

- [ ] **Step 2: 頻出語リストを取得(上位3000語)**

```bash
curl -fsSL https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt | head -3000 > scripts/common_words.txt
wc -l scripts/common_words.txt
```

Expected: `3000 scripts/common_words.txt`。URLが死んでいる場合は同リポジトリ(first20hours/google-10000-english)の別ミラーを探し、1行1語・小文字・頻度順のリストの上位3000語を保存する(READMEで出典を明記するのはTask 11)。

- [ ] **Step 3: Commit**

```bash
git add LICENSE scripts/common_words.txt docs/data/passages/.gitkeep
git commit -m "chore: scaffold project with MIT license and common words list"
```

---

### Task 2: 難語彙抽出スクリプト

**Files:**
- Create: `scripts/extract_hard_words.py`
- Test: `tests/python/test_extract_hard_words.py`

**Interfaces:**
- Consumes: `scripts/common_words.txt`(Task 1)
- Produces:
  - CLI: `python3 scripts/extract_hard_words.py <passage.json>` → 難語彙を1行1語で標準出力
  - `WORD_RE: re.Pattern`(英単語トークナイズ用)、`candidates(token: str) -> list[str]`(小文字化+接尾辞除去候補)、`extract_hard_words(body: str, common: set[str]) -> list[str]`。Task 3がimportする

- [ ] **Step 1: 失敗するテストを書く**

`tests/python/test_extract_hard_words.py`:

```python
"""Tests for extract_hard_words.py."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from extract_hard_words import candidates, extract_hard_words


class TestCandidates(unittest.TestCase):
    def test_plain_word_returns_lowercase_self(self):
        self.assertEqual(candidates("Reef"), ["reef"])

    def test_suffixes_are_stripped(self):
        self.assertEqual(candidates("fluctuates"), ["fluctuates", "fluctuat", "fluctuate"])
        self.assertIn("attribute", candidates("attributed"))
        self.assertIn("change", candidates("changed"))
        self.assertIn("read", candidates("reading"))

    def test_short_stems_are_not_produced(self):
        self.assertEqual(candidates("les"), ["les"])


class TestExtractHardWords(unittest.TestCase):
    COMMON = {"the", "coral", "reef", "often", "show", "change", "an"}

    def test_extracts_words_not_in_common_list(self):
        body = "The coral reefs often show disequilibria."
        self.assertEqual(extract_hard_words(body, self.COMMON), ["disequilibria"])

    def test_inflected_common_words_are_excluded(self):
        body = "Changes changed changing."
        self.assertEqual(extract_hard_words(body, self.COMMON), [])

    def test_dedup_keeps_first_occurrence_order(self):
        body = "Disequilibria persists; disequilibria persists."
        self.assertEqual(extract_hard_words(body, self.COMMON), ["disequilibria", "persists"])

    def test_words_shorter_than_four_letters_are_ignored(self):
        body = "An apex zoo."
        self.assertEqual(extract_hard_words(body, self.COMMON), ["apex"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `python3 -m unittest discover -s tests/python -v`
Expected: FAIL(`ModuleNotFoundError: No module named 'extract_hard_words'`)

- [ ] **Step 3: 実装を書く**

`scripts/extract_hard_words.py`:

```python
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `python3 -m unittest discover -s tests/python -v`
Expected: 全テストPASS(7 tests OK)

- [ ] **Step 5: Commit**

```bash
git add scripts/extract_hard_words.py tests/python/test_extract_hard_words.py
git commit -m "feat: add hard-word extraction script"
```

---

### Task 3: パッセージ検証スクリプト

**Files:**
- Create: `scripts/validate_passage.py`
- Test: `tests/python/test_validate_passage.py`

**Interfaces:**
- Consumes: `WORD_RE`, `candidates` from `extract_hard_words`(Task 2)
- Produces: CLI `python3 scripts/validate_passage.py <passage.json>` → 正常時 exit 0 で `OK: ...`、エラー時 exit 1 でエラー一覧をstderrへ。`validate(passage: dict) -> list[str]`(エラーメッセージのリスト、空なら合格)

- [ ] **Step 1: 失敗するテストを書く**

`tests/python/test_validate_passage.py`:

```python
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `python3 -m unittest discover -s tests/python -v`
Expected: FAIL(`ModuleNotFoundError: No module named 'validate_passage'`)

- [ ] **Step 3: 実装を書く**

`scripts/validate_passage.py`:

```python
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `python3 -m unittest discover -s tests/python -v`
Expected: 全テストPASS(13 tests OK)

- [ ] **Step 5: Commit**

```bash
git add scripts/validate_passage.py tests/python/test_validate_passage.py
git commit -m "feat: add passage schema validator"
```

---

### Task 4: index.json 更新スクリプト

**Files:**
- Create: `scripts/update_index.py`
- Test: `tests/python/test_update_index.py`

**Interfaces:**
- Produces: CLI `python3 scripts/update_index.py` → `docs/data/passages/*.json` を走査し `docs/data/index.json` を再生成(added降順)。`build_index(passages_dir: Path) -> dict`

- [ ] **Step 1: 失敗するテストを書く**

`tests/python/test_update_index.py`:

```python
"""Tests for update_index.py."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from update_index import build_index


def write_passage(directory: Path, pid: str, added: str) -> None:
    meta = {
        "id": pid, "title": f"Title {pid}", "topic": "環境",
        "word_count": 480, "added": added,
        "body": "x", "questions": [], "vocab": {},
    }
    (directory / f"{pid}.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )


class TestBuildIndex(unittest.TestCase):
    def test_entries_sorted_by_added_descending(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            write_passage(directory, "passage_001", "2026-08-01")
            write_passage(directory, "passage_002", "2026-08-03")
            index = build_index(directory)
            self.assertEqual(
                [e["id"] for e in index["passages"]],
                ["passage_002", "passage_001"],
            )

    def test_entry_has_only_meta_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            write_passage(directory, "passage_001", "2026-08-01")
            entry = build_index(directory)["passages"][0]
            self.assertEqual(
                sorted(entry), ["added", "id", "title", "topic", "word_count"]
            )


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `python3 -m unittest discover -s tests/python -v`
Expected: FAIL(`ModuleNotFoundError: No module named 'update_index'`)

- [ ] **Step 3: 実装を書く**

`scripts/update_index.py`:

```python
#!/usr/bin/env python3
"""Rebuild docs/data/index.json from the passage files."""
import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
PASSAGES_DIR = DATA_DIR / "passages"
INDEX_PATH = DATA_DIR / "index.json"
META_FIELDS = ["id", "title", "topic", "word_count", "added"]


def build_index(passages_dir: Path) -> dict:
    """Collect meta fields from every passage file, newest first."""
    entries = []
    for path in sorted(passages_dir.glob("passage_*.json")):
        passage = json.loads(path.read_text(encoding="utf-8"))
        entries.append({field: passage[field] for field in META_FIELDS})
    entries.sort(key=lambda e: (e["added"], e["id"]), reverse=True)
    return {"passages": entries}


def main() -> int:
    if not PASSAGES_DIR.is_dir():
        print(f"ERROR: {PASSAGES_DIR} not found", file=sys.stderr)
        return 1
    index = build_index(PASSAGES_DIR)
    INDEX_PATH.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {INDEX_PATH} ({len(index['passages'])} passages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: テストが通ることを確認**

Run: `python3 -m unittest discover -s tests/python -v`
Expected: 全テストPASS(15 tests OK)

- [ ] **Step 5: Commit**

```bash
git add scripts/update_index.py tests/python/test_update_index.py
git commit -m "feat: add index.json manifest generator"
```

---

### Task 5: /new-passage スラッシュコマンド

**Files:**
- Create: `.claude/commands/new-passage.md`

**Interfaces:**
- Consumes: Task 2〜4 のCLI
- Produces: 作者(またはTask 6の実装者)が従う生成手順書。`docs/data/passages/passage_NNN.json` と更新済み `index.json` を出力する

- [ ] **Step 1: コマンドファイルを書く**

`.claude/commands/new-passage.md`:

```markdown
---
description: 新しいTOEFLパッセージ・クイズ・単語解説を生成してサイトデータを更新する
---

# /new-passage — 新しいパッセージを追加する

以下の手順を順番に実行する。スキーマの正は
`docs/superpowers/specs/2026-08-04-toefl-vocab-app-design.md` セクション5。

## 1. 次のIDを決める
- `docs/data/passages/` の既存ファイルから連番の次のID(`passage_NNN`、3桁ゼロ埋め)を決める。
- `docs/data/index.json` で既存パッセージのトピックとテーマを確認する。

## 2. パッセージとクイズを生成する
以下の条件でJSONを作り `docs/data/passages/passage_NNN.json` に保存する:
- `body`: 450〜500語の学術的英文(TOEFL iBTリーディング相当の難度、3〜5段落、段落区切りは `\n\n`)
- `topic`: 科学/社会/歴史/芸術/環境のうち既存で使用が少ないもの。テーマは既存と重複させない
- `questions`: 5問。`type` は Factual / Inference / Vocabulary / Reference / Rhetorical Purpose
  から少なくとも3種類を混在させる。Vocabulary問題は `target_word` に本文中の語を設定
  (他のtypeは `null`)。`correct` はA〜Dに分散(同一文字は最大3回)。
  `explanation` は日本語で、本文の根拠を引用して書く
- `word_count`: 実際の語数、`added`: 今日の日付(YYYY-MM-DD)、`vocab`: この段階では `{}`

## 3. 難語彙を抽出する
`python3 scripts/extract_hard_words.py docs/data/passages/passage_NNN.json`
出力リストから明らかな固有名詞(人名・地名)を除外し、残りを解説対象とする。

## 4. 単語解説を生成する
手順3の各単語について以下を作成し、JSONの `vocab` にマージする(解説は日本語):
- `etymology`: 接頭辞・語根・接尾辞に分けた語源分解
- `definition`: 簡潔な定義
- `usage_in_passage`: 本文からの引用と、その語が果たす論理的役割の説明
- `related_terms`: 関連語3〜4個(英語)
- `context_sentence`: その単語を含む本文の一文をそのまま抜き出す

## 5. 検証してindexを更新する
`python3 scripts/validate_passage.py docs/data/passages/passage_NNN.json`
`python3 scripts/update_index.py`
エラーが出たら修正して再実行する。

## 6. 確認とコミット
- タイトル・トピック・語数・問題タイプ内訳・収録単語数のサマリをユーザーに表示する。
- ユーザーの承認後:
  `git add docs/data && git commit -m "content: add passage_NNN <title>"`
  リモートが設定済みなら `git push` も行う。
```

- [ ] **Step 2: 参照整合を検証**

Run: `grep -o "scripts/[a-z_]*\.py" .claude/commands/new-passage.md | sort -u`
Expected: `scripts/extract_hard_words.py`, `scripts/update_index.py`, `scripts/validate_passage.py` の3つ(全てTask 2〜4で作成済みのファイル名と一致)

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/new-passage.md
git commit -m "feat: add /new-passage content generation command"
```

---

### Task 6: passage_001 を生成(パイプラインE2E検証)

**Files:**
- Create: `docs/data/passages/passage_001.json`
- Create: `docs/data/index.json`(update_index.py が生成)

**Interfaces:**
- Consumes: `.claude/commands/new-passage.md`(Task 5)の手順1〜5
- Produces: スキーマ準拠の実データ1本。Task 8〜10のフロントエンドがこのデータで動作確認する

- [ ] **Step 1: /new-passage の手順1〜5を実行してpassage_001を作る**

`.claude/commands/new-passage.md` の手順1〜5に従い、実装者(Claude)自身がコンテンツを生成する:
- ID: `passage_001`、トピックは5分野から任意(例: 環境)
- 本文450〜500語・クイズ5問・難語彙抽出(`extract_hard_words.py`)・全難語彙の日本語解説を `vocab` にマージ
- 手順6(コミット確認)はこのタスクのStep 3で行うためスキップ

- [ ] **Step 2: 検証コマンドで合格を確認**

```bash
python3 scripts/validate_passage.py docs/data/passages/passage_001.json
python3 scripts/update_index.py
python3 -c "import json; d=json.load(open('docs/data/index.json')); print(d['passages'][0]['id'])"
```

Expected: `OK: passage_001 is valid (...)`、`Wrote ... (1 passages)`、`passage_001`

- [ ] **Step 3: Commit**

```bash
git add docs/data
git commit -m "content: add passage_001 via new-passage pipeline"
```

---

### Task 7: フロントエンド共通ロジック textmatch.js

**Files:**
- Create: `docs/js/textmatch.js`
- Test: `tests/js/textmatch.test.js`

**Interfaces:**
- Produces(ブラウザではグローバル関数、nodeでは `module.exports`):
  - `candidates(token: string) -> string[]` — Python版と同一ロジック
  - `findVocabKey(token: string, vocabKeys: Set<string>) -> string | null`
  - `tokenize(text: string) -> {text: string, isWord: boolean}[]` — 全文字保存
  - `escapeHtml(text: string) -> string`
  - Task 8〜10の全JSがこれらを使う

- [ ] **Step 1: 失敗するテストを書く**

`tests/js/textmatch.test.js`:

```javascript
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { candidates, findVocabKey, tokenize, escapeHtml } =
  require("../../docs/js/textmatch.js");

test("candidates lowers case and strips naive suffixes", () => {
  assert.deepEqual(candidates("Fluctuates"), ["fluctuates", "fluctuat", "fluctuate"]);
  assert.deepEqual(candidates("reef"), ["reef"]);
  assert.ok(candidates("changed").includes("change"));
});

test("findVocabKey matches direct and suffix-stripped forms", () => {
  const keys = new Set(["disequilibria", "fluctuate"]);
  assert.equal(findVocabKey("Disequilibria", keys), "disequilibria");
  assert.equal(findVocabKey("fluctuates", keys), "fluctuate");
  assert.equal(findVocabKey("coral", keys), null);
});

test("tokenize preserves every character and flags words", () => {
  const parts = tokenize("Coral reefs, and algae.");
  assert.equal(parts.map((p) => p.text).join(""), "Coral reefs, and algae.");
  assert.deepEqual(
    parts.filter((p) => p.isWord).map((p) => p.text),
    ["Coral", "reefs", "and", "algae"]
  );
});

test("escapeHtml escapes special characters", () => {
  assert.equal(escapeHtml('<b>"A" & \'B\'</b>'),
    "&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;");
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/js/`
Expected: FAIL(`Cannot find module '../../docs/js/textmatch.js'`)

- [ ] **Step 3: 実装を書く**

`docs/js/textmatch.js`:

```javascript
"use strict";

/* 純粋関数のみ。DOMに触れないこと(nodeでテストするため)。 */

const SUFFIXES = ["ing", "ed", "es", "s"];
const MIN_STEM_LEN = 3;
const WORD_RE = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;

function candidates(token) {
  const lowered = token.toLowerCase();
  const forms = [lowered];
  for (const suffix of SUFFIXES) {
    if (lowered.endsWith(suffix) && lowered.length - suffix.length >= MIN_STEM_LEN) {
      const stem = lowered.slice(0, -suffix.length);
      forms.push(stem);
      if (suffix === "ing" || suffix === "ed") {
        forms.push(stem + "e");  // changed -> change, attributed -> attribute
      }
    }
  }
  return forms;
}

function findVocabKey(token, vocabKeys) {
  for (const form of candidates(token)) {
    if (vocabKeys.has(form)) return form;
  }
  return null;
}

function tokenize(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(WORD_RE)) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), isWord: false });
    }
    parts.push({ text: match[0], isWord: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), isWord: false });
  return parts;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

if (typeof module !== "undefined") {
  module.exports = { candidates, findVocabKey, tokenize, escapeHtml };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/js/`
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add docs/js/textmatch.js tests/js/textmatch.test.js
git commit -m "feat: add shared text matching utilities for frontend"
```

---

### Task 8: パッセージ一覧ページ(style.css + index.html + app.js)

**Files:**
- Create: `docs/css/style.css`
- Create: `docs/index.html`
- Create: `docs/js/app.js`

**Interfaces:**
- Consumes: `escapeHtml`(textmatch.js)、`docs/data/index.json`(Task 6)
- Produces: 一覧ページ。各パッセージから `reader.html?id=<id>&mode=solve|study` へ遷移(Task 9が受ける)。localStorageキー `results.<id>` を読む(書くのはTask 9)

- [ ] **Step 1: style.css を書く**

`docs/css/style.css`:

```css
:root {
  --accent: #1565c0;
  --accent-green: #2e7d32;
  --danger: #c62828;
  --border: #d0d4da;
  --bg: #fafbfc;
  --text: #1f2430;
  --muted: #6b7280;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
  color: var(--text);
  background: var(--bg);
  line-height: 1.7;
}
a { color: var(--accent); }

.site-header {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  padding: 10px 20px; border-bottom: 1px solid var(--border); background: #fff;
  font-size: .95em;
}
.site-header .brand { font-weight: 700; color: var(--text); text-decoration: none; }
.site-footer {
  padding: 16px 20px; border-top: 1px solid var(--border);
  font-size: .8em; color: var(--muted); text-align: center;
}

/* 一覧・ガイド */
.page { max-width: 860px; margin: 0 auto; padding: 20px; }
.prose { max-width: 720px; margin: 0 auto; padding: 20px; }
.prose pre { background: #eef1f5; padding: 12px; border-radius: 8px; overflow-x: auto; }
.card {
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
  background: #fff; border: 1px solid var(--border); border-radius: 10px;
  padding: 14px 18px; margin-bottom: 12px;
}
.card h3 { margin: 0 0 4px; }
.card .meta { margin: 0; font-size: .85em; color: var(--muted); }
.card-actions { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
.badge { border: 1px solid var(--border); border-radius: 12px; padding: 1px 10px; font-size: .85em; }
.badge.done { border-color: var(--accent-green); color: var(--accent-green); }

/* ボタン */
.button, button {
  font: inherit; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border);
  background: #fff; color: var(--text); cursor: pointer;
  text-decoration: none; text-align: center; display: inline-block;
}
.button.primary, button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.anki { background: var(--accent-green); border-color: var(--accent-green); color: #fff; }
button:disabled { opacity: .4; cursor: not-allowed; }

/* リーダー左右分割 */
#reader-main { display: flex; min-height: calc(100vh - 110px); }
#passage-pane {
  flex: 1.2; padding: 18px 24px; border-right: 1px solid var(--border);
  overflow-y: auto; background: #fff;
}
#right-pane { flex: 1; overflow-y: auto; }
mark { background: rgba(21, 101, 192, .25); padding: 0 2px; }

/* 解答モード */
.question-card { padding: 18px 20px; }
.choices { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.choice { text-align: left; }
.choice.selected { border-color: var(--accent); background: rgba(21, 101, 192, .08); }
.nav-row { display: flex; justify-content: space-between; margin-top: 16px; }
.result-card { padding: 30px 20px; text-align: center; }
.result-card .score { font-size: 1.8em; font-weight: 700; margin: 0 0 8px; }

/* 解説モード */
.w { cursor: pointer; }
.w:hover { text-decoration: underline; }
.w.vocab-word { background: rgba(46, 125, 50, .13); border-radius: 3px; padding: 0 2px; }
.w.active { outline: 2px solid var(--accent-green); background: rgba(46, 125, 50, .3); }
.tabs { display: flex; border-bottom: 1px solid var(--border); }
.tab { flex: 1; border: none; border-radius: 0; background: none; padding: 10px; color: var(--muted); }
.tab.on { font-weight: 700; color: var(--text); border-bottom: 2px solid var(--accent-green); }
#panel-body { padding: 14px 18px; font-size: .95em; }
#panel-body p { margin: 2px 0 6px; }
.label {
  font-size: .72em; text-transform: uppercase; letter-spacing: .05em;
  color: var(--muted); margin-top: 10px;
}
.word { margin: 0 0 6px; font-size: 1.2em; }
.btn-row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
.hint { color: var(--muted); font-size: .85em; }
.error { color: var(--danger); padding: 20px; }
.quiz-review { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.quiz-review.ok { border-left: 3px solid var(--accent-green); }
.quiz-review.ng { border-left: 3px solid var(--danger); }
.explanation { color: var(--muted); font-size: .9em; }

/* モーダル */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, .4);
  display: flex; align-items: center; justify-content: center;
}
.modal { background: #fff; border-radius: 10px; padding: 20px 24px; min-width: 280px; }
.modal input {
  font: inherit; padding: 6px 8px; border: 1px solid var(--border);
  border-radius: 6px; width: 100%;
}

@media (max-width: 800px) {
  #reader-main { flex-direction: column; }
  #passage-pane { border-right: none; border-bottom: 1px solid var(--border); }
  .card { flex-direction: column; align-items: stretch; }
}
```

- [ ] **Step 2: index.html を書く**

`docs/index.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TOEFL Reading — 読んで、調べて、Ankiに送る</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="index.html">📖 TOEFL Reading</a>
    <a href="guide.html">使い方・Anki設定</a>
  </header>
  <main class="page">
    <p>TOEFL形式のリーディングを解き、わからない単語をクリックして日本語解説を読み、その場でAnkiに追加できる学習サイトです。</p>
    <div id="passage-list"><p class="hint">読み込み中…</p></div>
  </main>
  <footer class="site-footer">
    <p>⚠️ コンテンツは全てAI生成です ・ 作成者は英語の専門家ではありません ・ ETSおよびTOEFLとは無関係の非公式教材です</p>
    <p><a href="guide.html">使い方・Anki設定</a> ・ <a href="guide.html#report">問題を報告</a></p>
  </footer>
  <script src="js/textmatch.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: app.js を書く**

`docs/js/app.js`:

```javascript
"use strict";

async function initList() {
  const container = document.querySelector("#passage-list");
  let index;
  try {
    const res = await fetch("data/index.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (err) {
    container.innerHTML =
      `<p class="error">一覧を読み込めませんでした(${escapeHtml(err.message)})。</p>`;
    return;
  }
  if (!index.passages.length) {
    container.innerHTML = `<p class="hint">パッセージがまだありません。</p>`;
    return;
  }
  container.innerHTML = index.passages.map(cardHtml).join("");
}

function cardHtml(meta) {
  const result = loadResult(meta.id);
  const badge = result
    ? `<span class="badge done">✅ ${result.score}/${result.total} ・ ${formatMinSec(result.elapsedSec)}</span>`
    : `<span class="badge">未挑戦</span>`;
  return `
    <div class="card">
      <div class="card-main">
        <h3>${escapeHtml(meta.title)}</h3>
        <p class="meta">${escapeHtml(meta.topic)} ・ ${meta.word_count} words ・ ${meta.added} ${badge}</p>
      </div>
      <div class="card-actions">
        <a class="button primary" href="reader.html?id=${meta.id}&mode=solve">✏️ 問題を解く</a>
        <a class="button" href="reader.html?id=${meta.id}&mode=study">📖 解説モードで読む</a>
      </div>
    </div>`;
}

function loadResult(id) {
  try {
    return JSON.parse(localStorage.getItem(`results.${id}`));
  } catch (_) {
    return null;
  }
}

function formatMinSec(sec) {
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}

document.addEventListener("DOMContentLoaded", initList);
```

- [ ] **Step 4: サーバーを立てて確認**

```bash
python3 -m http.server 8000 -d docs &
sleep 1
curl -sf http://localhost:8000/ | grep -c "TOEFL Reading"
curl -sf http://localhost:8000/data/index.json | python3 -c "import json,sys; print(json.load(sys.stdin)['passages'][0]['id'])"
kill %1
```

Expected: 1行目のgrepが1以上、2行目が `passage_001`。さらにブラウザで http://localhost:8000/ を開き、パッセージカード1枚と2つのボタン、フッター免責が表示されることを目視確認。

- [ ] **Step 5: Commit**

```bash
git add docs/css/style.css docs/index.html docs/js/app.js
git commit -m "feat: add passage list page"
```

---

### Task 9: リーダー解答モード(reader.html + reader.js)

**Files:**
- Create: `docs/reader.html`
- Create: `docs/js/reader.js`

**Interfaces:**
- Consumes: `tokenize`, `candidates`, `escapeHtml`(textmatch.js)、`data/passages/<id>.json`
- Produces:
  - `qs(sel: string) -> Element`(グローバル。Task 10のvocab.jsも使う)
  - `state`(グローバル: `{passage, current, answers, startedAt, timerId}`)
  - `startSolveMode()`, `startStudyMode()`(このタスクでは仮実装。Task 10が置換)
  - localStorage `results.<id>` = `{solved, score, total, elapsedSec, answers, date}`
  - reader.htmlのDOM構造: `#header-title` `#header-status` `#passage-pane` `#right-pane` `#modal-root`

- [ ] **Step 1: reader.html を書く**

`docs/reader.html`(script読み込みはこの段階では2ファイルのみ。Task 10でvocab.js/anki.jsを追加する):

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>リーダー — TOEFL Reading</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="index.html">📖 TOEFL Reading</a>
    <span id="header-title"></span>
    <span id="header-status"></span>
  </header>
  <main id="reader-main">
    <section id="passage-pane"></section>
    <section id="right-pane"></section>
  </main>
  <footer class="site-footer">
    <p>⚠️ コンテンツは全てAI生成です ・ 作成者は英語の専門家ではありません ・ ETSおよびTOEFLとは無関係の非公式教材です</p>
    <p><a href="guide.html">使い方・Anki設定</a> ・ <a href="guide.html#report">問題を報告</a></p>
  </footer>
  <div id="modal-root"></div>
  <script src="js/textmatch.js"></script>
  <script src="js/reader.js"></script>
</body>
</html>
```

- [ ] **Step 2: reader.js を書く**

`docs/js/reader.js`:

```javascript
"use strict";

const state = {
  passage: null,
  current: 0,
  answers: [],
  startedAt: null,
  timerId: null,
};

function qs(sel) {
  return document.querySelector(sel);
}

async function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || "";
  const mode = params.get("mode") === "study" ? "study" : "solve";
  if (!/^passage_\d+$/.test(id)) {
    renderError("パッセージが指定されていません。");
    return;
  }
  try {
    const res = await fetch(`data/passages/${id}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.passage = await res.json();
  } catch (err) {
    renderError(`パッセージを読み込めませんでした(${err.message})。`);
    return;
  }
  document.title = `${state.passage.title} — TOEFL Reading`;
  qs("#header-title").textContent = state.passage.title;
  if (mode === "study") startStudyMode(); else startSolveMode();
}

function renderError(message) {
  qs("#reader-main").innerHTML =
    `<p class="error">${escapeHtml(message)} <a href="index.html">一覧に戻る</a></p>`;
}

/* ---------- 解答モード ---------- */

function startSolveMode() {
  stopTimer();
  state.current = 0;
  state.answers = state.passage.questions.map(() => null);
  state.startedAt = Date.now();
  state.timerId = setInterval(updateTimer, 1000);
  renderSolveHeader();
  renderSolveStep();
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function elapsedSeconds() {
  return Math.floor((Date.now() - state.startedAt) / 1000);
}

function formatElapsed(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function updateTimer() {
  const el = qs("#timer");
  if (el) el.textContent = formatElapsed(elapsedSeconds());
}

function renderSolveHeader() {
  qs("#header-status").innerHTML =
    `<span id="q-pos"></span> ｜ ⏱ <span id="timer">0:00</span> ｜ ` +
    `<a href="#" id="quit-link">中断して解説モードへ</a>`;
  qs("#quit-link").addEventListener("click", (e) => {
    e.preventDefault();
    startStudyMode();
  });
}

function renderSolveStep() {
  qs("#q-pos").textContent =
    `Question ${state.current + 1} of ${state.passage.questions.length}`;
  renderPassagePlain();
  renderQuestion();
}

function renderPassagePlain() {
  const question = state.passage.questions[state.current];
  const target =
    question && question.type === "Vocabulary" ? question.target_word : null;
  const pane = qs("#passage-pane");
  pane.innerHTML = "";
  for (const para of state.passage.body.split("\n\n")) {
    const p = document.createElement("p");
    for (const part of tokenize(para)) {
      if (part.isWord && target &&
          candidates(part.text).includes(target.toLowerCase())) {
        const mark = document.createElement("mark");
        mark.textContent = part.text;
        p.appendChild(mark);
      } else {
        p.appendChild(document.createTextNode(part.text));
      }
    }
    pane.appendChild(p);
  }
}

function renderQuestion() {
  const idx = state.current;
  const question = state.passage.questions[idx];
  const isLast = idx === state.passage.questions.length - 1;
  const choices = ["A", "B", "C", "D"].map((letter) => {
    const selected = state.answers[idx] === letter ? " selected" : "";
    return `<button class="choice${selected}" data-letter="${letter}">` +
      `<b>${letter}.</b> ${escapeHtml(question.choices[letter])}</button>`;
  }).join("");
  qs("#right-pane").innerHTML = `
    <div class="question-card">
      <p><b>Q${question.id}.</b> ${escapeHtml(question.question)}</p>
      <div class="choices">${choices}</div>
      <div class="nav-row">
        <button id="back-btn" ${idx === 0 ? "disabled" : ""}>← Back</button>
        <button id="next-btn" class="primary" ${state.answers[idx] ? "" : "disabled"}>
          ${isLast ? "採点する" : "Next →"}</button>
      </div>
    </div>`;
  document.querySelectorAll(".choice").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.answers[idx] = btn.dataset.letter;
      renderQuestion();
    }));
  qs("#back-btn").addEventListener("click", () => {
    state.current -= 1;
    renderSolveStep();
  });
  qs("#next-btn").addEventListener("click", () => {
    if (isLast) {
      finishSolve();
    } else {
      state.current += 1;
      renderSolveStep();
    }
  });
}

function finishSolve() {
  stopTimer();
  const questions = state.passage.questions;
  const score = questions.filter((q, i) => state.answers[i] === q.correct).length;
  const sec = elapsedSeconds();
  const wrong = questions
    .filter((q, i) => state.answers[i] !== q.correct)
    .map((q) => `Q${q.id} (${q.type})`);
  const result = {
    solved: true,
    score,
    total: questions.length,
    elapsedSec: sec,
    answers: state.answers,
    date: new Date().toISOString().slice(0, 10),
  };
  try {
    localStorage.setItem(`results.${state.passage.id}`, JSON.stringify(result));
  } catch (_) { /* プライベートモード等では保存しない */ }
  qs("#header-status").textContent = `⏱ ${formatElapsed(sec)} で終了`;
  qs("#right-pane").innerHTML = `
    <div class="result-card">
      <p class="score">${score} / ${questions.length} 正解</p>
      <p class="hint">所要時間 ${formatElapsed(sec)}${
        wrong.length ? ` ｜ 誤答: ${wrong.join(", ")}` : " ｜ 🎉 全問正解"}</p>
      <button id="to-study" class="primary">📖 解説モードで復習する</button>
    </div>`;
  qs("#to-study").addEventListener("click", () => startStudyMode());
}

/* ---------- 解説モード(Task 10で本実装に置換する仮実装) ---------- */

function startStudyMode() {
  stopTimer();
  qs("#header-status").textContent = "解説モード";
  qs("#right-pane").innerHTML =
    `<p class="hint" style="padding:20px">解説モードは未実装です(Task 10で実装)。</p>`;
}

document.addEventListener("DOMContentLoaded", init);
```

- [ ] **Step 3: サーバーを立てて確認**

```bash
python3 -m http.server 8000 -d docs &
sleep 1
curl -sf "http://localhost:8000/reader.html" | grep -c "reader.js"
kill %1
```

Expected: `1`。さらにブラウザで `http://localhost:8000/reader.html?id=passage_001&mode=solve` を開き以下を目視確認:
1. 左にパッセージ全文、右に問題1問、ヘッダーに Question 1 of 5 とカウントアップするタイマー
2. 選択肢を選ぶとNextが有効化、Backで戻ると選択が保持されている
3. Vocabulary問題の表示中のみ対象語がハイライトされる
4. 5問回答後に採点結果(スコア・所要時間・誤答タイプ)が出る
5. DevToolsのApplication → Local Storageに `results.passage_001` が保存されている

- [ ] **Step 4: Commit**

```bash
git add docs/reader.html docs/js/reader.js
git commit -m "feat: add reader solve mode with TOEFL-style layout and count-up timer"
```

---

### Task 10: 解説モードとAnki連携(vocab.js + anki.js)

**Files:**
- Create: `docs/js/vocab.js`
- Create: `docs/js/anki.js`
- Modify: `docs/reader.html`(script 2行追加)
- Modify: `docs/js/reader.js`(仮 `startStudyMode` を置換)

**Interfaces:**
- Consumes: `qs`, `state`, `stopTimer`, `startSolveMode`(reader.js)、`tokenize`, `findVocabKey`, `escapeHtml`(textmatch.js)、localStorage `results.<id>`
- Produces:
  - `renderStudy(passage)`(vocab.js。reader.jsの新startStudyModeが呼ぶ)
  - `addToAnki(passage, word, entry)`, `openAnkiSettings()`(anki.js。vocab.jsが呼ぶ)
  - localStorage `settings.anki` = `{deck: string}`

- [ ] **Step 1: anki.js を書く**

`docs/js/anki.js`:

```javascript
"use strict";

const ANKI_URL = "http://127.0.0.1:8765";
const DEFAULT_DECK = "TOEFL Reading";
const ANKI_SETTINGS_KEY = "settings.anki";

function ankiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(ANKI_SETTINGS_KEY));
    if (saved && saved.deck) return saved;
  } catch (_) { /* 破損データは無視してデフォルトへ */ }
  return { deck: DEFAULT_DECK };
}

function saveAnkiSettings(settings) {
  try {
    localStorage.setItem(ANKI_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) { /* プライベートモード等では保存しない */ }
}

async function ankiRequest(action, params) {
  const res = await fetch(ANKI_URL, {
    method: "POST",
    body: JSON.stringify({ action, version: 6, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function buildFront(word, entry, passageTitle) {
  const sentence = escapeHtml(entry.context_sentence)
    .replace(new RegExp(`\\b(${word})\\b`, "i"), "<b>$1</b>");
  return `<div style="font-size:1.2em"><b>${escapeHtml(word)}</b></div>` +
    `<div style="font-style:italic">"${sentence}"</div>` +
    `<div style="font-size:.8em;opacity:.7">出典: ${escapeHtml(passageTitle)}</div>`;
}

function buildBack(entry) {
  return `<b>定義:</b> ${escapeHtml(entry.definition)}<br>` +
    `<b>語源:</b> ${escapeHtml(entry.etymology)}<br>` +
    `<b>文中での役割:</b> ${escapeHtml(entry.usage_in_passage)}<br>` +
    `<b>関連語:</b> ${entry.related_terms.map(escapeHtml).join(", ")}`;
}

async function addToAnki(passage, word, entry) {
  const status = document.querySelector("#anki-status");
  status.textContent = "Ankiに追加中…";
  const deck = ankiSettings().deck;
  try {
    await ankiRequest("createDeck", { deck });
    await ankiRequest("addNote", {
      note: {
        deckName: deck,
        modelName: "Basic",
        fields: {
          Front: buildFront(word, entry, passage.title),
          Back: buildBack(entry),
        },
        options: { allowDuplicate: false },
        tags: ["toefl-reading", passage.id],
      },
    });
    status.textContent = `✅ デッキ「${deck}」に追加しました`;
  } catch (err) {
    if (String(err.message).includes("duplicate")) {
      status.textContent = "ℹ️ このカードは追加済みです";
    } else {
      status.innerHTML =
        `⚠ Ankiに接続できませんでした。Ankiが起動しているか確認してください。 ` +
        `<a href="guide.html#anki">セットアップ手順</a>`;
    }
  }
}

function openAnkiSettings() {
  const root = document.querySelector("#modal-root");
  const current = ankiSettings().deck;
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h3>Anki設定</h3>
        <label>追加先デッキ名
          <input id="deck-input" value="${escapeHtml(current)}">
        </label>
        <div class="btn-row">
          <button id="settings-save" class="primary">保存</button>
          <button id="settings-cancel">キャンセル</button>
        </div>
      </div>
    </div>`;
  root.querySelector("#settings-save").addEventListener("click", () => {
    const deck = root.querySelector("#deck-input").value.trim() || DEFAULT_DECK;
    saveAnkiSettings({ deck });
    root.innerHTML = "";
  });
  root.querySelector("#settings-cancel").addEventListener("click", () => {
    root.innerHTML = "";
  });
}
```

- [ ] **Step 2: vocab.js を書く**

`docs/js/vocab.js`:

```javascript
"use strict";

const studyState = { selectedWord: null, history: [], activeTab: "vocab" };

function renderStudy(passage) {
  renderPassageClickable(passage);
  renderPanel(passage);
}

function renderPassageClickable(passage) {
  const keys = new Set(Object.keys(passage.vocab).map((w) => w.toLowerCase()));
  const pane = qs("#passage-pane");
  pane.innerHTML = "";
  for (const para of passage.body.split("\n\n")) {
    const p = document.createElement("p");
    for (const part of tokenize(para)) {
      if (!part.isWord) {
        p.appendChild(document.createTextNode(part.text));
        continue;
      }
      const span = document.createElement("span");
      const key = findVocabKey(part.text, keys);
      span.textContent = part.text;
      span.className = key ? "w vocab-word" : "w";
      span.addEventListener("click", () => onWordClick(passage, part.text, key, span));
      p.appendChild(span);
    }
    pane.appendChild(p);
  }
}

function onWordClick(passage, surface, key, span) {
  document.querySelectorAll(".w.active").forEach((el) => el.classList.remove("active"));
  span.classList.add("active");
  studyState.selectedWord = key || surface.toLowerCase();
  studyState.activeTab = "vocab";
  if (!studyState.history.includes(studyState.selectedWord)) {
    studyState.history.unshift(studyState.selectedWord);
  }
  renderPanel(passage);
}

function renderPanel(passage) {
  const result = loadStudyResult(passage.id);
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
      renderPanel(passage);
    }));
  if (studyState.activeTab === "vocab") {
    renderVocabTab(passage);
  } else {
    renderQuizTab(passage, result);
  }
}

function loadStudyResult(id) {
  try {
    return JSON.parse(localStorage.getItem(`results.${id}`));
  } catch (_) {
    return null;
  }
}

function renderVocabTab(passage) {
  const body = qs("#panel-body");
  const word = studyState.selectedWord;
  if (!word) {
    body.innerHTML =
      `<p class="hint">本文中の単語をクリックすると、ここに解説が表示されます。</p>`;
    return;
  }
  const entry = passage.vocab[word];
  const weblio = `https://ejje.weblio.jp/content/${encodeURIComponent(word)}`;
  if (!entry) {
    body.innerHTML = `
      <h3 class="word">${escapeHtml(word)}</h3>
      <p>未収録の単語です。</p>
      <p><a href="${weblio}" target="_blank" rel="noopener">Weblioで調べる ↗</a></p>
      ${historyHtml()}`;
    return;
  }
  body.innerHTML = `
    <h3 class="word">${escapeHtml(word)}</h3>
    <div class="label">語源</div><p>${escapeHtml(entry.etymology)}</p>
    <div class="label">定義</div><p>${escapeHtml(entry.definition)}</p>
    <div class="label">この文章での役割</div><p>${escapeHtml(entry.usage_in_passage)}</p>
    <div class="label">関連語</div><p>${entry.related_terms.map(escapeHtml).join(" ・ ")}</p>
    <div class="btn-row">
      <button id="anki-add" class="anki">＋ Ankiに追加</button>
      <a class="button" href="${weblio}" target="_blank" rel="noopener">Weblio ↗</a>
      <button id="anki-settings-open" title="Anki設定">⚙</button>
    </div>
    <p id="anki-status" class="hint"></p>
    ${historyHtml()}`;
  qs("#anki-add").addEventListener("click", () => addToAnki(passage, word, entry));
  qs("#anki-settings-open").addEventListener("click", () => openAnkiSettings());
}

function historyHtml() {
  if (!studyState.history.length) return "";
  const words = studyState.history.slice(0, 8).map(escapeHtml).join(" ・ ");
  return `<p class="hint">最近調べた語: ${words}</p>`;
}

function renderQuizTab(passage, result) {
  const body = qs("#panel-body");
  if (!result) {
    body.innerHTML = `<p class="hint">まだ解いていません。` +
      `<a href="reader.html?id=${passage.id}&mode=solve">問題を解く</a></p>`;
    return;
  }
  body.innerHTML = passage.questions.map((q, i) => {
    const user = result.answers ? result.answers[i] : null;
    const ok = user === q.correct;
    return `
      <div class="quiz-review${ok ? " ok" : " ng"}">
        <p><b>Q${q.id}.</b> ${escapeHtml(q.question)}</p>
        <p>${ok ? "✅" : "❌"} あなたの回答: ${user || "—"} ／ ` +
        `正解: ${q.correct}. ${escapeHtml(q.choices[q.correct])}</p>
        <p class="explanation">${escapeHtml(q.explanation)}</p>
      </div>`;
  }).join("");
}
```

- [ ] **Step 3: reader.html にscriptを追加**

`docs/reader.html` の script 読み込み部を以下に変更(textmatch → anki → vocab → reader の順):

```html
  <script src="js/textmatch.js"></script>
  <script src="js/anki.js"></script>
  <script src="js/vocab.js"></script>
  <script src="js/reader.js"></script>
```

- [ ] **Step 4: reader.js の仮 startStudyMode を置換**

`docs/js/reader.js` の仮実装(`/* ---------- 解説モード(Task 10で本実装に置換する仮実装) ---------- */` から始まる `startStudyMode` 関数)を以下に置き換える:

```javascript
/* ---------- 解説モード ---------- */

function startStudyMode() {
  stopTimer();
  qs("#header-status").innerHTML =
    `<a href="#" id="resolve-link">✏️ もう一度解く</a>`;
  qs("#resolve-link").addEventListener("click", (e) => {
    e.preventDefault();
    startSolveMode();
  });
  renderStudy(state.passage);
}
```

- [ ] **Step 5: 動作確認**

```bash
node --test tests/js/
python3 -m http.server 8000 -d docs &
sleep 1
curl -sf "http://localhost:8000/reader.html" | grep -c "vocab.js"
kill %1
```

Expected: nodeテスト全PASS、grepは `1`。ブラウザで `http://localhost:8000/reader.html?id=passage_001&mode=study` を開き目視確認:
1. 収録語が薄緑背景、クリックで右パネルに 語源→定義→役割→関連語 が表示され、選択語に枠が付く
2. 未収録語クリックで「未収録の単語です + Weblioリンク」
3. 「問題の解説」タブ: 解答済みなら正誤一覧+解説、未解答なら「まだ解いていません」
4. 「もう一度解く」で解答モードに戻り、タイマーとQuestion 1 of 5から再開
5. Anki未起動の状態で「＋ Ankiに追加」→ 接続エラーメッセージとguide.htmlへのリンクが出る
6. (Ankiを起動しAnkiConnect設定済みなら)追加成功メッセージとAnki側のカード生成を確認。⚙でデッキ名変更→localStorageの `settings.anki` に反映

- [ ] **Step 6: Commit**

```bash
git add docs/js/vocab.js docs/js/anki.js docs/js/reader.js docs/reader.html
git commit -m "feat: add study mode with word explanations and AnkiConnect integration"
```

---

### Task 11: ガイドページ・README・最終検証

**Files:**
- Create: `docs/guide.html`
- Create: `README.md`

**Interfaces:**
- Consumes: これまでの全成果物
- Produces: 公開可能な状態のリポジトリ

- [ ] **Step 1: guide.html を書く**

`docs/guide.html`:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>使い方・Anki設定 — TOEFL Reading</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="index.html">📖 TOEFL Reading</a>
    <a href="index.html">パッセージ一覧</a>
  </header>
  <main class="prose">
    <h1>使い方</h1>
    <p>このサイトには2つのモードがあります。</p>
    <ul>
      <li><b>✏️ 解答モード</b> — 本番のTOEFLと同じ形式です。左にパッセージ、右に問題が1問ずつ表示され、回答するごとに次の問題へ進みます。経過時間はヘッダーでカウントアップ表示されます。このモードでは単語クリックは無効です。</li>
      <li><b>📖 解説モード</b> — 本文中の<b>すべての単語</b>をクリックできます。収録語は語源・定義・文中での役割・関連語の日本語解説が右パネルに表示され、その場でAnkiに追加できます。未収録語はWeblioへのリンクが表示されます。「問題の解説」タブでは各問題の正誤と日本語解説を確認できます。</li>
    </ul>
    <p>問題を解かずに解説モードだけで読むこともできます。成績(スコア・所要時間)はお使いのブラウザ内(localStorage)にのみ保存され、サーバーには送信されません。</p>

    <h1 id="anki">Anki連携のセットアップ</h1>
    <p>解説モードの「＋ Ankiに追加」ボタンで、単語カードをPCのAnkiに直接追加できます。初回のみ以下の設定が必要です。</p>
    <ol>
      <li><a href="https://apps.ankiweb.net/" target="_blank" rel="noopener">Anki</a>(PC版)をインストールする。</li>
      <li>Ankiのメニュー「ツール → アドオン → 新規アドオンを取得」でコード <code>2055492159</code> を入力し、<b>AnkiConnect</b> をインストールする。</li>
      <li>「ツール → アドオン → AnkiConnect → 設定」を開き、<code>webCorsOriginList</code> にこのサイトのURLを追加する:
<pre>{
    "webCorsOriginList": [
        "http://localhost",
        "https://あなたのユーザー名.github.io"
    ]
}</pre>
      (他の設定項目は変更不要。既存の値は残したまま追記してください)</li>
      <li>Ankiを再起動する。</li>
      <li>解説モードで単語をクリック →「＋ Ankiに追加」を押し、「✅ 追加しました」と出れば完了。カードはデッキ「TOEFL Reading」に入ります(デッキ名は ⚙ ボタンで変更可)。</li>
    </ol>
    <p><b>制約:</b> この機能はPCでAnkiを起動している間のみ動作します。スマートフォン(AnkiDroid / AnkiMobile)への直接追加はできません。PCのAnkiに追加後、Ankiの同期機能でスマートフォンへ反映してください。</p>

    <h1 id="report">免責事項・問題の報告</h1>
    <ul>
      <li>本サイトのパッセージ・問題・解説は<b>すべてAIによって生成</b>されており、人間の専門家によるレビューを受けていません。</li>
      <li>作成者は英語教育の専門家ではありません。</li>
      <li>本サイトはETSおよびTOEFLとは無関係の非公式教材です。TOEFLはETSの登録商標です。</li>
      <li>誤りを見つけた場合は <a href="https://github.com/REPLACE_WITH_YOUR_REPO/issues" target="_blank" rel="noopener">GitHub Issues</a> から報告してください(リポジトリ公開時にこのリンクを実URLへ更新)。</li>
    </ul>
  </main>
  <footer class="site-footer">
    <p>⚠️ コンテンツは全てAI生成です ・ 作成者は英語の専門家ではありません ・ ETSおよびTOEFLとは無関係の非公式教材です</p>
  </footer>
</body>
</html>
```

- [ ] **Step 2: README.md を書く**

`README.md`:

```markdown
# TOEFL Reading Vocab App

TOEFL形式のリーディングを解き、わからない単語をクリックして日本語解説
(語源・定義・文中での役割・関連語)を読み、その場でAnkiに追加できる
静的学習サイト。GitHub Pagesで配信し、バックエンドなし・訪問者のAPIキー不要。

> ⚠️ **免責**: パッセージ・問題・解説はすべてAI生成で、専門家のレビューを
> 受けていません。作成者は英語教育の専門家ではありません。本サイトは
> ETSおよびTOEFLとは無関係の非公式教材です。

## 機能

- **解答モード**: 本番TOEFL形式(左にパッセージ、右に問題1問ずつ)。
  経過時間をカウントアップ計測。成績はブラウザのlocalStorageに保存
- **解説モード**: 全単語クリック可能。収録語は日本語リッチ解説+Anki追加、
  未収録語はWeblioリンク。問題の日本語解説も表示
- **Anki連携**: AnkiConnect経由でPCのAnkiにワンクリックでカード追加
  (設定手順はサイト内の「使い方」ページ参照)

## ローカルでの動作確認

```bash
python3 -m http.server 8000 -d docs
# http://localhost:8000/ を開く
```

`docs/index.html` をfile://で直接開くとfetchが失敗するため、必ずローカル
サーバー経由で確認する。

## パッセージの追加(開発者向け)

Claude Code で `/new-passage` を実行する。Claudeがパッセージ・クイズ・
単語解説を生成し、以下を自動実行する(Anthropic APIキーは不要。
Claude Codeのサブスクリプション枠で動作):

1. `docs/data/passages/passage_NNN.json` の生成
2. `python3 scripts/extract_hard_words.py <file>` — 難語彙抽出
3. 難語彙の日本語解説を `vocab` にマージ
4. `python3 scripts/validate_passage.py <file>` — スキーマ検証
5. `python3 scripts/update_index.py` — マニフェスト更新

## テスト

```bash
python3 -m unittest discover -s tests/python -v   # Pythonスクリプト
node --test tests/js/                              # フロントエンド共通ロジック
```

## 公開手順(初回のみ)

1. GitHubにリポジトリを作成してpush
2. Settings → Pages → Branch: `main`, Folder: `/docs` を選択
3. `docs/guide.html` 内の `REPLACE_WITH_YOUR_REPO` を実リポジトリ名に置換
4. Anki連携を使う場合、AnkiConnectの `webCorsOriginList` に
   `https://<ユーザー名>.github.io` を追加(サイト内ガイド参照)

## クレジット

- 頻出語リスト: [google-10000-english](https://github.com/first20hours/google-10000-english)
  の上位3000語を使用

## ライセンス

MIT
```

- [ ] **Step 3: 全テストと全ページの最終検証**

```bash
python3 -m unittest discover -s tests/python -v
node --test tests/js/
python3 scripts/validate_passage.py docs/data/passages/passage_001.json
python3 -m http.server 8000 -d docs &
sleep 1
for page in index.html reader.html guide.html; do
  curl -sfo /dev/null "http://localhost:8000/$page" && echo "$page OK"
done
kill %1
```

Expected: 全テストPASS、validate OK、3ページとも `OK`。仕上げにブラウザで 一覧 → 解答モード(5問) → 結果 → 解説モード(単語クリック+Ankiエラー表示) → ガイド の一連の流れを通しで目視確認。

- [ ] **Step 4: Commit**

```bash
git add docs/guide.html README.md
git commit -m "docs: add usage guide page and README"
```
