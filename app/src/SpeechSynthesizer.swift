import Foundation
import AVFoundation

/// 台本の1行分。話者ごとに声が変わる。
struct Utterance {
    let voice: String
    let text: String
}

/// 音声を用意できなかった理由。画面にそのまま出せる日本語を持たせる。
enum SpeechError: Error, LocalizedError {
    case sayFailed(String)
    case mergeFailed(String)
    case cacheUnwritable(String)

    var errorDescription: String? {
        switch self {
        case .sayFailed(let detail):
            return "音声を合成できませんでした: \(detail)"
        case .mergeFailed(let detail):
            return "音声の結合に失敗しました: \(detail)"
        case .cacheUnwritable(let detail):
            return "音声の保存先に書き込めません: \(detail)"
        }
    }
}

/// macOS の say を呼んで台本を m4a にする。
/// say は1回の呼び出しで1話者しか使えないため、複数話者は個別に作って結合する。
final class SpeechSynthesizer {
    private let cacheDirectory: URL

    init(cacheDirectory: URL) {
        self.cacheDirectory = cacheDirectory
    }

    func fileName(for id: String) -> String {
        return "\(id).m4a"
    }

    /// キャッシュ済みならその場所。無ければ nil。
    func cachedURL(for id: String) -> URL? {
        let url = cacheDirectory.appendingPathComponent(fileName(for: id))
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// 台本から音声を作ってキャッシュへ置き、その場所を返す。
    /// 途中で失敗した場合、キャッシュには何も残さない。
    func synthesize(id: String, utterances: [Utterance]) throws -> URL {
        guard !utterances.isEmpty else {
            throw SpeechError.sayFailed("発話が1つもありません")
        }

        // say は存在しない声名を渡しても終了コード0で既定の声に黙って
        // フォールバックする(macOS 26 で確認済み)。終了コードでは
        // 「指定した声が無い」を検出できないため、say を呼ぶ前に
        // 利用可能な声の一覧と突き合わせて確認する。一覧そのものが
        // 取得できない場合、検証をすり抜けさせると「無い声が黙って
        // 別の声に化ける」経路を許すことになるため、ここで明示的に失敗する。
        let voices = availableVoiceNames()
        guard !voices.isEmpty else {
            throw SpeechError.sayFailed(
                "利用可能な声の一覧を取得できませんでした(say -v ? の実行に失敗しました)")
        }
        for utterance in utterances {
            guard voices.contains(utterance.voice) else {
                throw SpeechError.sayFailed(
                    "声「\(utterance.voice)」はこの環境に見つかりません"
                    + "(say -v ? で確認できる声だけが使えます)")
            }
        }

        do {
            try FileManager.default.createDirectory(
                at: cacheDirectory, withIntermediateDirectories: true)
        } catch {
            throw SpeechError.cacheUnwritable(error.localizedDescription)
        }

        let workDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("speech-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: workDir) }

        var parts: [URL] = []
        for (index, utterance) in utterances.enumerated() {
            let part = workDir.appendingPathComponent("part_\(index).m4a")
            try runSay(utterance: utterance, output: part)
            parts.append(part)
        }

        // 一時ディレクトリで完成させてから移す。半端なファイルをキャッシュに残さないため。
        let staged = workDir.appendingPathComponent("final.m4a")
        if parts.count == 1 {
            try move(parts[0], to: staged)
        } else {
            try merge(parts, into: staged)
        }

        let destination = cacheDirectory.appendingPathComponent(fileName(for: id))
        try move(staged, to: destination)
        return destination
    }

    private func move(_ source: URL, to destination: URL) throws {
        do {
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: source, to: destination)
        } catch {
            throw SpeechError.cacheUnwritable(error.localizedDescription)
        }
    }

    /// `say -v ?` の出力から声の名前一覧を作る。
    /// 声名には "Bad News" のように空白を含むものや、
    /// "Eddy (German (Germany))" のように括弧を含むものがあるため、
    /// 行末のロケール(空白を含まない1トークン)と "#" を手がかりに
    /// その手前までを声名として取り出す。
    private func availableVoiceNames() -> Set<String> {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        process.arguments = ["-v", "?"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        guard (try? process.run()) != nil else { return [] }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0,
              let text = String(data: data, encoding: .utf8) else { return [] }

        guard let regex = try? NSRegularExpression(pattern: "^(.+?)\\s+\\S+\\s+#") else {
            return []
        }
        var names = Set<String>()
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
            let lineString = String(line)
            let nsLine = lineString as NSString
            guard let match = regex.firstMatch(
                in: lineString, range: NSRange(location: 0, length: nsLine.length))
            else { continue }
            names.insert(nsLine.substring(with: match.range(at: 1)))
        }
        return names
    }

    /// AAC を必ず指定する。無指定だと非圧縮になり、同じ長さで約8倍の大きさになる。
    private func runSay(utterance: Utterance, output: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        process.arguments = [
            "-v", utterance.voice,
            "--file-format=m4af",
            "--data-format=aac",
            "-o", output.path,
            utterance.text,
        ]
        let errorPipe = Pipe()
        process.standardError = errorPipe
        process.standardOutput = Pipe()

        do {
            try process.run()
        } catch {
            throw SpeechError.sayFailed(error.localizedDescription)
        }
        let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            let detail = String(data: errorData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            // 声名の妥当性は synthesize() 側で事前に確認済み。
            // ここに来る終了コード異常はそれ以外の say の失敗(権限やディスクなど)。
            // どの声で失敗したかを必ず書く。黙って別の声に差し替えると、
            // 気づかないまま違う音声で学習することになる。
            throw SpeechError.sayFailed(
                "声「\(utterance.voice)」で合成できませんでした"
                + "(終了コード \(process.terminationStatus)) \(detail)")
        }
        guard FileManager.default.fileExists(atPath: output.path) else {
            throw SpeechError.sayFailed("say がファイルを作りませんでした")
        }
    }

    private func merge(_ parts: [URL], into destination: URL) throws {
        let composition = AVMutableComposition()
        guard let track = composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw SpeechError.mergeFailed("音声トラックを作れません")
        }

        var cursor = CMTime.zero
        for part in parts {
            let asset = AVURLAsset(url: part)
            guard let source = asset.tracks(withMediaType: .audio).first else {
                throw SpeechError.mergeFailed("音声トラックが見つかりません: \(part.lastPathComponent)")
            }
            do {
                try track.insertTimeRange(
                    CMTimeRange(start: .zero, duration: asset.duration), of: source, at: cursor)
            } catch {
                throw SpeechError.mergeFailed(error.localizedDescription)
            }
            cursor = CMTimeAdd(cursor, asset.duration)
        }

        guard let export = AVAssetExportSession(
            asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
            throw SpeechError.mergeFailed("書き出しを準備できません")
        }
        export.outputURL = destination
        export.outputFileType = .m4a

        // 書き出しは非同期。呼び出し側は同期で待つ。
        let semaphore = DispatchSemaphore(value: 0)
        export.exportAsynchronously { semaphore.signal() }
        semaphore.wait()

        guard export.status == .completed else {
            throw SpeechError.mergeFailed(export.error?.localizedDescription ?? "原因不明")
        }
    }
}
