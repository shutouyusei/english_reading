"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { problemStatus, groupProblems } = require("../../app/ui/js/problem-list.js");

test("problemStatus sorts a problem by its latest counted result", () => {
  const full = { ratio: 1, label: "5/5" };
  const partial = { ratio: 0.6, label: "3/5" };
  const unscored = { ratio: null, label: "Too fast to count" };

  assert.deepEqual(problemStatus([]), { status: "todo", label: "" });
  assert.deepEqual(problemStatus([partial, full]), { status: "retry", label: "3/5" });
  assert.deepEqual(problemStatus([unscored, full]), { status: "done", label: "5/5" });
  assert.deepEqual(problemStatus([unscored]), { status: "retry", label: "Too fast to count" });
  assert.equal(problemStatus([{ ratio: 0.8, label: "4/5" }], 0.8).status, "done");
});

test("groupProblems keeps the order not tried, retry, done and drops empty groups", () => {
  const problems = [
    { title: "a", status: "done" },
    { title: "b", status: "todo" },
    { title: "c", status: "done" },
  ];
  assert.deepEqual(
    groupProblems(problems).map((group) => [group.title, group.problems.map((p) => p.title)]),
    [["Not tried", ["b"]], ["Done", ["a", "c"]]],
  );
});
