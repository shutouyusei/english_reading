import Foundation
import WebKit

/// JS から届いた要求の共通部分を取り出す。形が違えば nil。
private func messageAction(_ message: WKScriptMessage) -> (body: [String: Any], action: String)? {
    guard let body = message.body as? [String: Any],
          let action = body["action"] as? String else { return nil }
    return (body, action)
}

// MARK: - 学習データの保存(追記専用)

final class StoreHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let log: JSONLinesFile

    /// 保存先のファイル名を差し替えられるようにしてある。読解は attempts.jsonl、
    /// リスニングは listening.jsonl を使い、同じ実装を2つのインスタンスで共有する。
    init(dataDir: URL, filename: String = "attempts.jsonl") {
        self.log = JSONLinesFile(directory: dataDir, filename: filename)
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let (body, action) = messageAction(message) else {
            replyHandler(nil, "要求の形式が不正です")
            return
        }
        switch action {
        case "loadAll":
            replyHandler(log.loadAll(), nil)
        case "saveAttempt":
            guard let attempt = body["attempt"] as? [String: Any] else {
                replyHandler(nil, "attempt が含まれていません")
                return
            }
            do {
                try log.append(attempt)
                replyHandler(nil, nil)
            } catch {
                replyHandler(nil, "書き込みに失敗しました: \(error.localizedDescription)")
            }
        default:
            replyHandler(nil, "未知の action: \(action)")
        }
    }
}

// MARK: - ライティングの保存(追記専用)

final class EssaysHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let log: JSONLinesFile

    init(dataDir: URL) {
        self.log = JSONLinesFile(directory: dataDir, filename: "essays.jsonl")
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let (body, action) = messageAction(message) else {
            replyHandler(nil, "要求の形式が不正です")
            return
        }
        switch action {
        case "loadAll":
            replyHandler(log.loadAll(), nil)
        case "saveEssay":
            save(body["essay"], kind: "essay", replyHandler: replyHandler)
        case "saveGrade":
            save(body["grade"], kind: "grade", replyHandler: replyHandler)
        default:
            replyHandler(nil, "未知の action: \(action)")
        }
    }

    /// 行の種別は Swift 側で付ける。JS から渡させると付け忘れが起きうる。
    private func save(_ payload: Any?, kind: String,
                      replyHandler: @escaping (Any?, String?) -> Void) {
        guard var row = payload as? [String: Any] else {
            replyHandler(nil, "\(kind) の中身が含まれていません")
            return
        }
        row["kind"] = kind
        do {
            try log.append(row)
            replyHandler(nil, nil)
        } catch {
            replyHandler(nil, "書き込みに失敗しました: \(error.localizedDescription)")
        }
    }
}
