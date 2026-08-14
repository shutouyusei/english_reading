"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// dict.native.js は Swift 側のブリッジ (window.webkit.messageHandlers.dictionary) に
// 依存する。偽のブリッジを差し込んで、キャッシュ・null の扱い・失敗時の振る舞いを見る。
//
// 辞書は本文読解の補助であって主役ではない。ブリッジが壊れても本文と単語解説は
// 出続けなければならない。そのため「失敗しても投げない」がここでの核心。

function loadDict(options = {}) {
  const calls = [];
  global.window = {
    webkit: {
      messageHandlers: {
        dictionary: {
          postMessage: async (payload) => {
            calls.push(payload);
            if (options.rejects) throw new Error("未知の action: define");
            const table = options.table || {};
            const definition = Object.prototype.hasOwnProperty.call(table, payload.word)
              ? table[payload.word]
              : null;
            return { word: payload.word, definition, source: "ウィズダム英和辞典" };
          },
        },
      },
    },
  };
  delete require.cache[require.resolve("../../app/ui/js/dict.native.js")];
  require("../../app/ui/js/dict.native.js");
  return { Dict: global.window.Dict, calls };
}

function loadWebDict() {
  global.window = {};
  delete require.cache[require.resolve("../../docs/js/dict.web.js")];
  require("../../docs/js/dict.web.js");
  return global.window.Dict;
}

const NEGLIGIBLE = "取るに足らない, 無視してかまわない";

test("define はブリッジへ action と word を渡す", async () => {
  const { Dict, calls } = loadDict({ table: { negligible: NEGLIGIBLE } });
  await Dict.define("negligible");
  assert.deepEqual(calls, [{ action: "define", word: "negligible" }]);
});

test("定義が見つかれば definition と source を返す", async () => {
  const { Dict } = loadDict({ table: { negligible: NEGLIGIBLE } });
  const result = await Dict.define("negligible");
  assert.equal(result.definition, NEGLIGIBLE);
  assert.equal(result.source, "ウィズダム英和辞典");
});

test("辞書に無い語は null を返す(呼び出し側が definition の有無を見なくて済む)", async () => {
  const { Dict } = loadDict({ table: {} });
  assert.equal(await Dict.define("autoinducer"), null);
});

test("同じ語を二度引いてもブリッジは一度しか呼ばれない", async () => {
  const { Dict, calls } = loadDict({ table: { negligible: NEGLIGIBLE } });
  await Dict.define("negligible");
  await Dict.define("negligible");
  assert.equal(calls.length, 1);
});

test("見つからなかった結果も覚えていて、二度目は問い合わせない", async () => {
  const { Dict, calls } = loadDict({ table: {} });
  await Dict.define("autoinducer");
  await Dict.define("autoinducer");
  assert.equal(calls.length, 1);
});

test("大文字と小文字は同じ語として扱う", async () => {
  const { Dict, calls } = loadDict({ table: { negligible: NEGLIGIBLE } });
  const upper = await Dict.define("Negligible");
  assert.equal(upper.definition, NEGLIGIBLE);
  assert.deepEqual(calls, [{ action: "define", word: "negligible" }]);
});

// 核心: 辞書が落ちても本文の表示は続く。
test("ブリッジが失敗しても投げずに null を返す", async () => {
  const { Dict } = loadDict({ rejects: true });
  assert.equal(await Dict.define("negligible"), null);
});

test("空文字はブリッジに問い合わせない", async () => {
  const { Dict, calls } = loadDict({ table: {} });
  assert.equal(await Dict.define(""), null);
  assert.equal(await Dict.define("   "), null);
  assert.equal(calls.length, 0);
});

test("公開版の Dict は常に null を返す(辞書はアプリ版だけの機能)", async () => {
  const Dict = loadWebDict();
  assert.equal(await Dict.define("negligible"), null);
});

test("公開版とアプリ版は同じ口を持つ", () => {
  const web = loadWebDict();
  const { Dict: native } = loadDict();
  assert.deepEqual(Object.keys(web).sort(), Object.keys(native).sort());
});
