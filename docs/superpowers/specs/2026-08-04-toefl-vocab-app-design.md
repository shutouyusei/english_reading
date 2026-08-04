# TOEFL Reading Vocab App — 設計スペック

日付: 2026-08-04
状態: ユーザーレビュー待ち

## 1. コンセプト

日本人TOEFL学習者向けの、TOEFL形式リーディング教材サイト。

- 本番形式でパッセージを読み、5問のクイズを解く(解答モード)
- 解き終わったら(または最初から)解説モードに入り、任意の単語をクリックして
  日本語解説(語源・定義・文中での役割・関連語)を読み、その場でAnkiに追加する
- 復習はAnkiに委ね、アプリは「読む・調べる・解く」に徹する
- 作者が毎日Claude Codeで1本生成してpushし、コンテンツが育つ

ホスティング: GitHub Pages(`docs/` 公開)。バックエンドなし、ビルドなし、
訪問者にAPIキー不要。

## 2. 確定した設計判断

| 論点 | 決定 |
|---|---|
| 想定ユーザー | 公開(日本人TOEFL学習者)。作者自身が毎日のヘビーユーザー |
| UI・解説の言語 | 日本語 |
| コンテンツ生成 | Claude Codeサブスクリプション枠(スラッシュコマンド)。API課金なし |
| 単語クリック範囲 | 全単語。収録語はリッチ解説、未収録語はWeblioリンク |
| 単語の記録・復習 | アプリ内には持たない。AnkiConnectでAnkiに直接追加 |
| アプリ内単語帳・SRS | 作らない(MVP外、要望が出たらv2検討) |
| 品質管理 | AI生成のまま公開。免責明記 + GitHub Issueで報告受付 |
| 画面形式 | TOEFL再現の左右分割。左=パッセージ、右=問題1問ずつ |
| モード | 解答モードと解説モードの2モード。入り口は選択制 |
| 時間計測 | カウントアップ式ストップウォッチ(経過時間を計測・表示) |
| 追加ペース | 毎日1本生成 → push(手動)。初期本数の目標は設けない |

## 3. 画面設計(docs/、Vanilla JS、外部ライブラリなし)

ページは3つ。全て静的HTML + JS。

### 3.1 パッセージ一覧(index.html)

- `data/index.json` を読み、新着順に一覧表示(タイトル・トピック・語数・追加日)
- 各パッセージに2つの入り口: 「✏️ 問題を解く」「📖 解説モードで読む」
- localStorageに保存した実施記録(解答済みフラグ・スコア・所要時間)をバッジ表示
- フッターに免責事項を常時表示(全ページ共通)

### 3.2 リーダー(reader.html?id=passage_XXX)

ヘッダー + 左右分割レイアウトを両モードで共通化。右側だけが入れ替わる。

**解答モード(本番TOEFL再現):**

- 左: パッセージ全文(スクロール可)。下線・色付け・クリック機能は一切なし。
  例外: Vocabulary問題の対象語のみ本番同様にハイライト
- 右: 問題が1問ずつ。回答して Next で次へ、Back で戻れる(回答は保持)
- ヘッダー: タイトル、Question n of 5、経過時間(カウントアップ)、
  「中断して解説モードへ」リンク
- 5問回答後: 採点結果画面(スコア、所要時間、誤答の問題タイプ)→
  「解説モードで復習する」ボタン
- 結果はlocalStorageに保存(パッセージごとに解答済み・スコア・所要時間)

**解説モード(復習・単語学習):**

- 左: 同じパッセージ。収録語(vocab収載)は薄い背景色、全単語クリック可能。
  選択中の語は濃い枠で強調
- 右: 解説パネル。タブ2つ:
  - 「単語解説」タブ: クリックした語の 語源 → 定義 → この文章での役割 →
    関連語 を表示。「＋ Ankiに追加」「Weblioで調べる」ボタン。
    パネル下部にセッション内のクリック履歴(最近調べた語)
  - 「問題の解説」タブ: 5問の正誤一覧(自分の回答と正解の比較)+日本語解説。
    未解答の場合は「まだ解いていません」表示
- 未収録語クリック時: 簡易表示(「未収録の単語です」+ Weblioリンク)
- ヘッダー: 「もう一度解く」リンク(解答モードに戻る。回答履歴はリセット)
- モバイル: 左右分割が成立しない幅では上下配置に切り替え、
  単語解説は画面下からのシート表示

### 3.3 使い方・Anki設定ガイド(guide.html)

- アプリの使い方(2モードの説明)
- AnkiConnectセットアップ手順: アドオンのインストール(コード 2055492159)、
  `webCorsOriginList` にサイトのオリジンを追加する設定例、動作確認方法
- 免責事項の全文(AI生成・作者は英語専門家ではない・ETS非公式)と
  GitHub Issueへの問題報告リンク

## 4. Anki連携

- 方式: AnkiConnect(`http://127.0.0.1:8765`)へ `addNote` をPOST
- デッキ名デフォルト: `TOEFL Reading`。ノートタイプ: Basic(表/裏)。
  デッキ名は設定モーダルで変更可(localStorageに保存)
- カード内容:
  - 表: 単語 + 出現文(単語を太字)+ 出典パッセージ名
  - 裏: 定義・語源・文中での役割・関連語(日本語)
- デッキが存在しない場合は `createDeck` で自動作成
- 重複追加はAnkiConnect側の重複判定に任せ、拒否されたら「追加済みです」と表示
- 接続失敗時: エラーメッセージ + guide.htmlへの誘導
- 制約(仕様として明記): PCでAnki起動中のみ動作。スマホ・AnkiDroidは対象外

