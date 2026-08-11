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

        exit(failures == 0 ? 0 : 1)
    }
}
