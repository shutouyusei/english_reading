"use strict";

/* A thin layer that re-implements the window.webkit.messageHandlers.<name>.postMessage()
   calling convention (returns a Promise), unchanged, on top of wry's one-way
   window.ipc.postMessage.
   The existing *.native.js files are not changed at all. Loaded only in the app-shell build.
   (See docs/superpowers/specs/2026-09-03-cross-platform-shell-design.md) */

let _requestSeq = 0;
const _pending = new Map();

window.__toeflIpc = {
  call(handler, payload) {
    const requestId = String(++_requestSeq);
    return new Promise((resolve, reject) => {
      _pending.set(requestId, { resolve, reject });
      window.ipc.postMessage(JSON.stringify({ handler, requestId, ...payload }));
    });
  },
};

window.__toeflIpcResolve = function (requestId, result, error) {
  const pending = _pending.get(requestId);
  if (!pending) return;
  _pending.delete(requestId);
  if (error) {
    pending.reject(new Error(error));
  } else {
    pending.resolve(result);
  }
};

/* On macOS (WKWebView), wry implements window.ipc.postMessage internally through
   window.webkit.messageHandlers.ipc. Overwriting window.webkit wholesale breaks
   that internal channel, and calls to window.ipc.postMessage loop back here into
   infinite recursion (this bug actually happened).
   Existing handlers (ipc and so on) are passed straight through, and only unknown
   handler names are synthesized. */
const _existingHandlers = (window.webkit && window.webkit.messageHandlers) || {};

window.webkit = {
  messageHandlers: new Proxy(_existingHandlers, {
    get(target, handlerName) {
      if (handlerName in target) {
        return target[handlerName];
      }
      return {
        postMessage: (payload) => window.__toeflIpc.call(handlerName, payload),
      };
    },
  }),
};
