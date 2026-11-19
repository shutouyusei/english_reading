"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// listening-player.js assumes a WebView (it touches the DOM, window.Speech and so
// on), so only the pure buildListeningSource is pulled out and checked.
// ListeningStore is only read, so a stub is injected. Same approach as
// study_source.test.js and listening_player_utterances.test.js.
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
  // Objects created inside the vm context have different prototypes from this
  // realm's Object and Array, so they are normalized to plain values of this realm
  // through JSON.
  return (item) => JSON.parse(JSON.stringify(raw(item)));
}

const item = {
  id: "listening_001",
  title: "Test Talk",
  speakers: [{ id: "professor", role: "Professor", voice: "Daniel" }],
  script: [
    { speaker: "professor", text: "Line one." },
    { speaker: "professor", text: "Line two." },
    { speaker: "professor", text: "Line three." },
  ],
  questions: [{ id: 1, type: "Detail" }, { id: 2, type: "Inference" }],
};

test("a speaker id is replaced by its role (speakers[].role)", () => {
  const build = loadBuildListeningSource({ latest: () => null });
  const source = build(item);
  assert.equal(source.lines[0].speaker, "Professor");
  assert.equal(source.lines[1].speaker, "Professor");
  assert.equal(source.lines[2].speaker, "Professor");
});

test("the id in solveUrl goes through encodeURIComponent", () => {
  const build = loadBuildListeningSource({ latest: () => null });
  const source = build({ ...item, id: "listening 001&x" });
  assert.equal(
    source.solveUrl,
    `listening-player.html?id=${encodeURIComponent("listening 001&x")}&mode=solve`);
});

test("id, title and questions are carried over unchanged", () => {
  const build = loadBuildListeningSource({ latest: () => null });
  const source = build(item);
  assert.equal(source.id, item.id);
  assert.equal(source.title, item.title);
  assert.deepEqual(source.questions, item.questions);
});
