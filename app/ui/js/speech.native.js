"use strict";

/* 音声層(アプリ版)。Swift 側が macOS の say で m4a を作り、
   ~/Documents/TOEFLReading/audio/ に置いたものを audio:// で返す。

   注意: window.Audio はブラウザ標準の Audio コンストラクタ、
   window.speechSynthesis も標準APIである。どちらも上書きしてはならない。 */

const _urls = new Map();

window.Speech = {
  /** 台本から音声を用意して URL を返す。失敗したら例外を投げる(呼び出し側が画面に出す)。
      options.force が真なら、キャッシュが壊れている前提で作り直す。 */
  async prepare(id, utterances, options = {}) {
    const force = options.force === true;
    if (!force && _urls.has(id)) return { url: _urls.get(id) };

    const reply = await window.webkit.messageHandlers.speech.postMessage({
      action: "prepare",
      id,
      utterances,
      force,
    });
    if (!reply || !reply.url) throw new Error("音声のURLを受け取れませんでした");

    // 作り直したのに WebKit が古い中身を使い回さないよう、問い合わせ文字列を変える。
    // ContentSchemeHandler はパスだけを見るので、この付加は無害。
    const url = force ? `${reply.url}?r=${Date.now()}` : reply.url;
    _urls.set(id, url);
    return { url };
  },
};
