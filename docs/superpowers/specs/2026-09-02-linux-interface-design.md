> **失効**: 本ドキュメントは
> [`2026-09-03-cross-platform-shell-design.md`](./2026-09-03-cross-platform-shell-design.md)
> に統合され、`app-linux/` という個別crateの計画は撤回された。以下は
> 経緯として残すのみで、実装の根拠として参照しないこと。

# Linux版ネイティブインターフェース設計

日付: 2026-09-02

## 背景

macOS版アプリ(`app/`)はSwift + WKWebViewで実装されている。
`app://` スキームハンドラで `docs/`・`app/ui/` 配下のHTML/JS/JSONを配信し、
`WKScriptMessageHandlerWithReply` でJS↔Swiftの以下7つのブリッジを提供する:

- `store` / `listening`: 読解・リスニングの解答ログ(JSONL追記)
- `essays`: ライティングの下書き・採点結果ログ(JSONL追記)
- `grader`: `claude -p` を起動してエッセイを採点
- `anki`: AnkiConnectへのHTTPリクエストの代理(CORS回避のため)
- `dictionary`: macOS Core Servicesの辞書引き(OS依存)
- `speech`: AVSpeechSynthesizerによる音声合成(OS依存)

ロジック部分(`PathResolver`, `JSONLinesLog`, `AnkiClient`, `ByteRange`,
`ClaudeRunner`, `ContentSchemeHandler`, `GradeHandler`)は既に `core/`
というRust crateへ移植済みで、`content_scheme.rs` は
「呼び出し側(Tauriのプロトコルハンドラ等)がこれをそのままHTTPレスポンスに
変換する」ことを想定したAPIになっている。

本設計は、この `core` crateを使ってLinux向けのネイティブGUIシェルを
新規に実装する方針を定める。

## スコープ

**含む**:
- `app-linux/` という新規Rust bin crateの作成(`tao` + `wry`)
- `app://` / `audio://` カスタムプロトコルハンドラの実装
- JS↔Rust IPCブリッジ(store/listening/essays/grader/anki)の実装
- Linux版専用の `*.linux.js` ブリッジファイル(`app/ui/js/`)
- `app/ui/index.html` からLinux版ブリッジを読み込むための分岐

**含まない(別タスク)**:
- `dictionary`・`speech` の実機能実装(今回はプレースホルダーのみ)
- macOS版のビルド・配布フローの変更
- Linux版のパッケージング(deb/AppImage等)

## アーキテクチャ

### クレート配置

`app/`(Swift/macOS版)と並列に `app-linux/` を新設する。`core/` を
依存として参照するRust bin crate。GUI依存(`wry`/`tao`)を `core/` に
混ぜないことで、macOS版・Linux版のビルド境界を明確に保つ。

```
app-linux/
  Cargo.toml       # core への path 依存 + tao + wry
  src/
    main.rs        # ウィンドウ生成、webview構築、起動時パス解決
    content.rs      # app:// / audio:// カスタムプロトコルの薄いラッパー
    ipc.rs          # JSON IPCディスパッチ(store/listening/essays/grader/anki)
```

### コンテンツ配信(`app://` / `audio://`)

wryの `with_custom_protocol("app", handler)` /
`with_custom_protocol("audio", handler)` を使う。ハンドラは
リクエストパスと `Range` ヘッダを取り出し、
`core::content_scheme::build_content_response(root, path, range_header)`
を呼んで `ContentResponse { status, headers, body }` を受け取り、
そのまま `http::Response` に詰め替えるだけ。ルート脱出防止・Range処理は
`core` 側で完結しているため、`app-linux` 側にロジックは書かない。

- `app://` のroot: リポジトリルート
- `audio://` のroot: `<データディレクトリ>/audio`

### IPC(JS ↔ Rust)

wryの `ipc_handler` はJSからの一方向メッセージ(戻り値なし)しか
受け取れない。macOS版の `window.webkit.messageHandlers.X.postMessage()`
はPromiseを返す前提でJSが書かれているため、Linux版では以下の
リクエスト/レスポンス相関の仕組みをJS・Rust両側に用意する。

**JS側(`app/ui/js/*.linux.js`)**:
- `window.__toeflIpc.call(handler, payload)` という共通関数を用意
  - `requestId` を採番し、`pending` Mapに `{resolve, reject}` を保持
  - `window.ipc.postMessage(JSON.stringify({handler, requestId, ...payload}))`
  - 戻り値は `pending` に積んだPromiseを返す
