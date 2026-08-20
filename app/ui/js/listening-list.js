"use strict";

/* リスニング一覧。docs/data/listening/index.json を読んでカードを並べる。 */

const WORDS_PER_MINUTE = 150;
const TYPE_LABELS = { lecture: "講義", conversation: "会話" };

function estimatedMinutes(wordCount) {
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

function cardHtml(item) {
  const latest = ListeningStore.latest(item.id);
  const badge = latest
    ? `<span class="badge done">${latest.score}/${latest.total}</span>`
    : `<span class="badge">未着手</span>`;
  const label = TYPE_LABELS[item.type] || item.type;
  return `
    <div class="card">
      <div>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="meta">${escapeHtml(label)} ・ ${escapeHtml(item.topic)} ・ 約${estimatedMinutes(item.word_count)}分</p>
      </div>
      <div class="card-actions">
        ${badge}
        <a class="button primary" href="listening-player.html?id=${encodeURIComponent(item.id)}&mode=solve">聴く</a>
        <a class="button" href="listening-player.html?id=${encodeURIComponent(item.id)}&mode=study">解説</a>
      </div>
    </div>`;
}

async function initListeningList() {
  const container = document.querySelector("#listening-list");
  try {
    await ListeningStore.init();
  } catch (err) {
    console.warn("学習記録を読み込めませんでした:", err);
  }
  try {
    // 公開後に内容を訂正した場合も確実に反映させる
    const res = await fetch(`${window.DATA_BASE || ""}data/listening/index.json`,
                            { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = await res.json();
    const items = index.items || [];
    container.innerHTML = items.length
      ? items.map(cardHtml).join("")
      : `<p class="hint">まだ問題がありません。</p>`;
  } catch (err) {
    container.innerHTML = `<p class="error">一覧を読み込めませんでした(${escapeHtml(err.message)})。</p>`;
  }
}

document.addEventListener("DOMContentLoaded", initListeningList);
