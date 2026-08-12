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

@main
struct TestClaudeRunner {
    static func main() {
        testArguments()
        testBinaryResolution()
        testPromptFile()
        testTemplate()
        testExtraction()
        exit(failures == 0 ? 0 : 1)
    }

    /// 最重要の回帰防止。--tools "" が抜けると入力トークンが 73 倍になる。
    static func testArguments() {
        let args = claudeArguments(systemPrompt: "SYS")
        guard let toolsIndex = args.firstIndex(of: "--tools") else {
            check("引数に --tools がある", false, args.joined(separator: " "))
            return
        }
        check("引数に --tools がある", true)
        check("--tools の直後は空文字である(73倍問題の回帰防止)",
              toolsIndex + 1 < args.count && args[toolsIndex + 1] == "",
              args.joined(separator: "|"))
        check("--output-format json がある",
              args.contains("--output-format") && args.contains("json"))
        check("--strict-mcp-config がある", args.contains("--strict-mcp-config"))
        check("--setting-sources が空文字とともにある",
              args.firstIndex(of: "--setting-sources").map { $0 + 1 < args.count && args[$0 + 1] == "" } ?? false)
        check("システムプロンプトが渡される",
              args.firstIndex(of: "--system-prompt").map { $0 + 1 < args.count && args[$0 + 1] == "SYS" } ?? false)
        check("-p がある(プロンプト本体は標準入力で渡すので引数には載せない)",
              args.contains("-p"))
    }

    static func testBinaryResolution() {
        let candidates = ["/candidate/one/claude", "/candidate/two/claude"]

        let found = resolveClaudeBinary(
            environment: [:],
            fileExists: { $0 == "/candidate/two/claude" },
            candidates: candidates)
        check("候補から実在するものを選ぶ", found == "/candidate/two/claude", found ?? "nil")

        let overridden = resolveClaudeBinary(
            environment: ["TOEFL_CLAUDE_BIN": "/custom/claude"],
            fileExists: { $0 == "/custom/claude" || $0 == "/candidate/one/claude" },
            candidates: candidates)
        check("TOEFL_CLAUDE_BIN が候補より優先される",
              overridden == "/custom/claude", overridden ?? "nil")

        let badOverride = resolveClaudeBinary(
            environment: ["TOEFL_CLAUDE_BIN": "/missing/claude"],
            fileExists: { $0 == "/candidate/one/claude" },
            candidates: candidates)
        check("TOEFL_CLAUDE_BIN が実在しなければ黙って候補に落ちない",
              badOverride == nil, badOverride ?? "nil")

        let none = resolveClaudeBinary(
            environment: [:], fileExists: { _ in false }, candidates: candidates)
        check("どれも無ければ nil", none == nil, none ?? "nil")
    }

    static func testPromptFile() {
        let text = """
        You are a grader.
        Reply with JSON.
        ---
        ESSAY:
        {{essay}}
        """
        guard let parts = splitPromptFile(text) else {
            check("--- でシステム部とユーザー部に分かれる", false)
            return
        }
        check("--- でシステム部とユーザー部に分かれる", true)
        check("システム部が取れる", parts.system == "You are a grader.\nReply with JSON.", parts.system)
        check("ユーザー部が取れる", parts.user == "ESSAY:\n{{essay}}", parts.user)

        check("区切りが無ければ nil", splitPromptFile("no separator here") == nil)
        check("システム部が空なら nil", splitPromptFile("---\nonly user") == nil)
        check("ユーザー部が空なら nil", splitPromptFile("only system\n---") == nil)
    }

    static func testTemplate() {
        let rendered = renderTemplate(
            "A={{a}} B={{b}} A again={{a}}",
            values: ["a": "1", "b": "2"])
        check("同じキーが複数回あっても全て置換される",
              rendered == "A=1 B=2 A again=1", rendered)

        let withNewlines = renderTemplate("ESSAY:\n{{essay}}",
                                          values: ["essay": "line1\nline2"])
        check("改行を含む値を入れられる", withNewlines == "ESSAY:\nline1\nline2", withNewlines)

        let leftover = renderTemplate("keep {{known}} drop {{unknown}}",
                                      values: ["known": "X"])
        check("値の無いプレースホルダは消える", leftover == "keep X drop ", leftover)

        // 回帰テスト: 生徒のエッセイ本文に {{...}} 形の文字列が含まれていても、
        // それはテンプレートではなく置換された「値」なので消してはならない。
        let essayWithBraces = renderTemplate(
            "ESSAY:\n{{essay}}",
            values: ["essay": "I wrote {{example}} on the board by mistake."])
        check("エッセイ本文中の {{...}} 風の文字列は消されずに残る",
              essayWithBraces == "ESSAY:\nI wrote {{example}} on the board by mistake.",
              essayWithBraces)
    }

    static func testExtraction() {
        let plain = #"{"result":"{\"overall\":4}","is_error":false}"#
        switch extractGradeJSON(fromWrapper: Data(plain.utf8)) {
        case .success(let grade):
            check("素の JSON を取り出せる", grade["overall"] as? Int == 4, "\(grade)")
        case .failure(let error):
            check("素の JSON を取り出せる", false, "\(error)")
        }

        let fenced = #"{"result":"```json\n{\"overall\":5}\n```","is_error":false}"#
        switch extractGradeJSON(fromWrapper: Data(fenced.utf8)) {
        case .success(let grade):
            check("コードフェンス付きでも取り出せる", grade["overall"] as? Int == 5, "\(grade)")
        case .failure(let error):
            check("コードフェンス付きでも取り出せる", false, "\(error)")
        }

        let errored = #"{"result":"Invalid API key","is_error":true}"#
        if case .failure(let error) = extractGradeJSON(fromWrapper: Data(errored.utf8)),
           case .claudeReportedError = error {
            check("is_error が真なら claudeReportedError になる", true)
        } else {
            check("is_error が真なら claudeReportedError になる", false)
        }

        let notJSON = #"{"result":"I cannot do that.","is_error":false}"#
        if case .failure(let error) = extractGradeJSON(fromWrapper: Data(notJSON.utf8)),
           case .unreadableOutput(let stage, let excerpt) = error {
            check("内側が JSON でなければ unreadableOutput(innerResult)",
                  stage == .innerResult, "\(stage) excerpt=\(excerpt)")
        } else {
            check("内側が JSON でなければ unreadableOutput(innerResult)", false)
        }

        if case .failure(let error) = extractGradeJSON(fromWrapper: Data("not json at all".utf8)),
           case .unreadableOutput(let stage, let excerpt) = error {
            check("外側が JSON でなければ unreadableOutput(outerWrapper)",
                  stage == .outerWrapper && excerpt == "not json at all",
                  "\(stage) excerpt=\(excerpt)")
        } else {
            check("外側が JSON でなければ unreadableOutput(outerWrapper)", false)
        }

        check("すべてのエラーに日本語の説明がある",
              [ClaudeRunnerError.binaryNotFound,
               .launchFailed("x"),
               .timedOut(seconds: 180),
               .claudeReportedError("x"),
               .unreadableOutput(stage: .outerWrapper, excerpt: "x"),
               .unreadableOutput(stage: .innerResult, excerpt: "x")]
                .allSatisfy { !$0.japaneseMessage.isEmpty })
    }
}
