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
  const entries = Essays.forPrompt(meta.id);
  const entry = entries[0] || null;
  return `
    <div class="card">
      <div class="card-main">
        <h3>${escapeText(meta.title)}</h3>
        <p class="meta">${TYPE_LABELS[meta.type] || meta.type} ・ 目安 ${meta.target_minutes} 分 ・ ${meta.added} ${badgeHtml(entry, entries.length)}</p>
      </div>
      <div class="card-actions">
        <a class="button primary" href="${window.EDITOR_URL}?id=${encodeURIComponent(meta.id)}">✏️ 書く</a>
      </div>
    </div>
    ${pastAttemptsHtml(entries)}`;
}

// バッジ(badgeHtml)は最新の1回だけを要約する。過去の分は entries[1:] として
// 一覧末尾に出す(新しい順)。要件: 問題一覧・過去のエッセイ一覧。
function pastAttemptsHtml(entries) {
  const past = entries.slice(1);
  if (!past.length) return "";
  return `
    <ul class="attempts">
      ${past.map(attemptRowHtml).join("")}
    </ul>`;
}

function attemptRowHtml(entry) {
  const date = escapeText(String(entry.essay.writtenAt).slice(0, 10));
  return `<li class="meta">${date} ・ ${attemptScoreLabel(entry.grade)} ・ ${attemptElapsedLabel(entry.essay)}</li>`;
}

// 採点結果はグレーディングAIが返すJSONそのままで型保証が無いため、
// badgeHtml と同じく 0〜5 の有限数でなければ採点待ち扱いに倒す。
function attemptScoreLabel(grade) {
  if (!grade) return "⏳ 採点待ち";
  const overall = grade.overall;
  if (typeof overall !== "number" || !Number.isFinite(overall) || overall < 0 || overall > 5) {
    return "⏳ 採点待ち";
  }
  return `${escapeText(overall)}/5`;
}

function attemptElapsedLabel(essay) {
  const sec = typeof essay.elapsedSec === "number" && Number.isFinite(essay.elapsedSec) && essay.elapsedSec >= 0
    ? Math.floor(essay.elapsedSec)
    : 0;
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}

function badgeHtml(entry, attempts) {
  if (!entry) return `<span class="badge">未着手</span>`;
  const count = attempts > 1 ? ` ・ ${attempts}回` : "";
  if (!entry.grade) return `<span class="badge">⏳ 採点待ち${count}</span>`;
  // 採点はグレーディングAIが返すJSONそのままで型保証が無いため、
  // 0〜5の有限数でなければ採点待ち扱いに倒す。
  const overall = entry.grade.overall;
  if (typeof overall !== "number" || !Number.isFinite(overall) || overall < 0 || overall > 5) {
    return `<span class="badge">⏳ 採点待ち${count}</span>`;
  }
  return `<span class="badge done">✅ ${escapeText(overall)}/5${count}</span>`;
}

document.addEventListener("DOMContentLoaded", initWritingList);
