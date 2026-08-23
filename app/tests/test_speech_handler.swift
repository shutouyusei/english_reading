import Cocoa
import WebKit

var failures = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)\(detail.isEmpty ? "" : "  (\(detail))")")
        failures += 1
    }
}

let cacheDir = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("speech-handler-\(UUID().uuidString)")

final class HandlerDelegate: NSObject, NSApplicationDelegate {
    private var webView: WKWebView!
    private var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(
            ContentSchemeHandler(root: cacheDir), forURLScheme: "audio")
        configuration.userContentController.addScriptMessageHandler(
            SpeechHandler(synthesizer: SpeechSynthesizer(cacheDirectory: cacheDir)),
            contentWorld: .page, name: "speech")

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 300),
                            configuration: configuration)
        // loadHTMLString ではなく、audio:// スキーム越しに実ファイルとして読み込む。
        // <audio> の読み込みは fetch() と別経路(AVFoundation のリソースローダ)を通り、
        // loadHTMLString で作ったページ(実ネットワーク要求を経ていない)からは
        // カスタムスキームの <audio> が読み込めないことがある。本番の main.swift も
        // 常に webView.load(URLRequest) で実ページを読み込んでおり、ここも同じ形にする。
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        try? "<meta charset='utf-8'><p>test</p>".write(
            to: cacheDir.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
        webView.load(URLRequest(url: URL(string: "audio://local/index.html")!))
        // 窓に載っていない WKWebView は非表示扱いになり、メディアの読み込みが
        // 抑制されることがある(実測: <audio> が networkState=3 のまま進まない)。
        // 実機の main.swift は必ず窓に載せているので、ここでも合わせる。
        window = NSWindow(contentRect: NSRect(x: -4000, y: -4000, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = webView
        window.orderFront(nil)

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.verify() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
            print("FAIL - 制限時間内に完了しなかった")
            exit(1)
        }
    }

    private func run(_ body: String, _ done: @escaping (String) -> Void) {
        webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): done((value as? String) ?? "文字列以外が返った")
            case .failure(let error): done("JSエラー: \(error.localizedDescription)")
            }
        }
    }

    private func modificationDate(of url: URL) -> Date? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attributes?[.modificationDate] as? Date
    }

    private func verify() {
        run("""
            const r = await window.webkit.messageHandlers.speech.postMessage({
                action: "prepare", id: "listening_900",
                utterances: [{ voice: "Samantha", text: "Hello there, this is a test." }] });
            // audio:// スキームが実際に登録・配信されているかも合わせて確かめる。
            // ハンドラが返す URL の形だけでなく、その URL からファイルが読めることまで見る。
            const res = await fetch(r.url);
            return res.ok ? r.url : "取得できない";
            """) { url in
            check("prepare が audio://local/ の URL を返し、fetch で読み込める",
                  url.hasPrefix("audio://local/"), url)
            check("URL に id が入っている", url.contains("listening_900"), url)
            check("実ファイルが作られている",
                  FileManager.default.fileExists(
                    atPath: cacheDir.appendingPathComponent("listening_900.m4a").path))

            self.verifyAudioElementPlayable(url: url)
        }
    }

    /// fetch() は Range ヘッダを送らないため、<audio> だけが踏む経路を見逃す。
    /// 実際に <audio> へ読み込み、readyState/duration が音声を読めたことを
    /// 示す値になるかを確かめる。ここでの回帰は「音声が一切鳴らない」という
    /// 症状に直結するため、fetch() の確認とは別に必ず持っておく。
    private func verifyAudioElementPlayable(url: String) {
        let literal = url.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        run("""
            const a = new Audio();
            const done = new Promise((resolve) => {
                a.addEventListener("loadedmetadata", () => resolve("ok"));
                a.addEventListener("error", () => resolve("error:" + (a.error && a.error.code)));
                setTimeout(() => resolve("timeout"), 8000);
            });
            document.body.appendChild(a);
            a.src = "\(literal)";
            const outcome = await done;
            return outcome + "|readyState=" + a.readyState + "|duration=" + a.duration;
            """) { result in
            check("<audio> 要素が Range 要求越しに読み込める(fetch では検出できない経路)",
                  result.hasPrefix("ok|"), result)
            check("読み込み後、時間長が数値として読める(NaN ではない)",
                  result.contains("duration=") && !result.contains("duration=NaN"), result)

            // 2回目はキャッシュを返す(生成し直さない)。生成し直すと say と
            // AVFoundation の書き出しに数秒かかるため、更新日時だけでなく
            // 「短時間で応答が返ったか」でも作り直していないことを確かめる。
            let cached = cacheDir.appendingPathComponent("listening_900.m4a")
            let firstModified = self.modificationDate(of: cached)
            let secondStart = Date()
            self.run("""
                const r = await window.webkit.messageHandlers.speech.postMessage({
                    action: "prepare", id: "listening_900",
                    utterances: [{ voice: "Samantha", text: "Hello there, this is a test." }] });
                return r.url;
                """) { _ in
                let secondElapsed = Date().timeIntervalSince(secondStart)
                let secondModified = self.modificationDate(of: cached)
                check("2回目はキャッシュを使い、作り直さない", firstModified == secondModified)
                check("2回目は生成をやり直していないので速い(1秒未満)",
                      secondElapsed < 1.0, "elapsed=\(secondElapsed)")
                self.verifyForce(cached: cached, before: secondModified)
            }
        }
    }

    /// 壊れたキャッシュを作り直せること。force を付けたときだけ作り直す。
    private func verifyForce(cached: URL, before: Date?) {
        run("""
            const r = await window.webkit.messageHandlers.speech.postMessage({
                action: "prepare", id: "listening_900", force: true,
                utterances: [{ voice: "Samantha", text: "Hello there, this is a test." }] });
            return r.url;
            """) { url in
            check("force でも audio://local/ の URL を返す", url.hasPrefix("audio://local/"), url)
            let after = self.modificationDate(of: cached)
            check("force を付けるとキャッシュを作り直す", after != before,
                  "before=\(String(describing: before)) after=\(String(describing: after))")
            self.verifyErrors()
        }
    }

    private func verifyErrors() {
        run("""
            try {
                await window.webkit.messageHandlers.speech.postMessage({ action: "bogus" });
                return "エラーにならなかった";
            } catch (e) { return "エラー: " + e.message; }
            """) { text in
            check("未知の action はエラーになる", text.hasPrefix("エラー:"), text)

            self.run("""
                try {
                    await window.webkit.messageHandlers.speech.postMessage({
                        action: "prepare", id: "listening_901" });
                    return "エラーにならなかった";
                } catch (e) { return "エラー: " + e.message; }
                """) { text in
                check("utterances が無いとエラーになる", text.hasPrefix("エラー:"), text)

                self.run("""
                    try {
                        await window.webkit.messageHandlers.speech.postMessage({
                            action: "prepare", id: "../escape",
                            utterances: [{ voice: "Samantha", text: "x" }] });
                        return "エラーにならなかった";
                    } catch (e) { return "エラー: " + e.message; }
                    """) { text in
                    check("id にディレクトリ区切りが混ざるとエラーになる",
                          text.hasPrefix("エラー:"), text)
                    check("id のエラーはディレクトリ区切りを理由にしている(声の不在ではない)",
                          text.contains("id") || text.contains("不正"), text)
                    // ../escape というファイルがキャッシュの外(tmp直下)に作られていないことも確かめる。
                    // isSafeIdentifier を素通りしてしまうと、synthesize がここに書き込みうる。
                    let escaped = cacheDir.deletingLastPathComponent()
                        .appendingPathComponent("escape.m4a")
                    check("キャッシュの外にファイルが作られていない",
                          !FileManager.default.fileExists(atPath: escaped.path))
                    try? FileManager.default.removeItem(at: escaped)
                    self.verifyIdEdgeCases()
                }
            }
        }
    }

    /// 制約は `/`、`\`、`.`、`..`、空文字を名指しで禁止している。
    /// allowlist はどれも弾くはずだが、テストが固定していなければ回帰に気づけない。
    private func verifyIdEdgeCases() {
        checkRejectedId("") {
            self.checkRejectedId(".") {
                self.checkRejectedId("..") {
                    try? FileManager.default.removeItem(at: cacheDir)
                    exit(failures == 0 ? 0 : 1)
                }
            }
        }
    }

    private func checkRejectedId(_ id: String, then next: @escaping () -> Void) {
        let idLiteral = id.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        run("""
            try {
                await window.webkit.messageHandlers.speech.postMessage({
                    action: "prepare", id: "\(idLiteral)",
                    utterances: [{ voice: "Samantha", text: "x" }] });
                return "エラーにならなかった";
            } catch (e) { return "エラー: " + e.message; }
            """) { text in
            let label = id.isEmpty ? "(空文字)" : id
            check("id が \"\(label)\" だとエラーになる", text.hasPrefix("エラー:"), text)
            next()
        }
    }
}

@main
struct TestSpeechHandler {
    static func main() {
        let application = NSApplication.shared
        let delegate = HandlerDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}
