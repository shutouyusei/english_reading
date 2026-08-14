"use strict";

/* HTML への差し込み前に特殊文字を無害化する。
   公開サイトのリーディングと、ローカルアプリのライティングが共通で使う。
   採点結果のように、内容を検査していないデータをそのまま埋め込む箇所があるため、
   描画側は必ずこれを通す。 */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

if (typeof module !== "undefined") {
  module.exports = { escapeHtml };
}
