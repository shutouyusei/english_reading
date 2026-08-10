# ローカルアプリの土台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存のリーディングUIを、自分のウィンドウで表示しディスクからパッセージを読み、解答履歴を追記専用のファイルに保存するmacOSネイティブアプリを作る。

**Architecture:** 保存層を `window.Store` という共通の口に切り出し、公開版は `store.web.js`(localStorage)、アプリ版は `store.native.js`(Swift経由でファイル)を読み込む。どちらを読み込むかはHTMLが決めるため、エンジン側に実行時分岐は無い。アプリはSwift + WKWebViewで、`app://` スキームをSwiftが処理してリポジトリのファイルを返す。

**Tech Stack:** Swift(swiftc 単体・Xcodeプロジェクト無し)、WKWebView、Vanilla JS、Python 3.13(既存スクリプト)。npm / Rust / Electron / パッケージマネージャは使わない。

**Spec:** `docs/superpowers/specs/2026-08-11-local-app-shell-design.md`

## Global Constraints

- `docs/` 以下は静的ファイルのみ。ビルドツール・npm・外部CDN・外部ライブラリ禁止
- サイト内リンク・fetchは相対パス(AnkiConnectへのPOSTのみ既存の例外)
- 機能差を実行時の `if` で表現しない。読み込むスクリプトで決める
- localStorageアクセスは try/catch で包む
- UIテキストは日本語
- JSテスト実行: `node --test "tests/js/**/*.test.js"`(`node --test tests/js/` はNode 25で壊れる)
- Pythonテスト実行: `python3 -m unittest discover -s tests/python`
- Swiftテスト実行: `bash app/tests/run.sh`
- 公開版(GitHub Pages)の利用者から見た挙動を変えない
- 学習データの保存先: `~/Documents/TOEFLReading/`、解答履歴は `attempts.jsonl`(追記専用)
- コミットは Conventional Commits、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- ローカル確認用サーバー: `python3 -m http.server 8000 -d docs`(ポート8765はAnkiConnectが使うため禁止)

## 保存層インターフェース(全タスク共通)

`window.Store` は以下を提供する。`init()` のみ非同期で、読み出しは同期。
既存の描画コードが同期前提で書かれているため、この形にする。

```
Store.init()                  -> Promise<void>   ページ開始時に一度だけ呼ぶ
Store.attempts(passageId)     -> Attempt[]       新しい順。無ければ []
Store.latest(passageId)       -> Attempt | null  attempts(id)[0]
Store.saveAttempt(attempt)    -> Promise<void>   失敗時は reject
```

`Attempt` の形:

```json
{
  "passageId": "passage_001",
  "score": 4,
  "total": 5,
  "elapsedSec": 499,
  "answers": ["B", "A", "A", "C", "D"],
  "finishedAt": "2026-08-11T09:12:33.000Z"
}
```

---

### Task 1: 保存層(公開版)`store.web.js`

**Files:**
- Create: `docs/js/store.web.js`
- Test: `tests/js/store.web.test.js`

**Interfaces:**
- Produces: `window.Store`(`init`/`attempts`/`latest`/`saveAttempt`)。Task 2 が全ての呼び出し側から使う

- [ ] **Step 1: 失敗するテストを書く**

`tests/js/store.web.test.js`:

