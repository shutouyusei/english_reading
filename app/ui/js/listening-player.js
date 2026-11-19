"use strict";

const playerState = {
  item: null,
  current: 0,
  answers: [],
  startedAt: null,
  audioUrl: null,
  retriedAudio: false,   // a broken cache is rebuilt only once
  playbackDone: false,   // after ended, neutralizes the audio element's error listener
};

function qs(sel) {
  return document.querySelector(sel);
}

function renderError(message) {
  qs("#reader-main").innerHTML =
    `<p class="error">${escapeHtml(message)} <a href="listening.html">Back to the list</a></p>`;
}

/** Show audio-related failures on screen. Never ignore them silently; always leave a
    way into study mode. It leads to the same place as the header's quit link
    (#quit-link), so the wording follows that link. */
function renderAudioFailure(message) {
  qs("#passage-pane").innerHTML = `
    <p class="error">${escapeHtml(message)}</p>
    <p><a href="#" id="to-study-on-error">Review with the script</a></p>`;
  qs("#to-study-on-error").addEventListener("click", (e) => {
    e.preventDefault();
    startStudyMode();
  });
}

function formatElapsed(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Shape the script into the form passed to Speech.prepare(). The voice changes per
    speaker. Consecutive lines by the same speaker are folded into one utterance.
    This cuts the number of synthesis calls and the joining work, and keeps unneeded
    silence out from between lines (about 0.2 s per line, measured with macOS say).
    In a conversation where the speakers alternate, adjacent lines have different
    speakers, so they are not folded and stay as they are. */
function utterancesOf(item) {
  const voices = new Map(item.speakers.map((s) => [s.id, s.voice]));
  const utterances = [];
  for (const line of item.script) {
    const voice = voices.get(line.speaker) || "";
    const last = utterances[utterances.length - 1];
    if (last && last.speaker === line.speaker) {
      last.text = `${last.text}\n\n${line.text}`;
    } else {
      utterances.push({ speaker: line.speaker, voice, text: line.text });
    }
  }
  return utterances.map(({ voice, text }) => ({ voice, text }));
}

async function init() {
  try {
    await ListeningStore.init();
  } catch (err) {
    console.warn("Could not load study records:", err);
  }
  const params = new URLSearchParams(location.search);
  const id = params.get("id") || "";
  const mode = params.get("mode") === "study" ? "study" : "solve";
  if (!/^listening_\d+$/.test(id)) {
    renderError("No question was specified.");
    return;
  }
  try {
    const res = await fetch(`${window.DATA_BASE || ""}data/listening/${id}.json`,
                            { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    playerState.item = await res.json();
  } catch (err) {
    renderError(`Could not load the question (${err.message}).`);
    return;
  }
  document.title = `${playerState.item.title} — TOEFL Study`;
  qs("#header-title").textContent = playerState.item.title;
  if (mode === "study") startStudyMode(); else startSolveMode();
}

/* ---------- Solve mode ---------- */

/** Stop playback in study mode. The reason mirrors stopSolvePlayback():
    startSolveMode() rebuilds #passage-pane wholesale, but if the
    <audio id="review-player"> inserted by renderReviewPlayer() is left alone, the
    detached element can keep playing while a closure holds it (the same general
    rule as in the stopSolvePlayback() comment below). A solve session is in
    principle a one-time session, so hearing that audio on top of it is especially
    bad. Does nothing on paths with no #review-player (audio preparation failed or
    is still in progress). */
function stopReviewPlayback() {
  const audio = qs("#review-player");
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
}

async function startSolveMode() {
  stopReviewPlayback();
  const item = playerState.item;
  playerState.current = 0;
  playerState.answers = item.questions.map(() => null);
  // Do not carry over the previous session's playback state. When coming back
  // through study mode (the "solve again" link), a playbackDone left set would
  // make the error listener in renderPlayer() swallow even real errors from the
  // new session. retriedAudio must be reset too, or the next session gets no
  // chance to rebuild the cache.
  playerState.playbackDone = false;
  playerState.retriedAudio = false;
  qs("#passage-pane").innerHTML =
    `<p class="hint">Preparing audio…</p>`;
  qs("#right-pane").innerHTML = "";
  // #q-status is the place where renderQuestion rewrites only textContent.
  // Overwriting everything with innerHTML would wipe out quit-link too, so an
  // empty container is put inside.
  qs("#header-status").innerHTML =
    `<span id="q-status"></span> <a href="#" id="quit-link">Quit and go to study mode</a>`;
  qs("#quit-link").addEventListener("click", (e) => {
    e.preventDefault();
    startStudyMode();
  });

  try {
    const { url } = await Speech.prepare(item.id, utterancesOf(item));
    playerState.audioUrl = url;
  } catch (err) {
    // Do not silently ignore that the audio could not be prepared. Study mode is still reachable.
    renderAudioFailure(`Could not prepare the audio: ${err.message}`);
    return;
  }
  renderPlayer();
}

function renderPlayer() {
  // As in the real test, the audio plays only once. Pausing is possible, rewinding is not.
  qs("#passage-pane").innerHTML = `
    <div class="audio-stage">
      <p class="hint">The audio plays only once. Take notes as you listen.</p>
      <audio id="player" src="${playerState.audioUrl}"></audio>
      <div class="btn-row">
        <button id="play-btn" class="primary">▶ Play</button>
        <span id="play-state" class="hint"></span>
      </div>
    </div>`;
  const audio = qs("#player");
  const button = qs("#play-btn");
  const state = qs("#play-state");

  button.addEventListener("click", () => {
    if (audio.paused) {
      // play() can reject, e.g. with NotAllowedError. If it is not caught, pressing
      // the button fails silently with nothing happening.
      audio.play().catch((err) => {
        renderAudioFailure(`Could not play the audio: ${err.message}`);
      });
    } else {
      audio.pause();
    }
  });
  audio.addEventListener("play", () => {
    button.textContent = "⏸ Pause";
    state.textContent = "Playing";
  });
  audio.addEventListener("pause", () => {
    if (audio.ended) return;
    button.textContent = "▶ Resume";
    state.textContent = "Paused";
  });
  audio.addEventListener("ended", () => {
    // Nothing may touch this audio element from here on. The error listener stays
    // attached, so if an error fires after moving on to the question or result
    // screen and renderPlayer() is called again, the UI can end up in a doubled
    // state (e.g. the player showing on top of the result).
    playerState.playbackDone = true;
    button.disabled = true;
    button.textContent = "Playback finished";
    state.textContent = "Go on to the questions";
    playerState.startedAt = Date.now();
    audio.removeAttribute("src");
    renderQuestion();
  });
  // The cache is sometimes broken. Rebuild it once, then give up.
  audio.addEventListener("error", async () => {
    // If the audio captured by this closure is not the #player that is live on
    // screen right now, the notification comes from an old, detached element that
    // a renderPlayer() re-render already replaced, so ignore it. This prevents an
    // error that arrives late on the old element, after a successful retry made
    // renderPlayer() create a new #player, from wiping the freshly rendered player
    // through renderAudioFailure(). The check is on element identity, so it tests
    // exactly "is this the current #player" without going through a flag.
    if (audio !== qs("#player")) return;
    // From here on the notification comes from the same element (still #player).
    // When playback has already ended (we moved on to the question or result
    // screen), the error triggered by the ended listener's own
    // audio.removeAttribute("src") should be ignored. ended does not replace the
    // element, so the identity check cannot filter it out and the playbackDone
    // flag is needed.
    if (playerState.playbackDone) return;
    if (playerState.retriedAudio) {
      renderAudioFailure("Could not play the audio.");
      return;
    }
    playerState.retriedAudio = true;
    try {
      const { url } = await Speech.prepare(
        playerState.item.id, utterancesOf(playerState.item), { force: true });
      playerState.audioUrl = url;
      renderPlayer();
    } catch (err) {
      renderAudioFailure(`Could not rebuild the audio: ${err.message}`);
    }
  });
}

function renderQuestion() {
  const idx = playerState.current;
  const questions = playerState.item.questions;
  const question = questions[idx];
  const isLast = idx === questions.length - 1;
  // Rewriting with innerHTML would remove the quit-link that startSolveMode put in,
  // so only the inner span is rewritten (same shape as #q-pos in docs/js/reader.js).
  const statusEl = qs("#q-status");
  if (statusEl) statusEl.textContent = `Question ${idx + 1} of ${questions.length}`;
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
          ${isLast ? "Grade" : "Next →"}</button>
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
  // Wait for the save before rendering. Otherwise a review right after shows the old result.
  let saveError = null;
  try {
    await ListeningStore.saveAttempt(attempt);
  } catch (err) {
    saveError = err;
  }
  qs("#header-status").textContent = saveError
    ? `⚠ Could not save: ${saveError.message}`
    : `⏱ Finished in ${formatElapsed(elapsedSec)}`;
  qs("#right-pane").innerHTML = `
    <div class="result-card">
      <p class="score">${score} / ${questions.length} correct</p>
      <p class="hint">Time ${formatElapsed(elapsedSec)}${
        wrong.length ? ` | Wrong: ${wrong.join(", ")}` : " | 🎉 All correct"}</p>
      <button id="to-study" class="primary">📖 Review in study mode</button>
    </div>`;
  qs("#to-study").addEventListener("click", () => startStudyMode());
}

/* ---------- Study mode ---------- */

/** Stop playback in solve mode. #quit-link can be pressed throughout the solve
    flow, including during playback, but even though renderStudy() rebuilds
    #passage-pane wholesale, the detached <audio id="player"> (like any <audio>
    under #passage-pane) can keep playing while a closure holds it. #player also
    has ended/error listeners attached, so those survive as well. If nothing is
    done, when the detached element ends naturally the ended listener calls
    renderQuestion() and overwrites #right-pane with a stale question card, or an
    error fires and renderAudioFailure() wipes #passage-pane together with the
    script being reviewed.
    Does nothing on paths with no #player (e.g. entering directly from the study
    link in the list).
    Setting playbackDone on that path would leave it set until the next
    startSolveMode() even though no solve session was ever touched, and the error
    listener in renderPlayer() would swallow even real playback errors
    (startSolveMode() resets it every time, so this does not normally happen, but
    the principle of not touching the flag on unrelated screen transitions is
    put first).
    When #player exists, audio.removeAttribute("src") itself can fire an error
    event, so the flag is set before that handler runs to neutralize it
    (same idea as the ended handler in renderPlayer()). */
function stopSolvePlayback() {
  const audio = qs("#player");
  if (!audio) return;
  playerState.playbackDone = true;
  audio.pause();
  audio.removeAttribute("src");
}

/** Build the study source from the script. Listening items carry no vocab notes,
    so vocab is empty. */
function buildListeningSource(item) {
  const roles = new Map(item.speakers.map((s) => [s.id, s.role]));
  return {
    id: item.id,
    title: item.title,
    lines: item.script.map((line) => ({
      speaker: roles.get(line.speaker) || line.speaker,
      text: line.text,
    })),
    vocab: {},
    questions: item.questions,
    latestResult: ListeningStore.latest(item.id),
    solveUrl: `listening-player.html?id=${encodeURIComponent(item.id)}&mode=solve`,
  };
}

async function startStudyMode() {
  stopSolvePlayback();
  const item = playerState.item;
  qs("#header-status").innerHTML =
    `<a href="#" id="resolve-link">🎧 Solve again</a>`;
  qs("#resolve-link").addEventListener("click", (e) => {
    e.preventDefault();
    startSolveMode();
  });

  renderStudy(buildListeningSource(item));
  await renderReviewPlayer(item);
}

/** In review the audio can be replayed freely. The default controls are shown as they are. */
async function renderReviewPlayer(item) {
  const pane = qs("#passage-pane");
  const bar = document.createElement("div");
  bar.className = "review-audio";
  bar.innerHTML = `<p class="hint">Preparing audio…</p>`;
  pane.insertBefore(bar, pane.firstChild);

  try {
    const { url } = await Speech.prepare(item.id, utterancesOf(item));
    bar.innerHTML = `<audio id="review-player" controls src="${url}"></audio>`;
  } catch (err) {
    // The script is already shown. Say that only the audio is unavailable, so the
    // review can continue.
    bar.innerHTML =
      `<p class="error">Could not prepare the audio: ${escapeHtml(err.message)}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
