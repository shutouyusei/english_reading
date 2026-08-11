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
