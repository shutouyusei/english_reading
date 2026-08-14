"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml } = require("../../docs/js/escape.js");

test("escapeHtml escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml('<b>"A" & \'B\'</b>'),
    "&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;");
});

test("escapeHtml neutralises a script tag", () => {
  assert.equal(escapeHtml("<script>alert(1)</script>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("escapeHtml leaves ordinary text untouched", () => {
  assert.equal(escapeHtml("Coral reefs support 25% of marine life."),
    "Coral reefs support 25% of marine life.");
});

// 採点結果は Claude が返す JSON で、型を検査していない。
// 数値や null がそのまま渡っても落ちずに文字列化されること。
test("escapeHtml coerces non-string values instead of throwing", () => {
  assert.equal(escapeHtml(5), "5");
  assert.equal(escapeHtml(null), "null");
  assert.equal(escapeHtml(undefined), "undefined");
});

test("escapeHtml escapes every occurrence, not just the first", () => {
  assert.equal(escapeHtml("<<<"), "&lt;&lt;&lt;");
});
