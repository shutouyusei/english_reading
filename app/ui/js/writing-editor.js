"use strict";

/* Switches between writing -> grading -> result on one screen.
   Pressing the grade button saves the essay first, and only then starts grading.
   With this order, the written text survives even if the app dies during grading. */

const state = {
  prompt: null,
  startedAt: null,
  timerId: null,
  elapsedSec: 0,
};

async function initEditor() {
  const promptId = new URLSearchParams(location.search).get("id");
  const promptPane = document.querySelector("#prompt-pane");

  try {
    await Essays.init();
  } catch (err) {
    console.warn("Could not load study records:", err);
  }

  try {
    const res = await fetch(
      `${window.DATA_BASE || ""}data/writing/${encodeURIComponent(promptId)}.json`,
      { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.prompt = await res.json();
  } catch (err) {
    promptPane.innerHTML =
      `<p class="error">Could not load the prompt (${esc(err.message)}).</p>`;
    return;
  }

  document.querySelector("#header-title").textContent = state.prompt.title;
  promptPane.innerHTML = promptHtml(state.prompt);

  const previous = Essays.latest(promptId);
  if (previous && previous.grade) {
    showResult(previous.essay, previous.grade);
  } else if (previous && !previous.grade) {
    showUngraded(previous.essay);
  } else {
    showWriting();
  }
}

function promptHtml(prompt) {
  if (prompt.type === "discussion") {
    const discussion = prompt.discussion;
    if (!discussion || !discussion.professor_post || !Array.isArray(discussion.student_posts)) {
      return `<p class="error">The prompt data is broken (invalid discussion field).</p>`;
    }
    const posts = [discussion.professor_post, ...discussion.student_posts];
    return `
      <h2>${esc(prompt.title)}</h2>
      <p class="hint">${esc(prompt.instructions)}</p>
      ${posts.map((post, i) => `
        <div class="post ${i === 0 ? "post-professor" : ""}">
          <p class="post-name">${esc(post.name)}</p>
          <p>${esc(post.text)}</p>
        </div>`).join("")}`;
  }
  return `
    <h2>${esc(prompt.title)}</h2>
    <p class="hint">${esc(prompt.instructions)}</p>
    <div class="post"><p>${esc(prompt.situation)}</p></div>
    <p class="meta">To: ${esc(prompt.recipient)}</p>
    <p class="meta">Points to cover:</p>
    <ul>${prompt.must_include.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}

// --- Writing ---

function showWriting(initialText = "") {
  document.querySelector("#header-status").textContent = "";
  document.querySelector("#right-pane").innerHTML = `
    <div class="pane-header">
      <span id="timer">0m 0s</span>
      <span class="meta">Target ${state.prompt.target_minutes} min</span>
    </div>
    <textarea id="essay-input" placeholder="Write your essay here">${esc(initialText)}</textarea>
    <p class="meta"><span id="word-count">0</span> words</p>
    <button id="submit-button" class="button primary" disabled>Grade</button>`;

  const input = document.querySelector("#essay-input");
  const button = document.querySelector("#submit-button");
  const syncCounter = () => {
    const words = countWords(input.value);
    document.querySelector("#word-count").textContent = words;
    // Sending empty text to Claude returns no meaningful grade. Do not waste the quota.
    button.disabled = words === 0;
  };
  input.addEventListener("input", syncCounter);
  syncCounter(); // also reflect text pre-filled by a draft restore (the rewrite button)
  button.addEventListener("click", () => submitEssay(input.value));
  input.focus();
  startTimer();
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function startTimer() {
  state.startedAt = Date.now();
  state.timerId = setInterval(() => {
    state.elapsedSec = Math.floor((Date.now() - state.startedAt) / 1000);
    const label = document.querySelector("#timer");
    if (!label) return;
    label.textContent = formatMinSec(state.elapsedSec);
    label.classList.toggle("over", state.elapsedSec > state.prompt.target_minutes * 60);
  }, 1000);
}

function stopTimer() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = null;
}

function formatMinSec(sec) {
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// --- Submit and grade ---

async function submitEssay(text) {
  stopTimer();
  const essay = {
    essayId: newEssayId(),
    promptId: state.prompt.id,
    promptType: state.prompt.type,
    text,
    elapsedSec: state.elapsedSec,
    writtenAt: new Date().toISOString(),
  };
  try {
    await Essays.saveEssay(essay);
  } catch (err) {
    showError(essay, `Could not save: ${err.message}`);
    return;
  }
  await runGrading(essay);
}

function newEssayId() {
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]/g, "").slice(0, 15);
  const salt = Math.random().toString(36).slice(2, 6);
  return `e_${stamp}_${salt}`;
}

async function runGrading(essay) {
  showGrading();
  let grade;
  try {
    grade = await Grader.grade({
      promptId: essay.promptId,
      promptType: essay.promptType,
      essayText: essay.text,
    });
  } catch (err) {
    showError(essay, err.message || String(err));
    return;
  }
  const row = { ...grade, essayId: essay.essayId, gradedAt: new Date().toISOString() };
  try {
    await Essays.saveGrade(row);
  } catch (err) {
    showError(essay, `Could not save the grading result: ${err.message}`);
    return;
  }
  showResult(essay, row);
}

function showGrading() {
  document.querySelector("#header-status").textContent = "";
  const startedAt = Date.now();
  document.querySelector("#right-pane").innerHTML = `
    <div class="grading">
      <p>Grading…</p>
      <p class="meta">Usually takes 15-20 seconds. <span id="grading-elapsed">0</span>s elapsed</p>
      <p class="hint">Your essay is already saved, so you can close this screen.<br>
        It stays in the list as "Awaiting grading".</p>
      <div class="card-actions">
        <a class="button" href="writing.html">Back to the list</a>
      </div>
    </div>`;
  const tick = setInterval(() => {
    const label = document.querySelector("#grading-elapsed");
    if (!label) { clearInterval(tick); return; }
    label.textContent = Math.floor((Date.now() - startedAt) / 1000);
  }, 1000);
}

// --- Result ---

// The grade is the JSON the grading AI returned, as is, and its types are guaranteed
// nowhere (it is saved verbatim to essays.jsonl and re-read on every launch).
// Always escape it before inserting it into innerHTML.
// If overall is not a finite number from 0 to 5, fall back to showing "?"
// (same idea as badgeHtml in app/ui/js/writing-list.js).
// criteria/corrections are not guaranteed to be arrays either, so anything that is not
// an array is treated as an empty array.
function safeScore(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) return null;
  return value;
}

function showResult(essay, grade) {
  const overall = safeScore(grade.overall);
  const overallLabel = overall === null ? "?" : esc(overall);
  const criteria = Array.isArray(grade.criteria) ? grade.criteria : [];
  const corrections = Array.isArray(grade.corrections) ? grade.corrections : [];
  document.querySelector("#header-status").textContent =
    `${overall === null ? "?" : overall}/5 · ${formatMinSec(essay.elapsedSec)}`;
  document.querySelector("#right-pane").innerHTML = `
    <div class="pane-header"><h3>Overall ${overallLabel} / 5</h3></div>
    ${criteria.map((c) => `
      <div class="criterion">
        <p class="criterion-name">${esc(c && c.name)} <strong>${esc(c && c.score)}/5</strong></p>
        <p>${esc(c && c.comment)}</p>
      </div>`).join("")}
    <h3>Corrections</h3>
    ${corrections.length
      ? corrections.map((c) => `
        <div class="correction">
          <p class="original">${esc(c && c.original)}</p>
          <p class="revised">→ ${esc(c && c.revised)}</p>
          <p class="meta">${esc(c && c.reason)}</p>
        </div>`).join("")
      : `<p class="hint">Nothing to correct.</p>`}
    <h3>Summary</h3>
    <p>${esc(grade.summary || "")}</p>
    <div class="card-actions">
      <button id="rewrite-button" class="button primary">Write again</button>
      <a class="button" href="writing.html">Back to the list</a>
    </div>`;
  document.querySelector("#rewrite-button")
    .addEventListener("click", () => { state.elapsedSec = 0; showWriting(); });
}

function showUngraded(essay) {
  document.querySelector("#right-pane").innerHTML = `
    <div class="pane-header"><h3>Awaiting grading</h3></div>
    <p class="meta">Written in ${formatMinSec(essay.elapsedSec)} · ${countWords(essay.text)} words</p>
    <pre class="essay-text">${esc(essay.text)}</pre>
    <div class="card-actions">
      <button id="grade-button" class="button primary">Grade</button>
      <button id="rewrite-button" class="button">Revise</button>
    </div>`;
  document.querySelector("#grade-button")
    .addEventListener("click", () => runGrading(essay));
  document.querySelector("#rewrite-button")
    .addEventListener("click", () => { state.elapsedSec = 0; showWriting(essay.text); });
}

function showError(essay, message) {
  document.querySelector("#header-status").textContent = "";
  document.querySelector("#right-pane").innerHTML = `
    <div class="pane-header"><h3>Could not grade</h3></div>
    <p class="error">${esc(message)}</p>
    <p class="hint">Your essay is saved.</p>
    <pre class="essay-text">${esc(essay.text)}</pre>
    <div class="card-actions">
      <button id="retry-button" class="button primary">Grade again</button>
      <a class="button" href="writing.html">Back to the list</a>
    </div>`;
  document.querySelector("#retry-button")
    .addEventListener("click", () => runGrading(essay));
}

// HTML escaping uses escapeHtml from docs/js/escape.js.
const esc = (text) => escapeHtml(text);

document.addEventListener("DOMContentLoaded", initEditor);
