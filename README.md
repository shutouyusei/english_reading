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
node --test "tests/js/**/*.test.js"                # フロントエンド共通ロジック
```

## 公開URL

https://shutouyusei.github.io/english_reading/

Anki連携を公開版サイトで使う場合は、AnkiConnectの `webCorsOriginList` に
`https://shutouyusei.github.io` を追加してください(手順はサイト内の
[使い方・Anki設定](https://shutouyusei.github.io/english_reading/guide.html#anki))。

### フォークして自分用に公開する場合

1. GitHubにリポジトリを作成してpush
2. Settings → Pages → Branch: `main`, Folder: `/docs` を選択
3. `docs/guide.html` のIssueリンクを自分のリポジトリURLに変更
4. AnkiConnectの `webCorsOriginList` に `https://<ユーザー名>.github.io` を追加

## クレジット

- 頻出語リスト: [google-10000-english](https://github.com/first20hours/google-10000-english)
  の上位3000語を使用

## ライセンス

MIT
