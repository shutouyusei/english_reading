"use strict";

/* Storage layer (writing, app build). The native side (app-shell) appends to
   essays.jsonl in the data directory.
   The file mixes essay rows and grade rows, so they are matched by essayId into
   {essay, grade} pairs. It is append-only, so re-grading only adds another
   grade row. The one with the latest gradedAt is used. */

const _byPrompt = new Map();   // promptId -> Entry[] (newest first)
const _byEssayId = new Map();  // essayId  -> Entry

async function _callEssays(payload) {
  return window.webkit.messageHandlers.essays.postMessage(payload);
}

function _latestGrades(rows) {
  const grades = new Map();
  for (const row of rows) {
    if (!row || row.kind !== "grade" || !row.essayId) continue;
    const current = grades.get(row.essayId);
    if (!current || String(row.gradedAt) > String(current.gradedAt)) {
      grades.set(row.essayId, row);
    }
  }
  return grades;
}

function _rebuild(rows) {
  _byPrompt.clear();
  _byEssayId.clear();
  const safeRows = rows || [];
  const grades = _latestGrades(safeRows);
  for (const row of safeRows) {
    if (!row || row.kind !== "essay" || !row.essayId) continue;
    const entry = { essay: row, grade: grades.get(row.essayId) || null };
    _byEssayId.set(row.essayId, entry);
    const list = _byPrompt.get(row.promptId) || [];
    list.push(entry);
    _byPrompt.set(row.promptId, list);
  }
  for (const list of _byPrompt.values()) {
    list.sort((a, b) =>
      String(b.essay.writtenAt).localeCompare(String(a.essay.writtenAt)));
  }
}

window.Essays = {
  async init() {
    _rebuild(await _callEssays({ action: "loadAll" }));
  },
  forPrompt(promptId) {
    return _byPrompt.get(promptId) || [];
  },
  latest(promptId) {
    return this.forPrompt(promptId)[0] || null;
  },
  get(essayId) {
    return _byEssayId.get(essayId) || null;
  },
  async saveEssay(essay) {
    await _callEssays({ action: "saveEssay", essay });
    const entry = { essay, grade: null };
    _byEssayId.set(essay.essayId, entry);
    const list = _byPrompt.get(essay.promptId) || [];
    list.unshift(entry);
    _byPrompt.set(essay.promptId, list);
  },
  async saveGrade(grade) {
    await _callEssays({ action: "saveGrade", grade });
    const entry = _byEssayId.get(grade.essayId);
    if (entry) entry.grade = grade;
  },
};
