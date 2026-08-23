"use strict";

/* Anki 層(アプリ版)。Swift 側が AnkiConnect へ HTTP で問い合わせる。

   なぜ経由するのか: WKWebView から直接 fetch すると、ページの出自が app://local に
   なり、AnkiConnect がその出自を許可リストに持たないため Access-Control-Allow-Origin
   を返さない。応答はブラウザに遮断され、JS からは "Load failed" としか見えない。
   ネイティブコードには同一生成元ポリシーが無いので、この経路なら Anki 側の設定に
   依存せずに済む。 */

window.AnkiBridge = {
  /** AnkiConnect の action を実行して result を返す。失敗したら日本語の理由で throw。 */
  async request(action, params) {
    const reply = await window.webkit.messageHandlers.anki.postMessage({
      action: "request",
      ankiAction: action,
      params: params || {},
    });
    return reply ? reply.result : null;
  },
};
