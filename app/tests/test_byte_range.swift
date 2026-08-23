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

/// Range ヘッダの解釈。
///
/// WKWebView の <audio> は音声を Range 要求で読む。実測すると、まず
/// `bytes=0-1` で全体の長さを尋ね、次に MP4 の先頭と末尾(moov アトム)を
/// 飛び飛びに読みに来る。この要求に 206 で答えられないと、音声要素は
/// networkState=3 (NETWORK_NO_SOURCE) になり、一切再生されない。
///
/// 解釈できない指定は「範囲指定なし」として扱う(RFC 7233 は不正な
/// Range を無視して全体を返すことを求めている)。416 を返すのは、
/// 形は正しいが実際には満たせない範囲だけ。
@main
struct TestByteRange {
    static func main() {
        check("Range が無ければ全体", parseByteRange(nil, totalLength: 100) == .whole)
        check("空文字列は全体", parseByteRange("", totalLength: 100) == .whole)

        check("bytes=0-1 は先頭2バイト",
              parseByteRange("bytes=0-1", totalLength: 100) == .partial(start: 0, end: 1),
              "\(parseByteRange("bytes=0-1", totalLength: 100))")
        check("bytes=10-19 は途中の10バイト",
              parseByteRange("bytes=10-19", totalLength: 100) == .partial(start: 10, end: 19))

        check("終端の無い bytes=10- は最後まで",
              parseByteRange("bytes=10-", totalLength: 100) == .partial(start: 10, end: 99))
        check("終端がファイル長を超えたら末尾で止める",
              parseByteRange("bytes=50-999", totalLength: 100) == .partial(start: 50, end: 99))

        check("bytes=-20 は末尾20バイト",
              parseByteRange("bytes=-20", totalLength: 100) == .partial(start: 80, end: 99))
        check("末尾指定がファイル長を超えたら全体",
              parseByteRange("bytes=-500", totalLength: 100) == .partial(start: 0, end: 99))

        // 形は正しいが満たせない。ここだけ 416 になる。
        check("開始位置がファイル長以上なら満たせない",
              parseByteRange("bytes=100-", totalLength: 100) == .unsatisfiable)
        check("bytes=-0 は満たせない",
              parseByteRange("bytes=-0", totalLength: 100) == .unsatisfiable)
        check("空ファイルへの要求は満たせない",
              parseByteRange("bytes=0-", totalLength: 0) == .unsatisfiable)

        // 解釈できないものは全体を返す。中途半端に解釈して壊すより安全側に倒す。
        check("終端が開始より前なら全体",
              parseByteRange("bytes=5-3", totalLength: 100) == .whole)
        check("bytes 以外の単位は全体",
              parseByteRange("items=0-1", totalLength: 100) == .whole)
        check("数字でなければ全体",
              parseByteRange("bytes=abc", totalLength: 100) == .whole)
        check("ハイフンが無ければ全体",
              parseByteRange("bytes=10", totalLength: 100) == .whole)
        check("複数範囲は扱わないので全体",
              parseByteRange("bytes=0-1,5-6", totalLength: 100) == .whole)
        check("空白が入っていても読める",
              parseByteRange("bytes = 0 - 1 ", totalLength: 100) == .partial(start: 0, end: 1))

        // 実データで観測した要求そのもの(listening_002.m4a は 559,277 バイト)
        check("実際に来る bytes=0-1 を読める",
              parseByteRange("bytes=0-1", totalLength: 559_277) == .partial(start: 0, end: 1))
        check("実際に来る末尾寄りの要求を読める",
              parseByteRange("bytes=559027-559034", totalLength: 559_277)
                == .partial(start: 559_027, end: 559_034))

        print(failures == 0 ? "test_byte_range: ok" : "test_byte_range: \(failures) failed")
        exit(failures == 0 ? 0 : 1)
    }
}
