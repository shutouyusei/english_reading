"use strict";

const studyState = { selectedWord: null, history: [], activeTab: "vocab" };

/* Study source: the shape shared by reading passages and listening scripts.
   { id, title, lines: [{speaker, text}], vocab, questions, latestResult, solveUrl }
   Nothing below this layer knows which kind of material it is. */

/** Builds a study source from a reading passage. */
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
    // For a word without a vocab entry the dictionary is the last resort. If nothing is
    // found, fall back to the same notice as before.
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
  // A word with a vocab entry already has an explanation. Add the dictionary only when
  // the lookup returns something.
  fillDictionary(word, "");
}

/* ---------- Dictionary (app only) ---------- */

/// A dictionary lookup is a round trip to the native side (app-shell), so only the frame
/// is shown first and it is filled in later. When nothing is found it is replaced with
/// emptyHtml.
async function fillDictionary(word, emptyHtml) {
  let result = null;
  try {
    result = await Dict.define(word);
  } catch (err) {
    // This is also reached when the dictionary layer itself was not loaded.
    // Unless we give up quietly, the "looking up…" message would stay on screen.
    console.warn("辞書を引けませんでした:", err);
  }
  // If the user moved to another word while waiting, do not write the stale result
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

/// A dictionary definition is one continuous text with no line breaks. dictformat.js
/// splits it into headword, parts of speech, senses and examples; here they are put back
/// together for display. If the formatting layer is not loaded, show it as one block (the
/// dictionary is only an aid, so do not stop).
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
