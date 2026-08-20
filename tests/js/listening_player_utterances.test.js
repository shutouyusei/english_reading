"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// listening-player.js は WKWebView 前提(DOM・window.Speech 等に触る)なので、
// 純粋な utterancesOf だけを取り出して確かめる。DOMContentLoaded の
// リスナ登録(ファイル末尾の1行)は document に触るため、それだけ除いて
// 評価する。study_source.test.js と同じやり方。
function loadUtterancesOf() {
  const source = fs.readFileSync(
    path.join(__dirname, "../../app/ui/js/listening-player.js"), "utf8")
    .replace(/document\.addEventListener\("DOMContentLoaded", init\);\s*$/, "");
  const context = { window: {}, document: undefined, module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(source + "\n;this.utterancesOf = utterancesOf;", context);
  const raw = context.utterancesOf;
  // vm コンテキスト内で作られた配列は、この realm の Array と
  // プロトタイプが異なり assert.deepEqual が構造一致でも弾くことがある
  // (study_source.test.js は呼び出し元のオブジェクトをそのまま
  // 通すだけなのでこの問題に当たらない)。JSON を経由してこの realm の
  // 素の配列・オブジェクトに正規化する。
  return (item) => JSON.parse(JSON.stringify(raw(item)));
}

const lecture = {
  speakers: [{ id: "professor", voice: "Daniel" }],
  script: [
    { speaker: "professor", text: "Line one." },
    { speaker: "professor", text: "Line two." },
    { speaker: "professor", text: "Line three." },
  ],
};

const conversation = {
  speakers: [
    { id: "host", voice: "Daniel" },
    { id: "guest", voice: "Samantha" },
  ],
  script: [
    { speaker: "host", text: "Q1" },
    { speaker: "guest", text: "A1" },
    { speaker: "host", text: "Q2" },
    { speaker: "guest", text: "A2" },
  ],
};

const mixed = {
  speakers: [
    { id: "host", voice: "Daniel" },
    { id: "guest", voice: "Samantha" },
  ],
  script: [
    { speaker: "host", text: "H1" },
    { speaker: "host", text: "H2" },
    { speaker: "guest", text: "G1" },
    { speaker: "host", text: "H3" },
    { speaker: "host", text: "H4" },
    { speaker: "host", text: "H5" },
  ],
};

test("全行が同一話者なら1発話に畳まれる(講義)", () => {
  const utterancesOf = loadUtterancesOf();
  const result = utterancesOf(lecture);
  assert.equal(result.length, 1);
  assert.equal(result[0].voice, "Daniel");
  assert.equal(result[0].text, "Line one.\n\nLine two.\n\nLine three.");
});

test("2話者が交互なら発話数が保たれる(会話)", () => {
  const utterancesOf = loadUtterancesOf();
  const result = utterancesOf(conversation);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((u) => u.voice), ["Daniel", "Samantha", "Daniel", "Samantha"]);
  assert.deepEqual(result.map((u) => u.text), ["Q1", "A1", "Q2", "A2"]);
});

test("同一話者が連続する箇所だけが畳まれる", () => {
  const utterancesOf = loadUtterancesOf();
  const result = utterancesOf(mixed);
  assert.equal(result.length, 3);
  assert.equal(result[0].voice, "Daniel");
  assert.equal(result[0].text, "H1\n\nH2");
  assert.equal(result[1].voice, "Samantha");
  assert.equal(result[1].text, "G1");
  assert.equal(result[2].voice, "Daniel");
  assert.equal(result[2].text, "H3\n\nH4\n\nH5");
});

test("話者に対応する voice が無ければ空文字になる", () => {
  const utterancesOf = loadUtterancesOf();
  const result = utterancesOf({
    speakers: [],
    script: [{ speaker: "unknown", text: "x" }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].voice, "");
});
