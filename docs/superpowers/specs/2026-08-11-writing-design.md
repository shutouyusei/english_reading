# ライティング機能 設計書

作成日: 2026-08-11
対象ブランチ: `feature/writing`(`feature/local-app-shell` の上に積む)

## 目的

ローカルアプリに TOEFL ライティングの練習機能を足す。2形式の問題を解き、Claude が採点と添削を返し、記録が手元に残る。

公開版(GitHub Pages)には採点機能を載せない。公開版は「問題を解いて解説が見られる」ところまで、ローカルアプリは「さらに深く学習し他技能を鍛える」ためのもの、という既存の線引きを維持する。

## 実測に基づく前提

設計前に `claude -p` の挙動を実測した。以下は推測ではなく計測値。

| 項目 | 既定の呼び出し | 痩せた呼び出し |
|---|---|---|
| 所要時間 | 31.3 秒 | 14.6〜18.8 秒 |
| 入力トークン | 44,984 | 613 |
| 出力トークン | 1,334 | 955 |
| 内側 JSON のパース | 成功 | 3/3 成功 |

痩せた呼び出しとは、以下4つのフラグを付けたもの:

```
--system-prompt <採点用のシステムプロンプト>
--tools ""
--strict-mcp-config
--setting-sources ""
```

**`--tools ""` を付け忘れると入力トークンが 73 倍になる。** Claude Code の既定ツール定義一式が毎回プロンプトに載るため。採点にツールは不要なので必ず無効化する。これは実装時の最大の落とし穴であり、後述のテストで固定する。

出力は3回とも素の JSON で、マークダウンフェンスは付かなかった。ただし将来モデルが変わればフェンスを付ける可能性はあるため、パーサはフェンス付きも受け付ける。

### GUI 起動時の PATH

`launchctl getenv PATH` は空。したがって Finder から起動した `.app` が受け取る PATH は既定の `/usr/bin:/bin:/usr/sbin:/sbin` のみ。`claude` は `~/.local/bin/claude` にしか存在せず、`/usr/local/bin` にも `/opt/homebrew/bin` にも無い。

**`Process` の `executableURL` に `claude` とだけ書くと GUI 起動時に必ず失敗する。** 実行ファイルは明示的に探索する(後述)。

## 全体構成

既存の3層構造をそのまま踏襲する。

```
app/ui/*.html        画面(どのスクリプトを読むかをここで決める)
app/ui/js/*.js       画面の状態遷移と、Swift への橋渡し
app/src/*.swift      ファイル入出力と外部プロセス起動
docs/data/writing/   問題データ(公開版からも配信可能な場所に置く)
```

Reading 用の `docs/js/` には一切触らない。ライティングはローカル専用機能なので共有エンジンに入れない。問題データだけは `docs/data/` に置き、将来公開版に読み取り専用で載せる余地を残す。

## ファイル構成

大半は新規作成。既存ファイルへの変更は3か所に限る。

| 既存ファイル | 変更内容 |
|---|---|
| `app/ui/index.html` | 「✍️ ライティング」へのリンクを1本追加 |
| `app/src/main.swift` | `EssaysHandler` と `GradeHandler` を `userContentController` に登録 |
| `app/build.sh` | `ClaudeRunner.swift` と `EssaysLog.swift` を `swiftc` の引数に追加 |
| `app/tests/run.sh` | ClaudeRunner のテストを追加 |

`docs/js/` 以下(Reading の共有エンジン)には一切触らない。

