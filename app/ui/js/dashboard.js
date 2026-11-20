"use strict";

/* Dashboard (app home), laid out to fit one window without scrolling: a score sheet
   with one row per skill in the order of the test, an analysis of where points are
   lost (rules from analysis.js) and, on request, written advice from Claude.
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

// A rushed attempt (see analysis.js) still shows the set as touched, but its score is
// not counted, so the averages here agree with the analysis below.
function countedRecord(attempt) {
  const record = attemptRecord(attempt);
  return isRushed(attempt) ? { ...record, ratio: null, label: "Too fast to count" } : record;
}

// Rows follow the order of the sections in the test.
function skillDefinitions() {
  return [
    {
      key: "reading", label: "Reading", href: "reading.html",
      indexUrl: "data/reading/index.json", listKey: "passages",
      store: Store, recordsOf: (id) => Store.attempts(id).map(countedRecord),
      averageLabel: percentLabel, averageCaption: "average score",
      attemptsOf: (id) => Store.attempts(id),
      detailUrl: (id) => `data/reading/${encodeURIComponent(id)}.json`,
      solveUrl: (id) => `reader.html?id=${encodeURIComponent(id)}&mode=solve`,
    },
    {
      key: "listening", label: "Listening", href: "listening.html",
      indexUrl: "data/listening/index.json", listKey: "items",
      store: ListeningStore, recordsOf: (id) => ListeningStore.attempts(id).map(countedRecord),
      averageLabel: percentLabel, averageCaption: "average score",
      attemptsOf: (id) => ListeningStore.attempts(id),
      detailUrl: (id) => `data/listening/${encodeURIComponent(id)}.json`,
      // No solveUrl: the app cannot play listening audio yet, so no listening set is
      // offered as the next thing to do.
    },
    { key: "speaking", label: "Speaking", unavailable: true },
    {
      key: "writing", label: "Writing", href: "writing.html",
      indexUrl: "data/writing/index.json", listKey: "prompts",
      store: Essays, recordsOf: (id) => Essays.forPrompt(id).map(essayRecord),
      averageLabel: outOfFiveLabel, averageCaption: "average out of 5",
      solveUrl: (id) => `writing-editor.html?id=${encodeURIComponent(id)}`,
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
    return { ...skill, items, summary: summarize(items, skill.recordsOf), error: null };
  } catch (err) {
    return { ...skill, items: [], summary: null, error: err.message };
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
  const last = summary.lastAt ? `Last attempt on ${dateLabel(summary.lastAt)}` : "No attempt yet";
  const figure = summary.average === null
    ? `<p class="skill-figure empty">No score yet</p>`
    : `<p class="skill-figure">${escapeHtml(skill.averageLabel(summary.average))}<small>${skill.averageCaption}</small></p>`;
  return `
    <a class="skill-row skill-${skill.key}" href="${skill.href}" title="${escapeHtml(last)}">
      <div>${name}<p class="skill-note">${summary.done} of ${summary.total} done</p></div>
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

// ---- Analysis (rules) -------------------------------------------------------------

/** Reading and listening: pairs the latest real attempt at each set with that set's
    questions. A set whose question file cannot be loaded is left out. */
