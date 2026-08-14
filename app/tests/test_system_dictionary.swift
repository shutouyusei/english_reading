import Foundation

var failures = 0
var skipped = 0

func check(_ name: String, _ condition: Bool) {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)")
        failures += 1
    }
}

func skip(_ name: String, _ reason: String) {
    print("skip - \(name) (\(reason))")
    skipped += 1
}

/// ひらがな・カタカナ・漢字のいずれかを含むか。英英辞典と英和辞典の区別に使う。
func containsJapanese(_ text: String) -> Bool {
    for scalar in text.unicodeScalars {
        switch scalar.value {
        case 0x3040...0x309F,  // ひらがな
             0x30A0...0x30FF,  // カタカナ
             0x4E00...0x9FFF:  // 漢字
            return true
        default:
            continue
        }
    }
    return false
}

/// ディスク上に英和辞典のバンドルが実在するか。
/// スキップ条件を SystemDictionary 自身に尋ねると、実装が壊れているときに
/// 「辞書が無い環境」を装って全テストが素通りしてしまう。判定は実装から切り離す。
func wisdomBundleExistsOnDisk() -> Bool {
    let assetsRoot = URL(fileURLWithPath:
        "/System/Library/AssetsV2/com_apple_MobileAsset_DictionaryServices_dictionary3macOS")
    let fm = FileManager.default
    guard let assets = try? fm.contentsOfDirectory(at: assetsRoot,
                                                   includingPropertiesForKeys: nil) else {
        return false
    }
    for asset in assets {
        let dataDir = asset.appendingPathComponent("AssetData")
        let bundles = (try? fm.contentsOfDirectory(at: dataDir,
                                                   includingPropertiesForKeys: nil)) ?? []
        if bundles.contains(where: { $0.lastPathComponent.contains("WISDOM") }) { return true }
    }
    return false
}

@main
struct TestSystemDictionary {
    static func main() {
        // このテストは実機の辞書に依存する。英和辞典が入っていない環境では
        // 失敗ではなくスキップにする(クリーンな環境を落とさないため)。
        guard wisdomBundleExistsOnDisk() else {
            skip("辞書引き全般", "この環境には英和辞典がインストールされていない")
            exit(0)
        }

        // ディスクに辞書がある以上、実装からも見えていなければおかしい。
        let anyDictionary = SystemDictionary(preferredNames: [])
        check("インストール済み辞書を列挙できる", anyDictionary.installedNames.count > 0)

        let wisdom = SystemDictionary(preferredNames: ["ウィズダム"])

        // 1. 優先辞書を名前の一部で見つけられる
        check("優先名『ウィズダム』で英和辞典を選べる",
              wisdom.resolvedName?.contains("ウィズダム") == true)

        // 2. 核心: 返ってくるのが英英ではなく英和であること
        let negligible = wisdom.define("negligible")
        check("negligible の定義が返る", negligible != nil)
        check("negligible の定義が日本語を含む(英英ではない)",
              negligible.map(containsJapanese) == true)

        // 3. 語形変化を辞書側が吸収する。本文中の語をそのまま渡せる必要がある。
        let flourishes = wisdom.define("flourishes")
        check("活用形 flourishes を引くと原形 flourish の定義が返る",
              flourishes?.lowercased().contains("flourish") == true)
        let bacteria = wisdom.define("bacteria")
        check("複数形 bacteria を引ける", bacteria.map(containsJapanese) == true)

        // 4. 辞書に無い語は nil。呼び出し側は Weblio へ誘導する。
        check("辞書に無い造語は nil を返す", wisdom.define("zzzqqqxyzabc") == nil)

        // 5. 壊れた入力でクラッシュしない
        check("空文字は nil を返す", wisdom.define("") == nil)
        check("空白だけの文字列は nil を返す", wisdom.define("   ") == nil)

        // 6. 優先名は並び順に探す。前が見つからなければ次を使う。
        let ordered = SystemDictionary(preferredNames: ["存在しない辞書xyz", "ウィズダム"])
        check("優先名は並び順に探し、見つからないものは飛ばす",
              ordered.resolvedName?.contains("ウィズダム") == true)

        // 7. 優先辞書が1つも無くても、有効辞書へのフォールバックで引ける。
        //    非公開シンボルが将来消えた場合もこの経路に落ちる。
        let fallback = SystemDictionary(preferredNames: ["存在しない辞書xyz"])
        check("優先辞書が無いとき resolvedName は nil", fallback.resolvedName == nil)
        check("優先辞書が無くても有効辞書で定義を引ける",
              fallback.define("negligible") != nil)

        if skipped > 0 { print("(\(skipped) 件スキップ)") }
        exit(failures == 0 ? 0 : 1)
    }
}
