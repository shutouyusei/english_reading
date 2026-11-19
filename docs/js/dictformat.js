"use strict";

/* Splits a dictionary definition into display blocks. The input has the format of the macOS
   system dictionary (Wisdom English-Japanese): one continuous text with no line breaks at
   all, over 20,000 characters for some words. Shown as is, the headword, parts of speech,
   sense numbers and examples all run together and it is unreadable.

   The splitting is for presentation only and never changes the meaning.
   On an unexpected shape, give up silently and return the original text as a single block.
   The original text is still easier to read than a broken structure.

   Two constraints avoid false matches. Both come from traps hit with real data:
   - 「名詞」 and 「形容詞」 also appear in running text (e.g. "前出の 名詞が"). So they count
     as a part of speech only when a sense number, countability mark or inflection mark
     follows directly.
   - Digits also appear in examples ("The park covers 35 acres"). So they count as sense
     numbers only when they continue the sequence. The inside of brackets is never examined. */

(function () {
  const POS_ALT =
    "自動詞|他動詞|助動詞|代名詞|接続詞|前置詞|間投詞|形容詞|限定詞|数詞|冠詞|副詞|名詞|動詞";
  // What may come right after a part of speech. Without it, treat the match as 「名詞」 etc.
  // in running text. Kept broad to fit real data: 自動詞1,4a / 他動詞1a / 形容詞比較なし1 /
  // 名詞複～s / 名詞C1 / 冠詞〖定冠詞〗 are all part-of-speech headings.
  const POS_FOLLOW = `(?:${POS_ALT}|[CU]{1,2}(?=[\\d〖〘])|\\d|比較|複|～|〖|〘)`;
  const OPEN = "(（〖〘【〔｟[«‹";
  const CLOSE = ")）〗〙】〕｠]»›";
  const MAX_SENSES = 60;

  /// Bracket depth at each character position. An opening or closing bracket itself counts
  /// as outside (it gets the depth at which that bracket sits).
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

  /// Positions of the part-of-speech headings. The label takes in the countability mark
  /// (C/U/UC) as well.
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
      // A dictionary entry always starts with "headword [pronunciation] part of speech".
      // Only the first one is accepted whatever follows it (some words, as in
      // 「形容詞取るに足らない」, have neither a number nor a countability mark). From the
      // second on it could be running text, so check strictly.
      if (marks.length > 0 && !follow.test(text)) continue;
      let label = match[0];
      countable.lastIndex = end;
      const count = countable.exec(text);
      if (count) {
        label += count[0];
        end += count[0].length;
      }
      marks.push({ index: match.index, end: end, label: label });
      // Keep chained parts of speech such as 「動詞自動詞」 from being matched again from inside
      finder.lastIndex = end;
    }
    return marks;
  }

  /// Headword and pronunciation. The pronunciation can be missing (yárd･stìck名詞C1 …) or
  /// there can be two or more (de･pos･it | dɪpɑ́(ː)zət | -pɔ́zɪt |).
  /// A sentence-pattern mark can follow the pronunciation (run | rʌn | ｟SV(+)｠自動詞…), so
  /// whatever comes after the last | is returned to the caller as tail, not dropped.
  ///
  /// Returns null when the length or content is implausible for a headword. This guards
  /// against swallowing body text as the headword and losing it when a part of speech is
  /// misidentified.
  const MAX_HEAD_LENGTH = 40;

  function parseHead(text) {
    const parts = text.split("|");
    const word = parts[0]
      .replace(/[･·]/g, "")
      .trim()
      // The homonym number at the end of a headword (re･fuse 1) is not needed for display
      .replace(/\s*\d+$/, "");
    if (!word || word.length > MAX_HEAD_LENGTH || word.indexOf("▸") >= 0) return null;
    const pron = parts.length > 2
      ? parts.slice(1, -1).join(" ").replace(/\s+/g, " ").trim()
      : (parts.length > 1 ? parts[1].trim() : "");
    const tail = parts.length > 2 ? parts[parts.length - 1].trim() : "";
    return { word: word, pron: pron, tail: tail };
  }

  /// Picks up only the digits that continue the sequence (1, 2, 3, …) as sense numbers.
  /// Digits that do not match are skipped.
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

  /// Sub-senses (a. b. c.). Counted as sub-senses only when the body starts with "a. " and
  /// there are two or more. This constraint keeps "a. " inside an English example from
  /// being picked up.
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
        // The "." is displayed as is, so keep it in the label. Splitting must not drop
        // characters.
        index: match.index, end: match.index + match[0].length, label: `${match[1]}.`,
      });
      expected += 1;
    }
    return marks.length > 1 ? marks : [];
  }

  /// Returns the body of each span delimited by marks. Whatever precedes marks[0] is the lead.
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

  /// One sense. Examples (▸) are cut out of the body into blocks of their own.
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
      // The indent depends on which sense an example belongs to. A CSS sibling selector
      // would also catch examples that come after the sub-senses end, so carry the level here.
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

  /// Splits the body of one part of speech into senses.
  function pushSection(blocks, body) {
    const marks = findSenseMarks(body);
    if (!marks.length) {
      pushText(blocks, body);
      return;
    }
    pushText(blocks, body.slice(0, marks[0].index));
    for (const sense of slice(body, marks)) pushSenseGroup(blocks, sense.label, sense.text);
  }

  /// A part of speech with no body is merged into one line with the next one
  /// (「動詞」+「自動詞」→「動詞・自動詞」).
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

  /// Turns a definition into an array of display blocks.
  /// Block kinds: head (headword) / pos (part of speech) / sense / example / text (the rest)
  function formatDefinition(definition) {
    const text = String(definition == null ? "" : definition).trim();
    if (!text) return [];
    const posMarks = findPosMarks(text);
    // No part of speech found = not the expected shape. Return it untouched.
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
