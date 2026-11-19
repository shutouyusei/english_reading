"use strict";

async function initList() {
  const container = document.querySelector("#passage-list");
  try {
    await Store.init();
  } catch (err) {
    console.warn("Could not load study records:", err);
  }
  let index;
  try {
    // GitHub Pages returns max-age=600, so by default a new passage can stay hidden for up
    // to 10 minutes. no-cache revalidates with the server every time (an unchanged file
    // returns 304, so the transfer size barely grows).
    const res = await fetch(`${window.DATA_BASE || ""}data/reading/index.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (err) {
    container.innerHTML =
      `<p class="error">Could not load the passage list (${escapeHtml(err.message)}).</p>`;
    return;
  }
  if (!index.passages.length) {
    container.innerHTML = `<p class="hint">No passages yet.</p>`;
    return;
  }
  container.innerHTML = index.passages.map(cardHtml).join("");
}

function cardHtml(meta) {
  const result = Store.latest(meta.id);
  const badge = result
    ? `<span class="badge done">✅ ${result.score}/${result.total} · ${formatMinSec(result.elapsedSec)}</span>`
    : `<span class="badge">Not attempted</span>`;
  return `
    <div class="card">
      <div class="card-main">
        <h3>${escapeHtml(meta.title)}</h3>
        <p class="meta">${escapeHtml(meta.topic)} · ${meta.word_count} words · ${meta.added} ${badge}</p>
      </div>
      <div class="card-actions">
        <a class="button primary" href="${window.READER_URL}?id=${meta.id}&mode=solve">✏️ Solve</a>
        <a class="button" href="${window.READER_URL}?id=${meta.id}&mode=study">📖 Read in study mode</a>
      </div>
    </div>`;
}

function formatMinSec(sec) {
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

document.addEventListener("DOMContentLoaded", initList);
