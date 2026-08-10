"use strict";

async function initList() {
  const container = document.querySelector("#passage-list");
  try {
    await Store.init();
  } catch (err) {
    console.warn("学習記録を読み込めませんでした:", err);
  }
  let index;
  try {
    // GitHub Pages は max-age=600 を返すため、そのままだと新しいパッセージが
    // 最大10分間表示されない。no-cache で毎回サーバーに更新を問い合わせる
    // (変更が無ければ 304 が返るので転送量はほとんど増えない)。
    const res = await fetch(`${window.DATA_BASE || ""}data/index.json`, { cache: "no-cache" });
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
  const result = Store.latest(meta.id);
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
        <a class="button primary" href="${window.READER_URL}?id=${meta.id}&mode=solve">✏️ 問題を解く</a>
        <a class="button" href="${window.READER_URL}?id=${meta.id}&mode=study">📖 解説モードで読む</a>
      </div>
    </div>`;
}

function formatMinSec(sec) {
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}

document.addEventListener("DOMContentLoaded", initList);
