"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Checks, against the real code, that the error listener in renderPlayer()
// (app/ui/js/listening-player.js) tells apart a late error from an old element
// (one a renderPlayer() re-render already detached from #player) and an error on
// the #player that is live on screen right now.
//
// The bug found in review: after a successful forced rebuild, setting
// playerState.playbackDone = true just before calling renderPlayer() made the
// error listener of the new #player return at its first line,
// "if (playerState.playbackDone) return;". A real error on the replaced element
// then never reached renderAudioFailure(), and the user saw a dead player with no
// message. The current code filters only old elements, by identity
// (audio !== qs("#player")), so it has no such side effect.
//
// Going back to the flag version keeps test (a) passing but breaks test (b).
// Both passing together is the evidence that the code is right.
//
// The code calls DOM APIs directly, so a minimal fake DOM is used that recognizes
// only the markup renderPlayer() really emits. The source is run as is through vm,
// as in listening_player_source.test.js and listening_player_utterances.test.js.

class FakeAudioElement {
  constructor() {
    this._listeners = {};
    this.src = "set";
  }
  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }
  removeAttribute(name) {
    if (name === "src") this.src = undefined;
  }
  pause() {}
  get paused() { return true; }
  get ended() { return false; }
  /** Lets a test simulate an error on this element. */
  dispatchError() {
    for (const fn of this._listeners.error || []) fn();
  }
}

class FakeButton {
  constructor() { this._listeners = {}; this.disabled = false; this.textContent = ""; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
}

class FakeSpan {
  constructor() { this.textContent = ""; }
}

class FakeAnchor {
  constructor() { this._listeners = {}; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
}

/** Fakes only #passage-pane. It looks at the markup that renderPlayer() and
    renderAudioFailure() really write and registers fresh fake elements in the
    registry, so that running renderPlayer() again replaces #player. */
function makeFakeDocument(registry) {
  const passagePane = {
    set innerHTML(html) {
      if (html.includes('id="player"')) {
        registry.player = new FakeAudioElement();
        registry["play-btn"] = new FakeButton();
        registry["play-state"] = new FakeSpan();
      }
      if (html.includes('id="to-study-on-error"')) {
        registry["to-study-on-error"] = new FakeAnchor();
      }
    },
    get innerHTML() { return ""; },
  };
  registry["passage-pane"] = passagePane;
  registry["right-pane"] = { set innerHTML(_) {}, get innerHTML() { return ""; } };
  return {
    querySelector(sel) {
      return registry[sel.replace(/^#/, "")] || null;
    },
  };
}

const minimalItem = {
  id: "listening_001",
  speakers: [{ id: "professor", voice: "Daniel" }],
  script: [{ speaker: "professor", text: "Hello." }],
  questions: [],
};

function loadListeningPlayerInternals() {
  const source = fs.readFileSync(
    path.join(__dirname, "../../app/ui/js/listening-player.js"), "utf8")
    .replace(/document\.addEventListener\("DOMContentLoaded", init\);\s*$/, "");
  const registry = {};
  const context = {
    window: {},
    document: makeFakeDocument(registry),
    module: { exports: {} },
    Speech: { prepare: async () => ({ url: "audio://local/regenerated" }) },
    escapeHtml: (s) => s,
  };
  vm.createContext(context);
  vm.runInContext(
    source +
      "\n;this.playerState = playerState;" +
      "this.renderPlayer = renderPlayer;",
    context);
  return { context, registry };
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("(a) a late error from the old #player is ignored after the replacement", async () => {
  const { context, registry } = loadListeningPlayerInternals();
  context.playerState.item = minimalItem;
  context.playerState.audioUrl = "audio://local/broken";
  context.playerState.retriedAudio = false;
  context.playerState.playbackDone = false;

  let failureCalls = 0;
  context.renderAudioFailure = () => { failureCalls++; };

  context.renderPlayer();
  const oldAudio = registry.player;

  // First error: no retry yet, so it forces a rebuild and renderPlayer() runs again.
  oldAudio.dispatchError();
  await flushMicrotasks();

  assert.notEqual(registry.player, oldAudio,
    "running renderPlayer() again should replace #player with a new element");
  assert.equal(context.playerState.retriedAudio, true);
  assert.equal(failureCalls, 0, "the first error only triggers the retry, with no failure shown");

  // A second error arrives late on the old, already replaced element.
  oldAudio.dispatchError();

  assert.equal(failureCalls, 0,
    "a late error from the old element (no longer #player) must be ignored " +
    "and must not break the freshly rendered player");
});

test("(b) a real error on the new #player reaches renderAudioFailure", async () => {
  const { context, registry } = loadListeningPlayerInternals();
  context.playerState.item = minimalItem;
  context.playerState.audioUrl = "audio://local/broken";
  context.playerState.retriedAudio = false;
  context.playerState.playbackDone = false;

  let failureCalls = 0;
  context.renderAudioFailure = () => { failureCalls++; };

  context.renderPlayer();
  registry.player.dispatchError(); // first error: forced rebuild, retriedAudio = true
  await flushMicrotasks();

  const newAudio = registry.player;
  assert.equal(failureCalls, 0, "the first error only triggers the retry, with no failure shown");

  // This time a real error happens on the new #player.
  newAudio.dispatchError();

  assert.equal(failureCalls, 1,
    "an error on the live #player must reach renderAudioFailure() " +
    "(on a regression this stays 0 and the player freezes with no message)");
});
