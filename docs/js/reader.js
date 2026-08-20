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
  try {
    await Store.init();
  } catch (err) {
    console.warn("学習記録を読み込めませんでした:", err);
  }
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || "";
  const mode = params.get("mode") === "study" ? "study" : "solve";
  if (!/^passage_\d+$/.test(id)) {
    renderError("パッセージが指定されていません。");
    return;
  }
  try {
    // 公開後に内容を訂正した場合も確実に反映させる(理由は app.js の同種の記述を参照)。
    const res = await fetch(`${window.DATA_BASE || ""}data/passages/${id}.json`, { cache: "no-cache" });
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

async function finishSolve() {
  stopTimer();
  const questions = state.passage.questions;
  const score = questions.filter((q, i) => state.answers[i] === q.correct).length;
  const sec = elapsedSeconds();
  const wrong = questions
    .filter((q, i) => state.answers[i] !== q.correct)
    .map((q) => `Q${q.id} (${q.type})`);
  const attempt = {
    passageId: state.passage.id,
    score,
    total: questions.length,
    elapsedSec: sec,
    answers: state.answers,
    finishedAt: new Date().toISOString(),
  };
  // 保存を待ってから結果を描画する。待たないと、直後に復習へ進んだとき
  // Store.latest() がまだ古く「まだ解いていません」と表示されうる。
  let saveError = null;
  try {
    await Store.saveAttempt(attempt);
  } catch (err) {
    saveError = err;
  }
  qs("#header-status").textContent = saveError
    ? `⚠ 保存に失敗しました: ${saveError.message}`
    : `⏱ ${formatElapsed(sec)} で終了`;
  qs("#right-pane").innerHTML = `
    <div class="result-card">
      <p class="score">${score} / ${questions.length} 正解</p>
      <p class="hint">所要時間 ${formatElapsed(sec)}${
        wrong.length ? ` ｜ 誤答: ${wrong.join(", ")}` : " ｜ 🎉 全問正解"}</p>
      <button id="to-study" class="primary">📖 解説モードで復習する</button>
    </div>`;
  qs("#to-study").addEventListener("click", () => startStudyMode());
}

/* ---------- 解説モード ---------- */

function startStudyMode() {
  stopTimer();
  qs("#header-status").innerHTML =
    `<a href="#" id="resolve-link">✏️ もう一度解く</a>`;
  qs("#resolve-link").addEventListener("click", (e) => {
    e.preventDefault();
    startSolveMode();
  });
  const solveUrl = `${window.READER_URL}?id=${state.passage.id}&mode=solve`;
  renderStudy(buildStudySource(state.passage, Store.latest(state.passage.id), solveUrl));
}

document.addEventListener("DOMContentLoaded", init);