```javascript
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// store.web.js はブラウザ用の classic script なので、
// localStorage と window を用意してから読み込む
function loadStore() {
  const mem = new Map();
  global.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  global.window = {};
  delete require.cache[require.resolve("../../docs/js/store.web.js")];
  require("../../docs/js/store.web.js");
  return { Store: global.window.Store, mem };
}

const ATTEMPT = {
  passageId: "passage_001",
  score: 4,
  total: 5,
  elapsedSec: 499,
  answers: ["B", "A", "A", "C", "D"],
  finishedAt: "2026-08-11T09:12:33.000Z",
};

test("保存前は空配列と null を返す", async () => {
  const { Store } = loadStore();
  await Store.init();
  assert.deepEqual(Store.attempts("passage_001"), []);
  assert.equal(Store.latest("passage_001"), null);
});

test("保存した内容を読み出せる", async () => {
  const { Store } = loadStore();
  await Store.init();
  await Store.saveAttempt(ATTEMPT);
  assert.deepEqual(Store.attempts("passage_001"), [ATTEMPT]);
  assert.deepEqual(Store.latest("passage_001"), ATTEMPT);
});

test("公開版は最新の1件だけを保持する", async () => {
  const { Store } = loadStore();
  await Store.init();
  await Store.saveAttempt(ATTEMPT);
  const second = { ...ATTEMPT, score: 5, finishedAt: "2026-08-12T00:00:00.000Z" };
  await Store.saveAttempt(second);
  assert.equal(Store.attempts("passage_001").length, 1);
  assert.deepEqual(Store.latest("passage_001"), second);
});

test("パッセージごとに独立している", async () => {
  const { Store } = loadStore();
  await Store.init();
  await Store.saveAttempt(ATTEMPT);
  assert.equal(Store.latest("passage_002"), null);
});

test("壊れたJSONが入っていても落ちない", async () => {
  const { Store, mem } = loadStore();
  mem.set("results.passage_001", "{ぐちゃぐちゃ");
  await Store.init();
  assert.deepEqual(Store.attempts("passage_001"), []);
});

test("localStorage が例外を投げても保存呼び出しは reject しない", async () => {
  const { Store } = loadStore();
  global.localStorage.setItem = () => { throw new Error("QuotaExceeded"); };
  await Store.init();
  await Store.saveAttempt(ATTEMPT);   // ここで throw しなければ成功
  assert.equal(Store.latest("passage_001").score, 4);  // メモリ上には反映される
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test "tests/js/**/*.test.js"`
Expected: FAIL(`Cannot find module '../../docs/js/store.web.js'`)

- [ ] **Step 3: 実装を書く**

`docs/js/store.web.js`:

```javascript
"use strict";

/* 保存層(公開版)。localStorage に最新の1件だけを保持する。
   エンジンはこのファイルの存在を知らず、window.Store の口だけを使う。 */

const STORE_PREFIX = "results.";
const _memory = new Map();

function _readStored(passageId) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + passageId);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved && typeof saved === "object" ? saved : null;
  } catch (_) {
    return null;
  }
}

window.Store = {
  async init() {
    _memory.clear();
  },
  attempts(passageId) {
    if (_memory.has(passageId)) return _memory.get(passageId);
    const stored = _readStored(passageId);
    return stored ? [stored] : [];
  },
  latest(passageId) {
    return this.attempts(passageId)[0] || null;
  },
  async saveAttempt(attempt) {
    try {
      localStorage.setItem(
        STORE_PREFIX + attempt.passageId,
        JSON.stringify(attempt)
      );
    } catch (_) { /* プライベートモード等では保存しない */ }
    _memory.set(attempt.passageId, [attempt]);
  },
};

if (typeof module !== "undefined") {
  module.exports = window.Store;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test "tests/js/**/*.test.js"`
Expected: 10 tests pass(既存4件 + 新規6件)、fail 0

- [ ] **Step 5: Commit**

```bash
git add docs/js/store.web.js tests/js/store.web.test.js
git commit -m "feat: add web storage layer behind a common Store interface"
```

---

### Task 2: 呼び出し側を Store 経由にする

**Files:**
- Modify: `docs/js/reader.js`(finishSolve の保存、init の先頭)
- Modify: `docs/js/app.js`(loadResult の廃止、READER_URL 化、init の先頭)
- Modify: `docs/js/vocab.js`(loadStudyResult の廃止)
- Modify: `docs/index.html`(script 追加、READER_URL 定義)
- Modify: `docs/reader.html`(script 追加)

**Interfaces:**
- Consumes: `window.Store`(Task 1)
- Produces: `window.READER_URL`(HTMLが定義し `app.js` が読む)。Task 5 のアプリ版HTMLも同じ規約に従う

- [ ] **Step 1: `docs/js/reader.js` の保存処理を差し替える**

`finishSolve` 内の以下のブロックを:

```javascript
  const result = {
    solved: true,
    score,
    total: questions.length,
    elapsedSec: sec,
    answers: state.answers,
    date: new Date().toISOString().slice(0, 10),
  };
  try {
    localStorage.setItem(`results.${state.passage.id}`, JSON.stringify(result));
  } catch (_) { /* プライベートモード等では保存しない */ }
```

次に置き換える:

