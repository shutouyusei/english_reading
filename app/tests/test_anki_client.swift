import Foundation

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
    for s in text.unicodeScalars {
        switch s.value {
        case 0x3040...0x309F, 0x30A0...0x30FF, 0x4E00...0x9FFF: return true
        default: continue
        }
    }
    return false
}

/// AnkiConnect の代役を python3 で立てる。実際の HTTP をやり取りするため、
/// URLSession とヘッダの扱いまで含めて確かめられる。
/// mode によって「正常」「Anki 側がエラーを返す」「壊れた応答」を切り替える。
func startStubServer(port: Int, mode: String) -> Process? {
    let script = """
    import http.server, json, sys
    MODE = sys.argv[1]
    class H(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n).decode())
            if MODE == "ok":
                out = json.dumps({"result": {"echo": req.get("action")}, "error": None}).encode()
            elif MODE == "anki_error":
                out = json.dumps({"result": None, "error": "deck not found"}).encode()
            else:
                out = b"not json at all"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
        def log_message(self, *a): pass
    http.server.HTTPServer(("127.0.0.1", \(port)), H).serve_forever()
    """
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = ["python3", "-c", script, mode]
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    Thread.sleep(forTimeInterval: 1.0)   // 起動を待つ
    return p
}

func endpoint(_ port: Int) -> URL { URL(string: "http://127.0.0.1:\(port)")! }

@main
struct TestAnkiClient {
    static func main() {
        // 1. 正常系: result がそのまま返る
        if let server = startStubServer(port: 18765, mode: "ok") {
            defer { server.terminate() }
            let client = AnkiClient(endpoint: endpoint(18765), timeout: 5)
            do {
                let result = try client.request(action: "version", params: [:])
                let dict = result as? [String: Any]
                check("正常な応答から result を取り出せる",
                      dict?["echo"] as? String == "version", "\(result ?? "nil")")
            } catch {
                check("正常な応答から result を取り出せる", false, "\(error)")
            }
        } else {
            check("代役サーバを起動できる(正常系)", false)
        }

        // 2. 核心: Anki が動いていないことを、他の失敗と区別して伝える
        //    使われていないポートへ投げれば接続拒否になる
        let offline = AnkiClient(endpoint: endpoint(18799), timeout: 3)
        do {
            _ = try offline.request(action: "version", params: [:])
            check("Anki が起動していなければ失敗する", false, "例外が投げられなかった")
        } catch let error as AnkiError {
            check("Anki が起動していなければ失敗する", true)
            if case .notRunning = error {
                check("接続できない場合は notRunning として区別される", true)
            } else {
                check("接続できない場合は notRunning として区別される", false, "\(error)")
            }
            check("notRunning の説明が日本語である",
                  containsJapanese(error.localizedDescription), error.localizedDescription)
        } catch {
            check("Anki が起動していなければ失敗する", false, "AnkiError 以外: \(error)")
        }

        // 3. Anki 側が error を返したら、その文言をそのまま伝える
        if let server = startStubServer(port: 18766, mode: "anki_error") {
            defer { server.terminate() }
            let client = AnkiClient(endpoint: endpoint(18766), timeout: 5)
            do {
                _ = try client.request(action: "addNote", params: [:])
                check("Anki が返したエラーを失敗として扱う", false, "例外が投げられなかった")
            } catch let error as AnkiError {
                if case .ankiReported(let message) = error {
                    check("Anki が返したエラーを失敗として扱う", true)
                    check("Anki の文言をそのまま保持する", message == "deck not found", message)
                } else {
                    check("Anki が返したエラーを失敗として扱う", false, "\(error)")
                }
            } catch {
                check("Anki が返したエラーを失敗として扱う", false, "AnkiError 以外: \(error)")
            }
        } else {
            check("代役サーバを起動できる(エラー系)", false)
        }

        // 4. 壊れた応答は notRunning と混同せず、別のエラーにする
        if let server = startStubServer(port: 18767, mode: "garbage") {
            defer { server.terminate() }
            let client = AnkiClient(endpoint: endpoint(18767), timeout: 5)
            do {
                _ = try client.request(action: "version", params: [:])
                check("JSON でない応答を失敗として扱う", false, "例外が投げられなかった")
            } catch let error as AnkiError {
                if case .unreadableResponse = error {
                    check("JSON でない応答を失敗として扱う", true)
                } else {
                    check("JSON でない応答を失敗として扱う", false, "\(error)")
                }
            } catch {
                check("JSON でない応答を失敗として扱う", false, "AnkiError 以外: \(error)")
            }
        } else {
            check("代役サーバを起動できる(壊れた応答)", false)
        }

        // 5. すべてのエラーに日本語の説明がある(ClaudeRunner / SpeechError と同じ作法)
        let all: [AnkiError] = [.notRunning, .ankiReported("x"),
                                .unreadableResponse("x"), .badStatus(500)]
        for e in all {
            check("エラーに日本語の説明がある: \(e)",
                  containsJapanese(e.localizedDescription), e.localizedDescription)
        }

        exit(failures == 0 ? 0 : 1)
    }
}