| パス | 責務 | 目安行数 |
|---|---|---|
| `docs/data/writing/index.json` | 問題一覧 | データ |
| `docs/data/writing/writing_001.json` | 問題本体 | データ |
| `app/ui/writing.html` | 問題一覧・過去のエッセイ一覧 | 40 |
| `app/ui/writing-editor.html` | 執筆→採点中→結果 | 60 |
| `app/ui/js/writing-list.js` | 一覧の描画 | 90 |
| `app/ui/js/writing-editor.js` | 状態遷移とタイマー | 200 |
| `app/ui/js/essays.native.js` | `window.Essays`(保存層) | 80 |
| `app/ui/js/grader.native.js` | `window.Grader`(採点の呼び出し) | 30 |
| `app/prompts/grade-email.md` | メール問題の採点プロンプト | プロンプト |
| `app/prompts/grade-discussion.md` | ディスカッション問題の採点プロンプト | プロンプト |
| `app/src/ClaudeRunner.swift` | `claude -p` の起動と JSON 取り出し | 150 |
| `app/src/EssaysLog.swift` | `essays.jsonl` のパース | 40 |
| `scripts/validate_writing.py` | 問題 JSON の検証 | 120 |
| `.claude/commands/new-writing.md` | `/new-writing` 生成コマンド | コマンド |

Reading の `reader.js` が 206 行で収まっているので、`writing-editor.js` も同程度に収める。超えるようなら状態ごとに分割する。

## 問題データ

### `docs/data/writing/index.json`

```json
{
  "prompts": [
    {
      "id": "writing_001",
      "type": "email",
      "title": "Midterm rescheduled to Saturday",
      "target_minutes": 7,
      "added": "2026-08-11"
    }
  ]
}
```

Reading の `docs/data/index.json` とは別ファイルにする。両者は独立したドメインで、一覧の読み込み経路も別なので混ぜない。

### `docs/data/writing/writing_NNN.json`

2形式を1つの型で表す。使わないフィールドは `null` で埋める。一覧と読み込みのコードを1本に保つための判断。

**メール問題:**

```json
{
  "id": "writing_001",
  "type": "email",
  "title": "Midterm rescheduled to Saturday",
  "added": "2026-08-11",
  "target_minutes": 7,
  "instructions": "Read the situation and write an email to the person indicated. Your email should be 6-10 sentences.",
  "situation": "Your professor has announced that next week's midterm will be moved from Thursday to Saturday morning. You have a standing commitment on Saturdays and cannot attend.",
  "recipient": "Professor Alvarez",
  "must_include": [
    "変更を依頼する理由",
    "代替日程の提案"
  ],
  "discussion": null
}
```

**ディスカッション問題:**

```json
{
  "id": "writing_002",
  "type": "discussion",
  "title": "Should cities restrict private cars downtown?",
  "added": "2026-08-11",
  "target_minutes": 10,
  "instructions": "Your professor has posted a question. Write a response that contributes to the discussion. Aim for at least 100 words.",
  "situation": null,
  "recipient": null,
  "must_include": null,
  "discussion": {
    "professor_post": {
      "name": "Dr. Chen",
      "text": "Several cities have restricted private cars in their downtown cores..."
    },
    "student_posts": [
      { "name": "Marcus", "text": "I think restrictions are the only way..." },
      { "name": "Priya", "text": "Marcus overlooks the people who have no alternative..." }
    ]
  }
}
```

### 検証(`scripts/validate_writing.py`)

Python 3 標準ライブラリのみ。`scripts/validate_passage.py` と同じ作り。以下を検査する:

- `id` がファイル名と一致する
- `type` が `email` または `discussion`
- `type == "email"` のとき: `situation`・`recipient`・`must_include` が非 null、`discussion` が null
- `type == "discussion"` のとき: 上記が null、`discussion` が非 null かつ `student_posts` がちょうど2件
- `target_minutes` が正の整数
- `added` が `YYYY-MM-DD` 形式

型ごとの排他性をここで担保するので、読み込み側は `type` だけ見れば安全に分岐できる。

## 画面と状態遷移

### `app/ui/writing.html`(一覧)

問題の一覧と、各問題に対する自分の記録を並べる。バッジは3状態:

- 未着手 — 記録なし
- 採点待ち — エッセイ行はあるが採点行がない
- スコア表示 — 最新の採点の総合スコア

`app/ui/index.html` の先頭に「✍️ ライティング」へのリンクを1本足す。既存の一覧描画には手を入れない。