```javascript
  const attempt = {
    passageId: state.passage.id,
    score,
    total: questions.length,
    elapsedSec: sec,
    answers: state.answers,
    finishedAt: new Date().toISOString(),
  };
  Store.saveAttempt(attempt).catch((err) => {
    qs("#header-status").textContent = `⚠ 保存に失敗しました: ${err.message}`;
  });
```

- [ ] **Step 2: `docs/js/reader.js` の init で Store を初期化する**

`async function init() {` の直後の行に次を挿入する(`const params = ...` より前):

```javascript
  await Store.init();
```

- [ ] **Step 3: `docs/js/app.js` を Store と READER_URL に対応させる**

`initList` の `const container = ...` の次の行に挿入:

```javascript
  await Store.init();
```

`cardHtml` の先頭 `const result = loadResult(meta.id);` を次に変更:

```javascript
  const result = Store.latest(meta.id);
```

`cardHtml` の2つのリンクを次に変更:

```javascript
        <a class="button primary" href="${window.READER_URL}?id=${meta.id}&mode=solve">✏️ 問題を解く</a>
        <a class="button" href="${window.READER_URL}?id=${meta.id}&mode=study">📖 解説モードで読む</a>
```

`loadResult` 関数(定義全体)を削除する:

```javascript
function loadResult(id) {
  try {
    return JSON.parse(localStorage.getItem(`results.${id}`));
  } catch (_) {
    return null;
  }
}
```

- [ ] **Step 4: `docs/js/vocab.js` を Store に対応させる**

`renderPanel` 内の `const result = loadStudyResult(passage.id);` を次に変更:

```javascript
  const result = Store.latest(passage.id);
```

`loadStudyResult` 関数(定義全体)を削除する:

```javascript
function loadStudyResult(id) {
  try {
    return JSON.parse(localStorage.getItem(`results.${id}`));
  } catch (_) {
    return null;
  }
}
```

- [ ] **Step 5: `docs/index.html` の script 部を差し替える**

```html
  <script src="js/textmatch.js"></script>
  <script src="js/footer.js"></script>
  <script src="js/store.web.js"></script>
  <script>window.READER_URL = "reader.html";</script>
  <script src="js/app.js"></script>
```

- [ ] **Step 6: `docs/reader.html` の script 部を差し替える**

```html
  <script src="js/textmatch.js"></script>
  <script src="js/footer.js"></script>
  <script src="js/store.web.js"></script>
  <script src="js/anki.js"></script>
  <script src="js/vocab.js"></script>
  <script src="js/reader.js"></script>
```

- [ ] **Step 7: 構文確認とテスト**

```bash
for f in docs/js/*.js; do node --check "$f" || echo "NG: $f"; done
node --test "tests/js/**/*.test.js" 2>&1 | grep -E "^ℹ (pass|fail)"
grep -c "localStorage" docs/js/app.js docs/js/vocab.js docs/js/reader.js
```

Expected: 構文エラーなし、10 pass / 0 fail、3ファイルとも `localStorage` の出現が **0**
(保存層以外から localStorage が消えたことの確認)

- [ ] **Step 8: 公開版の挙動が変わっていないことをブラウザで確認**

```bash
python3 -m http.server 8000 -d docs &
sleep 1
curl -sfo /dev/null -w 'index: %{http_code}\n' http://localhost:8000/
curl -sfo /dev/null -w 'reader: %{http_code}\n' http://localhost:8000/reader.html
```

Expected: どちらも 200。続いてブラウザで http://localhost:8000/ を開き、次を目視で確認する:
1. パッセージ一覧が5件出る
2. 「問題を解く」で解答モードに入り、5問解くと採点結果が出る
3. 一覧に戻るとそのパッセージにスコアのバッジが出る
4. 解説モードの「問題の解説」タブに自分の回答と正誤が出る

ブラウザを操作できない場合は、その旨を報告に明記すること(推測で「確認した」と書かない)。

- [ ] **Step 9: Commit**

```bash
git add docs/js/reader.js docs/js/app.js docs/js/vocab.js docs/index.html docs/reader.html
git commit -m "refactor: route all attempt persistence through the Store interface"
```

---

### Task 3: Swift のパス解決(TDD)

**Files:**
- Create: `app/src/PathResolver.swift`
- Create: `app/tests/test_path_resolver.swift`
- Create: `app/tests/run.sh`

