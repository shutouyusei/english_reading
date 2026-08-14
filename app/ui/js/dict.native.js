"use strict";

/* 辞書層(アプリ版)。macOS のシステム辞書(ウィズダム英和)を Swift 経由で引く。
   公開版の dict.web.js と同じ口を提供するため、呼び出し側に分岐は要らない。 */

const _definitions = new Map();

window.Dict = {
  /** 定義が見つかれば {word, definition, source}、無ければ null。例外は投げない。 */
  async define(word) {
    const key = String(word == null ? "" : word).trim().toLowerCase();
    if (!key) return null;
    if (_definitions.has(key)) return _definitions.get(key);

    let reply;
    try {
      reply = await window.webkit.messageHandlers.dictionary.postMessage({
        action: "define",
        word: key,
      });
    } catch (err) {
      // 辞書は本文読解の補助であって主役ではない。引けなくても本文と単語解説は出し続ける。
      // ここで覚えないのは、一時的な失敗から次のクリックで回復できるようにするため。
      console.warn("辞書を引けませんでした:", err);
      return null;
    }

    const result = reply && reply.definition
      ? { word: key, definition: reply.definition, source: reply.source || null }
      : null;
    // 「辞書に無い」も結果のうち。覚えておけば同じ語で往復を繰り返さずに済む。
    _definitions.set(key, result);
    return result;
  },
};
