"use strict";

/* Speech layer (app build). The native side is meant to synthesize audio from the
   script, put it in audio/ under the data directory, and return it as an audio:// URL.
   For now the app-shell handler is a placeholder that always returns an error
   (app-shell/src/ipc/placeholder.rs).

   Note: window.Audio is the browser's standard Audio constructor, and
   window.speechSynthesis is a standard API too. Neither may be overwritten. */

const _urls = new Map();

window.Speech = {
  /** Prepare audio from the script and return its URL. Throws on failure (the caller
      shows it on screen). If options.force is true, rebuild on the assumption that
      the cache is broken. */
  async prepare(id, utterances, options = {}) {
    const force = options.force === true;
    if (!force && _urls.has(id)) return { url: _urls.get(id) };

    const reply = await window.webkit.messageHandlers.speech.postMessage({
      action: "prepare",
      id,
      utterances,
      force,
    });
    if (!reply || !reply.url) throw new Error("音声のURLを受け取れませんでした");

    // Change the query string so WebKit does not reuse the old content after a rebuild.
    // The audio:// handler in app-shell looks only at the path, so the suffix is harmless.
    const url = force ? `${reply.url}?r=${Date.now()}` : reply.url;
    _urls.set(id, url);
    return { url };
  },
};