**Interfaces:**
- Produces: `resolveContentPath(root: URL, requestPath: String) -> URL?`。Task 4 の `ContentSchemeHandler` が使う

- [ ] **Step 1: 失敗するテストを書く**

`app/tests/test_path_resolver.swift`:

```swift
import Foundation

var failures = 0

func check(_ name: String, _ condition: Bool) {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)")
        failures += 1
    }
}

let root = URL(fileURLWithPath: "/tmp/repo")

check("通常のパスを解決する",
      resolveContentPath(root: root, requestPath: "/docs/index.html")?.path
      == "/tmp/repo/docs/index.html")

check("先頭スラッシュが無くても解決する",
      resolveContentPath(root: root, requestPath: "docs/index.html")?.path
      == "/tmp/repo/docs/index.html")

check("ルート自身は許可する",
      resolveContentPath(root: root, requestPath: "/")?.path == "/tmp/repo")

check("親ディレクトリへの脱出を拒否する",
      resolveContentPath(root: root, requestPath: "/../etc/passwd") == nil)

check("途中に含まれる .. も拒否する",
      resolveContentPath(root: root, requestPath: "/docs/../../etc/passwd") == nil)

check("ルートと接頭辞が同じ別ディレクトリを拒否する",
      resolveContentPath(root: root, requestPath: "/../repo-evil/secret.txt") == nil)

check("ルート内で .. を使って戻る分には許可する",
      resolveContentPath(root: root, requestPath: "/app/ui/../../docs/index.html")?.path
      == "/tmp/repo/docs/index.html")

exit(failures == 0 ? 0 : 1)
```

`app/tests/run.sh`:

```sh
#!/bin/sh
# Swift のユニットテスト。ソースとテストを1つの実行ファイルにまとめてビルドする。
set -e
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)/test_path_resolver
swiftc -O app/src/PathResolver.swift app/tests/test_path_resolver.swift -o "$OUT"
"$OUT"
echo "Swift tests: all passed"
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
chmod +x app/tests/run.sh
bash app/tests/run.sh
```

Expected: FAIL(`cannot find 'resolveContentPath' in scope`)

- [ ] **Step 3: 実装を書く**

`app/src/PathResolver.swift`:

```swift
import Foundation

/// app:// への要求パスを、リポジトリルート配下の実ファイルへ解決する。
/// ルートの外を指す場合は nil を返す(ディレクトリ脱出の防止)。
func resolveContentPath(root: URL, requestPath: String) -> URL? {
    let relative = requestPath.hasPrefix("/") ? String(requestPath.dropFirst()) : requestPath
    let rootStandardized = root.standardizedFileURL
    let target = rootStandardized.appendingPathComponent(relative).standardizedFileURL

    let rootPath = rootStandardized.path
    let targetPath = target.path
    guard targetPath == rootPath || targetPath.hasPrefix(rootPath + "/") else {
        return nil
    }
    return target
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
bash app/tests/run.sh
```

Expected: 7件すべて `ok`、最後に `Swift tests: all passed`

- [ ] **Step 5: Commit**

```bash
git add app/src/PathResolver.swift app/tests/test_path_resolver.swift app/tests/run.sh
git commit -m "feat: add path resolver for the app content scheme"
```

---

### Task 4: Swift アプリ本体

**Files:**
- Create: `app/src/main.swift`
- Modify: `.gitignore`(`app/build/` を追加)

**Interfaces:**
- Consumes: `resolveContentPath(root:requestPath:)`(Task 3)
- Produces: `app://` スキームでリポジトリのファイルを返す WKWebView アプリ。
  JS からは `window.webkit.messageHandlers.store.postMessage({action, ...})` を受け付ける。
  `action: "loadAll"` は `[[String: Any]]` を返し、`action: "saveAttempt"` は
  `attempts.jsonl` に1行追記して `nil` を返す。Task 5 の `store.native.js` が呼ぶ

- [ ] **Step 1: `app/src/main.swift` を書く**

