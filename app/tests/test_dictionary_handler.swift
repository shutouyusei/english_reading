import Cocoa
import WebKit

// DictionaryHandler を実際の WKWebView 越しに呼ぶ結合試験。
// JS からの postMessage が Swift の辞書引きに届き、期待した形で返るかを見る。
// SystemDictionary 単体の正しさは test_system_dictionary.swift が担当する。

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)\(detail.isEmpty ? "" : "  (\(detail))")")
        failures += 1
    }
}

func containsJapanese(_ text: String) -> Bool {
    for scalar in text.unicodeScalars {
        switch scalar.value {
        case 0x3040...0x309F, 0x30A0...0x30FF, 0x4E00...0x9FFF: return true
        default: continue
        }
    }
    return false
}

final class HandlerTestDelegate: NSObject, NSApplicationDelegate {
    private var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(
            DictionaryHandler(), contentWorld: .page, name: "dictionary")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 300),
                            configuration: configuration)
        webView.loadHTMLString("<meta charset='utf-8'><p>test</p>", baseURL: nil)

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.runChecks() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
            print("FAIL - 制限時間内に完了しなかった")
            exit(1)
        }
    }

    /// JS を1本走らせて結果の文字列を受け取る。
    private func run(_ body: String, _ done: @escaping (String) -> Void) {
        webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): done((value as? String) ?? "文字列以外が返った")
            case .failure(let error): done("JSエラー: \(error.localizedDescription)")
            }
        }
    }

    private func runChecks() {
        // 1. 収録語を引くと日本語の定義が返る
        run("""
            const r = await window.webkit.messageHandlers.dictionary.postMessage(
                { action: "define", word: "negligible" });
            return JSON.stringify(r);
            """) { json in
            check("収録語の定義が JS まで届く", json.contains("\"definition\""), json.prefix(80).description)
            check("定義が日本語である(英和が使われている)", containsJapanese(json), json.prefix(80).description)
            check("どの辞書を使ったかが source で分かる", json.contains("ウィズダム"), json.prefix(120).description)

            // 2. 辞書に無い語は definition が null。JS 側は Weblio へ誘導する。
            self.run("""
                const r = await window.webkit.messageHandlers.dictionary.postMessage(
                    { action: "define", word: "zzzqqqxyzabc" });
                return JSON.stringify(r);
                """) { json in
                check("辞書に無い語は definition が null で返る",
                      json.contains("\"definition\":null"), json.prefix(80).description)

                // 3. 活用形をそのまま渡せる(本文の見た目のまま引ける)
                self.run("""
                    const r = await window.webkit.messageHandlers.dictionary.postMessage(
                        { action: "define", word: "flourishes" });
                    return r.definition === null ? "null" : r.definition;
                    """) { text in
                    check("活用形 flourishes をそのまま引ける",
                          text.lowercased().contains("flourish"), text.prefix(60).description)
                    self.runErrorChecks()
                }
            }
        }
    }

    private func runErrorChecks() {
        // 4. 未知の action は握りつぶさずエラーにする
        run("""
            try {
                await window.webkit.messageHandlers.dictionary.postMessage({ action: "bogus" });
                return "エラーにならなかった";
            } catch (e) { return "エラー: " + e.message; }
            """) { text in
            check("未知の action はエラーとして返る", text.hasPrefix("エラー:"), text.prefix(60).description)

            // 5. word が無い要求もエラー
            self.run("""
                try {
                    await window.webkit.messageHandlers.dictionary.postMessage({ action: "define" });
                    return "エラーにならなかった";
                } catch (e) { return "エラー: " + e.message; }
                """) { text in
                check("word の無い define はエラーとして返る",
                      text.hasPrefix("エラー:"), text.prefix(60).description)
                exit(failures == 0 ? 0 : 1)
            }
        }
    }
}

@main
struct DictionaryHandlerTest {
    static func main() {
        let application = NSApplication.shared
        let delegate = HandlerTestDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}