### `app/ui/writing-editor.html`(執筆→採点中→結果)

1枚の HTML の中で3状態を切り替える。Reading の `reader.html` が解答モードと解説モードを1画面で切り替えているのと同じ構造。

```
writing   問題文 + 入力欄 + 経過時間 + [採点する]
   |  「採点する」押下 → まずエッセイを保存 → 状態を grading へ
   v
grading   採点中の表示 + 経過秒 + [中止]
   |  成功 → 採点結果を保存 → 状態を result へ
   |  失敗 → 状態を error へ(エッセイは保存済み)
   v
result    総合スコア + 観点別 + 文単位の添削 + 講評 + [もう一度書く][一覧へ]
```

`error` 状態は結果画面と同じ場所に理由と `[再採点]` を出す。エッセイは保存済みなので、失敗しても書いた文章は失われない。

**保存が採点より先** という順序が重要。採点中にクラッシュしても、強制終了しても、文章はディスクにある。一覧に「採点待ち」として現れ、そこから再採点できる。

### タイマー

カウントアップのみ。Reading と揃える。`target_minutes` を超えたら表示色を変えて知らせるだけで、強制終了はしない。経過秒はエッセイ行に記録する。

## 保存形式

`~/Documents/TOEFLReading/essays.jsonl`。既存の `attempts.jsonl` と同じく **追記専用**。既存行は読み込み以外で触らない。

行は2種類。`kind` で区別する。

**エッセイ行**(「採点する」を押した瞬間に書く):

```json
{"kind":"essay","essayId":"e_20260811T142233_a1b2","promptId":"writing_001","promptType":"email","text":"Dear Professor Alvarez, ...","elapsedSec":412,"writtenAt":"2026-08-11T14:22:33.120Z"}
```

**採点行**(採点が成功した瞬間に書く):

```json
{"kind":"grade","essayId":"e_20260811T142233_a1b2","overall":3,"criteria":[{"name":"Task Fulfillment","score":4,"comment":"..."}],"corrections":[{"original":"...","revised":"...","reason":"..."}],"summary":"...","gradedAt":"2026-08-11T14:23:01.870Z","runnerMs":15243}
```

読み込み時に `essayId` で突き合わせる。採点行が無ければ「採点待ち」。再採点したら採点行をもう1行追記し、`gradedAt` が最新のものを採用する。更新も削除もしないので、追記専用の性質を壊さない。

`essayId` は `e_<ISO8601 の英数字部分>_<乱数4桁>` で生成する。同一秒に2回送信しても衝突しない。

### `window.Essays`(`app/ui/js/essays.native.js`)

`window.Store` と同じ形の口を提供する。

```
Essays.init()                -> Promise<void>   ページ開始時に一度だけ
Essays.forPrompt(promptId)   -> Entry[]         同期。新しい順
Essays.latest(promptId)      -> Entry|null      同期
Essays.get(essayId)          -> Entry|null      同期
Essays.saveEssay(essay)      -> Promise<void>   失敗時は reject
Essays.saveGrade(grade)      -> Promise<void>   失敗時は reject
```

`Entry` は `{essay, grade}` のペア。`grade` は未採点なら `null`。マージは `init()` の中で1回だけ行う。

呼び出しは必ずドット記法(`Essays.latest(id)`)。`latest` は `this` に依存するため。`Store` と同じ制約。

Swift 側の `EssaysHandler`(メッセージ名 `essays`)が受け取る action は3つ:

| action | 引数 | 戻り値 |
|---|---|---|
| `loadAll` | なし | 行の配列(essay 行と grade 行が混在) |
| `saveEssay` | `essay` | なし |
| `saveGrade` | `grade` | なし |

`kind` フィールドは Swift 側が付ける。JS からは渡さない。行の種別判定を1か所に閉じるため。

## Claude 採点層

### `app/prompts/grade-email.md` / `grade-discussion.md`

