"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// store.web.js はブラウザ用の classic script なので、
// localStorage と window を用意してから読み込む
function loadStore() {
  const mem = new Map();
  global.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  global.window = {};
  delete require.cache[require.resolve("../../docs/js/store.web.js")];
  require("../../docs/js/store.web.js");
  return { Store: global.window.Store, mem };
}

const ATTEMPT = {
  passageId: "passage_001",
  score: 4,
  total: 5,
  elapsedSec: 499,
  answers: ["B", "A", "A", "C", "D"],
  finishedAt: "2026-08-11T09:12:33.000Z",
};

test("保存前は空配列と null を返す", async () => {
  const { Store } = loadStore();
  await Store.init();
  assert.deepEqual(Store.attempts("passage_001"), []);
  assert.equal(Store.latest("passage_001"), null);
});

test("保存した内容を読み出せる", async () => {
  const { Store } = loadStore();
  await Store.init();
  await Store.saveAttempt(ATTEMPT);
  assert.deepEqual(Store.attempts("passage_001"), [ATTEMPT]);
  assert.deepEqual(Store.latest("passage_001"), ATTEMPT);
});

test("公開版は最新の1件だけを保持する", async () => {
  const { Store } = loadStore();
  await Store.init();
  await Store.saveAttempt(ATTEMPT);
  const second = { ...ATTEMPT, score: 5, finishedAt: "2026-08-12T00:00:00.000Z" };
  await Store.saveAttempt(second);
  assert.equal(Store.attempts("passage_001").length, 1);
  assert.deepEqual(Store.latest("passage_001"), second);
});

test("パッセージごとに独立している", async () => {
  const { Store } = loadStore();
  await Store.init();
  await Store.saveAttempt(ATTEMPT);
  assert.equal(Store.latest("passage_002"), null);
});

test("壊れたJSONが入っていても落ちない", async () => {
  const { Store, mem } = loadStore();
  mem.set("results.passage_001", "{ぐちゃぐちゃ");
  await Store.init();
  assert.deepEqual(Store.attempts("passage_001"), []);
});

test("localStorage が例外を投げても保存呼び出しは reject しない", async () => {
  const { Store } = loadStore();
  global.localStorage.setItem = () => { throw new Error("QuotaExceeded"); };
  await Store.init();
  await Store.saveAttempt(ATTEMPT);   // ここで throw しなければ成功
  assert.equal(Store.latest("passage_001").score, 4);  // メモリ上には反映される
});
