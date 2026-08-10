import Foundation

/// attempts.jsonl の内容を1行ずつ解釈する。
/// 壊れた行はその行だけを捨て、他の行は失わない。
func parseAttemptsLog(_ data: Data) -> [[String: Any]] {
    return data.split(separator: 0x0A).compactMap { lineBytes in
        guard let object = try? JSONSerialization.jsonObject(with: Data(lineBytes)),
              let dictionary = object as? [String: Any] else { return nil }
        return dictionary
    }
}
