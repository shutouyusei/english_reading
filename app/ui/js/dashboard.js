"use strict";

/* Dashboard (app home). One card per skill with progress from the saved records, and
   a list of recent attempts across skills.
   The functions down to recentActivity are pure and exported for tests; the rest
   loads the data and renders the page. */

const RECENT_LIMIT = 8;

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

/** Progress for one skill. recordsOf(id) returns that item's records, newest first. */
function summarize(items, recordsOf) {
  const ratios = [];
  let done = 0;
  let lastAt = "";
  for (const item of items) {
    const records = recordsOf(item.id);
    if (!records.length) continue;
    done += 1;
    if (records[0].at > lastAt) lastAt = records[0].at;
    const scored = records.find((record) => record.ratio !== null);
    if (scored) ratios.push(scored.ratio);
  }
  const average = ratios.length ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length : null;
  return { total: items.length, done, average, lastAt: lastAt || null };
}

/** Every record of every skill as one list, newest first, cut to limit. */
function recentActivity(skills, limit) {
  const rows = [];
  for (const skill of skills) {
    for (const item of skill.items) {
      for (const record of skill.recordsOf(item.id)) {
        rows.push({ skill: skill.label, title: item.title, at: record.at, label: record.label });
      }
    }
  }
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return rows.slice(0, limit);
}

if (typeof module !== "undefined") {
  module.exports = { attemptRecord, essayRecord, summarize, recentActivity };
}

const percentLabel = (ratio) => `${Math.round(ratio * 100)}%`;
const outOfFiveLabel = (ratio) => `${(ratio * 5).toFixed(1)}/5`;
const dateLabel = (at) => at.slice(0, 10);

function skillDefinitions() {
  return [
    {
      label: "Reading", icon: "📖", href: "reading.html",
      indexUrl: "data/reading/index.json", listKey: "passages",
      store: Store, recordsOf: (id) => Store.attempts(id).map(attemptRecord),
      averageLabel: percentLabel,
    },
    {
      label: "Listening", icon: "🎧", href: "listening.html",
      indexUrl: "data/listening/index.json", listKey: "items",
      store: ListeningStore, recordsOf: (id) => ListeningStore.attempts(id).map(attemptRecord),
      averageLabel: percentLabel,
    },
    {
      label: "Writing", icon: "✍️", href: "writing.html",
      indexUrl: "data/writing/index.json", listKey: "prompts",
      store: Essays, recordsOf: (id) => Essays.forPrompt(id).map(essayRecord),
      averageLabel: outOfFiveLabel,
    },
  ];
}

async function loadSkill(skill) {
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
    return { ...skill, items, error: null };
  } catch (err) {
    return { ...skill, items: [], error: err.message };
  }
}

function skillCardHtml(skill) {
  const heading = `<h3>${skill.icon} ${escapeHtml(skill.label)}</h3>`;
  const open = `<a class="button primary" href="${skill.href}">Open</a>`;
  if (skill.error) {
    return `
      <div class="card skill-card">
        ${heading}
        <p class="error">Could not load the list (${escapeHtml(skill.error)}).</p>
        ${open}
      </div>`;
  }
  const summary = summarize(skill.items, skill.recordsOf);
  const average = summary.average === null ? "No score yet" : `Average ${skill.averageLabel(summary.average)}`;
  const last = summary.lastAt ? ` · last: ${escapeHtml(dateLabel(summary.lastAt))}` : "";
  return `
    <div class="card skill-card">
      ${heading}
      <p class="skill-progress">${summary.done} of ${summary.total} done</p>
      <p class="meta">${escapeHtml(average)}${last}</p>
      ${open}
    </div>`;
}

const SPEAKING_CARD_HTML = `
    <div class="card skill-card disabled">
      <h3>🎤 Speaking</h3>
      <p class="skill-progress">Not available yet</p>
      <p class="meta">Speaking questions have not been built.</p>
    </div>`;

function activityHtml(rows) {
  if (!rows.length) return `<p class="hint">No attempts yet.</p>`;
  const items = rows.map((row) => `
      <li class="meta">
        <span>${escapeHtml(dateLabel(row.at))}</span>
        <span>${escapeHtml(row.skill)}</span>
        <span class="activity-title">${escapeHtml(row.title)}</span>
        <span>${escapeHtml(row.label)}</span>
      </li>`);
  return `<ul class="activity">${items.join("")}</ul>`;
}

async function initDashboard() {
  const skills = await Promise.all(skillDefinitions().map(loadSkill));
  document.querySelector("#skill-cards").innerHTML =
    skills.map(skillCardHtml).join("") + SPEAKING_CARD_HTML;
  document.querySelector("#recent-activity").innerHTML =
    activityHtml(recentActivity(skills, RECENT_LIMIT));
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initDashboard);
}
