"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// store.native.js depends on the native bridge (window.webkit.messageHandlers.store).
// A fake bridge is injected to check grouping, sorting and cache updates. After an
// app restart, whether the list badge shows the latest attempt depends only on the
// sort in init().

function loadStore(initialAttempts, options = {}) {
  const calls = [];
  global.window = {
    webkit: {
      messageHandlers: {
        store: {
          postMessage: async (payload) => {
            calls.push(payload);
            if (payload.action === "loadAll") return initialAttempts;
            if (payload.action === "saveAttempt") {
              if (options.saveRejects) throw new Error("write failed: permission denied");
              return null;
            }
            throw new Error(`unknown action: ${payload.action}`);
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

test("attempts are grouped by passage", async () => {
  const { Store } = loadStore([older, other, newer]);
  await Store.init();
  assert.equal(Store.attempts("passage_005").length, 2);
  assert.equal(Store.attempts("passage_001").length, 1);
  assert.deepEqual(Store.attempts("passage_999"), []);
});

test("latest returns the newest attempt (whatever the file order)", async () => {
  // The file lists the older attempt first, so latest is only right if init() sorts.
  const { Store } = loadStore([older, newer]);
  await Store.init();
  assert.equal(Store.latest("passage_005").finishedAt, newer.finishedAt);
  assert.equal(Store.latest("passage_005").score, 4);
});

test("attempts are sorted newest first", async () => {
  const { Store } = loadStore([older, newer]);
  await Store.init();
  assert.deepEqual(
    Store.attempts("passage_005").map((a) => a.finishedAt),
    [newer.finishedAt, older.finishedAt]
  );
});

test("saveAttempt calls the bridge and puts the attempt at the front of the cache", async () => {
  const { Store, calls } = loadStore([older]);
  await Store.init();
  await Store.saveAttempt(newer);
  assert.deepEqual(calls[1], { action: "saveAttempt", attempt: newer });
  assert.equal(Store.attempts("passage_005").length, 2);
  assert.equal(Store.latest("passage_005").finishedAt, newer.finishedAt);
});

test("a failed save rejects and leaves the cache unchanged", async () => {
  const { Store } = loadStore([older], { saveRejects: true });
  await Store.init();
  await assert.rejects(() => Store.saveAttempt(newer), /write failed/);
  // What did not reach the disk must not enter the cache.
  assert.equal(Store.attempts("passage_005").length, 1);
  assert.equal(Store.latest("passage_005").finishedAt, older.finishedAt);
});
