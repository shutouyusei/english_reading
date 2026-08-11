import Cocoa
import WebKit

// アプリの起動から一覧描画までを、ウィンドウを出さずに通しで確かめる煙試験。
//
// 単体テストでは捕まえられない層を対象にする。実際に一度、
// 素の URLResponse を返していたために fetch() のステータスが 0 になり
// (HTMLパーサ経由の CSS/JS 読み込みは成功するので気づけない)、
// 一覧だけが描画されない不具合が本番に入った。ここはその再発を防ぐ。
//
// 実行にはリポジトリルートを環境変数 REPO で渡す。

let repoRoot = URL(fileURLWithPath: ProcessInfo.processInfo.environment["REPO"] ?? ".")
    .standardizedFileURL

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)\(detail.isEmpty ? "" : "  (\(detail))")")
        failures += 1
    }
}

/// 本番の ContentSchemeHandler と同じ応答の組み立て方をする。
/// ここが本番と食い違うと試験の意味が無くなるため、変更時は main.swift と揃えること。
final class SmokeSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    private static let mimeTypes: [String: String] = [
        "html": "text/html", "js": "text/javascript", "css": "text/css",
        "json": "application/json", "png": "image/png", "svg": "image/svg+xml",
        "ico": "image/x-icon", "m4a": "audio/mp4", "mp3": "audio/mpeg",
    ]
    private(set) var servedPaths: [String] = []

    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let path = task.request.url?.path ?? ""
        guard let file = resolveContentPath(root: root, requestPath: path),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: "smoke", code: 404))
            return
        }
        let mime = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        guard let response = HTTPURLResponse(
            url: task.request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "\(mime); charset=utf-8"]
        ) else {
            task.didFailWithError(NSError(domain: "smoke", code: 500))
            return
        }
        servedPaths.append(path)
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Swift 側の保存を模す。実ファイルには触れない。
final class SmokeStoreStub: NSObject, WKScriptMessageHandlerWithReply {
    private(set) var savedAttempts: [[String: Any]] = []

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "不正な要求")
            return
        }
        switch action {
        case "loadAll":
            replyHandler(savedAttempts, nil)
        case "saveAttempt":
            if let attempt = body["attempt"] as? [String: Any] { savedAttempts.append(attempt) }
            replyHandler(nil, nil)
        default:
            replyHandler(nil, "未知の action")
        }
    }
}

final class SmokeDelegate: NSObject, NSApplicationDelegate {
    private var webView: WKWebView!
    private var handler: SmokeSchemeHandler!
    private var store: SmokeStoreStub!

    func applicationDidFinishLaunching(_ notification: Notification) {
        handler = SmokeSchemeHandler(root: repoRoot)
        store = SmokeStoreStub()

        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(handler, forURLScheme: "app")
        configuration.userContentController.addScriptMessageHandler(
            store, contentWorld: .page, name: "store")

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800),
                            configuration: configuration)
        webView.load(URLRequest(url: URL(string: "app://local/app/ui/index.html")!))

        // 読み込み完了を待ってから確認する
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.verify() }
        // 何かが固まっても試験が終わらなくならないようにする
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
            print("FAIL - 制限時間内に完了しなかった")
            exit(1)
        }
    }

    private func verify() {
        let expectedCards = passageCountOnDisk()

        webView.evaluateJavaScript("document.querySelectorAll('.card').length") { result, error in
            let count = (result as? Int) ?? -1
            check("一覧のカードが描画される", count > 0,
                  "カード数=\(count) error=\(error?.localizedDescription ?? "なし")")
            check("カード数がディスク上のパッセージ数と一致する", count == expectedCards,
                  "描画=\(count) ディスク=\(expectedCards)")

            self.webView.evaluateJavaScript(
                "document.querySelector('#passage-list').textContent"
            ) { text, _ in
                let body = (text as? String) ?? ""
                check("エラー文言が表示されていない",
                      !body.contains("読み込めませんでした") && !body.contains("読み込み中"),
                      body.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60).description)

                self.webView.evaluateJavaScript(
                    "typeof window.Store + '|' + typeof window.READER_URL + '|' + typeof window.DATA_BASE"
                ) { kinds, _ in
                    check("合成定数と保存層が揃っている",
                          (kinds as? String) == "object|string|string", "\(kinds ?? "?")")
                    check("index.json がスキーム経由で配信された",
                          self.handler.servedPaths.contains("/docs/data/index.json"),
                          self.handler.servedPaths.joined(separator: ", "))
                    exit(failures == 0 ? 0 : 1)
                }
            }
        }
    }

    private func passageCountOnDisk() -> Int {
        let indexPath = repoRoot.appendingPathComponent("docs/data/index.json")
        guard let data = try? Data(contentsOf: indexPath),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let passages = object["passages"] as? [[String: Any]] else { return -1 }
        return passages.count
    }
}

// swiftc は main.swift 以外でトップレベルの実行文を許さないため @main を使う
// (test_path_resolver.swift / test_attempts_log.swift と同じ形)
@main
struct SmokeApp {
    static func main() {
        let application = NSApplication.shared
        let smokeDelegate = SmokeDelegate()
        application.delegate = smokeDelegate
        application.setActivationPolicy(.accessory)   // ウィンドウもDockアイコンも出さない
        application.run()
    }
}
