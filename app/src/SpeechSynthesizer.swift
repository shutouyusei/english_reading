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
        do {
            try FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true)
        } catch {
            // ここを try? で握りつぶすと、後続の say がファイルを作れず
            // 「say がファイルを作りませんでした」という見当違いの診断になる。
            // 本当の原因(作業用ディレクトリを作れない)をそのまま伝える。
            throw SpeechError.cacheUnwritable(error.localizedDescription)
        }
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
        // 標準エラーは読まないので捨てる。Pipe() のままだと 64KB を超える書き込みで
        // ブロックしうる。nullDevice ならその心配がない。
        process.standardError = FileHandle.nullDevice
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
        // 標準出力は読まないので捨てる。理由は availableVoiceNames() と同様。
        process.standardOutput = FileHandle.nullDevice

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

    /// 同期の橋渡し。AVFoundation の非推奨でない結合処理は async 版しかないため、
    /// ここで async 処理を起こして待つ。
    ///
    /// `Task.detached` と、結合本体を `nonisolated` にしていることの両方が要る。
    /// もし将来 `SpeechSynthesizer` が `@MainActor` になった場合、非 detached の
    /// `Task { }` や actor-isolated な async 関数だと、下で `semaphore.wait()`
    /// がメインスレッドを塞いでいる間に、その Task 自身がメインスレッドの空きを
    /// 必要としてしまい、デッドロックする(実機で再現・検証済み)。
    /// `Task.detached` + `nonisolated` の組み合わせは呼び出し元のアクター文脈を
    /// 一切引き継がないため、このブロッキング待ちと衝突しない。
    private func merge(_ parts: [URL], into destination: URL) throws {
        let semaphore = DispatchSemaphore(value: 0)
        var outcome: SpeechError?
        Task.detached {
            do {
                try await Self.mergeAsync(parts, into: destination)
            } catch let error as SpeechError {
                outcome = error
            } catch {
                outcome = .mergeFailed(error.localizedDescription)
            }
            semaphore.signal()
        }
        semaphore.wait()
        if let outcome {
            throw outcome
        }
    }

    private nonisolated static func mergeAsync(_ parts: [URL], into destination: URL) async throws {
        let composition = AVMutableComposition()
        guard let track = composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw SpeechError.mergeFailed("音声トラックを作れません")
        }

        var cursor = CMTime.zero
        for part in parts {
            let asset = AVURLAsset(url: part)
            let tracks: [AVAssetTrack]
            do {
                tracks = try await asset.loadTracks(withMediaType: .audio)
            } catch {
                throw SpeechError.mergeFailed(error.localizedDescription)
            }
            guard let source = tracks.first else {
                throw SpeechError.mergeFailed("音声トラックが見つかりません: \(part.lastPathComponent)")
            }
            do {
                let duration = try await asset.load(.duration)
                try track.insertTimeRange(
                    CMTimeRange(start: .zero, duration: duration), of: source, at: cursor)
                cursor = CMTimeAdd(cursor, duration)
            } catch {
                throw SpeechError.mergeFailed(error.localizedDescription)
            }
        }

        guard let export = AVAssetExportSession(
            asset: composition, presetName: AVAssetExportPresetAppleM4A) else {
            throw SpeechError.mergeFailed("書き出しを準備できません")
        }
        do {
            try await export.export(to: destination, as: .m4a)
        } catch {
            throw SpeechError.mergeFailed(error.localizedDescription)
        }
    }
}