```swift
import Cocoa
import WebKit

// MARK: - リポジトリルートの決定

/// 実行ファイルは <repo>/app/build/TOEFLReading.app/Contents/MacOS/TOEFLReading に置かれる。
/// そこから5階層上がリポジトリルート。環境変数があればそちらを優先する。
func repositoryRoot() -> URL {
    if let override = ProcessInfo.processInfo.environment["TOEFL_REPO_ROOT"], !override.isEmpty {
        return URL(fileURLWithPath: override).standardizedFileURL
    }
    var url = (Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0]))
        .resolvingSymlinksInPath()
        .deletingLastPathComponent()
    for _ in 0..<5 { url = url.deletingLastPathComponent() }
    return url.standardizedFileURL
}

// MARK: - コンテンツ配信(app:// を Swift が処理する)

final class ContentSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    private static let mimeTypes: [String: String] = [
        "html": "text/html", "js": "text/javascript", "css": "text/css",
        "json": "application/json", "png": "image/png", "svg": "image/svg+xml",
        "ico": "image/x-icon", "m4a": "audio/mp4", "mp3": "audio/mpeg",
    ]

    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let path = task.request.url?.path ?? ""
        guard let file = resolveContentPath(root: root, requestPath: path),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(
                domain: "TOEFLReading", code: 404,
                userInfo: [NSLocalizedDescriptionKey: "読み込めません: \(path)"]))
            return
        }
        let mime = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = URLResponse(url: task.request.url!, mimeType: mime,
                                   expectedContentLength: data.count, textEncodingName: "utf-8")
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// MARK: - 学習データの保存(追記専用)

final class StoreHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let dataDir: URL
    private var attemptsFile: URL { dataDir.appendingPathComponent("attempts.jsonl") }

    init(dataDir: URL) {
        self.dataDir = dataDir
        super.init()
        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true)
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "要求の形式が不正です")
            return
        }
        switch action {
        case "loadAll":
            replyHandler(loadAll(), nil)
        case "saveAttempt":
            guard let attempt = body["attempt"] as? [String: Any] else {
                replyHandler(nil, "attempt が含まれていません")
                return
            }
            do {
                try append(attempt)
                replyHandler(nil, nil)
            } catch {
                replyHandler(nil, "書き込みに失敗しました: \(error.localizedDescription)")
            }
        default:
            replyHandler(nil, "未知の action: \(action)")
        }
    }

    private func loadAll() -> [[String: Any]] {
        guard let text = try? String(contentsOf: attemptsFile, encoding: .utf8) else { return [] }
        return text.split(separator: "\n").compactMap { line in
            guard let data = line.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return nil }
            return object
        }
    }

    /// 既存行は一切読み書きせず、末尾に1行足すだけ。
    private func append(_ attempt: [String: Any]) throws {
        var line = try JSONSerialization.data(withJSONObject: attempt, options: [.sortedKeys])
        line.append(0x0A)
        if FileManager.default.fileExists(atPath: attemptsFile.path) {
            let handle = try FileHandle(forWritingTo: attemptsFile)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: line)
        } else {
            try line.write(to: attemptsFile)
        }
    }
}

// MARK: - アプリ

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let root = repositoryRoot()
        let dataDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents/TOEFLReading")

        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(ContentSchemeHandler(root: root), forURLScheme: "app")
        configuration.userContentController.addScriptMessageHandler(
            StoreHandler(dataDir: dataDir), contentWorld: .page, name: "store")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.autoresizingMask = [.width, .height]

        let indexJSON = root.appendingPathComponent("docs/data/index.json")
        if FileManager.default.fileExists(atPath: indexJSON.path) {
            webView.load(URLRequest(url: URL(string: "app://local/app/ui/index.html")!))
        } else {
            // 黙って空白を出さず、何が起きたかを画面に表示する
            let message = """
            <meta charset="utf-8">
            <div style="font-family:-apple-system,sans-serif;padding:40px;line-height:1.8">
            <h2>リポジトリを見つけられません</h2>
            <p>探した場所: <code>\(root.path)</code></p>
            <p><code>docs/data/index.json</code> が見つかりませんでした。
            アプリをリポジトリの外へ移動した場合は、環境変数
            <code>TOEFL_REPO_ROOT</code> にリポジトリのパスを設定して起動してください。</p>
            </div>
            """
            webView.loadHTMLString(message, baseURL: nil)
        }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "TOEFL Reading"
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
```

- [ ] **Step 2: `.gitignore` に生成物を追加する**

`.gitignore` の末尾に次の2行を足す:

