import Foundation
import WebKit

/// 採点(claude -p を起動する)。
final class GradeHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let root: URL
    /// 採点は十数秒かかる。メインスレッドで走らせると画面が固まる。
    private let queue = DispatchQueue(label: "local.toefl.grade", qos: .userInitiated)

    init(root: URL) {
        self.root = root
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any],
              body["action"] as? String == "grade",
              let promptId = body["promptId"] as? String,
              let promptType = body["promptType"] as? String,
              let essayText = body["essayText"] as? String else {
            replyHandler(nil, "採点要求の形式が不正です")
            return
        }
        queue.async {
            let outcome = self.grade(promptId: promptId, promptType: promptType,
                                     essayText: essayText)
            DispatchQueue.main.async {
                switch outcome {
                case .success(let grade): replyHandler(grade, nil)
                case .failure(let error): replyHandler(nil, error.japaneseMessage)
                }
            }
        }
    }

    private func grade(promptId: String, promptType: String,
                       essayText: String) -> Result<[String: Any], ClaudeRunnerError> {
        guard let binary = resolveClaudeBinary() else { return .failure(.binaryNotFound) }

        // promptId は JS から来るため、リポジトリ外や docs/data/writing の外を
        // 指せないことを resolveContentPath 経由の writingPromptPath で確かめる。
        guard let promptPath = writingPromptPath(root: root, promptId: promptId) else {
            return .failure(.launchFailed("問題ID \"\(promptId)\" のパスが不正です"))
        }
        let templateName = promptType == "discussion" ? "grade-discussion" : "grade-email"
        let templatePath = root.appendingPathComponent("app/prompts/\(templateName).md")

        guard let promptData = try? Data(contentsOf: promptPath),
              let prompt = (try? JSONSerialization.jsonObject(with: promptData)) as? [String: Any],
              let templateText = try? String(contentsOf: templatePath, encoding: .utf8),
              let parts = splitPromptFile(templateText) else {
            return .failure(.launchFailed("問題または採点プロンプトを読み込めません"))
        }

        let userPrompt = renderTemplate(parts.user, values: [
            "instructions": prompt["instructions"] as? String ?? "",
            "situation": prompt["situation"] as? String ?? "",
            "recipient": prompt["recipient"] as? String ?? "",
            "must_include": (prompt["must_include"] as? [String])?.joined(separator: "\n") ?? "",
            "discussion": Self.describeDiscussion(prompt["discussion"]),
            "essay": essayText,
        ])

        let started = Date()
        return runClaude(binary: binary, systemPrompt: parts.system, userPrompt: userPrompt)
            .map { grade in
                var enriched = grade
                enriched["runnerMs"] = Int(Date().timeIntervalSince(started) * 1000)
                return enriched
            }
    }

    /// ディスカッションの投稿群を、そのままプロンプトに貼れる平文にする。
    private static func describeDiscussion(_ value: Any?) -> String {
        guard let discussion = value as? [String: Any] else { return "" }
        var lines: [String] = []
        if let professor = discussion["professor_post"] as? [String: Any] {
            lines.append("\(professor["name"] as? String ?? "Professor"):")
            lines.append(professor["text"] as? String ?? "")
        }
        for post in (discussion["student_posts"] as? [[String: Any]]) ?? [] {
            lines.append("")
            lines.append("\(post["name"] as? String ?? "Student"):")
            lines.append(post["text"] as? String ?? "")
        }
        return lines.joined(separator: "\n")
    }
}
