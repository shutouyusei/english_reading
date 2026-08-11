---
description: TOEFLライティングの問題を1問生成して docs/data/writing/ に追加する
---

新しいライティング問題を作る。

1. 形式を決める。引数で `email` か `discussion` が指定されていればそれに従い、
   無ければ `docs/data/writing/` の既存ファイルを見て少ない方を選ぶ。
2. 既存の問題と題材が重ならないことを確認する。
   `docs/data/writing/index.json` の `title` を全て読んでから決める。
3. 次の番号を決める(`writing_001` の次は `writing_002`)。
4. `docs/data/writing/writing_NNN.json` を書く。スキーマは
   `docs/superpowers/specs/2026-08-11-writing-design.md` の「問題データ」節に従う。
   - `email`: `situation` / `recipient` / `must_include` を埋め、`discussion` は null
   - `discussion`: 上記3つを null にし、`discussion.student_posts` はちょうど2件
   - `must_include` と、生徒の投稿の名前以外の日本語は使わない(英語の問題文にする)
   - `target_minutes` は email なら 7、discussion なら 10
5. 検証する: `python3 scripts/validate_writing.py docs/data/writing/writing_NNN.json`
   エラーが出たら直してから次へ進む。
6. 一覧を更新する: `python3 scripts/update_writing_index.py`
7. コミットする:
   `git add docs/data/writing/ && git commit -m "content: add writing_NNN <title>"`

生成はこのセッション内で行うので API 課金は発生しない。
