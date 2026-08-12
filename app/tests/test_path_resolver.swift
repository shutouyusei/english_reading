import Foundation

var failures = 0

func check(_ name: String, _ condition: Bool) {
    if condition {
        print("ok   - \(name)")
    } else {
        print("FAIL - \(name)")
        failures += 1
    }
}

@main
struct TestPathResolver {
    static func main() {
        let root = URL(fileURLWithPath: "/tmp/repo")

        check("通常のパスを解決する",
              resolveContentPath(root: root, requestPath: "/docs/index.html")?.path
              == "/tmp/repo/docs/index.html")

        check("先頭スラッシュが無くても解決する",
              resolveContentPath(root: root, requestPath: "docs/index.html")?.path
              == "/tmp/repo/docs/index.html")

        check("ルート自身は許可する",
              resolveContentPath(root: root, requestPath: "/")?.path == "/tmp/repo")

        check("親ディレクトリへの脱出を拒否する",
              resolveContentPath(root: root, requestPath: "/../etc/passwd") == nil)

        check("途中に含まれる .. も拒否する",
              resolveContentPath(root: root, requestPath: "/docs/../../etc/passwd") == nil)

        check("ルートと接頭辞が同じ別ディレクトリを拒否する",
              resolveContentPath(root: root, requestPath: "/../repo-evil/secret.txt") == nil)

        check("ルート内で .. を使って戻る分には許可する",
              resolveContentPath(root: root, requestPath: "/app/ui/../../docs/index.html")?.path
              == "/tmp/repo/docs/index.html")

        // 実在するシンボリックリンクでの脱出を拒否する
        let fm = FileManager.default
        let tmpRoot = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("pathresolver-test-\(ProcessInfo.processInfo.processIdentifier)")
        let outside = tmpRoot.appendingPathComponent("outside")
        let inside = tmpRoot.appendingPathComponent("inside")
        try? fm.createDirectory(at: outside, withIntermediateDirectories: true)
        try? fm.createDirectory(at: inside, withIntermediateDirectories: true)
        try? "secret".write(to: outside.appendingPathComponent("secret.txt"),
                            atomically: true, encoding: .utf8)
        try? fm.createSymbolicLink(at: inside.appendingPathComponent("escape"),
                                   withDestinationURL: outside)
        check("シンボリックリンクによる脱出を拒否する",
              resolveContentPath(root: inside, requestPath: "/escape/secret.txt") == nil)
        try? fm.removeItem(at: tmpRoot)

        // writingPromptPath: 問題IDからのパス解決(ディレクトリ脱出防止)
        check("通常のIDは docs/data/writing 配下に解決される",
              writingPromptPath(root: root, promptId: "writing_001")?.path
              == "/tmp/repo/docs/data/writing/writing_001.json")

        check("親ディレクトリへ3段階上る ID は docs/data/writing の外へ出るため拒否する",
              writingPromptPath(root: root, promptId: "../../../etc/hosts") == nil)

        check("先頭スラッシュを含む ID は docs/data/writing 配下に留まる(脱出しない)",
              writingPromptPath(root: root, promptId: "/etc/hosts")?.path
              == "/tmp/repo/docs/data/writing/etc/hosts.json")

        check("途中に .. を含む ID は docs/data/writing の外へ出るため拒否する",
              writingPromptPath(root: root, promptId: "a/../../b") == nil)

        exit(failures == 0 ? 0 : 1)
    }
}
