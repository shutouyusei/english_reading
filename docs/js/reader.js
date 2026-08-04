"use strict";

const state = {
  passage: null,
  current: 0,
  answers: [],
  startedAt: null,
  timerId: null,
};

function qs(sel) {
  return document.querySelector(sel);
}

async function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || "";
  const mode = params.get("mode") === "study" ? "study" : "solve";
  if (!/^passage_\d+$/.test(id)) {
    renderError("パッセージが指定されていません。");
    return;
  }
  try {
    const res = await fetch(`data/passages/${id}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.passage = await res.json();
  } catch (err) {
    renderError(`パッセージを読み込めませんでした(${err.message})。`);
    return;
  }
  document.title = `${state.passage.title} — TOEFL Reading`;
  qs("#header-title").textContent = state.passage.title;
  if (mode === "study") startStudyMode(); else startSolveMode();
}

function renderError(message) {
  qs("#reader-main").innerHTML =
    `<p class="error">${escapeHtml(message)} <a href="index.html">一覧に戻る</a></p>`;
}

/* ---------- 解答モード ---------- */

function startSolveMode() {
  stopTimer();
  state.current = 0;
  state.answers = state.passage.questions.map(() => null);
  state.startedAt = Date.now();
  state.timerId = setInterval(updateTimer, 1000);
  renderSolveHeader();
  renderSolveStep();
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function elapsedSeconds() {
  return Math.floor((Date.now() - state.startedAt) / 1000);
}

function formatElapsed(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function updateTimer() {
  const el = qs("#timer");
  if (el) el.textContent = formatElapsed(elapsedSeconds());
}

function renderSolveHeader() {
  qs("#header-status").innerHTML =
    `<span id="q-pos"></span> ｜ ⏱ <span id="timer">0:00</span> ｜ ` +
    `<a href="#" id="quit-link">中断して解説モードへ</a>`;
  qs("#quit-link").addEventListener("click", (e) => {
    e.preventDefault();
    startStudyMode();
  });
}

function renderSolveStep() {
  qs("#q-pos").textContent =
    `Question ${state.current + 1} of ${state.passage.questions.length}`;
  renderPassagePlain();
  renderQuestion();
}

function renderPassagePlain() {
  const question = state.passage.questions[state.current];
  const target =
    question && question.type === "Vocabulary" ? question.target_word : null;
  const pane = qs("#passage-pane");
  pane.innerHTML = "";
  for (const para of state.passage.body.split("\n\n")) {
    const p = document.createElement("p");
    for (const part of tokenize(para)) {
      if (part.isWord && target &&
          candidates(part.text).includes(target.toLowerCase())) {
        const mark = document.createElement("mark");
        mark.textContent = part.text;
        p.appendChild(mark);
      } else {
        p.appendChild(document.createTextNode(part.text));
      }
    }
    pane.appendChild(p);
  }
}

function renderQuestion() {
  const idx = state.current;
  const question = state.passage.questions[idx];
  const isLast = idx === state.passage.questions.length - 1;
  const choices = ["A", "B", "C", "D"].map((letter) => {
    const selected = state.answers[idx] === letter ? " selected" : "";
    return `<button class="choice${selected}" data-letter="${letter}">` +
      `<b>${letter}.</b> ${escapeHtml(question.choices[letter])}</button>`;
  }).join("");
  qs("#right-pane").innerHTML = `
    <div class="question-card">
      <p><b>Q${question.id}.</b> ${escapeHtml(question.question)}</p>
      <div class="choices">${choices}</div>
      <div class="nav-row">
        <button id="back-btn" ${idx === 0 ? "disabled" : ""}>← Back</button>
        <button id="next-btn" class="primary" ${state.answers[idx] ? "" : "disabled"}>
          ${isLast ? "採点する" : "Next →"}</button>
      </div>
    </div>`;
  document.querySelectorAll(".choice").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.answers[idx] = btn.dataset.letter;
      renderQuestion();
    }));
  qs("#back-btn").addEventListener("click", () => {
    state.current -= 1;
    renderSolveStep();
  });
  qs("#next-btn").addEventListener("click", () => {
    if (isLast) {
      finishSolve();
    } else {
      state.current += 1;
      renderSolveStep();
    }
  });
}

function finishSolve() {
  stopTimer();
  const questions = state.passage.questions;
  const score = questions.filter((q, i) => state.answers[i] === q.correct).length;
  const sec = elapsedSeconds();
  const wrong = questions
    .filter((q, i) => state.answers[i] !== q.correct)
    .map((q) => `Q${q.id} (${q.type})`);
  const result = {
    solved: true,
    score,
    total: questions.length,
    elapsedSec: sec,
    answers: state.answers,
    date: new Date().toISOString().slice(0, 10),
  };
  try {
    localStorage.setItem(`results.${state.passage.id}`, JSON.stringify(result));
  } catch (_) { /* プライベートモード等では保存しない */ }
  qs("#header-status").textContent = `⏱ ${formatElapsed(sec)} で終了`;
  qs("#right-pane").innerHTML = `
    <div class="result-card">
      <p class="score">${score} / ${questions.length} 正解</p>
      <p class="hint">所要時間 ${formatElapsed(sec)}${
        wrong.length ? ` ｜ 誤答: ${wrong.join(", ")}` : " ｜ 🎉 全問正解"}</p>
      <button id="to-study" class="primary">📖 解説モードで復習する</button>
    </div>`;
  qs("#to-study").addEventListener("click", () => startStudyMode());
}

/* ---------- 解説モード(Task 10で本実装に置換する仮実装) ---------- */

function startStudyMode() {
  stopTimer();
  qs("#header-status").textContent = "解説モード";
  qs("#right-pane").innerHTML =
    `<p class="hint" style="padding:20px">解説モードは未実装です(Task 10で実装)。</p>`;
}

document.addEventListener("DOMContentLoaded", init);
