"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// vocab.js assumes a browser (it touches the DOM), so only the pure part is tested.
// buildStudySource does not touch the DOM, which makes this possible.
function loadBuildStudySource() {
  const source = fs.readFileSync(
    path.join(__dirname, "../../docs/js/vocab.js"), "utf8");
  const context = { window: {}, document: undefined, module: { exports: {} } };
  vm.createContext(context);
  // Only function definitions are evaluated; no top-level statement touches the DOM.
  vm.runInContext(source + "\n;this.buildStudySource = buildStudySource;", context);
  return context.buildStudySource;
}

const passage = {
  id: "passage_001",
  title: "Peatlands",
  body: "First paragraph here.\n\nSecond paragraph here.",
  vocab: { peat: { definition: "partly decayed plant matter" } },
  questions: [{ id: 1, type: "Factual" }],
};

test("consecutive blank lines do not produce empty paragraphs", () => {
  const buildStudySource = loadBuildStudySource();
  const withBlanks = { ...passage, body: "A.\n\n\n\nB." };
  const source = buildStudySource(withBlanks, null, "x");
  // source.lines comes from vm.runInContext, so it has another realm's Array.prototype
  // and deepEqual would fail on that alone. Array.from rebuilds it in this realm
  // without loosening the comparison of the values.
  assert.deepEqual(Array.from(source.lines, (l) => l.text), ["A.", "B."]);
});
