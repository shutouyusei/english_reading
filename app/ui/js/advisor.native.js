"use strict";

/* Study advice call (app build). The native side (app-shell) pastes the statistics into
   app/prompts/advise.md, launches claude -p, and appends the answer to advice.jsonl in
   the data directory. On failure it rejects with an Error that carries the reason. */

window.Advisor = {
  /** The last saved {createdAt, stats, advice}, or null when none has been asked for. */
  async latest() {
    return window.webkit.messageHandlers.advisor.postMessage({ action: "latest" });
  },
  async advise(stats) {
    return window.webkit.messageHandlers.advisor.postMessage({
      action: "advise",
      stats,
      createdAt: new Date().toISOString(),
    });
  },
};
