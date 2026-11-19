"use strict";

const ANKI_URL = "http://127.0.0.1:8765";
const DEFAULT_DECK = "TOEFL Reading";
const ANKI_SETTINGS_KEY = "settings.anki";

function ankiSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(ANKI_SETTINGS_KEY));
    if (saved && saved.deck) return saved;
  } catch (_) { /* ignore corrupt data and fall back to the default */ }
  return { deck: DEFAULT_DECK };
}

function saveAnkiSettings(settings) {
  try {
    localStorage.setItem(ANKI_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) { /* cannot save in private mode etc.; ignore */ }
}

/* The app provides window.AnkiBridge (anki.native.js), which reaches AnkiConnect through
   the native side (app-shell). With a direct fetch from the browser, AnkiConnect does not have
   the page's origin (app://local in the app, https://… on the public site) in its allow list,
   so no Access-Control-Allow-Origin comes back, the response is blocked, and the result is
   "Load failed". Going through the native side is outside the same-origin policy, so it does
   not depend on Anki's settings. The public site has no bridge and fetches as before. */
async function ankiRequest(action, params) {
  if (window.AnkiBridge) {
    return window.AnkiBridge.request(action, params || {});
  }
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
    `<div style="font-size:.8em;opacity:.7">Source: ${escapeHtml(passageTitle)}</div>`;
}

function buildBack(entry) {
  return `<b>Definition:</b> ${escapeHtml(entry.definition)}<br>` +
    `<b>Etymology:</b> ${escapeHtml(entry.etymology)}<br>` +
    `<b>Role in the passage:</b> ${escapeHtml(entry.usage_in_passage)}<br>` +
    `<b>Related words:</b> ${entry.related_terms.map(escapeHtml).join(", ")}`;
}

async function addToAnki(passage, word, entry) {
  const status = document.querySelector("#anki-status");
  status.textContent = "Adding to Anki…";
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
    status.textContent = `✅ Added to deck "${deck}"`;
  } catch (err) {
    if (String(err.message).includes("duplicate")) {
      status.textContent = "ℹ️ This card is already in Anki";
    } else if (err instanceof TypeError) {
      status.innerHTML =
        `⚠ Could not connect to Anki. Check that Anki is running. ` +
        `<a href="guide.html#anki">Setup steps</a>`;
    } else {
      status.innerHTML =
        `⚠ Anki returned an error: ${escapeHtml(err.message)} ` +
        `<a href="guide.html#anki">Setup steps</a>`;
    }
  }
}

function openAnkiSettings() {
  const root = document.querySelector("#modal-root");
  const current = ankiSettings().deck;
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <h3>Anki settings</h3>
        <label>Deck name
          <input id="deck-input" value="${escapeHtml(current)}">
        </label>
        <div class="btn-row">
          <button id="settings-save" class="primary">Save</button>
          <button id="settings-cancel">Cancel</button>
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
