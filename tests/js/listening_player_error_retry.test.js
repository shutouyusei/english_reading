"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// renderPlayer() の error リスナ(app/ui/js/listening-player.js)が、
// 「古い(renderPlayer() の再描画で #player から外れた)要素からの遅れた
// error」と「今まさに画面上に生きている #player の error」を正しく
// 区別できているかを、実装そのものに対して確かめる。
//
// レビューで指摘された不具合: 強制再生成の成功後、renderPlayer() を呼ぶ
// 直前に playerState.playbackDone = true を立てる実装だと、その後に
// renderPlayer() が新しく作る #player の error リスナも
// 「if (playerState.playbackDone) return;」の1行目で弾かれてしまい、
// 差し替え後の要素で本当にエラーが起きても renderAudioFailure() に
// 届かなくなる(ユーザーは死んだプレイヤーと無言だけを見る)。
// 現在の実装は要素の同一性(audio !== qs("#player"))で古い要素からの
// 通知だけを弾くため、その副作用が起きないはずである。
//
// この2つのテストは、上のフラグ実装に戻すと(a)は通っても(b)が壊れる形に
// なっている。両方が同時に緑であることが、正しい実装の証拠になる。
//
// WKWebView 前提の DOM API を直接叩くコードなので、renderPlayer() が
// 実際に出すマークアップだけを認識する最小限のフェイク DOM を用意する
// (listening_player_source.test.js / listening_player_utterances.test.js
// と同じ、vm 経由でソースをそのまま実行するやり方)。

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
  /** テストから「この要素で error が起きた」ことを模す。 */
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

/** #passage-pane だけを模す。renderPlayer()/renderAudioFailure() が
    実際に書き込むマークアップの中身で判定し、対応するフェイク要素を
    registry に登録し直す(renderPlayer() の再実行 = #player の差し替え、
    を再現するのが目的)。 */
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

test("差し替え後、古い #player からの遅れた error は無視される", async () => {
  const { context, registry } = loadListeningPlayerInternals();
  context.playerState.item = minimalItem;
  context.playerState.audioUrl = "audio://local/broken";
  context.playerState.retriedAudio = false;
  context.playerState.playbackDone = false;

  let failureCalls = 0;
  context.renderAudioFailure = () => { failureCalls++; };

  context.renderPlayer();
  const oldAudio = registry.player;

  // 1回目の error: まだ再試行していないので強制再生成 → renderPlayer() 再実行
  oldAudio.dispatchError();
  await flushMicrotasks();

  assert.notEqual(registry.player, oldAudio,
    "renderPlayer() の再実行で #player が新しい要素に差し替わっているはず");
  assert.equal(context.playerState.retriedAudio, true);
  assert.equal(failureCalls, 0, "1回目はまだ再試行中で失敗表示はしない");

  // 差し替え済みの古い要素に、遅れて2回目の error が届く状況を再現する
  oldAudio.dispatchError();

  assert.equal(failureCalls, 0,
    "古い(既に #player ではない)要素からの遅れた error は無視され、" +
    "新しく描画したプレイヤーを壊してはいけない");
});

test("差し替え後の新しい #player で本当に error が起きたら renderAudioFailure に届く", async () => {
  const { context, registry } = loadListeningPlayerInternals();
  context.playerState.item = minimalItem;
  context.playerState.audioUrl = "audio://local/broken";
  context.playerState.retriedAudio = false;
  context.playerState.playbackDone = false;

  let failureCalls = 0;
  context.renderAudioFailure = () => { failureCalls++; };

  context.renderPlayer();
  registry.player.dispatchError(); // 1回目: 強制再生成 → retriedAudio = true
  await flushMicrotasks();

  const newAudio = registry.player;
  assert.equal(failureCalls, 0, "1回目はまだ再試行中で失敗表示はしない");

  // 差し替え後の新しい #player で、今度こそ本当にエラーが起きる
  newAudio.dispatchError();

  assert.equal(failureCalls, 1,
    "生きている #player の error は無視されず renderAudioFailure() まで届かなければならない " +
    "(退行するとここが 0 のまま無言で固まる)");
});
