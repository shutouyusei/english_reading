"use strict";

/* Grading call (app build). The native side (app-shell) reads the question JSON and the
   grading prompt, then launches claude -p. This layer knows neither the prompt's contents
   nor where the questions are stored.
   On failure it rejects with an Error that carries a Japanese message. */

window.Grader = {
  async grade({ promptId, promptType, essayText }) {
    return window.webkit.messageHandlers.grader.postMessage({
      action: "grade",
      promptId,
      promptType,
      essayText,
    });
  },
};