## 5. データスキーマ

### 5.1 docs/data/passages/passage_XXX.json

```json
{
  "id": "passage_001",
  "title": "string",
  "topic": "科学|社会|歴史|芸術|環境",
  "body": "string (英文全文。段落は\n\nで区切る)",
  "word_count": 480,
  "added": "2026-08-04",
  "questions": [
    {
      "id": 1,
      "type": "Factual|Inference|Vocabulary|Reference|Rhetorical Purpose",
      "question": "string (英語)",
      "target_word": "string | null (Vocabulary問題のハイライト対象語)",
      "choices": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "correct": "A",
      "explanation": "string (日本語の解答解説)"
    }
  ],
  "vocab": {
    "disequilibria": {
      "etymology": "日本語: 接頭辞・語根・接尾辞の分解説明",
      "definition": "日本語: 簡潔な定義",
      "usage_in_passage": "日本語: 本文引用 + 論理的役割の説明",
      "related_terms": ["equilibrium", "..."],
      "context_sentence": "string (単語を含む本文の一文。Ankiカード表に使用)"
    }
  }
}
```

### 5.2 docs/data/index.json(マニフェスト)

GitHub Pagesはディレクトリ一覧を返さないため必須。生成パイプラインが自動更新。

```json
{
  "passages": [
    {"id": "passage_001", "title": "...", "topic": "環境",
     "word_count": 487, "added": "2026-08-04"}
  ]
}
```

### 5.3 単語照合ルール(フロントエンド)

本文トークンとvocabキーの照合は軽い正規化のみ:
小文字化 + 末尾の s / es / ed / ing を落として一致を試す。
それ以上の語形変化対応(不規則変化など)はしない。

### 5.4 localStorage キー設計

- `results.<passage_id>`: `{solved: true, score: 4, total: 5, elapsedSec: 842, date: "..."}`
- `settings.anki`: `{deck: "TOEFL Reading"}`

## 6. コンテンツ生成パイプライン(サブスク枠、API課金ゼロ)

### 6.1 スラッシュコマンド `.claude/commands/new-passage.md`

作者がClaude Codeで `/new-passage` を実行すると、セッション内で:

1. Claudeがパッセージ(450〜500語、トピックは科学/社会/歴史/芸術/環境から選択、
   既存パッセージとの重複を避ける)+ クイズ5問(問題タイプを混在、正答をA〜Dに分散、
   日本語explanation付き)を生成し、スキーマ通りのJSONを書く
2. `python scripts/extract_hard_words.py` で難語彙を抽出
   (NGSL等の頻出語リスト `common_words.txt` に含まれない語)
3. Claudeが各難語彙の日本語解説(etymology / definition / usage_in_passage /
   related_terms / context_sentence)を生成し、JSONの `vocab` にマージ
4. `python scripts/validate_passage.py` でスキーマ検証
   (必須フィールド、正答分布、vocabキーが本文に存在するか)
5. `python scripts/update_index.py` で `index.json` を更新
6. 生成物のサマリを表示し、作者の確認後にコミット & push

### 6.2 Pythonスクリプト(決定論的処理のみ、API不使用)

- `scripts/extract_hard_words.py` — トークナイズ + 頻出語リスト照合
- `scripts/validate_passage.py` — スキーマ・整合性検証
- `scripts/update_index.py` — マニフェスト再生成
- `scripts/common_words.txt` — NGSL等の公開頻出語リスト(出典をREADMEに明記)
- 依存: Python標準ライブラリのみ(`requirements.txt` は空、または不要)
- `ANTHROPIC_API_KEY` は一切不要

## 7. ディレクトリ構成

```
english_reading/
├── docs/                        # GitHub Pages公開対象
│   ├── index.html               # パッセージ一覧
│   ├── reader.html              # 解答/解説モード
│   ├── guide.html               # 使い方・Anki設定・免責
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js               # 一覧ページ
│   │   ├── reader.js            # リーダー(モード管理・採点)
│   │   ├── vocab.js             # 単語クリック・解説パネル
│   │   └── anki.js              # AnkiConnect連携
│   └── data/
│       ├── index.json
│       └── passages/passage_001.json
├── scripts/                     # 開発時のみ(Python、API不使用)
├── .claude/commands/new-passage.md
├── README.md
└── LICENSE                      # MIT
```

JSは1ファイル200〜400行を目安に分割する。

## 8. 免責・品質方針

- 全ページフッター: 「コンテンツは全てAI生成です ・ 作成者は英語の専門家では
  ありません ・ ETSおよびTOEFLとは無関係の非公式教材です」
- guide.htmlに免責の全文と、誤り報告用のGitHub Issueリンク
- 生成物はレビューなしで公開し、報告ベースで修正する

## 9. MVPで意図的に切るもの

- アプリ内単語帳・SRS・TSVエクスポート(復習はAnkiに全面委任)
- 端末間同期(バックエンドなしを維持)
- GitHub Actionsによる自動生成(v2候補。サブスクのOAuthトークン
  `claude setup-token` で実現可能な道は確認済み)
- 語形変化の本格対応(レンマ化)
- リーディング以外のセクション

## 10. 検証方法

- フロントエンド: `docs/index.html` をブラウザで直接開いて動作確認
  (fetchのCORS制約がある場合は `python -m http.server` で確認)
- Anki連携: ローカルでAnki + AnkiConnectを起動して実際にカード追加を確認
- パイプライン: `/new-passage` を1回実行し、生成→検証→表示まで
  エンドツーエンドで通す
