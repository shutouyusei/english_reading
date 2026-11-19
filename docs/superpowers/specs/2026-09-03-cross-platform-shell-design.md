# クロスプラットフォーム・ネイティブシェル設計

日付: 2026-09-03

このドキュメントは `docs/superpowers/specs/2026-09-02-linux-interface-design.md`
(Linux版ネイティブインターフェース設計)を置き換える。Linux専用crateだった
`app-linux/` の計画を、macOS・Linux・(設計のみ)Windowsを1つのRust crateで
カバーする方針に一般化する。**2026-09-02のドキュメントは本設計に統合され失効する。**

## 背景

macOS版アプリ(`app/`)はSwift + WKWebViewで実装されている。ロジック部分
(`PathResolver`, `JSONLinesLog`, `AnkiClient`, `ByteRange`, `ClaudeRunner`,
`ContentSchemeHandler`, `GradeHandler`)は既に `core/` というRust crateへ
移植済みで、`content_scheme.rs` は「呼び出し側がこれをそのままHTTPレスポンスに
変換する」ことを想定したAPIになっている。

`core/` のロジックはOS非依存であり、GUIシェル側も `tao`(ウィンドウ生成) +
`wry`(WebView、macOSはWKWebView・LinuxはWebKitGTK・WindowsはWebView2を
裏で使い分ける)というクロスプラットフォームスタックを使えば、ウィンドウ生成・
カスタムプロトコル・IPCディスパッチのコードはOS分岐なしで共有できる。
分岐が必要になるのはデータディレクトリの既定パスのみである。

このため、macOS版のSwift実装をやめてRust一本化し、同じ `app-shell/` crateで
Linux版・(将来的に)Windows版もカバーする方針とする。

## スコープ

**含む**:
- `app-shell/` という新規Rust bin crateの作成(`tao` + `wry`)。`core/` への
  path依存。macOS向けにビルド・動作確認する
- `app://` / `audio://` カスタムプロトコルハンドラの実装
- JS↔Rust IPCブリッジ(store/listening/essays/grader/anki)の実装
- `dictionary`/`speech` は常に失敗を返すプレースホルダー実装(全OS共通)
- `app/ui/js/*.native.js` を新しいIPC方式(リクエスト/レスポンス相関)に
  書き直す(Swift版・旧Linux版で想定していた `*.linux.js` は作らない —
  1系統のブリッジが全OSで動くため)
- `platform.rs` でのOS別データディレクトリ既定値(`#[cfg(target_os)]`)
- Windows向けの `#[cfg(target_os = "windows")]` 分岐はコード上に用意するが、
  この開発環境ではビルド・動作確認しない(設計のみ)
- 既存Swift版(`app/`)の削除(macOS上でapp-shellが機能的に同等になった後)

**含まない(別タスク)**:
- `dictionary`・`speech` の実機能実装(将来、必要になった時点で
  `objc`/`cocoa` バインディング等を検討)
- Linux版・Windows版のパッケージング(deb/AppImage/msi等)
- Windows版の実機ビルド・動作確認(このマシンでは不可能)

## アーキテクチャ

### クレート配置

```
app-shell/
  Cargo.toml       # core への path 依存 + tao + wry
  src/
    main.rs        # ウィンドウ生成、webview構築、起動時パス解決
    content.rs      # app:// / audio:// カスタムプロトコルの薄いラッパー
    ipc.rs          # JSON IPCディスパッチ(store/listening/essays/grader/anki/dictionary/speech)
    platform.rs      # OS別データディレクトリ既定値のみ
```

`app/`(Swift/macOS版、削除予定)や個別の `app-linux/`・`app-macos/` のような
OS別crateには分割しない。dictionary/speechが全OSでプレースホルダーである
現状、OS固有ロジックはデータディレクトリのパスだけであり、`platform.rs`
内の `#[cfg(target_os)]` 分岐で十分カバーできる(YAGNI — OS固有ロジックが
増えた時点でcrate分割を再検討する)。

### コンテンツ配信(`app://` / `audio://`)

wryの `with_custom_protocol("app", handler)` /
`with_custom_protocol("audio", handler)` を使う。ハンドラは
リクエストパスと `Range` ヘッダを取り出し、
`core::content_scheme::build_content_response(root, path, range_header)`
を呼んで `ContentResponse { status, headers, body }` を受け取り、
そのまま `http::Response` に詰め替えるだけ。ルート脱出防止・Range処理は
`core` 側で完結しているため、`app-shell` 側にロジックは書かない。

- `app://` のroot: リポジトリルート(`TOEFL_REPO_ROOT` 環境変数で上書き可能。
  既存Swift版main.swiftの挙動を踏襲)
- `audio://` のroot: `<データディレクトリ>/audio`

### IPC(JS ↔ Rust)

wryの `ipc_handler` はJSからの一方向メッセージ(戻り値なし)しか
受け取れない。macOS版の `window.webkit.messageHandlers.X.postMessage()`
はPromiseを返す前提でJSが書かれているため、`app-shell` では以下の
リクエスト/レスポンス相関の仕組みをJS・Rust両側に用意する。

