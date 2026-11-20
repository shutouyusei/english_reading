"use strict";

/* Listening list. */

const WORDS_PER_MINUTE = 150;
const TYPE_LABELS = { lecture: "Lecture", conversation: "Conversation" };

// Keeps a row with a missing or non-numeric word_count from being shown as "about NaN min".
function minutesLabel(wordCount) {
  if (typeof wordCount !== "number" || !Number.isFinite(wordCount) || wordCount < 0) {
    return "length unknown";
  }
  return `about ${Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE))} min`;
}

function listeningProblem(item) {
  const state = problemStatus(ListeningStore.attempts(item.id).map(countedRecord));
  const id = encodeURIComponent(item.id);
  return {
    title: item.title,
    details: [item.topic, `${TYPE_LABELS[item.type] || item.type}, ${minutesLabel(item.word_count)}`],
    status: state.status,
    result: state.label,
    actionsHtml: `
      <a class="button primary" href="listening-player.html?id=${id}&mode=solve">Listen</a>
      <a class="button" href="listening-player.html?id=${id}&mode=study">Study</a>`,
  };
}

document.addEventListener("DOMContentLoaded", () => initProblemList({
  store: ListeningStore,
  indexUrl: "data/listening/index.json",
  listKey: "items",
  emptyText: "No listening sets yet.",
  toProblem: listeningProblem,
}));
