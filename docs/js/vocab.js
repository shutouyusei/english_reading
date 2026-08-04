"use strict";

const studyState = { selectedWord: null, history: [], activeTab: "vocab" };

function renderStudy(passage) {
  renderPassageClickable(passage);
  renderPanel(passage);
}

function renderPassageClickable(passage) {
  const keys = new Set(Object.keys(passage.vocab).map((w) => w.toLowerCase()));
  const pane = qs("#passage-pane");
  pane.innerHTML = "";
  for (const para of passage.body.split("\n\n")) {
    const p = document.createElement("p");
    for (const part of tokenize(para)) {
      if (!part.isWord) {
        p.appendChild(document.createTextNode(part.text));
        continue;
      }
      const span = document.createElement("span");
      const key = findVocabKey(part.text, keys);
      span.textContent = part.text;
      span.className = key ? "w vocab-word" : "w";
      span.addEventListener("click", () => onWordClick(passage, part.text, key, span));
      p.appendChild(span);
    }
    pane.appendChild(p);
  }
}

function onWordClick(passage, surface, key, span) {
  document.querySelectorAll(".w.active").forEach((el) => el.classList.remove("active"));
  span.classList.add("active");
  studyState.selectedWord = key || surface.toLowerCase();
  studyState.activeTab = "vocab";
  if (!studyState.history.includes(studyState.selectedWord)) {
    studyState.history.unshift(studyState.selectedWord);
  }
  renderPanel(passage);
}

function renderPanel(passage) {
  const result = loadStudyResult(passage.id);
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
      renderPanel(passage);
    }));
  if (studyState.activeTab === "vocab") {
    renderVocabTab(passage);
  } else {
    renderQuizTab(passage, result);
  }
}

function loadStudyResult(id) {
  try {
    return JSON.parse(localStorage.getItem(`results.${id}`));
  } catch (_) {
    return null;
  }
}

function renderVocabTab(passage) {
  const body = qs("#panel-body");
  const word = studyState.selectedWord;
  if (!word) {
    body.innerHTML =
      `<p class="hint">本文中の単語をクリックすると、ここに解説が表示されます。</p>`;
    return;
  }
  const entry = passage.vocab[word];
  const weblio = `https://ejje.weblio.jp/content/${encodeURIComponent(word)}`;
  if (!entry) {
    body.innerHTML = `
      <h3 class="word">${escapeHtml(word)}</h3>
      <p>未収録の単語です。</p>
      <p><a href="${weblio}" target="_blank" rel="noopener">Weblioで調べる ↗</a></p>
      ${historyHtml()}`;
    return;
  }
  body.innerHTML = `
    <h3 class="word">${escapeHtml(word)}</h3>
    <div class="label">語源</div><p>${escapeHtml(entry.etymology)}</p>
    <div class="label">定義</div><p>${escapeHtml(entry.definition)}</p>
    <div class="label">この文章での役割</div><p>${escapeHtml(entry.usage_in_passage)}</p>
    <div class="label">関連語</div><p>${entry.related_terms.map(escapeHtml).join(" ・ ")}</p>
    <div class="btn-row">
      <button id="anki-add" class="anki">＋ Ankiに追加</button>
      <a class="button" href="${weblio}" target="_blank" rel="noopener">Weblio ↗</a>
      <button id="anki-settings-open" title="Anki設定">⚙</button>
    </div>
    <p id="anki-status" class="hint"></p>
    ${historyHtml()}`;
  qs("#anki-add").addEventListener("click", () => addToAnki(passage, word, entry));
  qs("#anki-settings-open").addEventListener("click", () => openAnkiSettings());
}

function historyHtml() {
  if (!studyState.history.length) return "";
  const words = studyState.history.slice(0, 8).map(escapeHtml).join(" ・ ");
  return `<p class="hint">最近調べた語: ${words}</p>`;
}

function renderQuizTab(passage, result) {
  const body = qs("#panel-body");
  if (!result) {
    body.innerHTML = `<p class="hint">まだ解いていません。` +
      `<a href="reader.html?id=${passage.id}&mode=solve">問題を解く</a></p>`;
    return;
  }
  body.innerHTML = passage.questions.map((q, i) => {
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
