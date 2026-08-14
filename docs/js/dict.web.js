"use strict";

/* 辞書層(公開版)。システム辞書は macOS のアプリ版だけの機能なので、常に null を返す。
   呼び出し側(vocab.js)が「アプリかどうか」を判定しなくて済むよう、口だけ合わせる。
   公開サイトでは従来どおり Weblio へのリンクが案内になる。 */

window.Dict = {
  async define(_word) {
    return null;
  },
};
