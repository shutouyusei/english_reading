"use strict";

/* Study analysis for the dashboard. Pure functions only: no DOM, no storage, no network.
   The dashboard collects the records and question data and passes them in. */

const TYPE_TIPS = {
  reading: {
    "Factual": "Find the sentence the question points to and check each choice against it; wrong choices often change one detail.",
    "Vocabulary": "Reread the sentence around the word and try each choice in its place.",
    "Reference": "Put each choice in place of the pronoun or phrase and check that the sentence still makes sense.",
    "Inference": "The answer is implied, not stated: pick the choice the passage forces to be true and drop choices that go beyond it.",
    "Rhetorical Purpose": "Ask why the author included the detail: as an example, a contrast, or support for the paragraph's main point.",
  },
  listening: {
    "Gist-Content": "Note the topic the speaker announces at the start and returns to at the end.",
    "Detail": "Take short notes on names, numbers and reasons while you listen.",
    "Function": "Listen for why something is said, not what: the tone and the sentence before it give it away.",
    "Attitude": "Pay attention to tone and to hedges such as 'I suppose' or 'frankly'.",
    "Inference": "The answer is implied, not stated: pick the choice the speakers' words force to be true.",
  },
};

function sortWeakestFirst(rows) {
  return rows.sort((a, b) => a.value / a.max - b.value / b.max || a.name.localeCompare(b.name));
}

/** sets: [{questions: [{type, correct}], answers: [letter]}].
    Returns one row per question type, {name, value: correct, max: answered}, weakest first. */
function typeBreakdown(sets) {
  const byType = new Map();
  for (const set of sets) {
    set.questions.forEach((question, index) => {
      const row = byType.get(question.type) || { name: question.type, value: 0, max: 0 };
      row.max += 1;
      if (set.answers[index] === question.correct) row.value += 1;
      byType.set(question.type, row);
    });
  }
  return sortWeakestFirst([...byType.values()]);
}

/** grades: grading results, each with criteria [{name, score}] on a 0-5 scale.
    Returns one row per criterion, {name, value: average, max: 5}, weakest first. */
function criteriaBreakdown(grades) {
  const byName = new Map();
  for (const grade of grades) {
    for (const criterion of Array.isArray(grade.criteria) ? grade.criteria : []) {
      if (typeof criterion.score !== "number" || !Number.isFinite(criterion.score)) continue;
      const scores = byName.get(criterion.name) || [];
      scores.push(criterion.score);
      byName.set(criterion.name, scores);
    }
  }
  const rows = [...byName].map(([name, scores]) => ({
    name,
    value: Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10,
    max: 5,
  }));
  return sortWeakestFirst(rows);
}

/** The rows tied for the lowest ratio. Empty when nothing stands out (no rows, one row,
    or every row equal), so the caller never names a "weakest" that is not one. */
function weakestRows(rows) {
  if (rows.length < 2) return [];
  const ratios = rows.map((row) => row.value / row.max);
  const lowest = Math.min(...ratios);
  if (lowest === Math.max(...ratios)) return [];
  return rows.filter((row) => row.value / row.max === lowest);
}

/** candidates: [{item, ratio}] in list order; ratio is null for a set with no real attempt.
    A set never tried comes first; otherwise the lowest score is worth a retry. */
function nextSet(candidates) {
  const fresh = candidates.find((candidate) => candidate.ratio === null);
  if (fresh) return { item: fresh.item, reason: "new" };
  const retry = candidates
    .filter((candidate) => candidate.ratio < 1)
    .sort((a, b) => a.ratio - b.ratio)[0];
  return retry ? { item: retry.item, reason: "retry" } : null;
}

function joinNames(names) {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Plain-sentence advice from fixed rules. setsAnalysed is how many question sets the
    reading and listening rows rest on. */
function adviceLines({ reading, listening, writing, setsAnalysed }) {
  const lines = [];
  for (const [skill, rows] of [["reading", reading], ["listening", listening]]) {
    const weak = weakestRows(rows);
    if (!weak.length) continue;
    const names = joinNames(weak.map((row) => row.name));
    const verb = weak.length > 1 ? "are your weakest" : "is your weakest";
    const noun = weak.length > 1 ? "question types" : "question type";
    lines.push(`${names} ${verb} ${skill} ${noun}: ${weak[0].value} of ${weak[0].max} correct${weak.length > 1 ? " each" : ""}.`);
    const tip = TYPE_TIPS[skill][weak[0].name];
    if (tip) lines.push(`For ${weak[0].name} questions: ${tip}`);
  }
  const weakCriteria = weakestRows(writing);
  if (weakCriteria.length) {
    const names = joinNames(weakCriteria.map((row) => row.name));
    lines.push(`In writing, your lowest criterion is ${names}: ${weakCriteria[0].value} of 5 on average.`);
  }
  if (setsAnalysed > 0 && setsAnalysed < 3) {
    const sets = setsAnalysed === 1 ? "1 question set" : `${setsAnalysed} question sets`;
    lines.push(`These numbers rest on ${sets}, so treat them as a first hint.`);
  }
  return lines;
}

if (typeof module !== "undefined") {
  module.exports = {
    typeBreakdown, criteriaBreakdown, weakestRows, nextSet, adviceLines,
  };
}