プロンプトはリポジトリのファイルに置き、Swift が実行時に読む。**プロンプトを直すのに再ビルドを要求しない。** 問題追加でビルドさせない方針と同じ思想。

ファイルは2部構成にする。`---` の行で区切り、前半をシステムプロンプト、後半をユーザープロンプトのテンプレートとする。

```
You are a strict, concise TOEFL Essentials writing grader.
You reply with exactly one JSON object and nothing else.
---
TASK TYPE: Email
INSTRUCTIONS: {{instructions}}
SITUATION: {{situation}}
RECIPIENT: {{recipient}}
MUST INCLUDE: {{must_include}}

STUDENT RESPONSE:
{{essay}}

Return ONLY a JSON object matching this shape:
{"overall": <0-5>, "criteria": [...], "corrections": [...], "summary": "<日本語>"}
```

`{{...}}` は Swift 側で単純置換する。テンプレート言語は導入しない。置換対象のキーは `instructions` `situation` `recipient` `must_include` `essay` `discussion` の6つに固定する。

### `app/src/ClaudeRunner.swift`

責務は「プロンプトを受け取り、採点結果の辞書を返す」ことだけ。ファイルの場所も JSONL も知らない。

**実行ファイルの解決** — GUI 起動時に PATH が痩せている問題への対処。以下の順で探し、最初に見つかった実行可能ファイルを使う:

1. 環境変数 `TOEFL_CLAUDE_BIN`(利用者による明示指定の逃げ道)
2. `~/.local/bin/claude`
3. `/opt/homebrew/bin/claude`
4. `/usr/local/bin/claude`
5. `/usr/bin/claude`

どれも見つからなければ「Claude Code が見つかりません」という日本語のエラーを返す。PATH 探索に頼らないのは、Finder 起動時の PATH に `~/.local/bin` が入らないため。

**起動引数** — 実測で確定した4フラグを必ず付ける:

```
-p <ユーザープロンプト>
--output-format json
--system-prompt <システムプロンプト>
--tools ""
--strict-mcp-config
--setting-sources ""
```

**タイムアウト** 180 秒。実測 15〜19 秒に対して十分な余裕を取る。超えたらプロセスを終了させ、タイムアウトのエラーを返す。

**出力の取り出し** は2段階。純粋関数として切り出し、テストで固定する。

1. stdout を JSON としてパース → Claude Code のラッパー。`is_error` が真ならエラー。`result` を文字列として取り出す。
2. `result` の文字列を JSON としてパース → 採点結果。マークダウンフェンス(```json ... ```)で囲まれていたら剥がしてから再試行する。

2段階目を `extractGradeJSON(from:) -> [String: Any]?` という純粋関数にすることで、プロセス起動なしにテストできる。

### `window.Grader`(`app/ui/js/grader.native.js`)

```
Grader.grade({promptId, promptType, essayText}) -> Promise<grade>
```

Swift の `GradeHandler`(メッセージ名 `grader`)へ `{action: "grade", promptId, promptType, essayText}` を投げるだけの薄い層。

Swift 側の処理順:

1. `repositoryRoot()` を起点に `docs/data/writing/<promptId>.json` を読む
2. `promptType` に応じて `app/prompts/grade-email.md` か `grade-discussion.md` を読む
3. `---` でシステム部とユーザー部に分割し、`{{...}}` を置換する
4. `ClaudeRunner` を呼ぶ
5. 採点結果の辞書を JS へ返す

JS 側はプロンプトの中身も問題 JSON の場所も知らない。`repositoryRoot()` は `main.swift` の既存関数をそのまま使う。

## エラー処理

すべての失敗経路で、**エッセイは既に保存済み**である。失敗しても書いた文章は消えない。

