"use strict";

/* Listening list. Reads docs/data/listening/index.json and lays out the cards. */

const WORDS_PER_MINUTE = 150;
const TYPE_LABELS = { lecture: "講義", conversation: "会話" };

// Keeps a row with a missing or non-numeric word_count from being shown as "about NaN minutes".
function estimatedMinutes(wordCount) {
  if (typeof wordCount !== "number" || !Number.isFinite(wordCount) || wordCount < 0) {
    return null;
  }
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}

function minutesLabel(wordCount) {
  const minutes = estimatedMinutes(wordCount);
  return minutes === null ? "分数不明" : `約${minutes}分`;
}

// The score also comes from learning records with no schema guarantee, so, in the same
// way as badgeHtml in writing-list.js, even validated numbers go through escapeHtml.
function badgeHtml(latest) {
  if (!latest) return `<span class="badge">未着手</span>`;
  const score = latest.score;
  const total = latest.total;
  const valid = typeof score === "number" && Number.isFinite(score) &&
                typeof total === "number" && Number.isFinite(total);
  if (!valid) return `<span class="badge">未着手</span>`;
  return `<span class="badge done">${escapeHtml(score)}/${escapeHtml(total)}</span>`;
}

function cardHtml(item) {
  const latest = ListeningStore.latest(item.id);
  const label = TYPE_LABELS[item.type] || item.type;
  return `
    <div class="card">
      <div>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="meta">${escapeHtml(label)} ・ ${escapeHtml(item.topic)} ・ ${minutesLabel(item.word_count)}</p>
      </div>
      <div class="card-actions">
        ${badgeHtml(latest)}
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
    // Make sure content corrected after publishing is picked up
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
