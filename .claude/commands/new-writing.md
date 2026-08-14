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
   - `email`: `situation` / `recipient` は必須の非空文字列、`must_include` は非空文字列の非空リスト。`discussion` は null
   - `discussion`: `situation` / `recipient` / `must_include` は null にし、`discussion.student_posts` はちょうど2件
   - **全て英語で書く。** 人名・地名・会社名も英語。日本語は使わない
   - `target_minutes` は email なら 7、discussion なら 10

   **分量と形の目安**(`writing_001` / `writing_002` を手本にすること):

   - `email` の `situation` は **40〜60 words、3〜4文**に抑える。日常で起きうる具体的な出来事を1つだけ書く
     (例: 借りたレンタカーで、断ったはずの保険が請求に入っていた)。背景説明を盛らない
   - `must_include` は **3項目**。動詞で始まる短い命令形にする
     (`explain what happened…` / `state what you would like…` / `ask when…`)。
     採点プロンプトにそのまま埋め込まれるので、採点の観点として読める表現にする
   - `discussion` は逆に読み応えを持たせる。`professor_post` は **150〜200 words**
     で、具体例と対立する2つの立場の両方に触れ、最後に問いを置く。
     `student_posts` は各 **120〜150 words** で、片方がもう片方に言及して噛み合わせる。
     短い相槌ではなく、それぞれが独立した主張になっていること
5. 検証する: `python3 scripts/validate_writing.py docs/data/writing/writing_NNN.json`
   エラーが出たら直してから次へ進む。
6. 一覧を更新する: `python3 scripts/update_writing_index.py`
7. 確認とコミット
- タイトル・形式・シチュエーション・必須要素のサマリーをユーザーに表示する。
- ユーザーの承認後:
  `git add docs/data/writing/ && git commit -m "content: add writing_NNN <title>"`
  リモートが設定済みなら `git push` も行う。

生成はこのセッション内で行うので API 課金は発生しない。
