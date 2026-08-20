"use strict";

const playerState = {
  item: null,
  current: 0,
  answers: [],
  startedAt: null,
  audioUrl: null,
  retriedAudio: false,   // 壊れたキャッシュの作り直しは1回だけ
};

function qs(sel) {
  return document.querySelector(sel);
}

function renderError(message) {
  qs("#reader-main").innerHTML =
    `<p class="error">${escapeHtml(message)} <a href="listening.html">一覧に戻る</a></p>`;
}

/** 台本を say に渡せる形にする。話者ごとに声が変わる。 */
function utterancesOf(item) {
  const voices = new Map(item.speakers.map((s) => [s.id, s.voice]));
  return item.script.map((line) => ({
    voice: voices.get(line.speaker) || "",
    text: line.text,
  }));
}

async function init() {
  try {
    await ListeningStore.init();
  } catch (err) {
    console.warn("学習記録を読み込めませんでした:", err);
  }
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || "";
  const mode = params.get("mode") === "study" ? "study" : "solve";
  if (!/^listening_\d+$/.test(id)) {
    renderError("問題が指定されていません。");
    return;
  }
  try {
    const res = await fetch(`${window.DATA_BASE || ""}data/listening/${id}.json`,
                            { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    playerState.item = await res.json();
  } catch (err) {
    renderError(`問題を読み込めませんでした(${err.message})。`);
    return;
  }
  document.title = `${playerState.item.title} — TOEFL Reading`;
  qs("#header-title").textContent = playerState.item.title;
  if (mode === "study") startStudyMode(); else startSolveMode();
}

/* ---------- 解答モード ---------- */

async function startSolveMode() {
  const item = playerState.item;
  playerState.current = 0;
  playerState.answers = item.questions.map(() => null);
  qs("#passage-pane").innerHTML =
    `<p class="hint">音声を準備しています…</p>`;
  qs("#right-pane").innerHTML = "";
  qs("#header-status").innerHTML =
    `<a href="#" id="quit-link">中断して解説モードへ</a>`;
  qs("#quit-link").addEventListener("click", (e) => {
    e.preventDefault();
    startStudyMode();
  });

  try {
    const { url } = await Speech.prepare(item.id, utterancesOf(item));
    playerState.audioUrl = url;
  } catch (err) {
    // 音声が用意できないことを黙って無視しない。解説モードへは進める。
    qs("#passage-pane").innerHTML = `
      <p class="error">音声を準備できませんでした: ${escapeHtml(err.message)}</p>
      <p><a href="#" id="to-study-on-error">台本を見て復習する</a></p>`;
    qs("#to-study-on-error").addEventListener("click", (e) => {
      e.preventDefault();
      startStudyMode();
    });
    return;
  }
  renderPlayer();
}

function renderPlayer() {
  // 本番と同じく再生は1回だけ。一時停止はできるが、巻き戻しはできない。
  qs("#passage-pane").innerHTML = `
    <div class="audio-stage">
      <p class="hint">音声は一度だけ再生されます。メモを取りながら聴いてください。</p>
      <audio id="player" src="${playerState.audioUrl}" controlslist="nodownload noplaybackrate"></audio>
      <div class="btn-row">
        <button id="play-btn" class="primary">▶ 再生する</button>
        <span id="play-state" class="hint"></span>
      </div>
    </div>`;
  const audio = qs("#player");
  const button = qs("#play-btn");
  const state = qs("#play-state");

  button.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });
  audio.addEventListener("play", () => {
    button.textContent = "⏸ 一時停止";
    state.textContent = "再生中";
  });
  audio.addEventListener("pause", () => {
    if (audio.ended) return;
    button.textContent = "▶ 続きから";
    state.textContent = "一時停止中";
  });
  audio.addEventListener("ended", () => {
    button.disabled = true;
    button.textContent = "再生終了";
    state.textContent = "設問に進んでください";
    playerState.startedAt = Date.now();
    renderQuestion();
  });
  // キャッシュが壊れていることがある。1度だけ作り直してから諦める。
  audio.addEventListener("error", async () => {
    if (playerState.retriedAudio) {
      qs("#passage-pane").innerHTML =
        `<p class="error">音声を再生できませんでした。一覧に戻ってやり直してください。</p>`;
      return;
    }
    playerState.retriedAudio = true;
    try {
      const { url } = await Speech.prepare(
        playerState.item.id, utterancesOf(playerState.item), { force: true });
      playerState.audioUrl = url;
      renderPlayer();
    } catch (err) {
      qs("#passage-pane").innerHTML =
        `<p class="error">音声を作り直せませんでした: ${escapeHtml(err.message)}</p>`;
    }
  });
}

