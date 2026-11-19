"use strict";

/* Storage layer (app build). The native side (app-shell) appends to attempts.jsonl in
   the data directory.
   Exposes the same interface as store.web.js in the public build, so the engine needs
   no changes. */

const _attempts = new Map();

async function _callStore(payload) {
  return window.webkit.messageHandlers.store.postMessage(payload);
}

window.Store = {
  async init() {
    _attempts.clear();
    const all = await _callStore({ action: "loadAll" });
    for (const attempt of all || []) {
      const list = _attempts.get(attempt.passageId) || [];
      list.push(attempt);
      _attempts.set(attempt.passageId, list);
    }
    for (const list of _attempts.values()) {
      list.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    }
  },
  attempts(passageId) {
    return _attempts.get(passageId) || [];
  },
  latest(passageId) {
    return this.attempts(passageId)[0] || null;
  },
  async saveAttempt(attempt) {
    await _callStore({ action: "saveAttempt", attempt });
    const list = _attempts.get(attempt.passageId) || [];
    list.unshift(attempt);
    _attempts.set(attempt.passageId, list);
  },
};
