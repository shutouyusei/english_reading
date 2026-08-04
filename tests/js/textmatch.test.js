"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { candidates, findVocabKey, tokenize, escapeHtml } =
  require("../../docs/js/textmatch.js");

test("candidates lowers case and strips naive suffixes", () => {
  assert.deepEqual(candidates("Fluctuates"), ["fluctuates", "fluctuat", "fluctuate"]);
  assert.deepEqual(candidates("reef"), ["reef"]);
  assert.ok(candidates("changed").includes("change"));
});

test("findVocabKey matches direct and suffix-stripped forms", () => {
  const keys = new Set(["disequilibria", "fluctuate"]);
  assert.equal(findVocabKey("Disequilibria", keys), "disequilibria");
  assert.equal(findVocabKey("fluctuates", keys), "fluctuate");
  assert.equal(findVocabKey("coral", keys), null);
});

test("tokenize preserves every character and flags words", () => {
  const parts = tokenize("Coral reefs, and algae.");
  assert.equal(parts.map((p) => p.text).join(""), "Coral reefs, and algae.");
  assert.deepEqual(
    parts.filter((p) => p.isWord).map((p) => p.text),
    ["Coral", "reefs", "and", "algae"]
  );
});

test("escapeHtml escapes special characters", () => {
  assert.equal(escapeHtml('<b>"A" & \'B\'</b>'),
    "&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;");
});
