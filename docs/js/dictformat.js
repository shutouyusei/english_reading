"use strict";

/* システム辞書(ウィズダム英和)の定義文を、表示用の塊に切り分ける。
   辞書が返すのは改行を1つも含まない一続きのテキストで、語によっては2万字を超える。
   そのまま出すと見出しも品詞も語義番号も例文も地続きになり、読めない。

   切り分けは見た目のためだけの処理で、意味は一切変えない。
   想定外の形に当たったら黙って諦め、元のテキストを1塊のまま返す。
   崩れた構造を見せるより、元のままの方がまだ読める。

   誤爆を避ける縛りが2つある。どちらも実データで踏んだ罠に対応する:
   ・「名詞」「形容詞」は地の文にも出る("前出の 名詞が"など)。そのため
     直後に語義番号・可算記号・活用記号が続くときだけ品詞と見なす。
   ・数字は例文にも出る("The park covers 35 acres")。そのため連番が
     合うときだけ語義番号と見なす。括弧の内側は最初から見ない。 */

(function () {
  const POS_ALT =
    "自動詞|他動詞|助動詞|代名詞|接続詞|前置詞|間投詞|形容詞|限定詞|数詞|冠詞|副詞|名詞|動詞";
  // 品詞の直後に来てよいもの。これが続かなければ地の文の「名詞」等と判断する。
  // 実データに合わせて広めに取る: 自動詞1,4a / 他動詞1a / 形容詞比較なし1 / 名詞複～s /
  // 名詞C1 / 冠詞〖定冠詞〗 のいずれも品詞の見出しである。
  const POS_FOLLOW = `(?:${POS_ALT}|[CU]{1,2}(?=[\\d〖〘])|\\d|比較|複|～|〖|〘)`;
  const OPEN = "(（〖〘【〔｟[«‹";
  const CLOSE = ")）〗〙】〕｠]»›";
  const MAX_SENSES = 60;

  /// 各文字位置の括弧の深さ。開き括弧自身と閉じ括弧自身は外側(その括弧の深さ)に置く。
  function depths(text) {
    const out = new Array(text.length);
    let depth = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (CLOSE.indexOf(ch) >= 0 && depth > 0) depth -= 1;
      out[i] = depth;
      if (OPEN.indexOf(ch) >= 0) depth += 1;
    }
    return out;
  }

  /// 品詞の見出しの位置。可算記号(C/U/UC)まで取り込んでラベルにする。
  function findPosMarks(text) {
    const depth = depths(text);
    const finder = new RegExp(POS_ALT, "g");
    const follow = new RegExp(POS_FOLLOW, "y");
    const countable = /[CU]{1,2}(?=[\d〖〘])/y;
    const marks = [];
    let match;
    while ((match = finder.exec(text)) !== null) {
      if (depth[match.index] !== 0) continue;
      let end = match.index + match[0].length;
      follow.lastIndex = end;
      // 辞書の項目は必ず「見出し語 [発音] 品詞」で始まる。最初の1つだけは
      // 直後の形を問わずに認める(「形容詞取るに足らない」のように、
      // 番号も可算記号も伴わない語があるため)。2つ目からは地の文と紛れるので厳しく見る。
      if (marks.length > 0 && !follow.test(text)) continue;
      let label = match[0];
      countable.lastIndex = end;
      const count = countable.exec(text);
      if (count) {
        label += count[0];
        end += count[0].length;
      }
      marks.push({ index: match.index, end: end, label: label });
      // 「動詞自動詞」のように品詞が連なる形を、内側から重ねて拾わないようにする
      finder.lastIndex = end;
    }
    return marks;
  }

  /// 見出し語と発音記号。発音記号は無いことも(yárd･stìck名詞C1 …)、
  /// 2つ以上あることもある(de･pos･it | dɪpɑ́(ː)zət | -pɔ́zɪt |)。
  /// 発音記号の後ろに文型記号が続くこともある(run | rʌn | ｟SV(+)｠自動詞…)ので、
  /// 最後の | より後ろは tail として呼び出し側に返し、捨てない。
  ///
  /// 見出しとして無理がある長さ・中身なら null を返す。品詞の取り違えが起きたとき、
  /// 本文を見出しとして飲み込んで消してしまうのを防ぐための歯止め。
  const MAX_HEAD_LENGTH = 40;

  function parseHead(text) {
    const parts = text.split("|");
    const word = parts[0]
      .replace(/[･·]/g, "")
      .trim()
      // 見出し語末尾の同音異義語番号(re･fuse 1)は表示に要らない
      .replace(/\s*\d+$/, "");
    if (!word || word.length > MAX_HEAD_LENGTH || word.indexOf("▸") >= 0) return null;
    const pron = parts.length > 2
      ? parts.slice(1, -1).join(" ").replace(/\s+/g, " ").trim()
      : (parts.length > 1 ? parts[1].trim() : "");
    const tail = parts.length > 2 ? parts[parts.length - 1].trim() : "";
    return { word: word, pron: pron, tail: tail };
  }

  /// 連番が合う数字だけを語義番号として拾う。途切れたらそこで打ち切る。
  function findSenseMarks(body) {
    const depth = depths(body);
    const finder = /(\d+)\s/g;
    const marks = [];
    let expected = 1;
    let match;
    while ((match = finder.exec(body)) !== null) {
      if (depth[match.index] !== 0) continue;
      if (Number(match[1]) !== expected) continue;
      marks.push({
        index: match.index, end: match.index + match[0].length, label: match[1],
      });
      expected += 1;
      if (expected > MAX_SENSES) break;
    }
    return marks;
  }

  /// 枝番(a. b. c.)。本文が "a. " で始まり、2つ以上並ぶときだけ枝番と見なす。
  /// 英文例の中の "a. " を拾わないための縛り。
  function findSubMarks(body) {
    if (!/^[a-z]\.\s/.test(body)) return [];
    const depth = depths(body);
    const finder = /([a-z])\.\s/g;
    const marks = [];
    let expected = "a".charCodeAt(0);
    let match;
    while ((match = finder.exec(body)) !== null) {
      if (depth[match.index] !== 0) continue;
      if (match[1].charCodeAt(0) !== expected) continue;
      marks.push({
        // "." はそのまま表示に使うのでラベルに残す。切り分けで文字が消えないようにする。
        index: match.index, end: match.index + match[0].length, label: `${match[1]}.`,
      });
      expected += 1;
    }
    return marks.length > 1 ? marks : [];
  }

  /// marks で区切った各区間の本文を返す。marks[0] より前は lead。
  function slice(body, marks) {
    return marks.map((mark, i) => ({
      label: mark.label,
      text: body.slice(mark.end, i + 1 < marks.length ? marks[i + 1].index : body.length),
    }));
  }

  function pushText(blocks, text) {
    const trimmed = text.trim();
    if (trimmed) blocks.push({ kind: "text", text: trimmed });
  }

  /// 語義1つ分。例文(▸)を本文から切り離して独立した塊にする。
  function pushSense(blocks, label, level, text) {
    const depth = depths(text);
    const cuts = [];
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "▸" && depth[i] === 0) cuts.push(i);
    }
    const lead = (cuts.length ? text.slice(0, cuts[0]) : text).trim();
    blocks.push({ kind: "sense", label: label, level: level, text: lead });
    cuts.forEach((start, i) => {
      const end = i + 1 < cuts.length ? cuts[i + 1] : text.length;
      const example = text.slice(start + 1, end).trim();
      // どの語義に属す例文かは字下げに要る。CSS の兄弟セレクタでは
      // 枝番を抜けた後の例文まで巻き込むため、ここで持たせる。
      if (example) blocks.push({ kind: "example", level: level, text: example });
    });
  }

  function pushSenseGroup(blocks, label, text) {
    const subs = findSubMarks(text.trim());
    if (!subs.length) {
      pushSense(blocks, label, 1, text);
      return;
    }
    const body = text.trim();
    pushSense(blocks, label, 1, body.slice(0, subs[0].index));
    for (const sub of slice(body, subs)) pushSense(blocks, sub.label, 2, sub.text);
  }

  /// 1つの品詞の中身を語義に切り分ける。
  function pushSection(blocks, body) {
    const marks = findSenseMarks(body);
    if (!marks.length) {
      pushText(blocks, body);
      return;
    }
    pushText(blocks, body.slice(0, marks[0].index));
    for (const sense of slice(body, marks)) pushSenseGroup(blocks, sense.label, sense.text);
  }

  /// 中身を持たない品詞は、次の品詞と1行にまとめる(「動詞」+「自動詞」→「動詞・自動詞」)。
  function mergeEmpty(sections) {
    const merged = [];
    let carried = "";
    for (const section of sections) {
      const label = carried ? `${carried}・${section.label}` : section.label;
      const body = section.body.trim();
      if (!body) {
        carried = label;
        continue;
      }
      merged.push({ label: label, body: body });
      carried = "";
    }
    if (carried) merged.push({ label: carried, body: "" });
    return merged;
  }

  /// 定義文を表示用の塊の配列にする。
  /// 塊の種類: head(見出し) / pos(品詞) / sense(語義) / example(例文) / text(その他)
  function formatDefinition(definition) {
    const text = String(definition == null ? "" : definition).trim();
    if (!text) return [];
    const posMarks = findPosMarks(text);
    // 品詞が1つも見つからない = 想定した形ではない。手を加えずに返す。
    if (!posMarks.length) return [{ kind: "text", text: text }];

    const blocks = [];
    if (posMarks[0].index > 0) {
      const prefix = text.slice(0, posMarks[0].index);
      const head = parseHead(prefix);
      if (head) {
        blocks.push({ kind: "head", word: head.word, pron: head.pron });
        pushText(blocks, head.tail);
      } else {
        pushText(blocks, prefix);
      }
    }
    const sections = posMarks.map((mark, i) => ({
      label: mark.label,
      body: text.slice(mark.end, i + 1 < posMarks.length ? posMarks[i + 1].index : text.length),
    }));
    for (const section of mergeEmpty(sections)) {
      blocks.push({ kind: "pos", text: section.label });
      pushSection(blocks, section.body);
    }
    return blocks;
  }

  window.DictFormat = { formatDefinition: formatDefinition };
})();