| 失敗 | 検出方法 | 画面に出す文言 |
|---|---|---|
| Claude Code 未インストール | 候補パスすべてに実行ファイル無し | 「Claude Code が見つかりません。`~/.local/bin/claude` などを確認してください」 |
| 未ログイン・認証エラー | 終了コード非0、または `is_error` が真 | 「Claude Code の認証に失敗しました。ターミナルで `claude` を実行してログイン状態を確認してください」 |
| タイムアウト | 180 秒経過 | 「採点が時間内に終わりませんでした。もう一度お試しください」 |
| JSON パース失敗 | 2段階のどちらかで失敗 | 「採点結果を読み取れませんでした。もう一度お試しください」 |
| 保存失敗 | ファイル書き込み例外 | 「保存できませんでした: (理由)」 |

いずれも `error` 状態に遷移し、`[再採点]` ボタンを出す。一覧に戻っても「採点待ち」として残り、後から採点できる。

空のエッセイは送信させない。入力欄が空白のみなら「採点する」を無効化する。Claude に空文字を投げても意味のある採点は返らないため、枠を無駄にしない。

## テスト

既存の3系統(Python / Node / Swift)に追加する。新しいテスト基盤は導入しない。

**Python(`unittest`)** — `scripts/validate_writing.py`

- email 型で `discussion` が非 null なら不合格
- discussion 型で `situation` が非 null なら不合格
- `student_posts` が2件でなければ不合格
- `id` がファイル名と食い違えば不合格
- 正しい2形式の問題が合格する

**Node(`node --test "tests/js/**/*.test.js"`)** — `essays.native.js`

- 採点行が無いエントリは `grade` が `null`
- 同一 `essayId` に採点行が2つあれば `gradedAt` の新しい方を採る
- `forPrompt` は新しい順
- 保存失敗時にキャッシュを汚さない
- `init()` を2回呼んでも重複しない

グロブ形式は必須。`node --test tests/js/` は Node 25.9.0 で壊れている。

**Swift(`app/tests/run.sh`)** — `ClaudeRunner` と `EssaysLog`

- `extractGradeJSON`: 素の JSON を取り出せる
- `extractGradeJSON`: ```json フェンス付きを取り出せる
- `extractGradeJSON`: 壊れた JSON では `nil` を返す
- `extractGradeJSON`: `is_error` が真ならエラーとして扱う
- **起動引数の組み立てに `--tools` と `""` が隣接して含まれる**(73倍問題の回帰防止)
- 実行ファイル探索: `TOEFL_CLAUDE_BIN` が最優先される
- 実行ファイル探索: 候補が無ければ `nil`
- `parseEssaysLog`: 不正な1行を飛ばして残りを読む(`AttemptsLog` と同じ性質)

`--tools ""` の検査をテストに入れるのは、これが最も起きやすく、かつ静かに枠を食う失敗だから。引数組み立てを純粋関数に切り出して検査する。

**スモークテスト** — 既存の `test_smoke_app.swift` に準じて、`writing.html` が問題一覧を描画することを確認する。`app://` スキーム経由で `docs/data/writing/index.json` が配信されることも併せて確認する。Claude は呼ばない。

## 問題の生成(`/new-writing`)

`.claude/commands/new-writing.md` を追加する。`/new-passage` と同じ流れ:

1. 形式(email / discussion)とトピックを決める
2. 問題 JSON を生成して `docs/data/writing/writing_NNN.json` に書く
3. `scripts/validate_writing.py` で検証する
4. `docs/data/writing/index.json` を更新する
5. コミットする

生成は Claude Code のセッション内で行うため API 課金は発生しない。

## やらないこと

- 公開版(GitHub Pages)へのライティング機能の搭載。問題データは配信可能な場所に置くが、UI は載せない。
- 採点のバックグラウンドキュー化。実測15〜19秒なので、待ち画面で足りる。
- モデルアンサー(満点回答例)の生成。まず採点と添削で使ってみて、必要なら足す。
- 採点結果の Anki 連携。Reading の語彙とは性質が違うので、別途検討する。
- Integrated Writing(読む+聴く+書く)。Listening が未実装のため。

## 未解決の依存

`feature/local-app-shell` が未マージ。このブランチはその上に積んでいる。ライティングを main に入れる前に、先に app shell をマージする必要がある。
