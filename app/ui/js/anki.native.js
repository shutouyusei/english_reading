"use strict";

/* Anki layer (app build). The native side (app-shell) queries AnkiConnect over HTTP.

   Why go through it: a fetch straight from the WebView has the page origin app://local,
   which AnkiConnect does not have in its allow list, so it returns no
   Access-Control-Allow-Origin. The browser blocks the response and JS only sees
   "Load failed". Native code has no same-origin policy, so this route does not depend
   on Anki's configuration. */

window.AnkiBridge = {
  /** Run an AnkiConnect action and return its result. Throws with the reason on failure. */
  async request(action, params) {
    const reply = await window.webkit.messageHandlers.anki.postMessage({
      action: "request",
      ankiAction: action,
      params: params || {},
    });
    return reply ? reply.result : null;
  },
};