```
app/build/
.DS_Store
```

(`.DS_Store` が既にある場合は `app/build/` のみ足す)

- [ ] **Step 3: コンパイルが通ることを確認**

```bash
swiftc -O app/src/PathResolver.swift app/src/main.swift -o /tmp/toefl-compile-check
ls -la /tmp/toefl-compile-check && echo "コンパイル成功"
bash app/tests/run.sh
```

Expected: 実行ファイルが生成され「コンパイル成功」、Swiftテスト7件も引き続き通る

- [ ] **Step 4: Commit**

```bash
git add app/src/main.swift .gitignore
git commit -m "feat: add native app shell with app:// scheme and attempt storage"
```

---

### Task 5: アプリ側のUI

**Files:**
- Create: `app/ui/index.html`
- Create: `app/ui/reader.html`
- Create: `app/ui/js/store.native.js`

**Interfaces:**
- Consumes: `window.webkit.messageHandlers.store`(Task 4)、`docs/js/` の共通エンジン(Task 2)
- Produces: `window.Store` のアプリ版実装と、アプリの2画面

- [ ] **Step 1: `app/ui/js/store.native.js` を書く**

```javascript
"use strict";

/* 保存層(アプリ版)。Swift 側が ~/Documents/TOEFLReading/attempts.jsonl に追記する。
   公開版の store.web.js と同じ口を提供するため、エンジン側の変更は不要。 */

const _attempts = new Map();

async function _callStore(payload) {
  return window.webkit.messageHandlers.store.postMessage(payload);
}

window.Store = {
  async init() {
    _attempts.clear();
    const all = await _callStore({ action: "loadAll" });
    for (const attempt of all || []) {
      const list = _attempts.get(attempt.passageId) || [];
      list.push(attempt);
      _attempts.set(attempt.passageId, list);
    }
    // 新しい順に並べる
    for (const list of _attempts.values()) {
      list.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    }
  },
  attempts(passageId) {
    return _attempts.get(passageId) || [];
  },
  latest(passageId) {
    return this.attempts(passageId)[0] || null;
  },
  async saveAttempt(attempt) {
    await _callStore({ action: "saveAttempt", attempt });
    const list = _attempts.get(attempt.passageId) || [];
    list.unshift(attempt);
    _attempts.set(attempt.passageId, list);
  },
};
```

- [ ] **Step 2: `app/ui/index.html` を書く**

公開版の `docs/index.html` と同じ構造だが、保存層とリンク先だけが違う。
共通のCSS・JSは `../../docs/` を相対参照する。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>TOEFL Reading</title>
  <link rel="stylesheet" href="../../docs/css/style.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="index.html">📖 TOEFL Reading</a>
    <span>ローカル版</span>
  </header>
  <main class="page">
    <p>解いた記録は <code>~/Documents/TOEFLReading/attempts.jsonl</code> に追記されます。</p>
    <div id="passage-list"><p class="hint">読み込み中…</p></div>
  </main>
  <footer class="site-footer">
    <p>⚠️ コンテンツは全てAI生成です ・ 作成者は英語の専門家ではありません ・ ETSおよびTOEFLとは無関係の非公式教材です</p>
  </footer>
  <script src="../../docs/js/textmatch.js"></script>
  <script src="../../docs/js/footer.js"></script>
  <script src="js/store.native.js"></script>
  <script>window.READER_URL = "reader.html";</script>
  <script src="../../docs/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: `app/ui/reader.html` を書く**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>リーダー — TOEFL Reading</title>
  <link rel="stylesheet" href="../../docs/css/style.css">
</head>
<body class="reader-page">
  <header class="site-header">
    <a class="brand" href="index.html">📖 TOEFL Reading</a>
    <span id="header-title"></span>
    <span id="header-status"></span>
  </header>
  <main id="reader-main">
    <section id="passage-pane"></section>
    <section id="right-pane"></section>
  </main>
  <footer class="site-footer">
    <p>⚠️ コンテンツは全てAI生成です ・ 作成者は英語の専門家ではありません ・ ETSおよびTOEFLとは無関係の非公式教材です</p>
  </footer>
  <div id="modal-root"></div>
  <script src="../../docs/js/textmatch.js"></script>
  <script src="../../docs/js/footer.js"></script>
  <script src="js/store.native.js"></script>
  <script src="../../docs/js/anki.js"></script>
  <script src="../../docs/js/vocab.js"></script>
  <script src="../../docs/js/reader.js"></script>
