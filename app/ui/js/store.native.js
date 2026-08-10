"use strict";

/* 保存層(アプリ版)。Swift 側が ~/Documents/TOEFLReading/attempts.jsonl に追記する。
   公開版の store.web.js と同じ口を提供するため、エンジン側の変更は不要。 */

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
    // 新しい順に並べる
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
