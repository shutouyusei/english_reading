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

test("postMessage sends the handler, a requestId and the payload", () => {
  const { sent } = loadShim();
  window.webkit.messageHandlers.store.postMessage({ action: "loadAll" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].handler, "store");
  assert.equal(sent[0].action, "loadAll");
  assert.equal(typeof sent[0].requestId, "string");
});

test("the promise rejects when the reply carries an error", async () => {
  const { sent } = loadShim();
  const promise = window.webkit.messageHandlers.anki.postMessage({ action: "request" });
  const requestId = sent[0].requestId;
  window.__toeflIpcResolve(requestId, null, "cannot connect");
  await assert.rejects(promise, /cannot connect/);
});

test("the window.webkit.messageHandlers.ipc that wry set up is not overwritten", () => {
  // On macOS, wry implements window.ipc.postMessage through
  // window.webkit.messageHandlers.ipc. If the shim replaced window.webkit wholesale,
  // that channel would break and window.ipc.postMessage would loop back into the
  // shim, recursing forever. This bug happened once.
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
