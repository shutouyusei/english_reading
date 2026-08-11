"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// essays.native.js は Swift 側のブリッジに依存する。偽のブリッジを差し込んで
// essay 行と grade 行のマージ、並べ替え、キャッシュ更新を検証する。

function loadEssays(rows, options = {}) {
  const calls = [];
  global.window = {
    webkit: {
      messageHandlers: {
        essays: {
          postMessage: async (payload) => {
            calls.push(payload);
            if (payload.action === "loadAll") return rows;
            if (payload.action === "saveEssay" || payload.action === "saveGrade") {
              if (options.saveRejects) throw new Error("書き込みに失敗しました: 権限がありません");
              return null;
            }
            throw new Error(`未知の action: ${payload.action}`);
          },
        },
      },
    },
  };
  delete require.cache[require.resolve("../../app/ui/js/essays.native.js")];
  require("../../app/ui/js/essays.native.js");
  return { Essays: global.window.Essays, calls };
}

const essayOld = {
  kind: "essay", essayId: "e_1", promptId: "writing_001", promptType: "email",
  text: "Dear Professor, ...", elapsedSec: 412, writtenAt: "2026-08-11T10:00:00.000Z",
};
const essayNew = {
  kind: "essay", essayId: "e_2", promptId: "writing_001", promptType: "email",
  text: "Dear Professor Alvarez, ...", elapsedSec: 380, writtenAt: "2026-08-11T12:00:00.000Z",
};
const essayOther = {
  kind: "essay", essayId: "e_3", promptId: "writing_002", promptType: "discussion",
  text: "I agree with Priya ...", elapsedSec: 600, writtenAt: "2026-08-11T11:00:00.000Z",
};
const gradeFirst = {
  kind: "grade", essayId: "e_1", overall: 3, criteria: [], corrections: [],
  summary: "一回目", gradedAt: "2026-08-11T10:01:00.000Z", runnerMs: 15000,
};
const gradeRegraded = {
  kind: "grade", essayId: "e_1", overall: 4, criteria: [], corrections: [],
  summary: "再採点", gradedAt: "2026-08-11T13:00:00.000Z", runnerMs: 16000,
};

test("init は loadAll を一度だけ呼ぶ", async () => {
  const { Essays, calls } = loadEssays([]);
  await Essays.init();
  assert.deepEqual(calls, [{ action: "loadAll" }]);
});

test("記録が無ければ空配列と null を返す", async () => {
  const { Essays } = loadEssays([]);
  await Essays.init();
  assert.deepEqual(Essays.forPrompt("writing_001"), []);
  assert.equal(Essays.latest("writing_001"), null);
  assert.equal(Essays.get("e_1"), null);
});

test("採点行が無いエッセイは grade が null になる", async () => {
  const { Essays } = loadEssays([essayOld]);
  await Essays.init();
  assert.equal(Essays.get("e_1").grade, null);
  assert.equal(Essays.get("e_1").essay.text, essayOld.text);
});

test("採点行があれば essayId で突き合わせる", async () => {
  const { Essays } = loadEssays([essayOld, gradeFirst]);
  await Essays.init();
  assert.equal(Essays.get("e_1").grade.overall, 3);
});

test("再採点では gradedAt が新しい方を採る(ファイル順に依存しない)", async () => {
  const { Essays } = loadEssays([essayOld, gradeRegraded, gradeFirst]);
  await Essays.init();
  assert.equal(Essays.get("e_1").grade.overall, 4);
  assert.equal(Essays.get("e_1").grade.summary, "再採点");
});

test("採点行が先に現れても突き合わせられる", async () => {
  const { Essays } = loadEssays([gradeFirst, essayOld]);
  await Essays.init();
  assert.equal(Essays.get("e_1").grade.overall, 3);
});

test("問題ごとにグループ化され、新しい順に並ぶ", async () => {
  const { Essays } = loadEssays([essayOld, essayOther, essayNew]);
  await Essays.init();
  assert.deepEqual(
    Essays.forPrompt("writing_001").map((e) => e.essay.essayId),
    ["e_2", "e_1"]
  );
  assert.equal(Essays.forPrompt("writing_002").length, 1);
  assert.deepEqual(Essays.forPrompt("writing_999"), []);
});

test("latest は最新のエッセイを返す", async () => {
  const { Essays } = loadEssays([essayOld, essayNew]);
  await Essays.init();
  assert.equal(Essays.latest("writing_001").essay.essayId, "e_2");
});

test("孤児の採点行があっても落ちない", async () => {
  const { Essays } = loadEssays([{ kind: "grade", essayId: "e_missing", overall: 5, gradedAt: "x" }]);
  await Essays.init();
  assert.deepEqual(Essays.forPrompt("writing_001"), []);
});

test("loadAll が null を返しても落ちない", async () => {
  const { Essays } = loadEssays(null);
  await Essays.init();
  assert.deepEqual(Essays.forPrompt("writing_001"), []);
});

test("saveEssay はブリッジへ渡し、キャッシュの先頭に積む", async () => {
  const { Essays, calls } = loadEssays([essayOld]);
  await Essays.init();
  await Essays.saveEssay(essayNew);
  assert.deepEqual(calls[1], { action: "saveEssay", essay: essayNew });
  assert.equal(Essays.latest("writing_001").essay.essayId, "e_2");
  assert.equal(Essays.get("e_2").grade, null);
});

test("saveGrade は既存エントリに採点を結び付ける", async () => {
  const { Essays, calls } = loadEssays([essayOld]);
  await Essays.init();
  await Essays.saveGrade(gradeFirst);
  assert.deepEqual(calls[1], { action: "saveGrade", grade: gradeFirst });
  assert.equal(Essays.get("e_1").grade.overall, 3);
});

test("保存が失敗したらキャッシュを汚さずに reject する", async () => {
  const { Essays } = loadEssays([essayOld], { saveRejects: true });
  await Essays.init();
  await assert.rejects(() => Essays.saveEssay(essayNew), /書き込みに失敗しました/);
  assert.equal(Essays.forPrompt("writing_001").length, 1);
  await assert.rejects(() => Essays.saveGrade(gradeFirst), /書き込みに失敗しました/);
  assert.equal(Essays.get("e_1").grade, null);
});

test("init を二度呼んでも重複しない", async () => {
  const { Essays } = loadEssays([essayOld, essayNew]);
  await Essays.init();
  await Essays.init();
  assert.equal(Essays.forPrompt("writing_001").length, 2);
});
