import Foundation
import WebKit

/// JS からの音声生成要求を SpeechSynthesizer へ渡す橋渡し。
/// 判断はすべて SpeechSynthesizer 側にあり、ここは形の検査と応答の組み立てだけを行う。
///
/// 応答は `{ url }`。URL は audio:// スキームで、WKWebView の <audio> がそのまま読める。
///
/// `WKScriptMessageHandlerWithReply` の呼び出しはメインスレッドで届く。
/// `SpeechSynthesizer.synthesize` は say の実行と AVFoundation の書き出しを待つため、
/// 数秒かかることがある(1本の台本でも実測5秒前後)。これをメインスレッドで
/// そのまま実行すると WKWebView 全体が固まり、「音声を準備しています…」の
/// 画面が操作不能なまま止まって見える。そこで形の検査だけをメインスレッドで
/// 即座に行い、キャッシュ照会と synthesize は `DispatchQueue.global` の
/// バックグラウンドキューへ渡す。Swift Concurrency の `Task` を使わないのは、
/// `synthesize` の内部(`SpeechSynthesizer.merge`)がセマフォで待つ同期処理であり、
/// それを協調スレッドプール上のスレッドで行うと `activeProcessorCount` を
/// 超える同時呼び出しでスレッド枯渇に陥るため。`DispatchQueue.global` の
/// worker スレッドは協調スレッドプールに属さないため、この崖から外れる。
final class SpeechHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let synthesizer: SpeechSynthesizer

    init(synthesizer: SpeechSynthesizer) {
        self.synthesizer = synthesizer
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // 形の検査は安価なので、メインスレッド上でそのまま同期的に行う。
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            replyHandler(nil, "要求の形式が不正です")
            return
        }
        guard action == "prepare" else {
            replyHandler(nil, "未知の action: \(action)")
            return
        }
        guard let id = body["id"] as? String, isSafeIdentifier(id) else {
            replyHandler(nil, "id が不正です")
            return
        }
        guard let rawUtterances = body["utterances"] as? [[String: Any]], !rawUtterances.isEmpty else {
            replyHandler(nil, "utterances が含まれていません")
            return
        }

        var utterances: [Utterance] = []
        for raw in rawUtterances {
            guard let voice = raw["voice"] as? String, !voice.isEmpty,
                  let text = raw["text"] as? String, !text.isEmpty else {
                replyHandler(nil, "utterances の形式が不正です")
                return
            }
            utterances.append(Utterance(voice: voice, text: text))
        }
        let force = body["force"] as? Bool ?? false

        // ここから先(キャッシュ照会と synthesize)はメインスレッドを塞がないよう
        // バックグラウンドキューで行い、応答だけをメインスレッドへ戻す。
        let synthesizer = self.synthesizer
        DispatchQueue.global(qos: .userInitiated).async {
            if !force, let cached = synthesizer.cachedURL(for: id) {
                let url = Self.audioURL(for: cached)
                DispatchQueue.main.async {
                    replyHandler(["url": url], nil)
                }
                return
            }
            do {
                let created = try synthesizer.synthesize(id: id, utterances: utterances)
                let url = Self.audioURL(for: created)
                DispatchQueue.main.async {
                    replyHandler(["url": url], nil)
                }
            } catch {
                let message = error.localizedDescription
                DispatchQueue.main.async {
                    replyHandler(nil, message)
                }
            }
        }
    }

    /// id はファイル名になる。区切り文字が混ざるとキャッシュの外を指せてしまう。
    private func isSafeIdentifier(_ id: String) -> Bool {
        guard !id.isEmpty, !id.contains("/"), !id.contains("\\"), id != ".", id != ".." else {
            return false
        }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
        return id.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    private static func audioURL(for file: URL) -> String {
        return "audio://local/\(file.lastPathComponent)"
    }
}
