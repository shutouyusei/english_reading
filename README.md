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

## ローカルアプリ(macOS)

リスニング・スピーキング等の学習機能を載せるための、ブラウザに依存しない
ネイティブアプリ(`app-shell/`、Rust + tao + wry)。学習記録を実ファイルとして残す。

```bash
bash app-shell/build.sh    # ビルド(cargo のみ)
TOEFL_REPO_ROOT="$(pwd)" app-shell/target/release/app_shell
```

- 解答履歴は `~/Documents/TOEFLReading/attempts.jsonl` に**追記**される(上書きしない)
- パッセージは起動のたびにディスクから読むため、`/new-passage` で追加した分は
  **再ビルドせずに**反映される
- リポジトリルートは環境変数 `TOEFL_REPO_ROOT` で指定する(未設定時は起動時の
  カレントディレクトリを使う)
- macOS・Linux 対応(Windows は設計のみで未検証)。署名していないため配布には
  向かない(個人利用を前提)
- リスニングもローカルアプリのみ。音声は macOS の `say` コマンドで初回再生時に
  生成し、`~/Documents/TOEFLReading/audio/` にキャッシュする(2回目以降は
  再生成しない)。音声ファイルはリポジトリにはコミットしない

公開版(GitHub Pages)はリーディングのみで、保存はブラウザ内にとどまる。

## ライティング

ローカルアプリのみ。メール問題(TOEFL Essentials型。状況を読んで、相手への返信を
6〜10文で書く)と学術ディスカッション問題(教授の投稿 + 2人の学生の返信があり、
自分の意見を加える)の2形式。

採点は Claude Code 付属の `claude` CLI を経由する。Anthropic APIキーは不要。
Claude Code がインストール・ログイン済みなら、ローカルアプリから採点ボタンで
自動起動。採点にかかる時間は**16〜22秒**程度だが、120秒以上かかることと、
通信失敗が稀に起こるため、UI ではエッセイを採点前に保存し、失敗時には
再採点できる画面を出す。

エッセイはディスク上に以下のパスで**追記**のみされる。再採点も別行として
追記される。`gradedAt` の値で最新の採点が判定される:

```
~/Documents/TOEFLReading/essays.jsonl
```

問題を追加するには、Claude Code で `/new-writing` を実行。データは
`docs/data/writing/` に保存され、ローカルアプリが再ビルド無しで読み込む。

`claude` コマンドが PATH に無い環境(Finder から起動した `.app` が
`/usr/bin:/bin:/usr/sbin:/sbin` のみを見る場合など)では、環境変数
`TOEFL_CLAUDE_BIN` に full path を設定して起動する:

```bash
TOEFL_CLAUDE_BIN=/path/to/claude TOEFL_REPO_ROOT="$(pwd)" app-shell/target/release/app_shell
```

## テスト

```bash
python3 -m unittest discover -s tests/python -v   # Pythonスクリプト
node --test "tests/js/**/*.test.js"                # フロントエンド共通ロジック
(cd core && cargo test)                            # Rust core
(cd app-shell && cargo test)                       # Rust app-shell
```

## 公開URL

https://shutouyusei.github.io/english_reading/

Anki連携を公開版サイトで使う場合は、AnkiConnectの `webCorsOriginList` に
`https://shutouyusei.github.io` を追加してください(手順はサイト内の
[使い方・Anki設定](https://shutouyusei.github.io/english_reading/guide.html#anki))。

### フォークして自分用に公開する場合

1. GitHubにリポジトリを作成してpush
2. Settings → Pages → Branch: `main`, Folder: `/docs` を選択
3. `docs/guide.html` 内の2箇所を自分のURLに変更
   - Anki設定手順の `https://shutouyusei.github.io`(訪問者が許可すべきサイトのオリジン)
   - 免責セクションのIssueリンク `https://github.com/shutouyusei/english_reading/issues`
4. AnkiConnectの `webCorsOriginList` に `https://<ユーザー名>.github.io` を追加

## クレジット

- 頻出語リスト: [google-10000-english](https://github.com/first20hours/google-10000-english)
  の上位3000語を使用

## ライセンス

MIT
