# ローカルアプリの土台 — 設計スペック

日付: 2026-08-11
状態: ユーザーレビュー待ち
関連: `2026-08-04-toefl-vocab-app-design.md`(公開版の設計)

## 1. 背景と目的

現在のサイトはGitHub Pagesで配信する静的サイト1つだけである。ここに
リスニング・ライティング・スピーキングと振り返り機能を足したいが、これらは
音声ファイルの蓄積やローカルLLM連携を伴うため、ブラウザの保存領域では扱いにくい。

そこで用途を2つに分ける。

| | GitHub Pages版 | ローカルアプリ |
|---|---|---|
| 目的 | 試用・公開教材。アプリへの入口 | 本番の学習環境 |
| 機能 | リーディングを解く・解説を見る | + リスニング・スピーキング・ライティング・振り返り |
| 保存 | 追加しない(現行のlocalStorageのまま) | 実ファイルとしてSwiftが管理 |
| 実行基盤 | ブラウザ | ネイティブアプリ(WKWebView内蔵) |

**本スペックが扱うのは、ローカルアプリの土台のみである。** 学習機能そのものは
後続の別スペックで扱う。

## 2. 設計方針: 実行時分岐を持たない

機能の差を `if (isNativeApp)` のような実行時判定で表現しない。
**どのスクリプトを読み込むかをHTMLが決め、共通エンジンは差異を知らない。**

層は4つ。

| 層 | 内容 | 共有 |
|---|---|---|
| コンテンツ | `docs/data/passages/*.json` | 完全に共通。スキーマ変更なし |
| エンジン | 本文描画・単語照合・採点・クイズ進行 | 共通(同一ファイル) |
| 保存 | 同じ呼び出し口に対する2つの実装 | 呼び出し口のみ共通 |
| 構成 | 各アプリのHTMLがどのスクリプトを読むか | それぞれ独立 |

エンジンは `window.Store` という決められた口を呼ぶだけで、その実体が
localStorage なのかSwift経由のファイル書き込みなのかを知らない。

## 3. 確定した設計判断

| 論点 | 決定 |
|---|---|
| アプリの実装手段 | Swift + WKWebView。`swiftc` 一行でビルド。Electron/Tauri/npm/Rust は使わない |
| ビルド検証 | 済。64KBのarm64実行ファイルが生成されることを確認 |
| ページ表示 | アプリ自身のウィンドウ(WKWebView)。ブラウザを開かない |
| ファイル読み取り | `WKURLSchemeHandler` で `app://` を処理し、Swiftがディスクから読む。HTTPサーバー・ポート・CORSは使わない |
| パッセージ追加時 | 要求のたびに読むためビルド不要。生成した瞬間に反映される |
| JS→Swift 通信 | `WKScriptMessageHandlerWithReply`(JS側はPromiseで受ける) |
| 学習データの置き場 | `~/Documents/TOEFLReading/` |
| 解答履歴の形式 | `attempts.jsonl`(1行1件の追記専用。上書きしない) |
| 公開版への変更 | 保存層の抽出に伴う内部整理のみ。利用者から見た挙動は変えない |

## 4. ディレクトリ構成

```
english_reading/
├── docs/                        # GitHub Pages 公開対象(変更は最小限)
│   ├── index.html               # 公開版: リーディングのみ
│   ├── reader.html
│   ├── guide.html
│   ├── css/style.css
│   ├── js/
│   │   ├── textmatch.js         # 共通エンジン(変更なし)
│   │   ├── reader.js            # 共通エンジン(保存呼び出しのみ Store 経由に変更)
│   │   ├── vocab.js             # 共通エンジン(保存呼び出しのみ Store 経由に変更)
│   │   ├── anki.js              # 共通(変更なし)
│   │   ├── app.js               # 一覧ページ
│   │   ├── footer.js            # 共通(変更なし)
│   │   └── store.web.js         # 保存層: localStorage 実装
│   └── data/passages/*.json     # 共通コンテンツ
├── app/                         # ローカルアプリ(GitHub Pages では配信されない)
│   ├── ui/
│   │   ├── index.html           # アプリ版の一覧(起動時に開く)
│   │   ├── reader.html          # アプリ版のリーダー
│   │   └── js/store.native.js   # 保存層: Swift 実装
│   ├── src/main.swift
│   └── build.sh                 # swiftc + .app 生成
└── scripts/                     # 既存(変更なし)
```

`app/ui/reader.html` は `../../docs/js/...` を相対参照する。Swiftはリポジトリ
ルートを `app://` のルートとして扱うため、この参照は解決できる。

## 5. 保存層のインターフェース

エンジンが依存する唯一の口。読み込まれた実装がこれを提供する。

```js
window.Store = {
  // 1回分の解答を記録する
  async saveAttempt(attempt),
  // 指定パッセージの履歴を新しい順で返す(無ければ空配列)
  async loadAttempts(passageId),
};
```

`attempt` の形:

```json
{
  "passageId": "passage_001",
  "score": 4,
  "total": 5,
  "elapsedSec": 499,
  "answers": ["B", "A", "A", "C", "D"],
  "finishedAt": "2026-08-11T09:12:33Z"
}
```

現行の `results.<id>` は `date` を日付のみで持つが、履歴を時系列で並べるには
時刻が要るため `finishedAt` をISO 8601に変更する。

### 5.1 `store.web.js`(公開版)

現行の挙動をそのまま包む。`saveAttempt` は `results.<passageId>` を上書きし、
`loadAttempts` はそこに1件あれば長さ1の配列として返す。
**利用者から見た挙動は現在と変わらない。** 一覧ページのバッジも従来どおり出る。

### 5.1.1 一覧ページのリンク先も構成で決める

