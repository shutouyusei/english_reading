"use strict";

const studyState = { selectedWord: null, history: [], activeTab: "vocab" };

/* 学習ソース: 読解のパッセージとリスニングの台本の共通の形。
   { id, title, lines: [{speaker, text}], vocab, questions, latestResult, solveUrl }
   この層より下は「どちらの教材か」を知らない。 */

/** 読解のパッセージから学習ソースを作る。 */
function buildStudySource(passage, latestResult, solveUrl) {
  const lines = passage.body
    .split("\n\n")
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({ speaker: null, text }));
  return {
    id: passage.id,
    title: passage.title,
    lines,
    vocab: passage.vocab,
    questions: passage.questions,
    latestResult,
    solveUrl,
  };
}

function renderStudy(source) {
  renderClickableLines(source);
  renderPanel(source);
}

function renderClickableLines(source) {
  const keys = new Set(Object.keys(source.vocab).map((w) => w.toLowerCase()));
  const pane = qs("#passage-pane");
  pane.innerHTML = "";
  for (const line of source.lines) {
    const p = document.createElement("p");
    if (line.speaker) {
      const label = document.createElement("b");
      label.className = "speaker";
      label.textContent = `${line.speaker}: `;
      p.appendChild(label);
    }
    for (const part of tokenize(line.text)) {
      if (!part.isWord) {
        p.appendChild(document.createTextNode(part.text));
        continue;
      }
      const span = document.createElement("span");
      const key = findVocabKey(part.text, keys);
      span.textContent = part.text;
      span.className = key ? "w vocab-word" : "w";
      span.addEventListener("click", () => onWordClick(source, part.text, key, span));
      p.appendChild(span);
    }
    pane.appendChild(p);
  }
}

function onWordClick(source, surface, key, span) {
  document.querySelectorAll(".w.active").forEach((el) => el.classList.remove("active"));
  span.classList.add("active");
  studyState.selectedWord = key || surface.toLowerCase();
  studyState.activeTab = "vocab";
  if (!studyState.history.includes(studyState.selectedWord)) {
    studyState.history.unshift(studyState.selectedWord);
  }
  renderPanel(source);
  qs("#right-pane").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderPanel(source) {
  const result = source.latestResult;
  const quizLabel = result ? `問題の解説 (${result.score}/${result.total})` : "問題の解説";
  qs("#right-pane").innerHTML = `
    <div class="tabs">
      <button class="tab${studyState.activeTab === "vocab" ? " on" : ""}" data-tab="vocab">単語解説</button>
      <button class="tab${studyState.activeTab === "quiz" ? " on" : ""}" data-tab="quiz">${quizLabel}</button>
    </div>
    <div id="panel-body"></div>`;
  document.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      studyState.activeTab = btn.dataset.tab;
      renderPanel(source);
    }));
  if (studyState.activeTab === "vocab") {
    renderVocabTab(source);
  } else {
    renderQuizTab(source, result);
  }
}

function renderVocabTab(source) {
  const body = qs("#panel-body");
  const word = studyState.selectedWord;
  if (!word) {
    body.innerHTML =
      `<p class="hint">本文中の単語をクリックすると、ここに解説が表示されます。</p>`;
    return;
  }
  const entry = source.vocab[word];
  const weblio = `https://ejje.weblio.jp/content/${encodeURIComponent(word)}`;
  if (!entry) {
    body.innerHTML = `
      <h3 class="word">${escapeHtml(word)}</h3>
      <div id="dict-body"><p class="hint">辞書を調べています…</p></div>
      <p><a href="${weblio}" target="_blank" rel="noopener">Weblioで調べる ↗</a></p>
      ${historyHtml()}`;
    // 収録語でなければ辞書が最後の頼み。引けなければ従来どおりの案内に戻す。
    fillDictionary(word, `<p>未収録の単語です。</p>`);
    return;
  }
  body.innerHTML = `
    <h3 class="word">${escapeHtml(word)}</h3>
    <div class="label">語源</div><p>${escapeHtml(entry.etymology)}</p>
    <div class="label">定義</div><p>${escapeHtml(entry.definition)}</p>
    <div class="label">この文章での役割</div><p>${escapeHtml(entry.usage_in_passage)}</p>
    <div class="label">関連語</div><p>${entry.related_terms.map(escapeHtml).join(" ・ ")}</p>
    <div id="dict-body"></div>
    <div class="btn-row">
      <button id="anki-add" class="anki">＋ Ankiに追加</button>
      <a class="button" href="${weblio}" target="_blank" rel="noopener">Weblio ↗</a>
      <button id="anki-settings-open" title="Anki設定">⚙</button>
    </div>
    <p id="anki-status" class="hint"></p>
    ${historyHtml()}`;
  qs("#anki-add").addEventListener("click", () => addToAnki(source, word, entry));
  qs("#anki-settings-open").addEventListener("click", () => openAnkiSettings());
  // 収録語には既に解説がある。辞書は引けたときだけ足す。
  fillDictionary(word, "");
}

