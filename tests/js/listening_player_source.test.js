"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// listening-player.js は WKWebView 前提(DOM・window.Speech 等に触る)なので、
// 純粋な buildListeningSource だけを取り出して確かめる。ListeningStore は
// 参照するだけなのでスタブを注入する。study_source.test.js /
// listening_player_utterances.test.js と同じやり方。
function loadBuildListeningSource(listeningStoreStub) {
  const source = fs.readFileSync(
    path.join(__dirname, "../../app/ui/js/listening-player.js"), "utf8")
    .replace(/document\.addEventListener\("DOMContentLoaded", init\);\s*$/, "");
  const context = {
    window: {}, document: undefined, module: { exports: {} },
    ListeningStore: listeningStoreStub,
  };
  vm.createContext(context);
  vm.runInContext(source + "\n;this.buildListeningSource = buildListeningSource;", context);
  const raw = context.buildListeningSource;
  // vm コンテキスト内で作られたオブジェクトは、この realm の Object/Array と
  // プロトタイプが異なるため、JSON を経由してこの realm の素の値に正規化する
  // (listening_player_utterances.test.js と同じ理由)。
  return (item) => JSON.parse(JSON.stringify(raw(item)));
}

const item = {
  id: "listening_001",
  title: "Test Talk",
  speakers: [{ id: "professor", role: "教授", voice: "Daniel" }],
  script: [
    { speaker: "professor", text: "Line one." },
    { speaker: "professor", text: "Line two." },
    { speaker: "professor", text: "Line three." },
  ],
  questions: [{ id: 1, type: "Detail" }, { id: 2, type: "Inference" }],
};

test("話者 id が役割(speakers[].role)に置き換わる", () => {
  const build = loadBuildListeningSource({ latest: () => null });
  const source = build(item);
  assert.equal(source.lines[0].speaker, "教授");
  assert.equal(source.lines[1].speaker, "教授");
  assert.equal(source.lines[2].speaker, "教授");
});

test("vocab は空オブジェクトになる(手書きの語彙解説を持たない)", () => {
  const build = loadBuildListeningSource({ latest: () => null });
  const source = build(item);
  assert.deepEqual(source.vocab, {});
});

test("solveUrl の id は encodeURIComponent を通る", () => {
  const build = loadBuildListeningSource({ latest: () => null });
  const source = build({ ...item, id: "listening 001&x" });
  assert.equal(
    source.solveUrl,
    `listening-player.html?id=${encodeURIComponent("listening 001&x")}&mode=solve`);
});

test("lines の件数は script の件数と一致する", () => {
  const build = loadBuildListeningSource({ latest: () => null });
  const source = build(item);
  assert.equal(source.lines.length, item.script.length);
});

test("latestResult は ListeningStore.latest(id) の返り値になる", () => {
  const result = { score: 4, total: 6 };
  let calledWith = null;
  const build = loadBuildListeningSource({
    latest: (id) => { calledWith = id; return result; },
  });
  const source = build(item);
  assert.deepEqual(source.latestResult, result);
  assert.equal(calledWith, item.id);
});

test("id・title・設問がそのまま移る", () => {
  const build = loadBuildListeningSource({ latest: () => null });
  const source = build(item);
  assert.equal(source.id, item.id);
  assert.equal(source.title, item.title);
  assert.deepEqual(source.questions, item.questions);
});

// speakers[] に無い話者 id が来たときの現状の記録。validate_listening.py が
// speaker を speakers[].id の集合に限定して弾くため、実データではこの分岐に
// 到達しない。ここでは挙動を変えず、現状(id がそのまま出る)を記録するだけにする。
test("speakers に無い話者は id がそのまま speaker になる(現状の記録。実データには到達しない)", () => {
  const build = loadBuildListeningSource({ latest: () => null });
  const source = build({
    ...item,
    speakers: [],
    script: [{ speaker: "ghost", text: "x" }],
  });
  assert.equal(source.lines[0].speaker, "ghost");
});
