"use strict";

/* 純粋関数のみ。DOMに触れないこと(nodeでテストするため)。 */

const SUFFIXES = ["ing", "ed", "es", "s"];
const MIN_STEM_LEN = 3;
const WORD_RE = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;

function candidates(token) {
  const lowered = token.toLowerCase();
  const forms = [lowered];
  for (const suffix of SUFFIXES) {
    if (lowered.endsWith(suffix) && lowered.length - suffix.length >= MIN_STEM_LEN) {
      const stem = lowered.slice(0, -suffix.length);
      forms.push(stem);
      if (suffix === "ing" || suffix === "ed") {
        forms.push(stem + "e");  // changed -> change, attributed -> attribute
      }
    }
  }
  return forms;
}

function findVocabKey(token, vocabKeys) {
  for (const form of candidates(token)) {
    if (vocabKeys.has(form)) return form;
  }
  return null;
}

function tokenize(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(WORD_RE)) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), isWord: false });
    }
    parts.push({ text: match[0], isWord: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), isWord: false });
  return parts;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

if (typeof module !== "undefined") {
  module.exports = { candidates, findVocabKey, tokenize, escapeHtml };
}
