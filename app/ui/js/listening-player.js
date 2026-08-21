"use strict";

const playerState = {
  item: null,
  current: 0,
  answers: [],
  startedAt: null,
  audioUrl: null,
  retriedAudio: false,   // 壊れたキャッシュの作り直しは1回だけ
  playbackDone: false,   // ended 後は audio 要素の error リスナを無害化する
};

function qs(sel) {
  return document.querySelector(sel);
}

function renderError(message) {
  qs("#reader-main").innerHTML =
    `<p class="error">${escapeHtml(message)} <a href="listening.html">一覧に戻る</a></p>`;
}

/** 音声関連の失敗を画面に出す。黙って無視せず、常に解説モードへの導線を残す。
    ヘッダの「中断して解説モードへ」と同じ行き先なので、文言もそちらへ揃える。 */
function renderAudioFailure(message) {
  qs("#passage-pane").innerHTML = `
    <p class="error">${escapeHtml(message)}</p>
    <p><a href="#" id="to-study-on-error">台本を見て復習する</a></p>`;
  qs("#to-study-on-error").addEventListener("click", (e) => {
    e.preventDefault();
    startStudyMode();
  });
}

function formatElapsed(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** 台本を say に渡せる形にする。話者ごとに声が変わる。
    連続する同じ話者の行は1つの発話に畳む。say の呼び出し回数と結合処理を
    減らせるうえ、行と行の間に不要な無音(実測で1行あたり約0.2秒)が
    入らなくなる。話者が交互に変わる会話では、隣り合う行の話者が異なる
    ため畳まれずそのまま残る。 */
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

/** 解説モード中の再生を止める。stopSolvePlayback() と対称の理由:
    startSolveMode() は #passage-pane を丸ごと作り直すが、renderReviewPlayer()
    が挿入した <audio id="review-player"> を放置すると、外れた要素は
    クロージャに掴まれたまま鳴り続けうる(下の stopSolvePlayback() のコメント
    にある一般則と同じ)。解答は原則1回きりのセッションなので、その音が
    かぶって聞こえるのは特に困る。#review-player が無い経路(音声の準備が
    失敗した、またはまだ準備中)では何もしない。 */
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
  // 前のセッションの再生状態を引き継がない。解説モードを経由して
  // 戻ってきた場合(「もう一度解く」)は、playbackDone が立ったままだと
  // 新しいセッションの本物の error まで renderPlayer() の error リスナに
  // 握りつぶされる。retriedAudio も戻さないと、次のセッションで
  // キャッシュ作り直しの機会が無くなる。
  playerState.playbackDone = false;
  playerState.retriedAudio = false;
  qs("#passage-pane").innerHTML =
    `<p class="hint">音声を準備しています…</p>`;
  qs("#right-pane").innerHTML = "";
  // #q-status は renderQuestion が textContent だけを書き換える場所。
  // innerHTML で丸ごと上書きすると quit-link ごと消えてしまうため、
  // 中に空の入れ物を用意しておく。
  qs("#header-status").innerHTML =
    `<span id="q-status"></span> <a href="#" id="quit-link">中断して解説モードへ</a>`;
  qs("#quit-link").addEventListener("click", (e) => {
    e.preventDefault();
    startStudyMode();
  });

  try {
    const { url } = await Speech.prepare(item.id, utterancesOf(item));
    playerState.audioUrl = url;
  } catch (err) {
    // 音声が用意できないことを黙って無視しない。解説モードへは進める。
    renderAudioFailure(`音声を準備できませんでした: ${err.message}`);
    return;
  }
  renderPlayer();
}

