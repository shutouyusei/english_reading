"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { attemptRecord, essayRecord, summarize } =
  require("../../app/ui/js/dashboard.js");

const ITEMS = [
  { id: "passage_001", title: "Peat" },
  { id: "passage_002", title: "Fresco" },
  { id: "passage_003", title: "Paper" },
];

function recordsFrom(byId) {
  return (id) => byId[id] || [];
}

test("summarize counts done items, averages the latest score of each, and keeps the last date", () => {
  const recordsOf = recordsFrom({
    passage_001: [
      attemptRecord({ score: 4, total: 5, finishedAt: "2026-08-20T02:00:00.000Z" }),
      attemptRecord({ score: 1, total: 5, finishedAt: "2026-08-11T00:00:00.000Z" }),
    ],
    passage_002: [attemptRecord({ score: 3, total: 5, finishedAt: "2026-08-14T10:00:00.000Z" })],
  });
  assert.deepEqual(summarize(ITEMS, recordsOf), {
    total: 3, done: 2, average: 0.7, lastAt: "2026-08-20T02:00:00.000Z",
    states: [
      { title: "Peat", status: "done", label: "4/5" },
      { title: "Fresco", status: "done", label: "3/5" },
      { title: "Paper", status: "todo", label: "Not attempted" },
    ],
  });
});

test("an ungraded essay counts as done but does not enter the average", () => {
  const graded = essayRecord({
    essay: { writtenAt: "2026-08-12T00:00:00.000Z" }, grade: { overall: 3.5 },
  });
  const ungraded = essayRecord({ essay: { writtenAt: "2026-08-14T00:00:00.000Z" }, grade: null });
  const invalid = essayRecord({
    essay: { writtenAt: "2026-08-15T00:00:00.000Z" }, grade: { overall: "high" },
  });
  assert.equal(ungraded.label, "Awaiting grading");
  assert.equal(invalid.ratio, null);

  const summary = summarize(ITEMS, recordsFrom({ passage_001: [ungraded, graded], passage_002: [invalid] }));
  assert.equal(summary.done, 2);
  assert.equal(summary.average, 0.7);
  assert.deepEqual(summary.states.map((state) => state.status), ["done", "pending", "todo"]);
  assert.equal(summarize(ITEMS, recordsFrom({})).average, null);
});