**JS側(`app/ui/js/*.native.js` を書き直す)**:
- `window.__toeflIpc.call(handler, payload)` という共通関数を用意
  - `requestId` を採番し、`pending` Mapに `{resolve, reject}` を保持
  - `window.ipc.postMessage(JSON.stringify({handler, requestId, ...payload}))`
  - 戻り値は `pending` に積んだPromiseを返す
- `window.__toeflIpcResolve(requestId, result, error)` をグローバルに公開し、
  Rust側からの `evaluate_script` 呼び出しで解決する
- `store.native.js` / `essays.native.js` / `grader.native.js` /
  `anki.native.js` は、既存と同じ `window.Store` / `window.AnkiBridge` 等の
  インターフェースを、この共通関数を使って実装し直す

**Rust側(`app-shell/src/ipc.rs`)**:
- `ipc_handler` で受けたJSON文字列をパースし、`handler` フィールドで
  `store` / `listening` / `essays` / `grader` / `anki` / `dictionary` /
  `speech` に振り分け
- store/listening/essays: `core::jsonlines_log::JsonLinesFile` をラップ
  (`loadAll` / `saveAttempt` / `saveEssay` / `saveGrade`)
- grader/anki: 別スレッド(`std::thread::spawn`)で実行し、メインスレッド
  (UIスレッド)をブロックしない
  - grader → `core::grade::grade_essay`
  - anki → `core::anki_client::AnkiClient::request`
- dictionary/speech: 常に `error` を返すプレースホルダー
- 処理完了後、UIスレッドに戻して
  `webview.evaluate_script("window.__toeflIpcResolve(...)")` で結果を返す

### データディレクトリ

`platform.rs` が `#[cfg(target_os)]` でOSごとの既定値を返す:

- macOS: `~/Documents/TOEFLReading`(既存Swift版と同じパス。既存ユーザー
  データをそのまま使える)
- Linux: `~/.local/share/toefl-reading`(XDG Base Directory準拠)
- Windows: `%APPDATA%\toefl-reading` (設計のみ、未検証)

`TOEFL_REPO_ROOT` によるリポジトリルート上書きは全OS共通。

### UI配信

`app/ui/index.html` は全OS共通の `*.native.js` を読み込む。旧Linux設計に
あった「`*.native.js` vs `*.linux.js` の実行時分岐」は不要になる
(1系統のRustシェルが全OSで同じIPCインターフェースを提供するため)。
公開サイト版(`*.web.js`、機能なしのフォールバック)との切り替えは既存の
仕組み(webビルド vs ネイティブアプリビルドでファイルを差し替え)を踏襲する。

## エラーハンドリング

- カスタムプロトコルでファイルが見つからない/読めない → `core` 側が
  `None` を返すので、`app-shell` は404相当のレスポンスを組み立てる
- IPCハンドラでJSONパース失敗・フィールド欠落 → `requestId` があれば
  `__toeflIpcResolve(requestId, null, "エラーメッセージ")` で返す。
  `requestId` すら取れない壊れたメッセージは無視してログに残す
- grader/ankiの例外・タイムアウトは `Result` として捕捉し、
  日本語メッセージにして `error` 引数で返す(既存Swift版のフォーマットに揃える)

## テスト方針

- `core` 側は既存のユニットテストで十分カバーされている
  (`content_scheme.rs`, `jsonlines_log.rs`, `grade.rs`, `anki_client.rs` 等、
  78テスト確認済み)
- `app-shell/src/ipc.rs` はJSON振り分けロジックが新規コードなので、
  「不正なJSON」「未知のhandler」「正常系の振り分け」を対象に
  最小限のユニットテストを書く(実際のwebview起動は結合できないため対象外)
- webview起動を伴う結合確認は手動(`cargo run` でウィンドウを開き、
  読解1問を解いて保存・Anki追加・採点が動くことを目視確認)。
  **この開発環境(macOS)ではmacOSビルドのみ実際に確認できる。Linux/Windows
  は `#[cfg(target_os)]` 分岐をコード上に用意するが、この環境ではビルド・
  動作確認しない**

## 移行

- `app/`(Swift版)は `app-shell/` がmacOS上で機能的に同等になった時点で
  削除する。Git履歴に残るため復元可能
- 削除の判断基準: 読解・リスニング・ライティングの解答保存、Anki追加、
  エッセイ採点が `app-shell` 版で一通り動作確認できること
  (dictionary/speechはプレースホルダーで良いためSwift版との機能比較対象外)

## 未確定事項(実装計画フェーズで詰める)

- `app-shell` のビルドスクリプト(`build.sh` 相当)の要否・内容
- `cargo run` 開発時と配布用ビルド(`.app` バンドル化)の分離方法
- Windows向け `#[cfg(target_os = "windows")]` コードの具体的な内容
  (この環境で検証できないため、コンパイルが通る形にとどめるか、
  実装自体を後回しにするかは実装計画で判断する)
