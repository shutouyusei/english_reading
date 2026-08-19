import Foundation

var failures = 0
var skipped = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)\(detail.isEmpty ? "" : "  (\(detail))")")
        failures += 1
    }
}

func skip(_ name: String, _ reason: String) {
    print("skip - \(name) (\(reason))")
    skipped += 1
}

/// say が使えるかは実装に尋ねず外形で判定する。
/// 実装が壊れているときに「say が無い環境」を装って素通りさせないため。
func sayIsAvailable() -> Bool {
    return FileManager.default.isExecutableFile(atPath: "/usr/bin/say")
}

func fileSize(of url: URL) -> Int {
    let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
    return (attributes?[.size] as? Int) ?? 0
}

func durationSeconds(of url: URL) -> Double {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/afinfo")
    process.arguments = [url.path]
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = Pipe()
    try? process.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let text = String(data: data, encoding: .utf8) ?? ""
    for line in text.split(separator: "\n") where line.contains("estimated duration") {
        let number = line.split(separator: ":").last?.trimmingCharacters(in: .whitespaces) ?? ""
        return Double(number.replacingOccurrences(of: " sec", with: "")) ?? 0
    }
    return 0
}

@main
struct TestSpeechSynthesizer {
    static func main() {
        guard sayIsAvailable() else {
            skip("音声合成全般", "この環境に /usr/bin/say が無い")
            exit(0)
        }

        let cacheDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("speech-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cacheDir) }

        let synthesizer = SpeechSynthesizer(cacheDirectory: cacheDir)

        check("生成前はキャッシュが無い", synthesizer.cachedURL(for: "listening_900") == nil)

        // 1発話: そのまま1ファイルになる
        // テキストは意図的にやや長め。m4a コンテナには数十KBの固定ヘッダ・
        // オーバーヘッドがあり、1〜2秒程度の短い発話だとそれが実データを
        // 上回って「1秒あたりのバイト数」を押し上げてしまい、AAC 圧縮の
        // 検出(下の bytesPerSecond の検査)が短い音声では成立しない
        // (実測: 環境依存だが概ね32KB程度のオーバーヘッド)。
        let single: URL
        do {
            single = try synthesizer.synthesize(
                id: "listening_900",
                utterances: [Utterance(
                    voice: "Samantha",
                    text: "This is a single utterance test that is long enough to outlast the file header overhead.")])
        } catch {
            check("1発話を生成できる", false, "\(error)")
            exit(1)
        }
        check("1発話を生成できる", FileManager.default.fileExists(atPath: single.path))
        check("生成後はキャッシュが見つかる", synthesizer.cachedURL(for: "listening_900") != nil)
        check("ファイル名が <id>.m4a", single.lastPathComponent == "listening_900.m4a")

        let singleSize = fileSize(of: single)
        check("空ファイルではない", singleSize > 1000, "サイズ=\(singleSize)")

        // 核心: AAC を指定していること。非圧縮だと同じ長さで約8倍になる。
        let singleDuration = durationSeconds(of: single)
        check("音声の長さが取れる", singleDuration > 1.0, "秒=\(singleDuration)")
        let bytesPerSecond = Double(singleSize) / max(singleDuration, 0.001)
        check("AAC で圧縮されている(1秒あたり20KB未満)", bytesPerSecond < 20_000,
              "1秒あたり\(Int(bytesPerSecond))バイト")

        // 複数発話: 結合されて1ファイルになり、合計の長さになる
        let parts = [
            Utterance(voice: "Samantha", text: "Excuse me, I have a question about the deadline."),
            Utterance(voice: "Daniel", text: "Of course. The form is due at the end of the week."),
        ]
        let merged: URL
        do {
            merged = try synthesizer.synthesize(id: "listening_901", utterances: parts)
        } catch {
            check("複数発話を結合できる", false, "\(error)")
            exit(1)
        }
        check("複数発話を結合できる", FileManager.default.fileExists(atPath: merged.path))
        let mergedDuration = durationSeconds(of: merged)
        check("結合後の長さが1発話より長い", mergedDuration > singleDuration,
              "結合=\(mergedDuration) 単独=\(singleDuration)")

        // 失敗しても半端なファイルを残さない
        do {
            _ = try synthesizer.synthesize(id: "listening_902", utterances: [])
            check("発話が空なら失敗する", false, "例外が投げられなかった")
        } catch {
            check("発話が空なら失敗する", true)
        }
        check("失敗した生成のファイルが残らない",
              synthesizer.cachedURL(for: "listening_902") == nil)

        // 存在しない声は黙って別の声に差し替えず、どの声が駄目かを言って失敗する
        do {
            _ = try synthesizer.synthesize(
                id: "listening_903",
                utterances: [Utterance(voice: "NoSuchVoiceXYZ", text: "Hello.")])
            check("存在しない声では失敗する", false, "例外が投げられなかった")
        } catch {
            let text = error.localizedDescription
            check("存在しない声では失敗する", true)
            check("エラー文にどの声か書いてある", text.contains("NoSuchVoiceXYZ"), text)
        }
        check("失敗した生成のファイルが残らない(声が無い場合)",
              synthesizer.cachedURL(for: "listening_903") == nil)

        // すべてのエラーに日本語の説明がある
        let errors: [SpeechError] = [
            .sayFailed("x"), .mergeFailed("x"), .cacheUnwritable("x"),
        ]
        for error in errors {
            let text = error.localizedDescription
            let hasJapanese = text.unicodeScalars.contains {
                (0x3040...0x309F).contains($0.value) || (0x30A0...0x30FF).contains($0.value)
                    || (0x4E00...0x9FFF).contains($0.value)
            }
            check("エラーに日本語の説明がある: \(error)", hasJapanese, text)
        }

        if skipped > 0 { print("(\(skipped) 件スキップ)") }
        exit(failures == 0 ? 0 : 1)
    }
}
