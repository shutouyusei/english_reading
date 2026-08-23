import Foundation
import WebKit

/// JS からの Anki 要求を AnkiClient へ渡すだけの橋渡し。
///
/// `GradeHandler` と同じく直列キューで捌く。要求の形の検査はメインスレッドで即座に行い、
/// 通信だけを逃がす。通信中にメインスレッドを塞ぐと、Anki の応答を待つ間 UI が固まる。
final class AnkiHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let client: AnkiClient
    private let queue = DispatchQueue(label: "local.toefl.anki", qos: .userInitiated)

    init(client: AnkiClient = AnkiClient()) {
        self.client = client
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "要求の形式が不正です")
            return
        }
        guard action == "request" else {
            replyHandler(nil, "未知の action: \(action)")
            return
        }
        guard let ankiAction = body["ankiAction"] as? String, !ankiAction.isEmpty else {
            replyHandler(nil, "ankiAction が含まれていません")
            return
        }
        // params は省略可。AnkiConnect は空のオブジェクトを受け付ける。
        let params = body["params"] as? [String: Any] ?? [:]

        let client = self.client
        queue.async {
            do {
                let result = try client.request(action: ankiAction, params: params)
                DispatchQueue.main.async {
                    // JS 側で「結果なし」と「エラー」を区別できるよう、常にキーを置く。
                    replyHandler(["result": result ?? NSNull()], nil)
                }
            } catch {
                DispatchQueue.main.async {
                    replyHandler(nil, error.localizedDescription)
                }
            }
        }
    }
}
