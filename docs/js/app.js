"use strict";

async function initList() {
  const container = document.querySelector("#passage-list");
  let index;
  try {
    const res = await fetch("data/index.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (err) {
    container.innerHTML =
      `<p class="error">一覧を読み込めませんでした(${escapeHtml(err.message)})。</p>`;
    return;
  }
  if (!index.passages.length) {
    container.innerHTML = `<p class="hint">パッセージがまだありません。</p>`;
    return;
  }
  container.innerHTML = index.passages.map(cardHtml).join("");
}

function cardHtml(meta) {
  const result = loadResult(meta.id);
  const badge = result
    ? `<span class="badge done">✅ ${result.score}/${result.total} ・ ${formatMinSec(result.elapsedSec)}</span>`
    : `<span class="badge">未挑戦</span>`;
  return `
    <div class="card">
      <div class="card-main">
        <h3>${escapeHtml(meta.title)}</h3>
        <p class="meta">${escapeHtml(meta.topic)} ・ ${meta.word_count} words ・ ${meta.added} ${badge}</p>
      </div>
      <div class="card-actions">
        <a class="button primary" href="reader.html?id=${meta.id}&mode=solve">✏️ 問題を解く</a>
        <a class="button" href="reader.html?id=${meta.id}&mode=study">📖 解説モードで読む</a>
      </div>
    </div>`;
}

function loadResult(id) {
  try {
    return JSON.parse(localStorage.getItem(`results.${id}`));
  } catch (_) {
    return null;
  }
}

function formatMinSec(sec) {
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}

document.addEventListener("DOMContentLoaded", initList);
