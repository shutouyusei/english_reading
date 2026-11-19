"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// listening.native.js depends on the native bridge
// (window.webkit.messageHandlers.listening). A fake bridge is injected to check
// grouping, sorting and cache updates. Whether the list badge shows the latest
// attempt depends only on the sort in init().

function loadStore(initialAttempts, options = {}) {
  const calls = [];
  global.window = {
    webkit: {
      messageHandlers: {
        listening: {
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

test("attempts are grouped by item", async () => {
  const { ListeningStore } = loadStore([older, other, newer]);
  await ListeningStore.init();
  assert.equal(ListeningStore.attempts("listening_001").length, 2);
  assert.equal(ListeningStore.attempts("listening_002").length, 1);
  assert.deepEqual(ListeningStore.attempts("listening_999"), []);
});

test("latest returns the newest attempt (whatever the file order)", async () => {
  const { ListeningStore } = loadStore([older, newer]);
  await ListeningStore.init();
  assert.equal(ListeningStore.latest("listening_001").score, 5);
});

test("saveAttempt calls the bridge and puts the attempt at the front of the cache", async () => {
  const { ListeningStore, calls } = loadStore([older]);
  await ListeningStore.init();
  await ListeningStore.saveAttempt(newer);
  assert.deepEqual(calls[1], { action: "saveAttempt", attempt: newer });
  assert.equal(ListeningStore.attempts("listening_001").length, 2);
  assert.equal(ListeningStore.latest("listening_001").score, 5);
});

test("a failed save rejects and leaves the cache unchanged", async () => {
  const { ListeningStore } = loadStore([older], { saveRejects: true });
  await ListeningStore.init();
  await assert.rejects(() => ListeningStore.saveAttempt(newer), /write failed/);
  assert.equal(ListeningStore.attempts("listening_001").length, 1);
});
