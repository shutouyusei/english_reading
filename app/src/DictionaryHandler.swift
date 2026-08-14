import Foundation
import WebKit

/// JS の `window.webkit.messageHandlers.dictionary` からの要求を
/// SystemDictionary に渡すだけの橋渡し。判断はすべて SystemDictionary 側にある。
///
/// 応答は `{ word, definition, source }`。定義が無い語は definition を null にして返し、
/// エラーにはしない(「辞書に無い」は失敗ではなく、呼び出し側は Weblio へ誘導する)。
final class DictionaryHandler: NSObject, WKScriptMessageHandlerWithReply {

    /// 優先順。英和を先に置き、無ければ有効辞書へ落ちる。
    /// 表示名は環境によって揺れるため、英語のバンドル名も候補に入れる。
    static let preferredDictionaryNames = ["ウィズダム", "WISDOM", "英和"]

    private let dictionary: SystemDictionary

    init(dictionary: SystemDictionary =
            SystemDictionary(preferredNames: DictionaryHandler.preferredDictionaryNames)) {
        self.dictionary = dictionary
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
        switch action {
        case "define":
            guard let word = body["word"] as? String else {
                replyHandler(nil, "word が含まれていません")
                return
            }
            replyHandler([
                "word": word,
                "definition": jsValue(dictionary.define(word)),
                "source": jsValue(dictionary.resolvedName),
            ], nil)
        default:
            replyHandler(nil, "未知の action: \(action)")
        }
    }

    /// 値の無い項目は JS 側で null として受け取れるようにする。
    /// キーごと省くと、呼び出し側で「未定義」と「辞書に無い」を区別できなくなる。
    private func jsValue(_ text: String?) -> Any {
        return text ?? NSNull()
    }
}
