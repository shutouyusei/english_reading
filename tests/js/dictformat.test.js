"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// システム辞書が返す定義文は改行を1つも含まない一続きのテキストで、
// 語によっては2万字を超える。dictformat.js はそれを見出し・品詞・語義・例文の
// 塊に切り分ける。切り分けは見た目のためだけの処理なので、
// 想定外の形に当たったら元のテキストをそのまま1塊で返す(壊れるより読めない方がまし)。
//
// ここでの試料は実機の「ウィズダム英和辞典」から採取した実データ。
// 作り物の文字列では、辞書が実際に使う記法(活用形の | ... |、
// ピリオド直後に空白なく続く語義番号など)を踏めない。

function loadFormatDefinition() {
  const source = fs.readFileSync(
    path.join(__dirname, "../../docs/js/dictformat.js"), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.DictFormat.formatDefinition;
}

const MEANDER =
  "me･an･der | miǽndər | 動詞自動詞1 〈川･道路などが〉曲がりくねる; 〖～＋副詞〗 " +
  "〈人が〉あてもなくさまよう, ぶらぶら歩く (!〖副詞〗は場所などの表現) " +
  "▸ meander along ぶらぶらと歩いて行く. 2 〈話･議論などが〉とりとめもなく続く(on). " +
  "名詞C1 〖通例～s〗 (川の大きな)湾曲; 曲がりくねった道. 2 そぞろ歩き; 迂回の旅. " +
  "3 〘建〙 雷文（らいもん）.";

// 発音記号が無い語。見出しの区切りに | を当てにできないことの証拠。
const YARDSTICK = "yárd･stìck名詞C1 ヤード尺. 2 (判断･比較･測定などの)基準.";

// 活用形が | ... | を使うため、見出しの発音記号と紛れる。
// さらに「くだけた言い方.3 〖refuse AB」と、ピリオドの直後に空白なく語義番号が来る。
const REFUSE =
  "re･fuse 1 | rifjúːz | 動詞～s | -ɪz |; ～d | -d |; refusing 他動詞1 " +
  "〖refuse to do〗 〈人が〉…するのを断る ▸ refuse to give up hope 望みを捨てようとしない. " +
  "2 〈人が〉〈招待･申し出･申請など〉を断る(↔ accept). " +
  "類義 refuseとreject, decline, turn downrefuse は…くだけた言い方." +
  "3 〖refuse AB/B to A〗 A〈人〉にB〈許可など〉を与えるのを拒む. " +
  "4 〈馬が〉〈障害物〉を飛び越そうとしない. 自動詞1 〈人が〉(依頼されたことを)拒絶する, 断る. " +
  "2 〈人が〉(勧められた物･事を)断る, 辞退する.";

// 「名詞」「形容詞」が地の文に現れる。品詞の見出しとして拾ってはいけない。
const PROSE_WITH_POS_WORDS =
  "the | ðə | 冠詞〖定冠詞〗1 その, あの. " +
  "2 具体的な内容を表す前出の 名詞が, theを使ってより広い意味の 名詞で言い換えられる. " +
  "3 国籍を表す 形容詞 名詞にtheを付ける.";

// vm.runInContext の中で作られた配列は Array.prototype が別物になるため、
// そのままだと deepStrictEqual が構造の一致を見ても不一致と判定する。
// 比較に使う配列はここで手元のレルムに移しておく。
function kinds(blocks) {
  return Array.from(blocks, (b) => b.kind);
}
function ofKind(blocks, kind) {
  return Array.from(blocks).filter((b) => b.kind === kind);
}

test("見出し語と発音記号を取り出し、音節の中黒を落とす", () => {
  const blocks = loadFormatDefinition()(MEANDER);
  assert.equal(blocks[0].kind, "head");
  assert.equal(blocks[0].word, "meander");
  assert.equal(blocks[0].pron, "miǽndər");
});

test("発音記号が無い語でも見出しを取り出せる", () => {
  const blocks = loadFormatDefinition()(YARDSTICK);
  assert.equal(blocks[0].kind, "head");
  assert.equal(blocks[0].word, "yárdstìck");
  assert.equal(blocks[0].pron, "");
});

test("見出し語に付く同音異義語番号は落とす", () => {
  const blocks = loadFormatDefinition()(REFUSE);
  assert.equal(blocks[0].word, "refuse");
  assert.equal(blocks[0].pron, "rifjúːz");
});

test("中身の無い品詞は次の品詞と1つにまとめる", () => {
  const blocks = loadFormatDefinition()(MEANDER);
  const pos = ofKind(blocks, "pos").map((b) => b.text);
  // 「動詞」単独では語義を持たない。「動詞・自動詞」として1行にする。
  assert.deepEqual(pos, ["動詞・自動詞", "名詞C"]);
});

test("品詞ごとに語義番号が振り直される", () => {
  const blocks = loadFormatDefinition()(REFUSE);
  const labels = ofKind(blocks, "sense").map((b) => b.label);
  assert.deepEqual(labels, ["1", "2", "3", "4", "1", "2"]);
});

test("ピリオドの直後に空白なく続く語義番号も切り出す", () => {
  const blocks = loadFormatDefinition()(REFUSE);
  const three = ofKind(blocks, "sense").find((b) => b.label === "3");
  assert.ok(three.text.startsWith("〖refuse AB/B to A〗"),
    `語義3の本文: ${three.text.slice(0, 40)}`);
  const two = ofKind(blocks, "sense").find((b) => b.label === "2");
  assert.ok(!two.text.includes("〖refuse AB"), "語義2が語義3を巻き込んでいる");
});

test("例文は語義から切り離して独立させる", () => {
  const blocks = loadFormatDefinition()(MEANDER);
  const examples = ofKind(blocks, "example").map((b) => b.text);
  assert.deepEqual(examples, ["meander along ぶらぶらと歩いて行く."]);
  const first = ofKind(blocks, "sense")[0];
  assert.ok(!first.text.includes("▸"), "語義本文に例文が残っている");
});

test("地の文に出る「名詞」「形容詞」を品詞の見出しにしない", () => {
  const blocks = loadFormatDefinition()(PROSE_WITH_POS_WORDS);
  const pos = ofKind(blocks, "pos").map((b) => b.text);
  assert.deepEqual(pos, ["冠詞"]);
});

test("括弧の内側にある数字を語義番号にしない", () => {
  const text = "test | test | 名詞1 (→ a,an 2 語法 3 ) の意味. 2 二番目の意味.";
  const blocks = loadFormatDefinition()(text);
  const labels = ofKind(blocks, "sense").map((b) => b.label);
  assert.deepEqual(labels, ["1", "2"]);
});

test("連番が途切れたら、そこから先は切らずに残す", () => {
  const text = "test | test | 名詞1 最初. 7 これは語義番号ではない.";
  const blocks = loadFormatDefinition()(text);
  const senses = ofKind(blocks, "sense");
  assert.equal(senses.length, 1);
  assert.ok(senses[0].text.includes("7 これは語義番号ではない"));
});

// 語義の中がさらに a. b. に分かれる語。枝番は本文の先頭が "a. " のときだけ
// 枝番として扱う。英文例の中の "a. " を拾わないための縛り。
const SUBLETTER =
  "chan･nel | tʃǽn(ə)l | 名詞C1 (ラジオ･テレビの)チャンネル. " +
  "2 a. 〖しばしば～s〗 (情報などの)経路 ▸ The news came through secret channels. " +
  "そのニュースは秘密の筋から入手された b. (思考･感情などを表現する)方法, 手段. " +
  "3 海峡.";

test("語義の中の a. b. を枝番として切り出す", () => {
  const blocks = loadFormatDefinition()(SUBLETTER);
  const senses = ofKind(blocks, "sense");
  assert.deepEqual(senses.map((b) => `${b.level}:${b.label}`),
    ["1:1", "1:2", "2:a.", "2:b.", "1:3"]);
});

test("英文中の a. b. に見える並びを枝番にしない", () => {
  // 語義本文が "a. " で始まらないので、枝番の判定に入らない。
  const text = "test | test | 名詞1 前置きがある a. これは枝番ではない b. これも違う.";
  const blocks = loadFormatDefinition()(text);
  assert.deepEqual(ofKind(blocks, "sense").map((b) => b.level), [1]);
});

test("品詞が1つも無ければ、元のテキストを1塊のまま返す", () => {
  const text = "これは辞書らしくない何かのテキスト";
  const blocks = loadFormatDefinition()(text);
  assert.deepEqual(kinds(blocks), ["text"]);
  assert.equal(blocks[0].text, text);
});

test("切り出した断片をつなぐと元のテキストの文字がすべて残る", () => {
  const format = loadFormatDefinition();
  // refuse は見出しの同音異義語番号を意図的に落とすため、ここでは対象にしない
  // (その振る舞いは「見出し語に付く同音異義語番号は落とす」で押さえている)。
  for (const [name, text] of [["meander", MEANDER], ["yardstick", YARDSTICK],
                              ["channel", SUBLETTER]]) {
    const joined = format(text)
      .map((b) => (b.kind === "head" ? `${b.word}${b.pron}` : (b.label || "") + (b.text || "")))
      .join("")
      .replace(/[\s･|▸・]/g, "");
    const original = text.replace(/[\s･|▸・]/g, "");
    assert.equal(joined, original, `${name} で文字が欠けている`);
  }
});

/* ---------- 実データで踏んだ罠の回帰試験 ----------
   いずれも「ウィズダム英和辞典」の実際の項目で見つかったもの。
   作った文字列では踏めなかった形なので、実データの並びをそのまま残す。 */

test("番号も可算記号も伴わない品詞を見落とさない", () => {
  // negligible: 「形容詞」の直後がいきなり訳語。以前はこれを品詞と認めず、
  // 項目全体が1塊のまま(=整形されないまま)になっていた。
  const blocks = loadFormatDefinition()(
    "neg･li･gi･ble | néɡlɪdʒəb(ə)l | 形容詞取るに足らない, 無視してかまわない.");
  assert.deepEqual(ofKind(blocks, "pos").map((b) => b.text), ["形容詞"]);
  assert.equal(blocks[0].word, "negligible");
});

test("「形容詞比較なし1」を品詞の見出しとして拾う", () => {
  // own: 以前はこれを品詞と認めず、次に現れる「動詞」を最初の品詞と誤認し、
  // その手前の 1,832 字を見出しとして飲み込んで捨てていた。
  const blocks = loadFormatDefinition()(
    "own | oʊn | 形容詞比較なし1 〖one's ～〗 自分自身の. 動詞～s | -z | 他動詞1 …を所有する.");
  assert.deepEqual(ofKind(blocks, "pos").map((b) => b.text),
    ["形容詞", "動詞", "他動詞"]);
});

test("文型記号は見出しに飲み込まず、そのまま残す", () => {
  // run: 「run | rʌn | ｟SV(+)｠自動詞1,4a 走る」。発音記号の後ろに文型記号が来る。
  const blocks = loadFormatDefinition()("run | rʌn | ｟SV(+)｠自動詞1,4a 走る 2 急ぐ.");
  assert.equal(blocks[0].word, "run");
  assert.equal(blocks[0].pron, "rʌn");
  assert.ok(Array.from(blocks).some((b) => b.kind === "text" && b.text === "｟SV(+)｠"),
    "文型記号が消えている");
  assert.deepEqual(ofKind(blocks, "pos").map((b) => b.text), ["自動詞"]);
});

test("発音記号が2つある語で、どちらも落とさない", () => {
  // deposit: | dɪpɑ́(ː)zət | -pɔ́zɪt | のように | が3本ある。
  const blocks = loadFormatDefinition()(
    "de･pos･it | dɪpɑ́(ː)zət | -pɔ́zɪt | 名詞複～s | -ts | C1 頭金.");
  assert.equal(blocks[0].word, "deposit");
  assert.equal(blocks[0].pron, "dɪpɑ́(ː)zət -pɔ́zɪt");
});

test("見出しとして無理のある長さの前置きは、捨てずに地の文として残す", () => {
  // 品詞の取り違えが起きても本文を消さないための歯止め。
  const long = "あ".repeat(60);
  const blocks = loadFormatDefinition()(`${long}名詞1 意味.`);
  assert.equal(ofKind(blocks, "head").length, 0);
  assert.ok(Array.from(blocks).some((b) => b.kind === "text" && b.text === long),
    "前置きが消えている");
});

test("例文は属する語義の階層を持つ", () => {
  // 字下げを CSS の兄弟セレクタで決めると、枝番を抜けた後の例文まで
  // 巻き込んでしまう(~ は「以降すべての兄弟」)。階層は塊自身が持つ。
  const blocks = loadFormatDefinition()(SUBLETTER);
  const levels = ofKind(blocks, "example").map((b) => b.level);
  assert.deepEqual(levels, [2]);
});
