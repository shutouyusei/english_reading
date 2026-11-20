"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// ankiRequest uses the bridge when there is one. In the app, CORS blocks fetch, so
// taking the bridge path is what matters here. The file is loaded through vm with
// window and fetch replaced, so a call that reaches fetch is recorded.

function load({ bridge } = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../../docs/js/anki.js"), "utf8");
  const calls = { bridge: [], fetch: [] };
  const ctx = {
    window: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { querySelector: () => ({ textContent: "" }) },
    escapeHtml: (s) => String(s),
    console: { warn() {} },
    fetch: async (...args) => {
      calls.fetch.push(args);
      throw new TypeError("Load failed");
    },
  };
  if (bridge) {
    ctx.window.AnkiBridge = {
      async request(action, params) {
        calls.bridge.push({ action, params });
        return bridge(action, params);
      },
    };
  }
  vm.createContext(ctx);
  vm.runInContext(source + "\n;this.__ankiRequest = ankiRequest;", ctx);
  return { ankiRequest: ctx.__ankiRequest, calls };
}

test("uses the bridge when present and does not call fetch", async () => {
  const { ankiRequest, calls } = load({ bridge: async () => 6 });
  const result = await ankiRequest("version", {});
  assert.equal(result, 6);
  assert.equal(calls.bridge.length, 1);
  assert.deepEqual(calls.bridge[0], { action: "version", params: {} });
  assert.equal(calls.fetch.length, 0);
});

test("passes on the error thrown by the bridge instead of swallowing it", async () => {
  const { ankiRequest } = load({
    bridge: async () => { throw new Error("Cannot connect to Anki. Start Anki…"); },
  });
  await assert.rejects(() => ankiRequest("version", {}), /Cannot connect to Anki/);
});
