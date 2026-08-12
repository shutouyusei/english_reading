"use strict";

const TYPE_LABELS = { email: "メール", discussion: "ディスカッション" };

async function initWritingList() {
  const container = document.querySelector("#writing-list");
  try {
    await Essays.init();
  } catch (err) {
    console.warn("学習記録を読み込めませんでした:", err);
  }

  let index;
  try {
    const res = await fetch(`${window.DATA_BASE || ""}data/writing/index.json`,
                            { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (err) {
    container.innerHTML =
      `<p class="error">一覧を読み込めませんでした(${escapeText(err.message)})。</p>`;
    return;
  }

  if (!index.prompts.length) {
    container.innerHTML = `<p class="hint">ライティングの問題がまだありません。</p>`;
    return;
  }
  container.innerHTML = index.prompts.map(promptCardHtml).join("");
}

function promptCardHtml(meta) {
  const entry = Essays.latest(meta.id);
  const attempts = Essays.forPrompt(meta.id).length;
  return `
    <div class="card">
      <div class="card-main">
        <h3>${escapeText(meta.title)}</h3>
        <p class="meta">${TYPE_LABELS[meta.type] || meta.type} ・ 目安 ${meta.target_minutes} 分 ・ ${meta.added} ${badgeHtml(entry, attempts)}</p>
      </div>
      <div class="card-actions">
        <a class="button primary" href="${window.EDITOR_URL}?id=${encodeURIComponent(meta.id)}">✏️ 書く</a>
      </div>
    </div>`;
}

function badgeHtml(entry, attempts) {
  if (!entry) return `<span class="badge">未着手</span>`;
  const count = attempts > 1 ? ` ・ ${attempts}回` : "";
  if (!entry.grade) return `<span class="badge">⏳ 採点待ち${count}</span>`;
  return `<span class="badge done">✅ ${entry.grade.overall}/5${count}</span>`;
}

document.addEventListener("DOMContentLoaded", initWritingList);