async function collectAnswered(skill) {
  const result = { sets: [], candidates: [], rushed: 0 };
  for (const item of skill.items) {
    const attempts = skill.attemptsOf(item.id);
    const usable = latestUsableAttempt(attempts);
    result.rushed += attempts.filter((attempt) => attempt !== usable && isRushed(attempt)).length;
    result.candidates.push({ item, ratio: usable ? usable.score / usable.total : null });
    if (!usable) continue;
    try {
      const res = await fetch(`${window.DATA_BASE || ""}${skill.detailUrl(item.id)}`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const detail = await res.json();
      result.sets.push({
        title: item.title, topic: item.topic, questions: detail.questions,
        answers: usable.answers || [], score: usable.score, total: usable.total,
        seconds: usable.elapsedSec,
      });
    } catch (err) {
      console.warn(`Could not load the questions of ${item.id}:`, err);
    }
  }
  return result;
}

/** Writing: the latest valid grade of each prompt. An essay still awaiting grading
    counts as tried, so it is not offered again as "new". */
function collectWriting(skill) {
  const grades = [];
  const candidates = [];
  for (const item of skill.items) {
    const entries = Essays.forPrompt(item.id);
    const graded = entries.find((entry) => essayRecord(entry).ratio !== null);
    if (graded) grades.push(graded.grade);
    const ratio = graded ? essayRecord(graded).ratio : (entries.length ? 1 : null);
    candidates.push({ item, ratio });
  }
  return { grades, candidates };
}

async function buildAnalysis(skills) {
  const bySkill = Object.fromEntries(skills.map((skill) => [skill.key, skill]));
  const reading = await collectAnswered(bySkill.reading);
  const listening = await collectAnswered(bySkill.listening);
  const writing = collectWriting(bySkill.writing);

  const nextSets = [];
  for (const [skill, candidates] of [[bySkill.reading, reading.candidates], [bySkill.writing, writing.candidates]]) {
    const next = nextSet(candidates);
    if (next) nextSets.push({ skill: skill.label, title: next.item.title, reason: next.reason, url: skill.solveUrl(next.item.id) });
  }
  return {
    readingRows: typeBreakdown(reading.sets),
    listeningRows: typeBreakdown(listening.sets),
    writingRows: criteriaBreakdown(writing.grades),
    readingSets: reading.sets,
    listeningSets: listening.sets,
    setsAnalysed: reading.sets.length + listening.sets.length,
    rushed: reading.rushed + listening.rushed,
    nextSets,
  };
}

function breakdownHtml(title, rows, unit) {
  if (!rows.length) return "";
  const items = rows.map((row) => `
      <li>
        <span class="breakdown-name">${escapeHtml(row.name)}</span>
        <span class="bar"><span style="width:${Math.round((row.value / row.max) * 100)}%"></span></span>
        <span class="breakdown-count">${escapeHtml(row.value)} of ${escapeHtml(row.max)}${unit}</span>
      </li>`);
  return `<h3>${title}</h3><ul class="breakdown">${items.join("")}</ul>`;
}

function nextSetHtml(next) {
  const verb = next.skill === "Writing" ? "Write" : "Solve";
  const why = next.reason === "new" ? "not tried yet" : "your lowest score so far";
  return `<a class="button primary" href="${next.url}" title="${escapeHtml(`${next.skill}, ${why}`)}">${verb} “${escapeHtml(next.title)}”</a>`;
}

function breakdownPanelHtml(analysis) {
  const breakdowns =
    breakdownHtml("Reading, by question type", analysis.readingRows, " correct") +
    breakdownHtml("Listening, by question type", analysis.listeningRows, " correct") +
    breakdownHtml("Writing, by criterion", analysis.writingRows, "");
  // One short line; the exact rule is in the tooltip so the panel stays compact.
  const rule = `Each set counts once, with your latest attempt. An attempt finished in under ${RUSHED_SECONDS_PER_QUESTION} seconds per question is left out.`;
  const leftOut = analysis.rushed
    ? `<p class="hint" title="${rule}">${analysis.rushed} very fast ${analysis.rushed === 1 ? "attempt is" : "attempts are"} left out.</p>`
    : "";
  return `
    <h2 title="${rule}">Where you lose points</h2>
    ${breakdowns || `<p class="hint">Finish a question set to see where you lose points.</p>`}
    ${leftOut}`;
}

function nextPanelHtml(analysis) {
  const lines = adviceLines({
    reading: analysis.readingRows, listening: analysis.listeningRows,
    writing: analysis.writingRows, setsAnalysed: analysis.setsAnalysed,
  });
  return `
    <h2>What to do next</h2>
    ${lines.length ? `<ul class="advice">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}
    ${analysis.nextSets.length
      ? `<div class="next-sets">${analysis.nextSets.map(nextSetHtml).join("")}</div>`
      : `<p class="hint">Every set is done with a full score.</p>`}`;
}

// ---- Advice from Claude -----------------------------------------------------------

/** What is sent to Claude: numbers and titles only, never the learner's essays. */
function statsForClaude(skills, analysis) {
  const typeRows = (rows) => rows.map((row) => ({ type: row.name, correct: row.value, answered: row.max }));
  const setRows = (skill, sets) => sets.map((set) => ({
    skill, title: set.title, topic: set.topic, score: set.score, total: set.total, seconds: set.seconds,
  }));
  return {
    skills: skills.filter((skill) => skill.summary)
      .map((skill) => ({ skill: skill.label, done: skill.summary.done, total: skill.summary.total })),
    question_types: { reading: typeRows(analysis.readingRows), listening: typeRows(analysis.listeningRows) },
    criteria: analysis.writingRows.map((row) => ({ name: row.name, average_out_of_5: row.value })),
    sets: [...setRows("Reading", analysis.readingSets), ...setRows("Listening", analysis.listeningSets)],
    skipped_rushed_attempts: analysis.rushed,
    not_available_yet: ["Listening practice (the app cannot play audio yet)", "Speaking"],
    next_sets: analysis.nextSets.map((next) => ({ skill: next.skill, title: next.title, reason: next.reason })),
  };
}

// The advice is whatever JSON Claude returned, with no type guarantee, so only strings
// are shown and everything goes through escapeHtml.
function adviceBodyHtml(row) {
  const advice = row && row.advice ? row.advice : {};
  const text = (value) => (typeof value === "string" ? escapeHtml(value) : "");
  const focus = (Array.isArray(advice.focus) ? advice.focus : [])
    .filter((entry) => entry && typeof entry.area === "string" && typeof entry.advice === "string")
    .map((entry) => `<li><b>${escapeHtml(entry.area)}</b> ${escapeHtml(entry.advice)}</li>`);
  if (!text(advice.summary) && !focus.length && !text(advice.next_step)) {
    return `<p class="error">Claude's answer could not be read. Ask again.</p>`;
  }
  return `
    <p>${text(advice.summary)}</p>
    ${focus.length ? `<ul class="advice">${focus.join("")}</ul>` : ""}
    ${text(advice.next_step) ? `<p><b>Next session</b> ${text(advice.next_step)}</p>` : ""}
    <p class="hint">Written by Claude on ${escapeHtml(dateLabel(String(row.createdAt || "")))}. AI advice can be wrong.</p>`;
}