`app.js` は現在 `reader.html?id=...` を直書きしているが、アプリ版の一覧は
`app/ui/reader.html` へ飛ばす必要がある。ここも実行時分岐にせず、
**HTMLが定数を定義してから `app.js` を読み込む**形にする。

```html
<!-- docs/index.html -->
<script>window.READER_URL = "reader.html";</script>
<script src="js/app.js"></script>
```
```html
<!-- app/ui/index.html -->
<script>window.READER_URL = "reader.html";</script>
<script src="../../docs/js/app.js"></script>
```

`app.js` は `window.READER_URL` を使ってリンクを組み立てる。両者とも同一
ディレクトリの `reader.html` を指すため値は同じだが、**参照の基準が
それぞれのHTMLの位置になる**ため、同じコードで別のリーダーへ飛ぶ。

### 5.2 `store.native.js`(アプリ版)

```js
window.Store = {
  async saveAttempt(attempt) {
    return window.webkit.messageHandlers.store.postMessage(
      { action: "saveAttempt", attempt }
    );
  },
  async loadAttempts(passageId) {
    return window.webkit.messageHandlers.store.postMessage(
      { action: "loadAttempts", passageId }
    );
  },
};
```

Swift側が `attempts.jsonl` に1行追記する。既存行は読み書きしない。

## 6. ネイティブアプリ(app/src/main.swift)

責務は3つだけ。学習ロジックは一切持たない。

**1. ウィンドウとWKWebViewの生成** — 起動時に `app://local/app/ui/index.html`
(アプリ版の一覧)を読み込む。

**2. `app://` の解決** — `WKURLSchemeHandler` を実装し、要求パスをリポジトリ
ルートからの相対パスとして解決してファイルを返す。拡張子から MIME 型を決める
(html / js / css / json / m4a / mp3 / png)。リポジトリルートの外へ出る
パス(`..` を含むもの)は拒否する。ファイルが無ければ404相当で失敗させる。

**3. 保存の受け付け** — `WKScriptMessageHandlerWithReply` を `store` という名前で
登録する。`saveAttempt` は `~/Documents/TOEFLReading/attempts.jsonl` へ1行追記し、
`loadAttempts` は同ファイルを読んで該当 `passageId` の行を新しい順で返す。
ディレクトリが無ければ作成する。書き込みに失敗した場合はJS側のPromiseを
reject し、画面にエラーを表示できるようにする。

リポジトリルートの決定: 実行ファイルは
`<repo>/app/build/TOEFLReading.app/Contents/MacOS/TOEFLReading` に置かれるため、
実行ファイルのあるディレクトリから5階層上がリポジトリルートになる
(`MacOS` → `Contents` → `TOEFLReading.app` → `build` → `app` → repo root)。
環境変数 `TOEFL_REPO_ROOT` が設定されていればそれを優先する。
解決したルートに `docs/data/index.json` が存在しなければ、その旨を
ウィンドウに表示して終了する(黙って空白の画面を出さない)。

## 7. ビルドと起動

`app/build.sh` が行うこと:

```sh
swiftc -O app/src/main.swift -o app/build/TOEFLReading.app/Contents/MacOS/TOEFLReading
```
に加えて `Info.plist` の配置と `.app` ディレクトリ構造の作成。
パッケージマネージャ・署名・Xcodeプロジェクトは使わない。

生成物 `app/build/TOEFLReading.app` は `.gitignore` に加える
(`app/src` と `app/ui` と `build.sh` はコミットする)。

アイコンはこの区切りでは用意せず、システム既定のままとする。

## 8. この区切りの範囲

### 含むもの

- `docs/js/reader.js` `docs/js/vocab.js` `docs/js/app.js` から localStorage への
  直接アクセスを取り除き、`window.Store` 経由にする
  (ファイル名は変更しない。保存層が分離できれば改名の必要はないため)
- `app.js` のリンク先を `window.READER_URL` から取るようにする
- `store.web.js` / `store.native.js` の2実装
- `app/src/main.swift`、`app/ui/index.html`、`app/ui/reader.html`、`app/build.sh`
- 公開版の挙動が変わらないことの確認

### 含まないもの(後続の区切りで扱う)

- リスニング・スピーキング・ライティング
- 振り返り・復習のUI
- 録音とその保存
- Whisper / Ollama 連携
- アプリアイコン(システム既定のまま)
- 解説モードのアプリ版(この区切りでは解答モードのみ動けばよい)

## 9. 検証方法

| 確認したいこと | 方法 |
|---|---|
| ビルドが通る | `app/build.sh` が `.app` を生成する |
| 自分のウィンドウで表示される | アプリを起動し、ブラウザを介さずUIが出ることを目視 |
| ディスクから読んでいる | パッセージJSONを1件追加し、**再ビルドせずに**起動して出ることを確認 |
| 履歴が追記される | 同じパッセージを2回解き、`attempts.jsonl` が2行になることを確認 |
| 上書きされない | 1行目の内容が2回目の解答後も変わっていないことを確認 |
| リポジトリ外を読めない | `app://local/../../etc/passwd` 相当の要求が拒否されることを確認 |
| 公開版が壊れていない | 既存テスト(Python 17件 / JS 4件)が通り、3ページが200を返し、一覧のバッジが従来どおり出る |

## 10. 明示しておく制約

- **macOS専用。** WKWebViewとswiftcに依存するため、他OSでは動かない
- **署名しないため**、他人へ配布するとGatekeeperに阻まれる。個人利用を前提とする
- **データはブラウザと共有されない。** 公開版で解いた記録はアプリに引き継がれない
- アプリはリポジトリの位置に依存する。リポジトリを移動した場合は再ビルドが要る
