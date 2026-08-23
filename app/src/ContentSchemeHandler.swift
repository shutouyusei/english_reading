import Foundation
import WebKit

/// 指定したルート配下の実ファイルを、あるスキームへの要求に対して返す。
/// app:// はリポジトリルート、audio:// は音声キャッシュを根にして使う。
/// どちらの場合も resolveContentPath がルート外への脱出を拒否する。
final class ContentSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    private static let mimeTypes: [String: String] = [
        "html": "text/html", "js": "text/javascript", "css": "text/css",
        "json": "application/json", "png": "image/png", "svg": "image/svg+xml",
        "ico": "image/x-icon", "m4a": "audio/mp4", "mp3": "audio/mpeg",
    ]

    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let path = task.request.url?.path ?? ""
        guard let file = resolveContentPath(root: root, requestPath: path),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(
                domain: "TOEFLReading", code: 404,
                userInfo: [NSLocalizedDescriptionKey: "読み込めません: \(path)"]))
            return
        }
        let mime = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"

        // WKWebView の <audio> は音声ファイルを Range 要求で読む。全体を
        // 200 で返し続けると音声要素が networkState=3 (NETWORK_NO_SOURCE)
        // に落ち、一切再生されない(詳しい経緯は ByteRange.swift 参照)。
        let rangeHeader = task.request.value(forHTTPHeaderField: "Range")
        let range = parseByteRange(rangeHeader, totalLength: data.count)

        var status = 200
        var headers = ["Content-Type": "\(mime); charset=utf-8", "Accept-Ranges": "bytes"]
        var body = data
        switch range {
        case .whole:
            break
        case .partial(let start, let end):
            status = 206
            body = data.subdata(in: start..<(end + 1))
            headers["Content-Range"] = "bytes \(start)-\(end)/\(data.count)"
        case .unsatisfiable:
            status = 416
            body = Data()
            headers["Content-Range"] = "bytes */\(data.count)"
        }
        headers["Content-Length"] = String(body.count)

        // 素の URLResponse ではステータスコードを持てず、fetch() から見ると status が 0 になり
        // res.ok が false になる(HTMLパーサ経由の読み込みは影響を受けないため気づきにくい)。
        // fetch() でデータを取得できるよう HTTPURLResponse でステータスを返す。
        guard let response = HTTPURLResponse(
            url: task.request.url!, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: headers
        ) else {
            task.didFailWithError(NSError(
                domain: "TOEFLReading", code: 500,
                userInfo: [NSLocalizedDescriptionKey: "応答を組み立てられません: \(path)"]))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