</body>
</html>
```

- [ ] **Step 4: データの取得パスが解決できることを確認**

`app.js` は `data/index.json` を、`reader.js` は `data/passages/<id>.json` を
**相対パス**で取りに行く。アプリ版のHTMLは `app/ui/` にあるため、このままでは
`app://local/app/ui/data/index.json` を見に行ってしまい解決できない。

`app/ui/index.html` の `<script>window.READER_URL = "reader.html";</script>` の行を、
次のブロックに**差し替える**:

```html
  <script>
    window.READER_URL = "reader.html";
    window.DATA_BASE = "../../docs/";
  </script>
```

`app/ui/reader.html` の `store.native.js` の**次**の行に足す:

```html
  <script>window.DATA_BASE = "../../docs/";</script>
```

そして `docs/js/app.js` の fetch を次に変更する:

```javascript
    const res = await fetch(`${window.DATA_BASE || ""}data/index.json`, { cache: "no-cache" });
```

`docs/js/reader.js` の fetch を次に変更する:

```javascript
    const res = await fetch(`${window.DATA_BASE || ""}data/passages/${id}.json`, { cache: "no-cache" });
```

`docs/index.html` と `docs/reader.html` では `window.DATA_BASE` を定義しないため
空文字となり、従来どおり相対パスのままになる。

- [ ] **Step 5: 公開版が壊れていないことを再確認**

```bash
for f in docs/js/*.js app/ui/js/*.js; do node --check "$f" || echo "NG: $f"; done
node --test "tests/js/**/*.test.js" 2>&1 | grep -E "^ℹ (pass|fail)"
python3 -m http.server 8000 -d docs &
sleep 1
curl -sf http://localhost:8000/data/index.json | python3 -c "import json,sys; print('公開版の一覧:', len(json.load(sys.stdin)['passages']), '件')"
```

Expected: 構文エラーなし、10 pass / 0 fail、一覧5件

- [ ] **Step 6: Commit**

```bash
git add app/ui docs/js/app.js docs/js/reader.js
git commit -m "feat: add app-side UI entries backed by native storage"
```

---

### Task 6: ビルドスクリプトと通しの検証

**Files:**
- Create: `app/build.sh`
- Modify: `README.md`(ローカルアプリの節を追加)

**Interfaces:**
- Consumes: Task 3〜5 の全成果物
- Produces: `app/build/TOEFLReading.app`(ダブルクリックで起動する macOS アプリ)

- [ ] **Step 1: `app/build.sh` を書く**

```sh
#!/bin/sh
# TOEFLReading.app をビルドする。Xcode プロジェクトも署名も使わない。
set -e
cd "$(dirname "$0")/.."

APP="app/build/TOEFLReading.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TOEFL Reading</string>
  <key>CFBundleDisplayName</key><string>TOEFL Reading</string>
  <key>CFBundleIdentifier</key><string>local.toefl.reading</string>
  <key>CFBundleExecutable</key><string>TOEFLReading</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

swiftc -O app/src/PathResolver.swift app/src/main.swift \
  -o "$APP/Contents/MacOS/TOEFLReading"

echo "ビルド完了: $APP"
echo "起動: open \"$APP\""
```

- [ ] **Step 2: ビルドしてテストが通ることを確認**

```bash
chmod +x app/build.sh
bash app/build.sh
bash app/tests/run.sh
ls -la app/build/TOEFLReading.app/Contents/MacOS/TOEFLReading
```

Expected: 「ビルド完了」と表示され、Swiftテスト7件が通り、実行ファイルが存在する

- [ ] **Step 3: 起動して通しで動作を確認する**

```bash
rm -f ~/Documents/TOEFLReading/attempts.jsonl   # 検証を清潔な状態から始める
open app/build/TOEFLReading.app
```

アプリのウィンドウで次を順に確認する。ブラウザは使わない。

