"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// essays.native.js depends on the native bridge. A fake bridge is injected to check
// how essay rows and grade rows are merged and that a failed save leaves the cache alone.

function loadEssays(rows, options = {}) {
  global.window = {
    webkit: {
      messageHandlers: {
        essays: {
          postMessage: async (payload) => {
            if (payload.action === "loadAll") return rows;
            if (payload.action === "saveEssay" || payload.action === "saveGrade") {
              if (options.saveRejects) throw new Error("write failed: permission denied");
              return null;
            }
            throw new Error(`unknown action: ${payload.action}`);
          },
        },
      },
    },
  };
  delete require.cache[require.resolve("../../app/ui/js/essays.native.js")];
  require("../../app/ui/js/essays.native.js");
  return { Essays: global.window.Essays };
}

const essayOld = {
  kind: "essay", essayId: "e_1", promptId: "writing_001", promptType: "email",
  text: "Dear Professor, ...", elapsedSec: 412, writtenAt: "2026-08-11T10:00:00.000Z",
};
const essayNew = {
  kind: "essay", essayId: "e_2", promptId: "writing_001", promptType: "email",
  text: "Dear Professor Alvarez, ...", elapsedSec: 380, writtenAt: "2026-08-11T12:00:00.000Z",
};
const gradeFirst = {
  kind: "grade", essayId: "e_1", overall: 3, criteria: [], corrections: [],
  summary: "first grading", gradedAt: "2026-08-11T10:01:00.000Z", runnerMs: 15000,
};
const gradeRegraded = {
  kind: "grade", essayId: "e_1", overall: 4, criteria: [], corrections: [],
  summary: "graded again", gradedAt: "2026-08-11T13:00:00.000Z", runnerMs: 16000,
};

test("a grade row is matched to its essay by essayId", async () => {
  const { Essays } = loadEssays([essayOld, gradeFirst]);
  await Essays.init();
  assert.equal(Essays.get("e_1").grade.overall, 3);
});

test("after grading again, the grade with the latest gradedAt wins (whatever the file order)", async () => {
  const { Essays } = loadEssays([essayOld, gradeRegraded, gradeFirst]);
  await Essays.init();
  assert.equal(Essays.get("e_1").grade.overall, 4);
  assert.equal(Essays.get("e_1").grade.summary, "graded again");
});

test("a grade row with no matching essay does not crash", async () => {
  const { Essays } = loadEssays([{ kind: "grade", essayId: "e_missing", overall: 5, gradedAt: "x" }]);
  await Essays.init();
  assert.deepEqual(Essays.forPrompt("writing_001"), []);
});

test("a failed save rejects and leaves the cache unchanged", async () => {
  const { Essays } = loadEssays([essayOld], { saveRejects: true });
  await Essays.init();
  await assert.rejects(() => Essays.saveEssay(essayNew), /write failed/);
  assert.equal(Essays.forPrompt("writing_001").length, 1);
  await assert.rejects(() => Essays.saveGrade(gradeFirst), /write failed/);
  assert.equal(Essays.get("e_1").grade, null);
});
