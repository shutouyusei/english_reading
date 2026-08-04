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
