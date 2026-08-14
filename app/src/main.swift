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

// MARK: - アプリ

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMainMenu()

        let root = repositoryRoot()
        let dataDir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents/TOEFLReading")

        let webView = WKWebView(frame: .zero, configuration: makeConfiguration(root: root,
                                                                               dataDir: dataDir))
        webView.autoresizingMask = [.width, .height]
        load(into: webView, root: root)

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

    /// app:// の配信と、JS から呼べる3つの窓口(store / essays / grader)を繋ぐ。
    private func makeConfiguration(root: URL, dataDir: URL) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(ContentSchemeHandler(root: root), forURLScheme: "app")
        configuration.userContentController.addScriptMessageHandler(
            StoreHandler(dataDir: dataDir), contentWorld: .page, name: "store")
        configuration.userContentController.addScriptMessageHandler(
            EssaysHandler(dataDir: dataDir), contentWorld: .page, name: "essays")
        configuration.userContentController.addScriptMessageHandler(
            GradeHandler(root: root), contentWorld: .page, name: "grader")
        return configuration
    }

    private func load(into webView: WKWebView, root: URL) {
        let indexJSON = root.appendingPathComponent("docs/data/index.json")
        guard FileManager.default.fileExists(atPath: indexJSON.path) else {
            // 黙って空白を出さず、何が起きたかを画面に表示する
            webView.loadHTMLString("""
            <meta charset="utf-8">
            <div style="font-family:-apple-system,sans-serif;padding:40px;line-height:1.8">
            <h2>リポジトリを見つけられません</h2>
            <p>探した場所: <code>\(root.path)</code></p>
            <p><code>docs/data/index.json</code> が見つかりませんでした。
            アプリをリポジトリの外へ移動した場合は、環境変数
            <code>TOEFL_REPO_ROOT</code> にリポジトリのパスを設定して起動してください。</p>
            </div>
            """, baseURL: nil)
            return
        }
        webView.load(URLRequest(url: URL(string: "app://local/app/ui/index.html")!))
    }

    private func installMainMenu() {
        let mainMenu = NSMenu()

        // アプリメニュー(⌘Q)
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "TOEFL Reading を終了",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // 編集メニュー(テキスト欄で ⌘C / ⌘V などを使えるようにする)
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "編集")
        editMenu.addItem(withTitle: "取り消す",
                         action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "やり直す",
                         action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "カット",
                         action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "コピー",
                         action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "ペースト",
                         action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "すべてを選択",
                         action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApp.mainMenu = mainMenu
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
