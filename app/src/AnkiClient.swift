import Foundation

/// Anki への追加が失敗した理由。画面にそのまま出せる日本語を持たせる。
///
/// 「繋がらない」を一括りにしないのが要点。ブラウザの fetch はネットワーク不達も
/// CORS 拒否も同じ "Load failed" にしてしまい、利用者にも作者にも原因が分からなかった。
enum AnkiError: Error, LocalizedError {
    /// 接続そのものができない。Anki が起動していないか AnkiConnect が入っていない。
    case notRunning
    /// 繋がったが Anki 側がエラーを返した。文言は Anki のものをそのまま渡す。
    case ankiReported(String)
    /// 繋がったが応答を解釈できない。AnkiConnect 以外が同じポートを使っている場合など。
    case unreadableResponse(String)
    /// HTTP のステータスが 200 でない。
    case badStatus(Int)

    var errorDescription: String? {
        switch self {
        case .notRunning:
            return "Anki に接続できません。Anki を起動し、AnkiConnect アドオンが有効か確認してください"
        case .ankiReported(let message):
            return "Anki がエラーを返しました: \(message)"
        case .unreadableResponse(let detail):
            return "Anki の応答を解釈できません: \(detail)"
        case .badStatus(let code):
            return "Anki が異常な応答を返しました(HTTP \(code))"
        }
    }
}

/// AnkiConnect の HTTP API を叩く。
///
/// ネイティブ側で通信するのは、WKWebView から直接 fetch すると CORS で弾かれるため。
/// ページの出自は app://local になり、AnkiConnect はその出自を許可リストに持たないので
/// Access-Control-Allow-Origin を返さず、応答がページに渡らない。
/// ネイティブコードには同一生成元ポリシーが無いので、この経路なら設定に依存しない。
final class AnkiClient {
    private let endpoint: URL
    private let timeout: TimeInterval

    init(endpoint: URL = URL(string: "http://127.0.0.1:8765")!, timeout: TimeInterval = 10) {
        self.endpoint = endpoint
        self.timeout = timeout
    }

    /// 呼び出し側のスレッドを塞いで待つ。重いので必ずメインスレッド以外から呼ぶこと。
    func request(action: String, params: [String: Any]) throws -> Any? {
        var body: Data
        do {
            body = try JSONSerialization.data(
                withJSONObject: ["action": action, "version": 6, "params": params])
        } catch {
            throw AnkiError.unreadableResponse("要求を組み立てられません: \(error.localizedDescription)")
        }

        var request = URLRequest(url: endpoint, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var data: Data?
        var response: URLResponse?
        var transportError: Error?
        let semaphore = DispatchSemaphore(value: 0)
        // 完了ハンドラは URLSession 内部のキューで走るため、ここで待っても行き詰まらない。
        URLSession.shared.dataTask(with: request) { d, r, e in
            data = d; response = r; transportError = e
            semaphore.signal()
        }.resume()
        semaphore.wait()

        if transportError != nil {
            // 接続拒否もタイムアウトも、利用者にとっては「Anki が居ない」で同じ。
            throw AnkiError.notRunning
        }
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw AnkiError.badStatus(http.statusCode)
        }
        guard let data = data else {
            throw AnkiError.unreadableResponse("応答が空です")
        }
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let payload = object as? [String: Any] else {
            let head = String(data: data.prefix(60), encoding: .utf8) ?? "(読めないバイト列)"
            throw AnkiError.unreadableResponse(head)
        }
        // AnkiConnect は成功時も error キーを null で返す。null と文字列を区別する。
        if let message = payload["error"] as? String, !message.isEmpty {
            throw AnkiError.ankiReported(message)
        }
        return payload["result"]
    }
}
