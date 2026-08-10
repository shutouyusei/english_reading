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
    return target
}
