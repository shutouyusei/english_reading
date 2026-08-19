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

/// 音声キャッシュをルートにしたときも、ルート外へ出られないことを確かめる。
/// 経路は app:// と同じ resolveContentPath だが、根が変わるので別に確認する。
@main
struct TestAudioScheme {
    static func main() {
        let base = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("audio-scheme-\(UUID().uuidString)")
        let audioDir = base.appendingPathComponent("audio")
        defer { try? FileManager.default.removeItem(at: base) }

        try? FileManager.default.createDirectory(at: audioDir, withIntermediateDirectories: true)
        let inside = audioDir.appendingPathComponent("listening_001.m4a")
        FileManager.default.createFile(atPath: inside.path, contents: Data([0x00, 0x01]))

        // 兄弟ディレクトリに秘密のファイルを置き、.. で届かないことを確かめる
        let secret = base.appendingPathComponent("secret.txt")
        FileManager.default.createFile(atPath: secret.path, contents: Data("secret".utf8))

        let resolved = resolveContentPath(root: audioDir, requestPath: "/listening_001.m4a")
        check("キャッシュ内のファイルを解決できる", resolved?.path == inside.path,
              resolved?.path ?? "nil")

        check("`..` で親ディレクトリへ出られない",
              resolveContentPath(root: audioDir, requestPath: "/../secret.txt") == nil)
        check("多重の `..` でも出られない",
              resolveContentPath(root: audioDir, requestPath: "/../../etc/passwd") == nil)

        // シンボリックリンク検査: 音声キャッシュ内のリンクが親へ指していても拒否される
        let linkTarget = audioDir.appendingPathComponent("symlink_to_secret")
        do {
            try FileManager.default.createSymbolicLink(at: linkTarget, withDestinationURL: secret)
            check("キャッシュ内のシンボリックリンクが親を指していても拒否される",
                  resolveContentPath(root: audioDir, requestPath: "/symlink_to_secret") == nil)
        } catch {
            check("キャッシュ内のシンボリックリンクが親を指していても拒否される",
                  false, "symlink creation failed: \(error)")
        }

        exit(failures == 0 ? 0 : 1)
    }
}