const ASK_CLAUDE_TITLE =
  "Sends your scores and set titles (no essay text) to Claude Code on this computer. Takes 10 to 20 seconds.";

function advicePanelHtml(action, body) {
  return `<div class="panel-heading"><h2>Advice from Claude</h2>${action}</div>${body}`;
}

function renderAdvicePanel(container, stats, row, errorMessage) {
  const hasData = stats.sets.length > 0 || stats.criteria.length > 0;
  const error = errorMessage ? `<p class="error">Could not get advice: ${escapeHtml(errorMessage)}</p>` : "";
  const saved = row ? adviceBodyHtml(row) : "";
  const empty = hasData
    ? `<p class="hint">Claude reads the numbers on this page and writes a short plan. It takes 10 to 20 seconds.</p>`
    : `<p class="hint">Finish a question set first; Claude needs some results to work from.</p>`;
  const action = hasData
    ? `<button id="ask-claude" class="primary" title="${ASK_CLAUDE_TITLE}">${row ? "Ask again" : "Ask Claude"}</button>`
    : "";
  container.innerHTML = advicePanelHtml(action, error + (saved || empty));

  const button = container.querySelector("#ask-claude");
  if (!button) return;
  button.addEventListener("click", async () => {
    const started = Date.now();
    container.innerHTML = advicePanelHtml(
      `<span class="meta">Asking Claude… <span id="advice-elapsed">0</span>s</span>`, saved);
    const tick = setInterval(() => {
      const label = container.querySelector("#advice-elapsed");
      if (label) label.textContent = String(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    try {
      renderAdvicePanel(container, stats, await Advisor.advise(stats), null);
    } catch (err) {
      renderAdvicePanel(container, stats, row, err && err.message ? err.message : String(err));
    } finally {
      clearInterval(tick);
    }
  });
}

async function initDashboard() {
  const skills = await Promise.all(skillDefinitions().map(loadSkill));
  document.querySelector("#dash-headline").textContent = headlineText(skills);
  document.querySelector("#skill-rows").innerHTML = skills.map(skillRowHtml).join("");

  const analysis = await buildAnalysis(skills);
  document.querySelector("#analysis-breakdown").innerHTML = breakdownPanelHtml(analysis);
  document.querySelector("#analysis-next").innerHTML = nextPanelHtml(analysis);

  let latest = null;
  try {
    latest = await Advisor.latest();
  } catch (err) {
    console.warn("Could not load the saved advice:", err);
  }
  renderAdvicePanel(document.querySelector("#ai-advice"), statsForClaude(skills, analysis), latest, null);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initDashboard);
}
