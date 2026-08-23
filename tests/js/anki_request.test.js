"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// ankiRequest は「ブリッジがあればそれを使い、無ければ fetch する」二枚舌になる。
// アプリ版では CORS のせいで fetch が通らないため、この選択が正しく効くことが要点。
// vm でファイルを読み、window と fetch を差し替えて分岐を確かめる。

function load({ bridge, fetchImpl } = {}) {
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
      if (!fetchImpl) throw new TypeError("Load failed");
      return fetchImpl(...args);
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

test("ブリッジがあればブリッジを使い、fetch は呼ばない", async () => {
  const { ankiRequest, calls } = load({ bridge: async () => 6 });
  const result = await ankiRequest("version", {});
  assert.equal(result, 6);
  assert.equal(calls.bridge.length, 1);
  assert.deepEqual(calls.bridge[0], { action: "version", params: {} });
  assert.equal(calls.fetch.length, 0);
});

test("ブリッジが無ければ従来どおり fetch を使う", async () => {
  const { ankiRequest, calls } = load({
    fetchImpl: async () => ({ json: async () => ({ result: 6, error: null }) }),
  });
  assert.equal(await ankiRequest("version", {}), 6);
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.bridge.length, 0);
});

test("ブリッジが投げた理由をそのまま伝える(握りつぶさない)", async () => {
  const { ankiRequest } = load({
    bridge: async () => { throw new Error("Anki に接続できません。Anki を起動し…"); },
  });
  await assert.rejects(() => ankiRequest("version", {}), /Anki に接続できません/);
});

test("fetch 経路でも Anki が返した error を throw する", async () => {
  const { ankiRequest } = load({
    fetchImpl: async () => ({ json: async () => ({ result: null, error: "deck not found" }) }),
  });
  await assert.rejects(() => ankiRequest("addNote", {}), /deck not found/);
});

test("params を省略してもブリッジには空オブジェクトが渡る", async () => {
  const { ankiRequest, calls } = load({ bridge: async () => null });
  await ankiRequest("version");
  // vm 内で作られたオブジェクトは別レルムのプロトタイプを持つため、
  // deepEqual(=deepStrictEqual)では構造が同じでも落ちる。中身で確かめる。
  const passed = calls.bridge[0].params;
  assert.equal(typeof passed, "object");
  assert.notEqual(passed, null);
  assert.equal(Object.keys(passed).length, 0);
});