function renderQuestion() {
  const idx = playerState.current;
  const questions = playerState.item.questions;
  const question = questions[idx];
  const isLast = idx === questions.length - 1;
  qs("#header-status").innerHTML =
    `Question ${idx + 1} of ${questions.length}`;
  const choices = ["A", "B", "C", "D"].map((letter) => {
    const selected = playerState.answers[idx] === letter ? " selected" : "";
    return `<button class="choice${selected}" data-letter="${letter}">` +
      `<b>${letter}.</b> ${escapeHtml(question.choices[letter])}</button>`;
  }).join("");
  qs("#right-pane").innerHTML = `
    <div class="question-card">
      <p><b>Q${question.id}.</b> ${escapeHtml(question.question)}</p>
      <div class="choices">${choices}</div>
      <div class="nav-row">
        <button id="back-btn" ${idx === 0 ? "disabled" : ""}>← Back</button>
        <button id="next-btn" class="primary" ${playerState.answers[idx] ? "" : "disabled"}>
          ${isLast ? "採点する" : "Next →"}</button>
      </div>
    </div>`;
  document.querySelectorAll(".choice").forEach((btn) =>
    btn.addEventListener("click", () => {
      playerState.answers[idx] = btn.dataset.letter;
      renderQuestion();
    }));
  qs("#back-btn").addEventListener("click", () => {
    playerState.current -= 1;
    renderQuestion();
  });
  qs("#next-btn").addEventListener("click", () => {
    if (isLast) {
      finishSolve();
    } else {
      playerState.current += 1;
      renderQuestion();
    }
  });
}

async function finishSolve() {
  const item = playerState.item;
  const questions = item.questions;
  const score = questions.filter((q, i) => playerState.answers[i] === q.correct).length;
  const elapsedSec = Math.floor((Date.now() - playerState.startedAt) / 1000);
  const wrong = questions
    .filter((q, i) => playerState.answers[i] !== q.correct)
    .map((q) => `Q${q.id} (${q.type})`);
  const attempt = {
    listeningId: item.id,
    score,
    total: questions.length,
    elapsedSec,
    answers: playerState.answers,
    finishedAt: new Date().toISOString(),
  };
  // 保存を待ってから描画する。待たないと直後の復習で古い結果が出る。
  let saveError = null;
  try {
    await ListeningStore.saveAttempt(attempt);
  } catch (err) {
    saveError = err;
  }
  qs("#header-status").textContent = saveError
    ? `⚠ 保存に失敗しました: ${saveError.message}`
    : "採点しました";
  qs("#right-pane").innerHTML = `
    <div class="result-card">
      <p class="score">${score} / ${questions.length} 正解</p>
      <p class="hint">${wrong.length ? `誤答: ${wrong.join(", ")}` : "🎉 全問正解"}</p>
      <button id="to-study" class="primary">📖 解説モードで復習する</button>
    </div>`;
  qs("#to-study").addEventListener("click", () => startStudyMode());
}

/* ---------- 解説モード(Task 11 で実装する) ---------- */

function startStudyMode() {
  qs("#header-status").textContent = "";
  qs("#passage-pane").innerHTML = `<p class="hint">解説モードは未実装です。</p>`;
  qs("#right-pane").innerHTML = "";
}

document.addEventListener("DOMContentLoaded", init);
