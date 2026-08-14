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

/// JSONLinesFile はファイルへ実際に書くため、使い捨てのディレクトリを1つ作って
/// その中だけで確かめる。既存の学習ログには触れない。
func testJSONLinesFile() {
    let tempDir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("jsonl-test-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let log = JSONLinesFile(directory: tempDir, filename: "rows.jsonl")

    check("ファイルがまだ無いときは空配列を返す", log.loadAll().isEmpty)

    do {
        try log.append(["id": "a", "score": 1])
    } catch {
        check("1行目を書ける(ファイルが無い状態から)", false)
        return
    }
    let afterFirst = log.loadAll()
    check("1行目を書ける(ファイルが無い状態から)",
          afterFirst.count == 1 && afterFirst.first?["id"] as? String == "a")

    // 核心: 2行目を足しても1行目が消えない(追記であって上書きではない)。
    do {
        try log.append(["id": "b", "score": 2])
        try log.append(["id": "c", "score": 3])
    } catch {
        check("既存ファイルの末尾に追記できる", false)
        return
    }
    let afterThird = log.loadAll()
    check("既存ファイルの末尾に追記できる",
          afterThird.count == 3 &&
          afterThird.map { $0["id"] as? String } == ["a", "b", "c"])

    // 各行が改行で区切られていること。区切りが無いと次回の読み出しで1行に潰れる。
    let raw = (try? String(contentsOf: tempDir.appendingPathComponent("rows.jsonl"),
                           encoding: .utf8)) ?? ""
    check("各行が改行で終わっている",
          raw.hasSuffix("\n") && raw.split(separator: "\n").count == 3)

    // 保存先ディレクトリがまだ無くても、初回の append で作られる。
    let nestedDir = tempDir.appendingPathComponent("not-created-yet")
    let nested = JSONLinesFile(directory: nestedDir, filename: "rows.jsonl")
    do {
        try nested.append(["id": "z"])
        check("保存先ディレクトリが無くても書ける", nested.loadAll().count == 1)
    } catch {
        check("保存先ディレクトリが無くても書ける", false)
    }
}

@main
struct TestJSONLinesLog {
    static func main() {
        let normalText = """
        {"passageId":"passage_001","score":1}
        {"passageId":"passage_002","score":0}
        """
        let normalData = normalText.data(using: .utf8)!
        let normalResult = parseJSONLines(normalData)
        check("正常な2行を読める(件数)", normalResult.count == 2)
        check("正常な2行を読める(1行目のpassageId)",
              normalResult.first?["passageId"] as? String == "passage_001")

        // 核心: 末尾が不正なUTF-8バイトで切れていても、それ以前の行は読める。
        // (追記の途中でクラッシュや電源断が起きた場合を想定)
        var brokenTailData = normalText.data(using: .utf8)!
        brokenTailData.append(0x0A)
        brokenTailData.append(contentsOf: [0xE6, 0x97]) // 「日」の3バイトシーケンスが途中で切れている
        let brokenTailResult = parseJSONLines(brokenTailData)
        check("末尾が不正なUTF-8バイトで切れていても、それ以前の行は読める",
              brokenTailResult.count == 2 &&
              brokenTailResult.first?["passageId"] as? String == "passage_001")

        let withBlankLines = "\n\n" + normalText + "\n\n\n"
        let blankLinesData = withBlankLines.data(using: .utf8)!
        check("空行が混ざっていても無視される", parseJSONLines(blankLinesData).count == 2)

        let withBrokenJSON = normalText + "\n" + "{\"passageId\":\"passage_003\"," // 閉じ括弧が無い
        let brokenJSONData = withBrokenJSON.data(using: .utf8)!
        check("JSONとして壊れた行はその行だけ捨てられる", parseJSONLines(brokenJSONData).count == 2)

        let withArrayLine = normalText + "\n" + "[1,2,3]"
        let arrayLineData = withArrayLine.data(using: .utf8)!
        check("配列など、オブジェクトでないJSON行は捨てられる", parseJSONLines(arrayLineData).count == 2)

        check("空のデータでは空配列を返す", parseJSONLines(Data()).isEmpty)

        // essays.jsonl は kind の異なる行が混在する。どちらも辞書として読める。
        let mixedText = """
        {"kind":"essay","essayId":"e_1","promptId":"writing_001"}
        {"kind":"grade","essayId":"e_1","overall":4}
        """
        let mixedResult = parseJSONLines(mixedText.data(using: .utf8)!)
        check("kind の異なる行が混在していても両方読める",
              mixedResult.count == 2 &&
              mixedResult.first?["kind"] as? String == "essay" &&
              mixedResult.last?["kind"] as? String == "grade")

        testJSONLinesFile()

        exit(failures == 0 ? 0 : 1)
    }
}