/* ---------- システム辞書(アプリ版のみ) ---------- */

/// 辞書引きは Swift 側への往復があるため、枠だけ先に出して後から埋める。
/// 引けなかったときは emptyHtml に差し替える。
async function fillDictionary(word, emptyHtml) {
  let result = null;
  try {
    result = await Dict.define(word);
  } catch (err) {
    // 辞書層そのものが読み込めていない場合もここに来る。
    // 黙って諦めないと「調べています…」の表示が残り続ける。
    console.warn("辞書を引けませんでした:", err);
  }
  // 待っている間に別の語へ移っていたら、古い結果を書き込まない
  if (studyState.selectedWord !== word || studyState.activeTab !== "vocab") return;
  const target = qs("#dict-body");
  if (!target) return;
  target.innerHTML = result ? dictionaryHtml(result) : emptyHtml;
}

function dictionaryHtml(result) {
  const source = result.source ? `（${escapeHtml(result.source)}）` : "";
  return `<div class="label">辞書${source}</div>` +
    `<div class="dict-entry">${dictionaryBodyHtml(result.definition)}</div>`;
}

/// 辞書が返すのは改行を1つも含まない一続きのテキスト。dictformat.js が
/// 見出し・品詞・語義・例文に切り分けたものを、ここで表示に組み直す。
/// 整形層が読み込まれていなければ、そのまま1塊で出す(辞書は補助なので止めない)。
function dictionaryBodyHtml(definition) {
  const format = window.DictFormat && window.DictFormat.formatDefinition;
  const blocks = format ? format(definition) : [{ kind: "text", text: definition }];
  return Array.from(blocks).map(dictionaryBlockHtml).join("");
}

function dictionaryBlockHtml(block) {
  if (block.kind === "head") {
    const pron = block.pron
      ? ` <span class="dict-pron">/${escapeHtml(block.pron)}/</span>` : "";
    return `<p class="dict-word">${escapeHtml(block.word)}${pron}</p>`;
  }
  if (block.kind === "pos") {
    return `<p class="dict-pos">${escapeHtml(block.text)}</p>`;
  }
  if (block.kind === "sense") {
    const sub = block.level === 2 ? " sub" : "";
    return `<p class="dict-sense${sub}">` +
      `<span class="dict-num">${escapeHtml(block.label)}</span>` +
      `<span>${escapeHtml(block.text)}</span></p>`;
  }
  if (block.kind === "example") {
    const sub = block.level === 2 ? " sub" : "";
    return `<p class="dict-ex${sub}">${escapeHtml(block.text)}</p>`;
  }
  return `<p class="dict-note">${escapeHtml(block.text)}</p>`;
}

function historyHtml() {
  if (!studyState.history.length) return "";
  const words = studyState.history.slice(0, 8).map(escapeHtml).join(" ・ ");
  return `<p class="hint">最近調べた語: ${words}</p>`;
}

function renderQuizTab(source, result) {
  const body = qs("#panel-body");
  if (!result) {
    body.innerHTML = `<p class="hint">まだ解いていません。` +
      `<a href="${source.solveUrl}">問題を解く</a></p>`;
    return;
  }
  body.innerHTML = source.questions.map((q, i) => {
    const user = result.answers ? result.answers[i] : null;
    const ok = user === q.correct;
    return `
      <div class="quiz-review${ok ? " ok" : " ng"}">
        <p><b>Q${q.id}.</b> ${escapeHtml(q.question)}</p>
        <p>${ok ? "✅" : "❌"} あなたの回答: ${user || "—"} ／ ` +
        `正解: ${q.correct}. ${escapeHtml(q.choices[q.correct])}</p>
        <p class="explanation">${escapeHtml(q.explanation)}</p>
      </div>`;
  }).join("");
}
