import Foundation
import CoreServices

/// macOS のシステム辞書(辞書.app が使うもの)から定義文を取り出す。
///
/// 辞書を指定せずに DCSCopyTextDefinition を呼ぶと「有効な辞書の1冊目」が使われ、
/// 既定では英英辞典が返る。英和を引くには辞書を名指しする必要があるが、
/// 辞書の一覧を得る API は公開されていないため dlsym で解決する。
/// 解決に失敗した場合は指定なし(有効辞書)へ静かに落ちる。
final class SystemDictionary {

    private typealias DictionaryRef = UnsafeRawPointer
    private typealias CopyAvailableDictionaries = @convention(c) () -> Unmanaged<CFSet>
    private typealias DictionaryGetName = @convention(c) (DictionaryRef) -> Unmanaged<CFString>
    private typealias CopyTextDefinition =
        @convention(c) (DictionaryRef?, CFString, CFRange) -> Unmanaged<CFString>?

    /// 選ばれた辞書は CFSet が保持している。集合を手放すと参照が無効になるため一緒に持つ。
    private let availableDictionaries: CFSet?
    private let dictionary: DictionaryRef?
    private let copyTextDefinition: CopyTextDefinition?

    /// インストール済み辞書の表示名。辞書が見えているかの確認用。
    let installedNames: [String]

    /// 実際に使う辞書の名前。nil のときは有効辞書へのフォールバック。
    let resolvedName: String?

    /// - Parameter preferredNames: 使いたい辞書名の一部を優先順に並べたもの。
    ///   前から順に探し、最初に見つかったものを使う。
    init(preferredNames: [String]) {
        let handle = dlopen(
            "/System/Library/Frameworks/CoreServices.framework/CoreServices", RTLD_LAZY)
        copyTextDefinition = SystemDictionary.symbol(handle, "DCSCopyTextDefinition")
            .map { unsafeBitCast($0, to: CopyTextDefinition.self) }

        guard let availablePtr = SystemDictionary.symbol(handle, "DCSCopyAvailableDictionaries"),
              let namePtr = SystemDictionary.symbol(handle, "DCSDictionaryGetName") else {
            // 非公開シンボルが無い環境。指定なしでの辞書引きだけは動く。
            availableDictionaries = nil
            dictionary = nil
            installedNames = []
            resolvedName = nil
            return
        }

        let copyAvailable = unsafeBitCast(availablePtr, to: CopyAvailableDictionaries.self)
        let getName = unsafeBitCast(namePtr, to: DictionaryGetName.self)
        let dictionaries = copyAvailable().takeRetainedValue()
        availableDictionaries = dictionaries

        var refsByName: [(name: String, ref: DictionaryRef)] = []
        for object in (dictionaries as NSSet).allObjects {
            let ref = unsafeBitCast(object as AnyObject, to: DictionaryRef.self)
            refsByName.append((getName(ref).takeUnretainedValue() as String, ref))
        }
        installedNames = refsByName.map { $0.name }

        let matched = preferredNames.lazy
            .compactMap { needle in refsByName.first { $0.name.contains(needle) } }
            .first
        dictionary = matched?.ref
        resolvedName = matched?.name
    }

    private static func symbol(_ handle: UnsafeMutableRawPointer?,
                               _ name: String) -> UnsafeMutableRawPointer? {
        guard let handle = handle else { return nil }
        return dlsym(handle, name)
    }

    /// 単語の定義文を返す。辞書に無い語や引けない環境では nil。
    /// 活用形・複数形は辞書側が原形に寄せるため、本文中の語をそのまま渡してよい。
    func define(_ word: String) -> String? {
        let trimmed = word.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let copyTextDefinition = copyTextDefinition else { return nil }

        let range = CFRange(location: 0, length: trimmed.utf16.count)
        guard let result = copyTextDefinition(dictionary, trimmed as CFString, range) else {
            return nil
        }
        let definition = (result.takeRetainedValue() as String)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return definition.isEmpty ? nil : definition
    }
}
