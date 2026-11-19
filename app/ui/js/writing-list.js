"use strict";

const TYPE_LABELS = { email: "Email", discussion: "Discussion" };

async function initWritingList() {
  const container = document.querySelector("#writing-list");
  try {
    await Essays.init();
  } catch (err) {
    console.warn("Could not load study records:", err);
  }

  let index;
  try {
    const res = await fetch(`${window.DATA_BASE || ""}data/writing/index.json`,
                            { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (err) {
    container.innerHTML =
      `<p class="error">Could not load the list (${escapeHtml(err.message)}).</p>`;
    return;
  }

  if (!index.prompts.length) {
    container.innerHTML = `<p class="hint">No writing prompts yet.</p>`;
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
        <h3>${escapeHtml(meta.title)}</h3>
        <p class="meta">${TYPE_LABELS[meta.type] || meta.type} · target ${meta.target_minutes} min · ${meta.added} ${badgeHtml(entry, entries.length)}</p>
      </div>
      <div class="card-actions">
        <a class="button primary" href="${window.EDITOR_URL}?id=${encodeURIComponent(meta.id)}">✏️ Write</a>
      </div>
    </div>
    ${pastAttemptsHtml(entries)}`;
}

// The badge (badgeHtml) summarizes only the latest attempt. Earlier ones are shown
// below the card as entries[1:] (newest first). Requirement: question list and
// past essay list.
function pastAttemptsHtml(entries) {
  const past = entries.slice(1);
  if (!past.length) return "";
  return `
    <ul class="attempts">
      ${past.map(attemptRowHtml).join("")}
    </ul>`;
}

function attemptRowHtml(entry) {
  const date = escapeHtml(String(entry.essay.writtenAt).slice(0, 10));
  return `<li class="meta">${date} · ${attemptScoreLabel(entry.grade)} · ${attemptElapsedLabel(entry.essay)}</li>`;
}

// The grade is the JSON the grading AI returned, as is, with no type guarantee, so,
// like badgeHtml, anything but a finite number from 0 to 5 is treated as awaiting grading.
function attemptScoreLabel(grade) {
  if (!grade) return "⏳ Awaiting grading";
  const overall = grade.overall;
  if (typeof overall !== "number" || !Number.isFinite(overall) || overall < 0 || overall > 5) {
    return "⏳ Awaiting grading";
  }
  return `${escapeHtml(overall)}/5`;
}

function attemptElapsedLabel(essay) {
  const sec = typeof essay.elapsedSec === "number" && Number.isFinite(essay.elapsedSec) && essay.elapsedSec >= 0
    ? Math.floor(essay.elapsedSec)
    : 0;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function badgeHtml(entry, attempts) {
  if (!entry) return `<span class="badge">Not attempted</span>`;
  const count = attempts > 1 ? ` · ${attempts} attempts` : "";
  if (!entry.grade) return `<span class="badge">⏳ Awaiting grading${count}</span>`;
  // The grade is the JSON the grading AI returned, as is, with no type guarantee, so
  // anything but a finite number from 0 to 5 is treated as awaiting grading.
  const overall = entry.grade.overall;
  if (typeof overall !== "number" || !Number.isFinite(overall) || overall < 0 || overall > 5) {
    return `<span class="badge">⏳ Awaiting grading${count}</span>`;
  }
  return `<span class="badge done">✅ ${escapeHtml(overall)}/5${count}</span>`;
}

document.addEventListener("DOMContentLoaded", initWritingList);
