"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// listening.native.js は Swift 側のブリッジ (window.webkit.messageHandlers.listening) に
// 依存する。偽のブリッジを差し込んで、グループ化・並べ替え・キャッシュ更新を確かめる。
// 一覧のバッジが「最新の」試行を示すかは init() の並べ替えだけで決まる。

function loadStore(initialAttempts, options = {}) {
  const calls = [];
  global.window = {
    webkit: {
      messageHandlers: {
        listening: {
          postMessage: async (payload) => {
            calls.push(payload);
            if (payload.action === "loadAll") {
              if (options.loadAllReturns !== undefined) return options.loadAllReturns;
              return initialAttempts;
            }
            if (payload.action === "saveAttempt") {
              if (options.saveRejects) throw new Error("書き込みに失敗しました: 権限がありません");
              return null;
            }
            throw new Error(`未知の action: ${payload.action}`);
          },
        },
      },
    },
  };
  delete require.cache[require.resolve("../../app/ui/js/listening.native.js")];
  require("../../app/ui/js/listening.native.js");
  return { ListeningStore: global.window.ListeningStore, calls };
}

const older = {
  listeningId: "listening_001", score: 3, total: 6, elapsedSec: 300,
  answers: ["A", "B", "C", "D", "A", "B"], finishedAt: "2026-08-19T00:10:00.000Z",
};
const newer = {
  listeningId: "listening_001", score: 5, total: 6, elapsedSec: 280,
  answers: ["A", "B", "C", "D", "A", "C"], finishedAt: "2026-08-19T00:30:00.000Z",
};
const other = {
  listeningId: "listening_002", score: 4, total: 6, elapsedSec: 260,
  answers: ["B", "B", "C", "D", "A", "B"], finishedAt: "2026-08-18T00:00:00.000Z",
};

test("init は loadAll を一度だけ呼ぶ", async () => {
  const { ListeningStore, calls } = loadStore([]);
  await ListeningStore.init();
  assert.deepEqual(calls, [{ action: "loadAll" }]);
});

test("履歴が無ければ空配列と null を返す", async () => {
  const { ListeningStore } = loadStore([]);
  await ListeningStore.init();
  assert.deepEqual(ListeningStore.attempts("listening_001"), []);
  assert.equal(ListeningStore.latest("listening_001"), null);
});

test("項目ごとにグループ化される", async () => {
  const { ListeningStore } = loadStore([older, other, newer]);
  await ListeningStore.init();
  assert.equal(ListeningStore.attempts("listening_001").length, 2);
  assert.equal(ListeningStore.attempts("listening_002").length, 1);
  assert.deepEqual(ListeningStore.attempts("listening_999"), []);
});

test("latest は最新の試行を返す(ファイル順に依存しない)", async () => {
  const { ListeningStore } = loadStore([older, newer]);
  await ListeningStore.init();
  assert.equal(ListeningStore.latest("listening_001").score, 5);
});

test("ファイルが新しい順に並んでいても latest は変わらない", async () => {
  const { ListeningStore } = loadStore([newer, older]);
  await ListeningStore.init();
  assert.equal(ListeningStore.latest("listening_001").finishedAt, newer.finishedAt);
});

test("saveAttempt はブリッジへ渡し、キャッシュの先頭に積む", async () => {
  const { ListeningStore, calls } = loadStore([older]);
  await ListeningStore.init();
  await ListeningStore.saveAttempt(newer);
  assert.deepEqual(calls[1], { action: "saveAttempt", attempt: newer });
  assert.equal(ListeningStore.attempts("listening_001").length, 2);
  assert.equal(ListeningStore.latest("listening_001").score, 5);
});

test("保存が失敗したらキャッシュを汚さずに reject する", async () => {
  const { ListeningStore } = loadStore([older], { saveRejects: true });
  await ListeningStore.init();
  await assert.rejects(() => ListeningStore.saveAttempt(newer), /書き込みに失敗しました/);
  assert.equal(ListeningStore.attempts("listening_001").length, 1);
});

test("loadAll が null を返しても落ちない", async () => {
  const { ListeningStore } = loadStore(null, { loadAllReturns: null });
  await ListeningStore.init();
  assert.deepEqual(ListeningStore.attempts("listening_001"), []);
});

test("init を二度呼んでも履歴が重複しない", async () => {
  const { ListeningStore } = loadStore([older, newer]);
  await ListeningStore.init();
  await ListeningStore.init();
  assert.equal(ListeningStore.attempts("listening_001").length, 2);
});
