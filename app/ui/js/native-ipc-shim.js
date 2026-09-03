"use strict";

/* window.webkit.messageHandlers.<name>.postMessage() の呼び出し規約(Promiseを返す)を
   崩さずに、wry の window.ipc.postMessage(一方向)の上に実装し直す薄い層。
   既存の *.native.js は一切変更しない。app-shell 版でのみ読み込む。
   (docs/superpowers/specs/2026-09-03-cross-platform-shell-design.md 参照) */

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

window.webkit = {
  messageHandlers: new Proxy(
    {},
    {
      get(_target, handlerName) {
        return {
          postMessage: (payload) => window.__toeflIpc.call(handlerName, payload),
        };
      },
    }
  ),
};
