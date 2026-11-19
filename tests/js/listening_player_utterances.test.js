"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// listening-player.js assumes a WebView (it touches the DOM, window.Speech and so
// on), so only the pure utterancesOf is pulled out and checked. The DOMContentLoaded
// listener on the last line of the file touches document, so that line alone is
// stripped before evaluating. Same approach as study_source.test.js.
function loadUtterancesOf() {
  const source = fs.readFileSync(
    path.join(__dirname, "../../app/ui/js/listening-player.js"), "utf8")
    .replace(/document\.addEventListener\("DOMContentLoaded", init\);\s*$/, "");
  const context = { window: {}, document: undefined, module: { exports: {} } };
  vm.createContext(context);
  vm.runInContext(source + "\n;this.utterancesOf = utterancesOf;", context);
  const raw = context.utterancesOf;
  // Arrays created inside the vm context have a different prototype from this
  // realm's Array, and assert.deepEqual can reject them even when the structure
  // matches. They are normalized to plain arrays and objects of this realm through
  // JSON.
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

test("lines that all share one speaker fold into a single utterance (lecture)", () => {
  const utterancesOf = loadUtterancesOf();
  const result = utterancesOf(lecture);
  assert.equal(result.length, 1);
  assert.equal(result[0].voice, "Daniel");
  assert.equal(result[0].text, "Line one.\n\nLine two.\n\nLine three.");
});

test("two alternating speakers keep one utterance per line (conversation)", () => {
  const utterancesOf = loadUtterancesOf();
  const result = utterancesOf(conversation);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((u) => u.voice), ["Daniel", "Samantha", "Daniel", "Samantha"]);
  assert.deepEqual(result.map((u) => u.text), ["Q1", "A1", "Q2", "A2"]);
});

test("only consecutive lines by the same speaker are folded", () => {
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
