"use strict";

/* 執筆 → 採点中 → 結果 を1画面で切り替える。
   「採点する」を押したらまずエッセイを保存し、それから採点を始める。
   この順序により、採点中に落ちても書いた文章は残る。 */

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
    console.warn("学習記録を読み込めませんでした:", err);
  }

  try {
    const res = await fetch(
      `${window.DATA_BASE || ""}data/writing/${encodeURIComponent(promptId)}.json`,
      { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.prompt = await res.json();
  } catch (err) {
    promptPane.innerHTML =
      `<p class="error">問題を読み込めませんでした(${esc(err.message)})。</p>`;
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
      return `<p class="error">問題データが壊れています(discussion フィールドが不正です)。</p>`;
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
    <p class="meta">宛先: ${esc(prompt.recipient)}</p>
    <p class="meta">押さえる点:</p>
    <ul>${prompt.must_include.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}

// --- 執筆 ---

function showWriting(initialText = "") {
  document.querySelector("#header-status").textContent = "";
  document.querySelector("#right-pane").innerHTML = `
    <div class="pane-header">
      <span id="timer">0分0秒</span>
      <span class="meta">目安 ${state.prompt.target_minutes} 分</span>
    </div>
    <textarea id="essay-input" placeholder="ここに英語で書きます">${esc(initialText)}</textarea>
    <p class="meta"><span id="word-count">0</span> words</p>
    <button id="submit-button" class="button primary" disabled>採点する</button>`;

  const input = document.querySelector("#essay-input");
  const button = document.querySelector("#submit-button");
  const syncCounter = () => {
    const words = countWords(input.value);
    document.querySelector("#word-count").textContent = words;
    // 空文字を Claude に投げても意味のある採点は返らない。枠を無駄にしない。
    button.disabled = words === 0;
  };
  input.addEventListener("input", syncCounter);
  syncCounter(); // 下書き復元(書き直す)で埋まっているテキストにも反映する
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
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}

// --- 送信と採点 ---

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
    showError(essay, `保存できませんでした: ${err.message}`);
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
    showError(essay, `採点結果を保存できませんでした: ${err.message}`);
    return;
  }
  showResult(essay, row);
}

function showGrading() {
  document.querySelector("#header-status").textContent = "";
  const startedAt = Date.now();
  document.querySelector("#right-pane").innerHTML = `
    <div class="grading">
      <p>採点しています…</p>
      <p class="meta">通常15〜20秒かかります。<span id="grading-elapsed">0</span> 秒経過</p>
      <p class="hint">この画面を閉じても、書いた文章は保存済みです。<br>
        一覧から「採点待ち」として再開できます。</p>
      <div class="card-actions">
        <a class="button" href="writing.html">一覧へ</a>
      </div>
    </div>`;
  const tick = setInterval(() => {
    const label = document.querySelector("#grading-elapsed");
    if (!label) { clearInterval(tick); return; }
    label.textContent = Math.floor((Date.now() - startedAt) / 1000);
  }, 1000);
}

// --- 結果 ---

// 採点結果はグレーディングAIが返すJSONそのままで、どこでも型保証されていない
// (essays.jsonlに逐語保存され、起動のたびに読み直される)。
// innerHTMLに差し込む前に、必ずエスケープする。
// overallは0〜5の有限数でなければ "?" 表示に倒す
// (app/ui/js/writing-list.js の badgeHtml と同じ考え方)。
// criteria/correctionsは配列である保証もないため、配列でなければ空配列扱いにする。
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
    `${overall === null ? "?" : overall}/5 ・ ${formatMinSec(essay.elapsedSec)}`;
  document.querySelector("#right-pane").innerHTML = `
    <div class="pane-header"><h3>総合 ${overallLabel} / 5</h3></div>
    ${criteria.map((c) => `
      <div class="criterion">
        <p class="criterion-name">${esc(c && c.name)} <strong>${esc(c && c.score)}/5</strong></p>
        <p>${esc(c && c.comment)}</p>
      </div>`).join("")}
    <h3>添削</h3>
    ${corrections.length
      ? corrections.map((c) => `
        <div class="correction">
          <p class="original">${esc(c && c.original)}</p>
          <p class="revised">→ ${esc(c && c.revised)}</p>
          <p class="meta">${esc(c && c.reason)}</p>
        </div>`).join("")
      : `<p class="hint">直すべき箇所は見つかりませんでした。</p>`}
    <h3>講評</h3>
    <p>${esc(grade.summary || "")}</p>
    <div class="card-actions">
      <button id="rewrite-button" class="button primary">もう一度書く</button>
      <a class="button" href="writing.html">一覧へ</a>
    </div>`;
  document.querySelector("#rewrite-button")
    .addEventListener("click", () => { state.elapsedSec = 0; showWriting(); });
}

function showUngraded(essay) {
  document.querySelector("#right-pane").innerHTML = `
    <div class="pane-header"><h3>採点待ち</h3></div>
    <p class="meta">${formatMinSec(essay.elapsedSec)} で執筆 ・ ${countWords(essay.text)} words</p>
    <pre class="essay-text">${esc(essay.text)}</pre>
    <div class="card-actions">
      <button id="grade-button" class="button primary">採点する</button>
      <button id="rewrite-button" class="button">書き直す</button>
    </div>`;
  document.querySelector("#grade-button")
    .addEventListener("click", () => runGrading(essay));
  document.querySelector("#rewrite-button")
    .addEventListener("click", () => { state.elapsedSec = 0; showWriting(essay.text); });
}

function showError(essay, message) {
  document.querySelector("#header-status").textContent = "";
  document.querySelector("#right-pane").innerHTML = `
    <div class="pane-header"><h3>採点できませんでした</h3></div>
    <p class="error">${esc(message)}</p>
    <p class="hint">書いた文章は保存されています。</p>
    <pre class="essay-text">${esc(essay.text)}</pre>
    <div class="card-actions">
      <button id="retry-button" class="button primary">再採点</button>
      <a class="button" href="writing.html">一覧へ</a>
    </div>`;
  document.querySelector("#retry-button")
    .addEventListener("click", () => runGrading(essay));
}

// HTML エスケープは docs/js/escape.js の escapeHtml を使う。
const esc = (text) => escapeHtml(text);

document.addEventListener("DOMContentLoaded", initEditor);
