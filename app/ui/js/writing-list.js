"use strict";

/* Writing list. */

const TYPE_LABELS = { email: "Email", discussion: "Discussion" };

// A full 5 is rare in writing, so a prompt counts as done from 4 out of 5.
const WRITING_DONE_AT = 0.8;

// Earlier essays for the same prompt, newest first, shown under its line.
function pastAttemptsHtml(entries) {
  const past = entries.slice(1);
  if (!past.length) return "";
  const rows = past.map((entry) => {
    const record = essayRecord(entry);
    return `<li class="meta">${escapeHtml(record.at.slice(0, 10))}, ${escapeHtml(record.label)}, written in ${minSecLabel(entry.essay.elapsedSec)}</li>`;
  });
  return `<ul class="attempts">${rows.join("")}</ul>`;
}

function writingProblem(prompt) {
  const entries = Essays.forPrompt(prompt.id);
  const state = problemStatus(entries.map(essayRecord), WRITING_DONE_AT);
  const attempts = entries.length > 1 ? `, ${entries.length} essays` : "";
  return {
    title: prompt.title,
    details: [TYPE_LABELS[prompt.type] || String(prompt.type), `target ${prompt.target_minutes} min`],
    status: state.status,
    result: state.label + attempts,
    actionsHtml: `<a class="button primary" href="writing-editor.html?id=${encodeURIComponent(prompt.id)}">Write</a>`,
    extraHtml: pastAttemptsHtml(entries),
  };
}

document.addEventListener("DOMContentLoaded", () => initProblemList({
  store: Essays,
  indexUrl: "data/writing/index.json",
  listKey: "prompts",
  emptyText: "No writing prompts yet.",
  toProblem: writingProblem,
}));
