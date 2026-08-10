"use strict";

/* 保存層(公開版)。localStorage に最新の1件だけを保持する。
   エンジンはこのファイルの存在を知らず、window.Store の口だけを使う。 */

const STORE_PREFIX = "results.";
const _memory = new Map();

function _readStored(passageId) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + passageId);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved && typeof saved === "object" ? saved : null;
  } catch (_) {
    return null;
  }
}

window.Store = {
  async init() {
    _memory.clear();
  },
  attempts(passageId) {
    if (_memory.has(passageId)) return _memory.get(passageId);
    const stored = _readStored(passageId);
    return stored ? [stored] : [];
  },
  latest(passageId) {
    return this.attempts(passageId)[0] || null;
  },
  async saveAttempt(attempt) {
    try {
      localStorage.setItem(
        STORE_PREFIX + attempt.passageId,
        JSON.stringify(attempt)
      );
    } catch (_) { /* プライベートモード等では保存しない */ }
    _memory.set(attempt.passageId, [attempt]);
  },
};

if (typeof module !== "undefined") {
  module.exports = window.Store;
}