1. **自分のウィンドウで表示される** — アドレスバーの無いウィンドウにパッセージ一覧が5件出る
2. **1本目を解く** — 「問題を解く」から5問回答し、採点結果が出る
3. **履歴が1行できる** — `cat ~/Documents/TOEFLReading/attempts.jsonl | wc -l` が `1`
4. **同じパッセージをもう一度解く** — 一覧に戻り、同じパッセージを再度解く
5. **追記されて上書きされない** — 行数が `2` になり、`head -1` の内容が手順3の時点と同一であること
6. **解説モードが動く** — 「解説モードで読む」で単語をクリックし解説が出る

```bash
wc -l < ~/Documents/TOEFLReading/attempts.jsonl
head -1 ~/Documents/TOEFLReading/attempts.jsonl
python3 -c "
import json, pathlib
p = pathlib.Path.home()/'Documents/TOEFLReading/attempts.jsonl'
rows = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
print('件数:', len(rows))
for r in rows:
    print(' ', r['passageId'], f\"{r['score']}/{r['total']}\", r['finishedAt'])
assert all(k in rows[0] for k in ['passageId','score','total','elapsedSec','answers','finishedAt'])
print('スキーマOK')
"
```

- [ ] **Step 4: 再ビルド無しでパッセージが増えることを確認**

```bash
python3 - <<'PY'
import json, pathlib, shutil
src = pathlib.Path("docs/data/passages/passage_001.json")
dst = pathlib.Path("docs/data/passages/passage_900.json")
d = json.loads(src.read_text(encoding="utf-8"))
d["id"] = "passage_900"; d["title"] = "ビルド不要の確認用"
dst.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
python3 scripts/update_index.py
```

アプリのウィンドウを再読み込み(Cmd+R が効かない場合は一度閉じて `open` し直す)し、
**再ビルドせずに**「ビルド不要の確認用」が一覧に出ることを確認する。

確認後、検証用データを消す:

```bash
rm docs/data/passages/passage_900.json
python3 scripts/update_index.py
git diff --stat docs/data/index.json   # 差分が無いこと
```

- [ ] **Step 5: ディレクトリ脱出が防げていることを確認**

Swiftのユニットテストで検証済みだが、実アプリでも確認する。アプリのウィンドウで
開発者メニューが無いため、次のコマンドでハンドラの挙動を間接的に確認する:

```bash
bash app/tests/run.sh | grep -E "拒否|ルート"
```

Expected: 「親ディレクトリへの脱出を拒否する」「途中に含まれる .. も拒否する」
「ルートと接頭辞が同じ別ディレクトリを拒否する」が全て `ok`

- [ ] **Step 6: 公開版が無傷であることを最終確認**

```bash
python3 -m unittest discover -s tests/python 2>&1 | tail -2
node --test "tests/js/**/*.test.js" 2>&1 | grep -E "^ℹ (pass|fail)"
python3 -m http.server 8000 -d docs &
sleep 1
for p in index.html reader.html guide.html; do
  curl -sfo /dev/null -w "$p: %{http_code}\n" "http://localhost:8000/$p"
done
```

Expected: Python 17件 OK、JS 10 pass / 0 fail、3ページとも 200

- [ ] **Step 7: README にローカルアプリの節を追加する**

`README.md` の「## テスト」節の**前**に次を挿入する:

```markdown
## ローカルアプリ(macOS)

リスニング・スピーキング等の学習機能を載せるための、ブラウザに依存しない
ネイティブアプリ。学習記録を実ファイルとして残す。

```bash
bash app/build.sh          # ビルド(swiftc のみ。npm も Xcode も不要)
open app/build/TOEFLReading.app
```

- 解答履歴は `~/Documents/TOEFLReading/attempts.jsonl` に**追記**される(上書きしない)
- パッセージは起動のたびにディスクから読むため、`/new-passage` で追加した分は
  **再ビルドせずに**反映される
- アプリはリポジトリの位置を実行ファイルからの相対で解決する。リポジトリを
  移動した場合は環境変数 `TOEFL_REPO_ROOT` を指定して起動する
- macOS 専用。署名していないため配布には向かない(個人利用を前提)

公開版(GitHub Pages)はリーディングのみで、保存はブラウザ内にとどまる。
```

そして「## テスト」節のコマンド一覧に次の行を足す:

```bash
bash app/tests/run.sh                              # Swift(パス解決)
```

- [ ] **Step 8: Commit**

```bash
git add app/build.sh README.md
git commit -m "feat: add build script and document the local app"
```
