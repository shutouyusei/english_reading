import Foundation

/// 採点に失敗しうる経路。すべて画面にそのまま出せる日本語の説明を持つ。
enum ClaudeRunnerError: Error {
    case binaryNotFound
    case launchFailed(String)
    case timedOut(seconds: Int)
    case claudeReportedError(String)
    /// stage: どちらの JSON を読もうとして失敗したか。
    /// excerpt: 読み取れなかった文字列の先頭最大200文字(診断用)。
    case unreadableOutput(stage: UnreadableStage, excerpt: String)

    /// unreadableOutput の失敗箇所を区別する。
    /// 外側(Claude Code のラッパー自体)と内側(result 文字列の中身)は
    /// 原因がまったく異なるため、まとめて捨てずに区別できるようにしておく。
    enum UnreadableStage {
        case outerWrapper
        case innerResult
    }
}

extension ClaudeRunnerError {
    var japaneseMessage: String {
        switch self {
        case .binaryNotFound:
            return "Claude Code が見つかりません。~/.local/bin/claude を確認するか、"
                 + "環境変数 TOEFL_CLAUDE_BIN にパスを設定してください。"
        case .launchFailed(let detail):
            return "Claude Code を起動できませんでした: \(detail)"
        case .timedOut(let seconds):
            return "採点が \(seconds) 秒以内に終わりませんでした。もう一度お試しください。"
        case .claudeReportedError(let detail):
            return "Claude Code がエラーを返しました。ターミナルで claude を実行して"
                 + "ログイン状態を確認してください。(\(detail))"
        case .unreadableOutput(let stage, let excerpt):
            let stageDescription = stage == .outerWrapper
                ? "Claude Code からの応答全体"
                : "採点結果の JSON 部分"
            return "採点結果を読み取れませんでした(\(stageDescription)を JSON として解釈できません: "
                 + "\(excerpt))。もう一度お試しください。"
        }
    }
}

/// 実行ファイルの既定の探索先。
/// Finder から起動した .app の PATH は /usr/bin:/bin:/usr/sbin:/sbin しか無く、
/// claude はそこに存在しない。PATH 探索に頼らず明示的に探す。
let defaultClaudeBinaryCandidates = [
    NSHomeDirectory() + "/.local/bin/claude",
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
]

/// claude の実行ファイルを見つける。
/// TOEFL_CLAUDE_BIN が設定されていればそれだけを見る。設定されているのに
/// 実在しない場合、黙って別のものを使うと利用者が誤った箇所を疑うため nil を返す。
func resolveClaudeBinary(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    fileExists: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
    candidates: [String] = defaultClaudeBinaryCandidates
) -> String? {
    if let override = environment["TOEFL_CLAUDE_BIN"], !override.isEmpty {
        return fileExists(override) ? override : nil
    }
    return candidates.first(where: fileExists)
}

/// claude -p に渡す引数。
///
/// --tools "" が最も重要。これが無いと Claude Code の既定ツール定義一式が
/// 毎回プロンプトに載り、入力トークンが 613 から 44,984 へ 73 倍に膨らむ。
/// 採点にツールは要らない。
///
/// ユーザープロンプトはここに含めない。標準入力で渡す(エッセイ本文に
/// 引用符・改行・バックスラッシュが入っても壊れないため)。
func claudeArguments(systemPrompt: String) -> [String] {
    return [
        "-p",
        "--output-format", "json",
        "--system-prompt", systemPrompt,
        "--tools", "",
        "--strict-mcp-config",
        "--setting-sources", "",
    ]
}

/// プロンプトファイルを "---" だけの行で前後に分ける。前half がシステム、後半がユーザー。
func splitPromptFile(_ text: String) -> (system: String, user: String)? {
    let lines = text.components(separatedBy: "\n")
    guard let separator = lines.firstIndex(where: {
        $0.trimmingCharacters(in: .whitespaces) == "---"
    }) else { return nil }

    let system = lines[..<separator].joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let user = lines[(separator + 1)...].joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    if system.isEmpty || user.isEmpty { return nil }
    return (system, user)
}

/// {{key}} を values の値で置き換える。
/// 値の無いプレースホルダはテンプレート側であらかじめ取り除く。置換が終わった
/// 後の文字列(エッセイなど利用者の入力を含みうる)に正規表現を掛けると、
/// 本文中にたまたま {{...}} 形の文字列が含まれていた場合に生徒の回答を
/// 無断で書き換えてしまうため、対象を置換前のテンプレートだけに限定する。
func renderTemplate(_ template: String, values: [String: String]) -> String {
    let strippedTemplate = removeUnresolvedPlaceholders(from: template, knownKeys: Set(values.keys))
    var result = strippedTemplate
    for (key, value) in values {
        result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
    }
    return result
}

/// テンプレート中の {{key}} のうち、values に用意されていないものだけを取り除く。
private func removeUnresolvedPlaceholders(from template: String, knownKeys: Set<String>) -> String {
    guard let regex = try? NSRegularExpression(pattern: "\\{\\{([A-Za-z_]+)\\}\\}") else {
        return template
    }
    let nsTemplate = template as NSString
    let matches = regex.matches(in: template, range: NSRange(location: 0, length: nsTemplate.length))
    var result = template
    // 後ろから消していけば、まだ処理していない前方のマッチ範囲がずれない。
    for match in matches.reversed() {
        let key = nsTemplate.substring(with: match.range(at: 1))
        guard !knownKeys.contains(key) else { continue }
        if let range = Range(match.range(at: 0), in: result) {
            result.removeSubrange(range)
        }
    }
    return result
}

