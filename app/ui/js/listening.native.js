"use strict";

/* リスニングの学習記録(アプリ版)。
   Swift 側が ~/Documents/TOEFLReading/listening.jsonl に追記する。
   読解の store.native.js と同じ形。キーが passageId ではなく listeningId である点だけが違う。 */

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
    // 新しい順に並べる
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
