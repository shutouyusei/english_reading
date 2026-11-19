"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml } = require("../../docs/js/escape.js");

test("escapeHtml escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml('<b>"A" & \'B\'</b>'),
    "&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;");
});

// Grading results are JSON returned by Claude and their types are not checked.
// Numbers and null must be stringified instead of throwing.
test("escapeHtml coerces non-string values instead of throwing", () => {
  assert.equal(escapeHtml(5), "5");
  assert.equal(escapeHtml(null), "null");
  assert.equal(escapeHtml(undefined), "undefined");
});
