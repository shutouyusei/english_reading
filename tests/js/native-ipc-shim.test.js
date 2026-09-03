"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

function loadShim() {
  const sent = [];
  global.window = {
    ipc: { postMessage: (raw) => sent.push(JSON.parse(raw)) },
  };
  delete require.cache[require.resolve("../../app/ui/js/native-ipc-shim.js")];
  require("../../app/ui/js/native-ipc-shim.js");
  return { sent };
}

test("postMessage経由でhandler/requestId/payloadを送る", () => {
  const { sent } = loadShim();
  window.webkit.messageHandlers.store.postMessage({ action: "loadAll" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].handler, "store");
  assert.equal(sent[0].action, "loadAll");
  assert.equal(typeof sent[0].requestId, "string");
});

test("resolveが呼ばれるとPromiseが解決する", async () => {
  const { sent } = loadShim();
  const promise = window.webkit.messageHandlers.essays.postMessage({ action: "loadAll" });
  const requestId = sent[0].requestId;
  window.__toeflIpcResolve(requestId, [{ id: 1 }], null);
  const result = await promise;
  assert.deepEqual(result, [{ id: 1 }]);
});

test("errorが渡されるとPromiseがrejectする", async () => {
  const { sent } = loadShim();
  const promise = window.webkit.messageHandlers.anki.postMessage({ action: "request" });
  const requestId = sent[0].requestId;
  window.__toeflIpcResolve(requestId, null, "接続できません");
  await assert.rejects(promise, /接続できません/);
});

test("異なるハンドラ名は個別のリクエストとして送られる", () => {
  const { sent } = loadShim();
  window.webkit.messageHandlers.store.postMessage({ action: "loadAll" });
  window.webkit.messageHandlers.grader.postMessage({ action: "grade" });
  assert.equal(sent[0].handler, "store");
  assert.equal(sent[1].handler, "grader");
  assert.notEqual(sent[0].requestId, sent[1].requestId);
});

test("未知のrequestIdでresolveされても例外にならない", () => {
  loadShim();
  assert.doesNotThrow(() => window.__toeflIpcResolve("does-not-exist", null, null));
});

test("wryが事前に用意したwindow.webkit.messageHandlers.ipcは上書きしない", () => {
  // wry はmacOS上でwindow.ipc.postMessageを、内部的に
  // window.webkit.messageHandlers.ipc経由で実装している。シムがwindow.webkitを
  // 丸ごと上書きすると、この内部チャンネルが壊れてwindow.ipc.postMessageの
  // 呼び出しがシム自身に回り込み、無限再帰になる(実際に起きた不具合の再発防止)。
  const nativeIpcCalls = [];
  global.window = {
    webkit: {
      messageHandlers: {
        ipc: { postMessage: (raw) => nativeIpcCalls.push(raw) },
      },
    },
  };
  window.ipc = { postMessage: (raw) => window.webkit.messageHandlers.ipc.postMessage(raw) };
  delete require.cache[require.resolve("../../app/ui/js/native-ipc-shim.js")];
  require("../../app/ui/js/native-ipc-shim.js");

  window.webkit.messageHandlers.store.postMessage({ action: "loadAll" });

  assert.equal(nativeIpcCalls.length, 1);
  const sent = JSON.parse(nativeIpcCalls[0]);
  assert.equal(sent.handler, "store");
});
