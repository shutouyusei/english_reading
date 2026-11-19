"use strict";

/* Listening learning records (app build).
   The native side (app-shell) appends to listening.jsonl in the data directory.
   Same shape as store.native.js for reading. The only difference is that the key is
   listeningId instead of passageId. */

const _listeningAttempts = new Map();

async function _callListening(payload) {
  return window.webkit.messageHandlers.listening.postMessage(payload);
}

window.ListeningStore = {
  async init() {
    _listeningAttempts.clear();
    const all = await _callListening({ action: "loadAll" });
    for (const attempt of all || []) {
      const list = _listeningAttempts.get(attempt.listeningId) || [];
      list.push(attempt);
      _listeningAttempts.set(attempt.listeningId, list);
    }
    for (const list of _listeningAttempts.values()) {
      list.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    }
  },
  attempts(listeningId) {
    return _listeningAttempts.get(listeningId) || [];
  },
  latest(listeningId) {
    return this.attempts(listeningId)[0] || null;
  },
  async saveAttempt(attempt) {
    await _callListening({ action: "saveAttempt", attempt });
    const list = _listeningAttempts.get(attempt.listeningId) || [];
    list.unshift(attempt);
    _listeningAttempts.set(attempt.listeningId, list);
  },
};
