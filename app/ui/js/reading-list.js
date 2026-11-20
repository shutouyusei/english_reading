"use strict";

/* Reading list (app build). The public site keeps its own list in docs/js/app.js. */

function readingProblem(passage) {
  const attempts = Store.attempts(passage.id);
  const state = problemStatus(attempts.map(countedRecord));
  const usable = latestUsableAttempt(attempts);
  const id = encodeURIComponent(passage.id);
  return {
    title: passage.title,
    details: [passage.topic, `${passage.word_count} words`],
    status: state.status,
    result: usable ? `${state.label} in ${minSecLabel(usable.elapsedSec)}` : state.label,
    actionsHtml: `
      <a class="button primary" href="reader.html?id=${id}&mode=solve">Solve</a>
      <a class="button" href="reader.html?id=${id}&mode=study">Study</a>`,
  };
}

document.addEventListener("DOMContentLoaded", () => initProblemList({
  store: Store,
  indexUrl: "data/reading/index.json",
  listKey: "passages",
  emptyText: "No passages yet.",
  toProblem: readingProblem,
}));
