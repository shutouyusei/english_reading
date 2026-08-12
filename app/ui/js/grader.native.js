"use strict";

/* 採点の呼び出し(アプリ版)。Swift 側が問題 JSON と採点プロンプトを読み、
   claude -p を起動する。この層はプロンプトの中身も問題の置き場所も知らない。
   失敗時は日本語のメッセージを持つ Error で reject する。 */

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