/// claude --output-format json の出力から採点結果を取り出す。
/// 外側は Claude Code のラッパー。内側の result 文字列が採点結果の JSON。
func extractGradeJSON(fromWrapper data: Data) -> Result<[String: Any], ClaudeRunnerError> {
    guard let wrapper = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
        let excerpt = String(data: data, encoding: .utf8) ?? "(UTF-8として読めないデータ)"
        return .failure(.unreadableOutput(stage: .outerWrapper, excerpt: String(excerpt.prefix(200))))
    }
    if let isError = wrapper["is_error"] as? Bool, isError {
        return .failure(.claudeReportedError((wrapper["result"] as? String) ?? "詳細不明"))
    }
    guard let body = wrapper["result"] as? String else {
        return .failure(.unreadableOutput(stage: .innerResult, excerpt: "result フィールドが文字列ではない"))
    }
    guard let grade = parseGradeBody(body) else {
        return .failure(.unreadableOutput(stage: .innerResult, excerpt: String(body.prefix(200))))
    }
    return .success(grade)
}

/// 採点結果の本文をパースする。実測ではフェンスは付かなかったが、
/// 将来モデルが変わって ```json で囲む可能性があるので剥がせるようにしておく。
func parseGradeBody(_ text: String) -> [String: Any]? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if let direct = (try? JSONSerialization.jsonObject(with: Data(trimmed.utf8)))
        as? [String: Any] {
        return direct
    }
    guard trimmed.hasPrefix("```") else { return nil }
    var lines = trimmed.components(separatedBy: "\n")
    lines.removeFirst()
    if lines.last?.trimmingCharacters(in: .whitespaces) == "```" { lines.removeLast() }
    return (try? JSONSerialization.jsonObject(with: Data(lines.joined(separator: "\n").utf8)))
        as? [String: Any]
}

/// claude -p を起動して採点結果を得る。呼び出し側のスレッドを塞ぐので、
/// 画面から呼ぶときはバックグラウンドキューで実行すること。
func runClaude(binary: String, systemPrompt: String, userPrompt: String,
               timeoutSeconds: Int = 180) -> Result<[String: Any], ClaudeRunnerError> {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: binary)
    process.arguments = claudeArguments(systemPrompt: systemPrompt)

    let stdinPipe = Pipe()
    let stdoutPipe = Pipe()
    let stderrPipe = Pipe()
    process.standardInput = stdinPipe
    process.standardOutput = stdoutPipe
    process.standardError = stderrPipe

    // パイプのバッファが満杯になると子プロセスが書き込みで止まる。
    // 待つ前から読み出しておく。
    let lock = NSLock()
    var stdoutData = Data()
    var stderrData = Data()
    stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
        let chunk = handle.availableData
        guard !chunk.isEmpty else { return }
        lock.lock(); stdoutData.append(chunk); lock.unlock()
    }
    stderrPipe.fileHandleForReading.readabilityHandler = { handle in
        let chunk = handle.availableData
        guard !chunk.isEmpty else { return }
        lock.lock(); stderrData.append(chunk); lock.unlock()
    }

    // 読み出しハンドラを止め、パイプに残っているデータを回収する。
    // GCD の読み出しソースは readabilityHandler を nil にするまで生き続け、
    // EOF 後も発火しうる。パイプ・バッファ・プロセスを握ったまま残ってしまうため、
    // この関数を抜けるどの経路でも必ずこれを通す。
    func stopReadingAndDrain() -> (stdout: Data, stderr: String) {
        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil
        let stdoutTail = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let stderrTail = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        lock.lock()
        stdoutData.append(stdoutTail)
        stderrData.append(stderrTail)
        let output = stdoutData
        let errorText = String(data: stderrData, encoding: .utf8) ?? ""
        lock.unlock()
        return (output, errorText)
    }

    let finished = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in finished.signal() }

    do {
        try process.run()
    } catch {
        _ = stopReadingAndDrain()
        return .failure(.launchFailed(error.localizedDescription))
    }

    stdinPipe.fileHandleForWriting.write(Data(userPrompt.utf8))
    try? stdinPipe.fileHandleForWriting.close()

    if finished.wait(timeout: .now() + .seconds(timeoutSeconds)) == .timedOut {
        // SIGTERM でまず止める。短い猶予の後もまだ生きていたら SIGKILL で確実に刈り取る。
        // ここで待たずに返すと子プロセスがゾンビのまま残り、読み出しソースも
        // プロセスの生死と無関係にアプリの寿命いっぱい生き残ってしまう。
        process.terminate()
        if finished.wait(timeout: .now() + .seconds(2)) == .timedOut {
            kill(process.processIdentifier, SIGKILL)
            _ = finished.wait(timeout: .now() + .seconds(5))
        }
        _ = stopReadingAndDrain()
        return .failure(.timedOut(seconds: timeoutSeconds))
    }

    let (output, errorText) = stopReadingAndDrain()

    if process.terminationStatus != 0 {
        let detail = errorText.isEmpty
            ? "終了コード \(process.terminationStatus)"
            : String(errorText.prefix(200))
        return .failure(.claudeReportedError(detail))
    }
    return extractGradeJSON(fromWrapper: output)
}
