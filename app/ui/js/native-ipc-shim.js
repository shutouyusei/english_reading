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

/* wry は macOS(WKWebView)上で window.ipc.postMessage を、内部的に
   window.webkit.messageHandlers.ipc 経由で実装している。window.webkit を
   丸ごと上書きするとその内部チャンネルを壊し、window.ipc.postMessage の
   呼び出しがここに回り込んで無限再帰になる(実際にこの不具合が起きた)。
   既存のハンドラ(ipcなど)はそのまま素通しし、未知のハンドラ名だけ
   合成する。 */
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
