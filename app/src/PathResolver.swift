import Foundation

/// app:// への要求パスを、リポジトリルート配下の実ファイルへ解決する。
/// ルートの外を指す場合は nil を返す(ディレクトリ脱出の防止)。
func resolveContentPath(root: URL, requestPath: String) -> URL? {
    let relative = requestPath.hasPrefix("/") ? String(requestPath.dropFirst()) : requestPath
    let rootStandardized = root.standardizedFileURL
    let target = rootStandardized.appendingPathComponent(relative).standardizedFileURL

    let rootPath = rootStandardized.path
    let targetPath = target.path
    guard targetPath == rootPath || targetPath.hasPrefix(rootPath + "/") else {
        return nil
    }

    // 字句チェックを通っても、シンボリックリンクで外へ出られる場合がある。
    // 実体のパスでもう一度確かめる。
    let realRoot = rootStandardized.resolvingSymlinksInPath().path
    let realTarget = target.resolvingSymlinksInPath().path
    guard realTarget == realRoot || realTarget.hasPrefix(realRoot + "/") else {
        return nil
    }

    return target
}

/// 問題IDから問題JSONの実ファイルを解決する。
/// ID は画面(JS)から来るため、リポジトリ配下に収まることを必ず確かめる。
/// docs/data/writing/ 自体を「ルート」として resolveContentPath に渡すことで、
/// .. を使って同フォルダの外(リポジトリ内の他ファイルも含む)へ出る経路を塞ぐ。
func writingPromptPath(root: URL, promptId: String) -> URL? {
    let writingDir = root.appendingPathComponent("docs/data/writing")
    return resolveContentPath(root: writingDir, requestPath: "\(promptId).json")
}
