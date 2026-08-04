"use strict";

const ANKI_URL = "http://127.0.0.1:8765";
const DEFAULT_DECK = "TOEFL Reading";
const ANKI_SETTINGS_KEY = "settings.anki";

function ankiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(ANKI_SETTINGS_KEY));
    if (saved && saved.deck) return saved;
  } catch (_) { /* 破損データは無視してデフォルトへ */ }
  return { deck: DEFAULT_DECK };
}

function saveAnkiSettings(settings) {
  try {
    localStorage.setItem(ANKI_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) { /* プライベートモード等では保存しない */ }
}

async function ankiRequest(action, params) {
  const res = await fetch(ANKI_URL, {
    method: "POST",
    body: JSON.stringify({ action, version: 6, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFront(word, entry, passageTitle) {
  const sentence = escapeHtml(entry.context_sentence)
    .replace(new RegExp(`\\b(${escapeRegExp(word)})\\b`, "i"), "<b>$1</b>");
  return `<div style="font-size:1.2em"><b>${escapeHtml(word)}</b></div>` +
    `<div style="font-style:italic">"${sentence}"</div>` +
    `<div style="font-size:.8em;opacity:.7">出典: ${escapeHtml(passageTitle)}</div>`;
}

function buildBack(entry) {
  return `<b>定義:</b> ${escapeHtml(entry.definition)}<br>` +
    `<b>語源:</b> ${escapeHtml(entry.etymology)}<br>` +
    `<b>文中での役割:</b> ${escapeHtml(entry.usage_in_passage)}<br>` +
    `<b>関連語:</b> ${entry.related_terms.map(escapeHtml).join(", ")}`;
}

async function addToAnki(passage, word, entry) {
  const status = document.querySelector("#anki-status");
  status.textContent = "Ankiに追加中…";
  const deck = ankiSettings().deck;
  try {
    await ankiRequest("createDeck", { deck });
    await ankiRequest("addNote", {
      note: {
        deckName: deck,
        modelName: "Basic",
        fields: {
          Front: buildFront(word, entry, passage.title),
          Back: buildBack(entry),
        },
        options: { allowDuplicate: false },
        tags: ["toefl-reading", passage.id],
      },
    });
    status.textContent = `✅ デッキ「${deck}」に追加しました`;
  } catch (err) {
    if (String(err.message).includes("duplicate")) {
      status.textContent = "ℹ️ このカードは追加済みです";
    } else if (err instanceof TypeError) {
      status.innerHTML =
        `⚠ Ankiに接続できませんでした。Ankiが起動しているか確認してください。 ` +
        `<a href="guide.html#anki">セットアップ手順</a>`;
    } else {
      status.innerHTML =
        `⚠ Ankiがエラーを返しました: ${escapeHtml(err.message)} ` +
        `<a href="guide.html#anki">セットアップ手順</a>`;
    }
  }
}

function openAnkiSettings() {
  const root = document.querySelector("#modal-root");
  const current = ankiSettings().deck;
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h3>Anki設定</h3>
        <label>追加先デッキ名
          <input id="deck-input" value="${escapeHtml(current)}">
        </label>
        <div class="btn-row">
          <button id="settings-save" class="primary">保存</button>
          <button id="settings-cancel">キャンセル</button>
        </div>
      </div>
    </div>`;
  root.querySelector("#settings-save").addEventListener("click", () => {
    const deck = root.querySelector("#deck-input").value.trim() || DEFAULT_DECK;
    saveAnkiSettings({ deck });
    root.innerHTML = "";
  });
  root.querySelector("#settings-cancel").addEventListener("click", () => {
    root.innerHTML = "";
  });
}
