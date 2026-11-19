"use strict";

/* Storage layer (public site). Keeps only the latest attempt in localStorage.
   The engine does not know this file exists; it only uses the window.Store interface. */

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
    } catch (_) { /* cannot save in private mode etc.; ignore */ }
    _memory.set(attempt.passageId, [attempt]);
  },
};

if (typeof module !== "undefined") {
  module.exports = window.Store;
}
