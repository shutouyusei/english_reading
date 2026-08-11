"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// store.native.js は Swift 側のブリッジ (window.webkit.messageHandlers.store) に
// 依存する。ここでは偽のブリッジを差し込んで、グループ化・並べ替え・キャッシュ更新を
// 検証する。アプリを再起動したとき一覧のバッジが「最新の」試行を示すかは、
// この init() の並べ替えだけで決まる。

function loadStore(initialAttempts, options = {}) {
  const calls = [];
  global.window = {
    webkit: {
      messageHandlers: {
        store: {
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
  delete require.cache[require.resolve("../../app/ui/js/store.native.js")];
  require("../../app/ui/js/store.native.js");
  return { Store: global.window.Store, calls };
}

const older = {
  passageId: "passage_005", score: 2, total: 5, elapsedSec: 12,
  answers: ["A", "C", "B", "B", "B"], finishedAt: "2026-08-11T00:27:09.564Z",
};
const newer = {
  passageId: "passage_005", score: 4, total: 5, elapsedSec: 6,
  answers: ["A", "D", "C", "B", "C"], finishedAt: "2026-08-11T00:30:08.848Z",
};
const other = {
  passageId: "passage_001", score: 3, total: 5, elapsedSec: 99,
  answers: ["A", "A", "A", "A", "A"], finishedAt: "2026-08-10T12:00:00.000Z",
};

test("init は loadAll を一度だけ呼ぶ", async () => {
  const { Store, calls } = loadStore([]);
  await Store.init();
  assert.deepEqual(calls, [{ action: "loadAll" }]);
});

test("履歴が無ければ空配列と null を返す", async () => {
  const { Store } = loadStore([]);
  await Store.init();
  assert.deepEqual(Store.attempts("passage_005"), []);
  assert.equal(Store.latest("passage_005"), null);
});

test("パッセージごとにグループ化される", async () => {
  const { Store } = loadStore([older, other, newer]);
  await Store.init();
  assert.equal(Store.attempts("passage_005").length, 2);
  assert.equal(Store.attempts("passage_001").length, 1);
  assert.deepEqual(Store.attempts("passage_999"), []);
});

test("latest は最新の試行を返す(ファイル順に依存しない)", async () => {
  // ファイルは古い順に並んでいる。最新を返すには並べ替えが要る
  const { Store } = loadStore([older, newer]);
  await Store.init();
  assert.equal(Store.latest("passage_005").finishedAt, newer.finishedAt);
  assert.equal(Store.latest("passage_005").score, 4);
});

test("ファイルが新しい順に並んでいても latest は変わらない", async () => {
  const { Store } = loadStore([newer, older]);
  await Store.init();
  assert.equal(Store.latest("passage_005").finishedAt, newer.finishedAt);
});

test("attempts は新しい順に並ぶ", async () => {
  const { Store } = loadStore([older, newer]);
  await Store.init();
  assert.deepEqual(
    Store.attempts("passage_005").map((a) => a.finishedAt),
    [newer.finishedAt, older.finishedAt]
  );
});

test("saveAttempt はブリッジへ渡し、キャッシュの先頭に積む", async () => {
  const { Store, calls } = loadStore([older]);
  await Store.init();
  await Store.saveAttempt(newer);
  assert.deepEqual(calls[1], { action: "saveAttempt", attempt: newer });
  assert.equal(Store.attempts("passage_005").length, 2);
  assert.equal(Store.latest("passage_005").finishedAt, newer.finishedAt);
});

test("保存が失敗したらキャッシュを汚さずに reject する", async () => {
  const { Store } = loadStore([older], { saveRejects: true });
  await Store.init();
  await assert.rejects(() => Store.saveAttempt(newer), /書き込みに失敗しました/);
  // ディスクに書けていないものをキャッシュに入れてはいけない
  assert.equal(Store.attempts("passage_005").length, 1);
  assert.equal(Store.latest("passage_005").finishedAt, older.finishedAt);
});

test("loadAll が null を返しても落ちない", async () => {
  const { Store } = loadStore(null, { loadAllReturns: null });
  await Store.init();
  assert.deepEqual(Store.attempts("passage_005"), []);
});

test("init を二度呼んでも履歴が重複しない", async () => {
  const { Store } = loadStore([older, newer]);
  await Store.init();
  await Store.init();
  assert.equal(Store.attempts("passage_005").length, 2);
});
