"use strict";

/* Dashboard (app home). A score sheet with one row per skill, in the order of the
   test, showing progress from the saved records.
   The functions down to summarize are pure and exported for tests; the rest loads
   the data and renders the page. */

function isNumberInRange(value, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}

// Saved records have no schema guarantee, so a record without a usable score keeps its
// date (it still counts as done) but gets ratio null and is left out of the average.
function attemptRecord(attempt) {
  const valid = isNumberInRange(attempt.total, Infinity) && attempt.total > 0 &&
                isNumberInRange(attempt.score, attempt.total);
  return {
    at: String(attempt.finishedAt || ""),
    ratio: valid ? attempt.score / attempt.total : null,
    label: valid ? `${attempt.score}/${attempt.total}` : "No score",
  };
}

function essayRecord(entry) {
  const overall = entry.grade ? entry.grade.overall : null;
  const valid = isNumberInRange(overall, 5);
  return {
    at: String(entry.essay.writtenAt || ""),
    ratio: valid ? overall / 5 : null,
    label: valid ? `${overall}/5` : "Awaiting grading",
  };
}

/** Progress for one skill. recordsOf(id) returns that item's records, newest first.
    states has one entry per item, in list order, for the row of blocks. */
function summarize(items, recordsOf) {
  const ratios = [];
  const states = [];
  let lastAt = "";
  for (const item of items) {
    const records = recordsOf(item.id);
    if (!records.length) {
      states.push({ title: item.title, status: "todo", label: "Not attempted" });
      continue;
    }
    if (records[0].at > lastAt) lastAt = records[0].at;
    const scored = records.find((record) => record.ratio !== null);
    if (scored) ratios.push(scored.ratio);
    states.push({
      title: item.title,
      status: scored ? "done" : "pending",
      label: (scored || records[0]).label,
    });
  }
  const average = ratios.length ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length : null;
  const done = states.filter((state) => state.status !== "todo").length;
  return { total: items.length, done, average, lastAt: lastAt || null, states };
}

if (typeof module !== "undefined") {
  module.exports = { attemptRecord, essayRecord, summarize };
}

const percentLabel = (ratio) => `${Math.round(ratio * 100)}%`;
const outOfFiveLabel = (ratio) => (ratio * 5).toFixed(1);

function dateLabel(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at.slice(0, 10);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Rows follow the order of the sections in the test.
function skillDefinitions() {
  return [
    {
      key: "reading", label: "Reading", href: "reading.html",
      indexUrl: "data/reading/index.json", listKey: "passages",
      store: Store, recordsOf: (id) => Store.attempts(id).map(attemptRecord),
      averageLabel: percentLabel, averageCaption: "average score",
    },
    {
      key: "listening", label: "Listening", href: "listening.html",
      indexUrl: "data/listening/index.json", listKey: "items",
      store: ListeningStore, recordsOf: (id) => ListeningStore.attempts(id).map(attemptRecord),
      averageLabel: percentLabel, averageCaption: "average score",
    },
    { key: "speaking", label: "Speaking", unavailable: true },
    {
      key: "writing", label: "Writing", href: "writing.html",
      indexUrl: "data/writing/index.json", listKey: "prompts",
      store: Essays, recordsOf: (id) => Essays.forPrompt(id).map(essayRecord),
      averageLabel: outOfFiveLabel, averageCaption: "average out of 5",
    },
  ];
}

async function loadSkill(skill) {
  if (skill.unavailable) return skill;
  try {
    await skill.store.init();
  } catch (err) {
    console.warn("Could not load study records:", err);
  }
  try {
    const res = await fetch(`${window.DATA_BASE || ""}${skill.indexUrl}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = (await res.json())[skill.listKey];
    if (!Array.isArray(items)) throw new Error(`index.json has no ${skill.listKey} list`);
    return { ...skill, summary: summarize(items, skill.recordsOf), error: null };
  } catch (err) {
    return { ...skill, summary: null, error: err.message };
  }
}

function blocksHtml(states) {
  const blocks = states.map((state) =>
    `<span class="block ${state.status}" title="${escapeHtml(`${state.title}: ${state.label}`)}"></span>`);
  return `<div class="blocks">${blocks.join("")}</div>`;
}

function skillRowHtml(skill) {
  const name = `<h2 class="skill-name">${escapeHtml(skill.label)}</h2>`;
  if (skill.unavailable) {
    return `
      <div class="skill-row skill-${skill.key} unavailable">
        <div>${name}<p class="skill-note">Not built yet</p></div>
      </div>`;
  }
  if (skill.error) {
    return `
      <a class="skill-row skill-${skill.key}" href="${skill.href}">
        <div>${name}<p class="skill-note error">Could not load the list (${escapeHtml(skill.error)})</p></div>
      </a>`;
  }
  const summary = skill.summary;
  const last = summary.lastAt ? `, last on ${dateLabel(summary.lastAt)}` : "";
  const figure = summary.average === null
    ? `<p class="skill-figure empty">No score yet</p>`
    : `<p class="skill-figure">${escapeHtml(skill.averageLabel(summary.average))}<small>${skill.averageCaption}</small></p>`;
  return `
    <a class="skill-row skill-${skill.key}" href="${skill.href}">
      <div>${name}<p class="skill-note">${summary.done} of ${summary.total} done${escapeHtml(last)}</p></div>
      ${blocksHtml(summary.states)}
      ${figure}
    </a>`;
}

function headlineText(skills) {
  const summaries = skills.map((skill) => skill.summary).filter(Boolean);
  const done = summaries.reduce((sum, summary) => sum + summary.done, 0);
  const total = summaries.reduce((sum, summary) => sum + summary.total, 0);
  if (!total) return "No question sets yet.";
  if (!done) return `${total} question sets are waiting. Pick a section to start.`;
  if (done === total) return `All ${total} question sets done.`;
  return `${done} of ${total} question sets done.`;
}

async function initDashboard() {
  const skills = await Promise.all(skillDefinitions().map(loadSkill));
  document.querySelector("#dash-headline").textContent = headlineText(skills);
  document.querySelector("#skill-rows").innerHTML = skills.map(skillRowHtml).join("");
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initDashboard);
}
