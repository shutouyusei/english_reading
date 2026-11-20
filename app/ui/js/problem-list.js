"use strict";

/* The list on each section page: one line per problem, grouped by what there is to do.
   Each page builds its problems ({title, details, status, result, actionsHtml, ...}) and
   hands them to problemListHtml. problemStatus and groupProblems are pure and exported
   for tests. */

const PROBLEM_GROUPS = [
  { key: "todo", title: "Not tried" },
  { key: "retry", title: "Worth a retry" },
  { key: "done", title: "Done" },
];

const STATUS_BLOCK_CLASS = { todo: "block", retry: "block pending", done: "block done" };

/** records: the problem's records as {ratio, label}, newest first (see records.js).
    doneAt: the ratio from which the problem counts as done.
    A problem tried without a score yet (awaiting grading, or finished too fast to count)
    is worth a retry. */
function problemStatus(records, doneAt = 1) {
  if (!records.length) return { status: "todo", label: "" };
  const scored = records.find((record) => record.ratio !== null);
  if (!scored) return { status: "retry", label: records[0].label };
  return { status: scored.ratio >= doneAt ? "done" : "retry", label: scored.label };
}

/** Splits problems into the groups above, in that order, leaving out empty groups. */
function groupProblems(problems) {
  return PROBLEM_GROUPS
    .map((group) => ({ ...group, problems: problems.filter((problem) => problem.status === group.key) }))
    .filter((group) => group.problems.length);
}

if (typeof module !== "undefined") {
  module.exports = { problemStatus, groupProblems };
}

function minSecLabel(seconds) {
  const whole = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
}

// details and result come from data files and saved records, so they are escaped here.
// actionsHtml and extraHtml are built by the page scripts, which escape their own parts.
function problemRowHtml(problem) {
  const details = problem.details.map((detail) => `<span class="problem-detail">${escapeHtml(detail)}</span>`);
  return `
    <li>
      <div class="problem-row">
        <span class="${STATUS_BLOCK_CLASS[problem.status]}"></span>
        <span class="problem-title">${escapeHtml(problem.title)}</span>
        ${details.join("")}
        <span class="problem-result">${escapeHtml(problem.result)}</span>
        <span class="problem-actions">${problem.actionsHtml}</span>
      </div>
      ${problem.extraHtml || ""}
    </li>`;
}

function problemListHtml(problems, emptyText) {
  if (!problems.length) return `<p class="hint">${escapeHtml(emptyText)}</p>`;
  return groupProblems(problems).map((group) => `
    <h2 class="problem-group">${group.title} <span>${group.problems.length}</span></h2>
    <ul class="problems">${group.problems.map(problemRowHtml).join("")}</ul>`).join("");
}

/** Loads one section's index.json and returns its list, or throws with the reason. */
async function loadProblemIndex(indexUrl, listKey) {
  // no-cache: content corrected after it was first loaded must be picked up.
  const res = await fetch(`${window.DATA_BASE || ""}${indexUrl}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = (await res.json())[listKey];
  if (!Array.isArray(items)) throw new Error(`index.json has no ${listKey} list`);
  return items;
}

/** The part every section page shares: load the records and the index, then render.
    toProblem(item) turns one index entry into a problem for problemRowHtml. */
async function initProblemList({ store, indexUrl, listKey, emptyText, toProblem }) {
  const container = document.querySelector("#problem-list");
  try {
    await store.init();
  } catch (err) {
    console.warn("Could not load study records:", err);
  }
  try {
    const items = await loadProblemIndex(indexUrl, listKey);
    container.innerHTML = problemListHtml(items.map(toProblem), emptyText);
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load the list (${escapeHtml(err.message)}).</p>`;
  }
}
