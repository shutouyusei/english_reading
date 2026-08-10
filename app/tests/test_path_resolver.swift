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

        exit(failures == 0 ? 0 : 1)
    }
}
