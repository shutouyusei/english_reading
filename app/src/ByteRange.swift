import Foundation

/// Range 要求の解釈結果。
enum ByteRangeRequest: Equatable {
    /// 範囲指定なし。全体を 200 で返す。
    case whole
    /// 両端を含むバイト範囲。206 と Content-Range で返す。
    case partial(start: Int, end: Int)
    /// 形は正しいが満たせない範囲。416 で返す。
    case unsatisfiable
}

/// HTTP の Range ヘッダを解釈する。
///
/// これが要るのは音声のため。WKWebView の <audio> は音声ファイルを
/// Range 要求で読む。実測では、まず `bytes=0-1` で全体の長さを尋ね、
/// 続いて MP4 の先頭と末尾(moov アトム)を飛び飛びに読みに来る。
/// 全体を 200 で返し続けると音声要素は networkState=3
/// (NETWORK_NO_SOURCE) に落ち、一切再生されない。
///
/// 解釈できない指定は .whole にする。RFC 7233 は不正な Range を
/// 無視して全体を返すことを求めており、中途半端に解釈して壊すより安全。
/// 複数範囲(`bytes=0-1,5-6`)も、multipart で返す代わりに全体を返す。
func parseByteRange(_ header: String?, totalLength: Int) -> ByteRangeRequest {
    guard let header = header else { return .whole }
    let spec = header.replacingOccurrences(of: " ", with: "")
    guard spec.hasPrefix("bytes=") else { return .whole }
    let value = String(spec.dropFirst("bytes=".count))
    // 複数範囲は扱わない
    guard !value.contains(",") else { return .whole }
    guard let dash = value.firstIndex(of: "-") else { return .whole }

    let firstText = String(value[value.startIndex..<dash])
    let lastText = String(value[value.index(after: dash)...])

    // 末尾からの指定(bytes=-N)
    if firstText.isEmpty {
        guard let suffix = Int(lastText), suffix > 0 else { return .unsatisfiable }
        guard totalLength > 0 else { return .unsatisfiable }
        return .partial(start: max(0, totalLength - suffix), end: totalLength - 1)
    }

    guard let start = Int(firstText) else { return .whole }
    guard totalLength > 0, start < totalLength else { return .unsatisfiable }

    if lastText.isEmpty {
        return .partial(start: start, end: totalLength - 1)
    }
    guard let requestedEnd = Int(lastText) else { return .whole }
    guard requestedEnd >= start else { return .whole }
    return .partial(start: start, end: min(requestedEnd, totalLength - 1))
}