function renderPlayer() {
  // 本番と同じく再生は1回だけ。一時停止はできるが、巻き戻しはできない。
  qs("#passage-pane").innerHTML = `
    <div class="audio-stage">
      <p class="hint">音声は一度だけ再生されます。メモを取りながら聴いてください。</p>
      <audio id="player" src="${playerState.audioUrl}"></audio>
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
      // play() は NotAllowedError などで reject しうる。拾わないと、
      // ボタンを押しても何も起きないまま黙って失敗する経路になる。
      audio.play().catch((err) => {
        renderAudioFailure(`音声を再生できませんでした: ${err.message}`);
      });
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
    // 以後この audio 要素をいじらせない。error リスナは残り続けるため、
    // 設問・結果画面に進んだ後に error が起きて renderPlayer() が
    // 呼び直されると、二重状態(結果の上に再生画面が出る等)になりうる。
    playerState.playbackDone = true;
    button.disabled = true;
    button.textContent = "再生終了";
    state.textContent = "設問に進んでください";
    playerState.startedAt = Date.now();
    audio.removeAttribute("src");
    renderQuestion();
  });
  // キャッシュが壊れていることがある。1度だけ作り直してから諦める。
  audio.addEventListener("error", async () => {
    // 再生が既に終わっている(設問・結果画面に進んでいる)なら、
    // この要素はもう使わない。ここで renderPlayer() を呼び直すと
    // #passage-pane が再生可能な音声要素で上書きされてしまう。
    if (playerState.playbackDone) return;
    if (playerState.retriedAudio) {
      renderAudioFailure("音声を再生できませんでした。");
      return;
    }
    playerState.retriedAudio = true;
    try {
      const { url } = await Speech.prepare(
        playerState.item.id, utterancesOf(playerState.item), { force: true });
      playerState.audioUrl = url;
      // renderPlayer() はこの (古い) audio 要素を #passage-pane ごと差し替える。
      // 差し替え後にこの要素へ遅れて届く error は、新しく描画したばかりの
      // プレイヤーを renderAudioFailure() で消してしまいうる。ended リスナ
      // (:176)・stopSolvePlayback() (:313) と同じ考え方で、差し替え前に
      // playbackDone を立てて古い要素の error リスナを無害化しておく。
      playerState.playbackDone = true;
      renderPlayer();
    } catch (err) {
      renderAudioFailure(`音声を作り直せませんでした: ${err.message}`);
    }
  });
}

function renderQuestion() {
  const idx = playerState.current;
  const questions = playerState.item.questions;
  const question = questions[idx];
  const isLast = idx === questions.length - 1;
  // innerHTML で書き換えると startSolveMode が入れた quit-link を消してしまうため、
  // 中の span だけを書き換える(docs/js/reader.js の #q-pos と同じ形)。
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
    : `⏱ ${formatElapsed(elapsedSec)} で終了`;
  qs("#right-pane").innerHTML = `
    <div class="result-card">
      <p class="score">${score} / ${questions.length} 正解</p>
      <p class="hint">所要時間 ${formatElapsed(elapsedSec)}${
        wrong.length ? ` ｜ 誤答: ${wrong.join(", ")}` : " ｜ 🎉 全問正解"}</p>
      <button id="to-study" class="primary">📖 解説モードで復習する</button>
    </div>`;
  qs("#to-study").addEventListener("click", () => startStudyMode());
}

/* ---------- 解説モード ---------- */

/** 解答モード中の再生を止める。#quit-link は再生中も含めて解答フロー全体で
    押せるが、renderStudy() が #passage-pane を丸ごと作り直しても、外れた
    <audio id="player"> は(#passage-pane 配下の <audio> 全般と同様)
    クロージャに掴まれたまま鳴り続けうる。#player はさらに ended/error の
    リスナが付いているため、それらも生き残る。何もしないと、外れた要素が自然終了したときに
    ended リスナが renderQuestion() を呼んで #right-pane を古い設問カードで
    上書きしたり、error が起きて renderAudioFailure() が復習中の台本ごと
    #passage-pane を消したりする。
    #player が無い経路(一覧の「解説」から直接入るなど)では何もしない。
    ここで playbackDone を立ててしまうと、解答セッションに一度も触れて
    いないのに次の startSolveMode() まで立ったままになり、本物の再生
    エラーまで renderPlayer() の error リスナに握りつぶされる
    (startSolveMode() 側で毎回リセットしているので通常は起きないが、
    無関係な画面遷移でフラグを触らないという原則を先に置いておく)。
    #player がある場合は、audio.removeAttribute("src") 自体が error
    イベントを起こしうるため、そのハンドラより先に立てて無害化しておく
    (renderPlayer() の ended ハンドラと同じ考え方)。 */
function stopSolvePlayback() {
  const audio = qs("#player");
  if (!audio) return;
  playerState.playbackDone = true;
  audio.pause();
  audio.removeAttribute("src");
}

/** 台本から学習ソースを作る。語彙辞書は空なので、全語が辞書引きの経路に入る。 */
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
    `<a href="#" id="resolve-link">🎧 もう一度解く</a>`;
  qs("#resolve-link").addEventListener("click", (e) => {
    e.preventDefault();
    startSolveMode();
  });

  renderStudy(buildListeningSource(item));
  await renderReviewPlayer(item);
}

/** 復習では自由に聴き直せる。既定のコントロールをそのまま出す。 */
async function renderReviewPlayer(item) {
  const pane = qs("#passage-pane");
  const bar = document.createElement("div");
  bar.className = "review-audio";
  bar.innerHTML = `<p class="hint">音声を準備しています…</p>`;
  pane.insertBefore(bar, pane.firstChild);

  try {
    const { url } = await Speech.prepare(item.id, utterancesOf(item));
    bar.innerHTML = `<audio id="review-player" controls src="${url}"></audio>`;
  } catch (err) {
    // 台本は既に出ている。音声だけが使えないことを伝えて、復習は続けられるようにする。
    bar.innerHTML =
      `<p class="error">音声を準備できませんでした: ${escapeHtml(err.message)}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
