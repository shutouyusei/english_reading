"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { latestUsableAttempt, typeBreakdown, weakestRows, nextSet, adviceLines } =
  require("../../app/ui/js/analysis.js");

const QUESTIONS = [
  { type: "Factual", correct: "B" },
  { type: "Inference", correct: "C" },
];

test("an attempt finished in a few seconds is skipped in favour of the latest real one", () => {
  const rushed = { score: 0, total: 5, elapsedSec: 7 };
  const real = { score: 3, total: 5, elapsedSec: 480 };
  assert.equal(latestUsableAttempt([rushed, real]), real);
  assert.equal(latestUsableAttempt([rushed]), null);
});

test("typeBreakdown counts correct answers per question type, weakest first", () => {
  const rows = typeBreakdown([
    { questions: QUESTIONS, answers: ["B", "A"] },
    { questions: QUESTIONS, answers: ["B", "C"] },
  ]);
  assert.deepEqual(rows, [
    { name: "Inference", value: 1, max: 2 },
    { name: "Factual", value: 2, max: 2 },
  ]);
  assert.deepEqual(weakestRows(rows).map((row) => row.name), ["Inference"]);
});

test("no type is called weakest when every type scores the same", () => {
  const rows = typeBreakdown([{ questions: QUESTIONS, answers: ["B", "C"] }]);
  assert.deepEqual(weakestRows(rows), []);
  assert.deepEqual(adviceLines({ reading: rows, listening: [], writing: [], setsAnalysed: 3 }), []);
});

test("nextSet offers a set never tried before a retry of the lowest score", () => {
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
  assert.deepEqual(
    nextSet([{ item: a, ratio: 0.4 }, { item: b, ratio: null }, { item: c, ratio: 0.2 }]),
    { item: b, reason: "new" },
  );
  assert.deepEqual(
    nextSet([{ item: a, ratio: 0.4 }, { item: c, ratio: 0.2 }]),
    { item: c, reason: "retry" },
  );
  assert.equal(nextSet([{ item: a, ratio: 1 }]), null);
});
