import Foundation

/// JSON Lines 形式のデータを1行ずつ解釈する。
/// 壊れた行はその行だけを捨て、他の行は失わない。
/// attempts.jsonl と essays.jsonl の両方がこれを使う。
func parseJSONLines(_ data: Data) -> [[String: Any]] {
    return data.split(separator: 0x0A).compactMap { lineBytes in
        guard let object = try? JSONSerialization.jsonObject(with: Data(lineBytes)),
              let dictionary = object as? [String: Any] else { return nil }
        return dictionary
    }
}

/// 追記専用の JSON Lines ファイル。
/// 学習ログ(attempts.jsonl)とライティング(essays.jsonl)が同じ扱い方をするため、
/// 読み書きの手順をここ1か所にまとめている。
struct JSONLinesFile {
    let url: URL

    init(directory: URL, filename: String) {
        self.url = directory.appendingPathComponent(filename)
    }

    /// ファイルがまだ無い場合は空配列。読めないこと自体は異常ではない。
    func loadAll() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        return parseJSONLines(data)
    }

    /// 既存行は一切読み書きせず、末尾に1行足すだけ。
    func append(_ row: [String: Any]) throws {
        var line = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])
        line.append(0x0A)

        if FileManager.default.fileExists(atPath: url.path) {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: line)
        } else {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try line.write(to: url)
        }
    }
}