- `window.__toeflIpcResolve(requestId, result, error)` をグローバルに公開し、
  Rust側からの `evaluate_script` 呼び出しで解決する
- `store.linux.js` / `essays.linux.js` / `grader.linux.js` / `anki.linux.js`
  は、既存の `*.native.js` と同じ `window.Store` / `window.AnkiBridge` 等の
  インターフェースを、この共通関数を使って実装する
  (既存の `*.native.js` は変更しない — macOS版は無改変)

**Rust側(`app-linux/src/ipc.rs`)**:
- `ipc_handler` で受けたJSON文字列をパースし、`handler` フィールドで
  `store` / `listening` / `essays` / `grader` / `anki` に振り分け
- store/listening/essays: `core::jsonlines_log::JsonLinesFile` をラップ
  (`loadAll` / `saveAttempt` / `saveEssay` / `saveGrade`)
- grader/anki: 別スレッド(`std::thread::spawn` または簡易ワーカースレッド)
  で実行し、メインスレッド(UIスレッド)をブロックしない
  - grader → `core::grade::grade_essay`
  - anki → `core::anki_client::AnkiClient::request`
- 処理完了後、UIスレッドに戻して
  `webview.evaluate_script("window.__toeflIpcResolve(...)")` で結果を返す
- dictionary/speechハンドラは常に `error` を返すプレースホルダーとして
  `handler` の振り分けに含めておく(JS側の `dict.native.js` /
  `speech.native.js` 相当は、Linux版では常にnull/失敗を返す最小実装)

### UI配信・ブリッジ切り替え

`app/ui/index.html` はmacOS版・Linux版で共有する。`*.native.js` 群
(macOS版)と `*.linux.js` 群(Linux版)のどちらを読み込むかは、
`index.html` 内で実行時にホストを判定するか、`app-linux` 起動時に
`app://local/app/ui/index.html?platform=linux` のようなクエリを付けて
`index.html` 側の `<script>` 挿入を分岐させる。詳細な切り替え方式は
実装計画フェーズで確定する。

### データディレクトリ

macOS版は `~/Documents/TOEFLReading` を使う。Linux版はXDG Base
Directoryに従い `~/.local/share/toefl-reading` を既定値とする
(環境変数での上書きは `TOEFL_REPO_ROOT` に加え、必要なら
`TOEFL_DATA_DIR` 相当を検討)。

### dictionary / speech

今回はスコープ外。Linux版では常に「利用不可」を返すプレースホルダー
ハンドラのみ用意し、UIは辞書引き・音声合成なしで動作する
(公開サイト版の `dict.web.js` が常にnullを返すのと同じ扱い)。
将来的に espeak-ng 等での代替を別タスクとして検討する。

## エラーハンドリング

- カスタムプロトコルでファイルが見つからない/読めない → `core` 側が
  `None` を返すので、`app-linux` は404相当のレスポンスを組み立てる
- IPCハンドラでJSONパース失敗・フィールド欠落 → `requestId` があれば
  `__toeflIpcResolve(requestId, null, "エラーメッセージ")` で返す。
  `requestId` すら取れない壊れたメッセージは無視してログに残す
- grader/ankiの例外・タイムアウトは `Result` として捕捉し、
  日本語メッセージにして `error` 引数で返す(macOS版のフォーマットに揃える)

## テスト方針

- `core` 側は既存のユニットテストで十分カバーされている想定
  (`content_scheme.rs`, `jsonlines_log.rs`, `grade.rs`, `anki_client.rs` 等)
- `app-linux/src/ipc.rs` はJSON振り分けロジックが新規コードなので、
  「不正なJSON」「未知のhandler」「正常系の振り分け」を対象に
  最小限のユニットテストを書く(実際のwebview起動は結合できないため対象外)
- webview起動を伴う結合確認は手動(`cargo run` でウィンドウを開き、
  読解1問を解いて保存・Anki追加・採点が動くことを目視確認)

## 未確定事項(実装計画フェーズで詰める)

- `index.html` でのLinux/macOS判定方法の具体的な実装
- データディレクトリの環境変数上書きの命名
- `app-linux` のビルドスクリプト(`build.sh` 相当)の要否
