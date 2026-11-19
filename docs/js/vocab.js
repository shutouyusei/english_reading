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
  const quizLabel = result ? `Question explanations (${result.score}/${result.total})` : "Question explanations";
  qs("#right-pane").innerHTML = `
    <div class="tabs">
      <button class="tab${studyState.activeTab === "vocab" ? " on" : ""}" data-tab="vocab">Vocabulary</button>
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
      `<p class="hint">Click a word in the text to see its explanation here.</p>`;
    return;
  }
  const entry = source.vocab[word];
  const cambridge =
    `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)}`;
  if (!entry) {
    body.innerHTML = `
      <h3 class="word">${escapeHtml(word)}</h3>
      <p>No prepared explanation for this word.</p>
      <p><a href="${cambridge}" target="_blank" rel="noopener">Look up in Cambridge Dictionary ↗</a></p>
      ${historyHtml()}`;
    return;
  }
  body.innerHTML = `
    <h3 class="word">${escapeHtml(word)}</h3>
    <div class="label">Etymology</div><p>${escapeHtml(entry.etymology)}</p>
    <div class="label">Definition</div><p>${escapeHtml(entry.definition)}</p>
    <div class="label">Role in the passage</div><p>${escapeHtml(entry.usage_in_passage)}</p>
    <div class="label">Related words</div><p>${entry.related_terms.map(escapeHtml).join(" · ")}</p>
    <div class="btn-row">
      <button id="anki-add" class="anki">+ Add to Anki</button>
      <a class="button" href="${cambridge}" target="_blank" rel="noopener">Cambridge ↗</a>
      <button id="anki-settings-open" title="Anki settings">⚙</button>
    </div>
    <p id="anki-status" class="hint"></p>
    ${historyHtml()}`;
  qs("#anki-add").addEventListener("click", () => addToAnki(source, word, entry));
  qs("#anki-settings-open").addEventListener("click", () => openAnkiSettings());
}

function historyHtml() {
  if (!studyState.history.length) return "";
  const words = studyState.history.slice(0, 8).map(escapeHtml).join(" · ");
  return `<p class="hint">Recently looked up: ${words}</p>`;
}

function renderQuizTab(source, result) {
  const body = qs("#panel-body");
  if (!result) {
    body.innerHTML = `<p class="hint">Not attempted yet. ` +
      `<a href="${source.solveUrl}">Solve</a></p>`;
    return;
  }
  body.innerHTML = source.questions.map((q, i) => {
    const user = result.answers ? result.answers[i] : null;
    const ok = user === q.correct;
    return `
      <div class="quiz-review${ok ? " ok" : " ng"}">
        <p><b>Q${q.id}.</b> ${escapeHtml(q.question)}</p>
        <p>${ok ? "✅" : "❌"} Your answer: ${user || "—"} / ` +
        `Correct answer: ${q.correct}. ${escapeHtml(q.choices[q.correct])}</p>
        <p class="explanation">${escapeHtml(q.explanation)}</p>
      </div>`;
  }).join("");
}
