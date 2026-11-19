"use strict";

/* Dictionary layer (app build). Meant to look words up through the native side
   (app-shell). For now the app-shell handler is a placeholder that always returns an
   error (app-shell/src/ipc/placeholder.rs).
   Exposes the same interface as dict.web.js in the public build, so callers need no
   branching. */

const _definitions = new Map();

window.Dict = {
  /** Returns {word, definition, source} if a definition is found, otherwise null. Never throws. */
  async define(word) {
    const key = String(word == null ? "" : word).trim().toLowerCase();
    if (!key) return null;
    if (_definitions.has(key)) return _definitions.get(key);

    let reply;
    try {
      reply = await window.webkit.messageHandlers.dictionary.postMessage({
        action: "define",
        word: key,
      });
    } catch (err) {
      // The dictionary is an aid to reading the passage, not the main feature. Even when a
      // lookup fails, keep showing the passage and the vocabulary notes.
      // The failure is not cached here so the next click can recover from a temporary one.
      console.warn("辞書を引けませんでした:", err);
      return null;
    }

    const result = reply && reply.definition
      ? { word: key, definition: reply.definition, source: reply.source || null }
      : null;
    // "Not in the dictionary" is a result too. Caching it avoids repeated round trips
    // for the same word.
    _definitions.set(key, result);
    return result;
  },
};
