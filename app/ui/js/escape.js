"use strict";

/* ライティングの2画面が共通で使う HTML エスケープ。
   docs/js/textmatch.js の escapeHtml はリーディングの読み込み経路にしか
   無いため、共有エンジンに手を入れずに済むよう独立させている。 */

window.escapeText = function escapeText(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
};
