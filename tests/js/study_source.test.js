"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// vocab.js はブラウザ前提(DOM に触る)なので、純粋な部分だけを取り出して確かめる。
// buildStudySource は DOM に触れないため、この方法で検証できる。
function loadBuildStudySource() {
  const source = fs.readFileSync(
    path.join(__dirname, "../../docs/js/vocab.js"), "utf8");
  const context = { window: {}, document: undefined, module: { exports: {} } };
  vm.createContext(context);
  // 関数定義だけを評価する。トップレベルで DOM に触る文は無い。
  vm.runInContext(source + "\n;this.buildStudySource = buildStudySource;", context);
  return context.buildStudySource;
}

const passage = {
  id: "passage_001",
  title: "Peatlands",
  body: "First paragraph here.\n\nSecond paragraph here.",
  vocab: { peat: { definition: "泥炭" } },
  questions: [{ id: 1, type: "Factual" }],
};

test("本文の段落が lines になる", () => {
  const buildStudySource = loadBuildStudySource();
  const source = buildStudySource(passage, null, "reader.html?id=passage_001&mode=solve");
  assert.equal(source.lines.length, 2);
  assert.equal(source.lines[0].text, "First paragraph here.");
  assert.equal(source.lines[1].text, "Second paragraph here.");
});

test("読解の行には話者が無い", () => {
  const buildStudySource = loadBuildStudySource();
  const source = buildStudySource(passage, null, "x");
  assert.equal(source.lines[0].speaker, null);
});

test("id・title・語彙・設問がそのまま移る", () => {
  const buildStudySource = loadBuildStudySource();
  const source = buildStudySource(passage, null, "x");
  assert.equal(source.id, "passage_001");
  assert.equal(source.title, "Peatlands");
  assert.deepEqual(source.vocab, passage.vocab);
  assert.deepEqual(source.questions, passage.questions);
});

test("採点結果と遷移先が渡したものになる", () => {
  const buildStudySource = loadBuildStudySource();
  const result = { score: 3, total: 5 };
  const source = buildStudySource(passage, result, "reader.html?id=passage_001&mode=solve");
  assert.deepEqual(source.latestResult, result);
  assert.equal(source.solveUrl, "reader.html?id=passage_001&mode=solve");
});

test("空行が続いても空の段落を作らない", () => {
  const buildStudySource = loadBuildStudySource();
  const withBlanks = { ...passage, body: "A.\n\n\n\nB." };
  const source = buildStudySource(withBlanks, null, "x");
  // buildStudySource は vm.runInContext 越しに評価されるため、source.lines は
  // 別レルムの Array.prototype を持つ。Array.from はこのファイルの realm の
  // Array を使って新しい配列を作るので、deepEqual が realm 違いだけで
  // 落ちることを避けつつ、値そのものの比較の厳密さは変えない。
  assert.deepEqual(Array.from(source.lines, (l) => l.text), ["A.", "B."]);
});
