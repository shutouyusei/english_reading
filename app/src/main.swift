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
