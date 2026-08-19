# リスニング機能 設計書

日付: 2026-08-19
状態: ユーザーレビュー待ち
関連: `2026-08-11-local-app-shell-design.md`(ローカルアプリの土台)、`2026-08-11-writing-design.md`(ライティング機能)

## 目的

TOEFL形式のリスニング(Conversation / Lecture)を聴いて設問に答え、復習できるようにする。
ローカルアプリ専用機能とする。

`2026-08-11-local-app-shell-design.md` でローカルアプリを作った動機がこれであり、
同スペックの「含まないもの」に置かれていた区切りを、ここで扱う。

本機能が入ると `2026-08-11-writing-design.md` の「やらないこと」にある
Integrated Writing(読む+聴く+書く) の前提が揃う。ただし Integrated Writing 自体は別スペックとする。

## 実測に基づく前提

macOS 内蔵の `say` を実測した結果(2026-08-19、本開発機)。

| 項目 | 実測値 |
|---|---|
| 生成速度 | 96語 → 29.4秒の音声を 0.64秒で生成(実時間の約37倍速) |
| 4分の講義に換算 | 約5秒 |
| AAC圧縮(`--data-format=aac`) | 29.4秒で 150KB(32kbps mono)。4分で約1.2MB |
| 非圧縮(既定) | 29.4秒で 1.2MB。**必ず AAC を指定する** |
| 複数話者 | Samantha(en_US) / Daniel(en_GB) / Karen(en_AU) で生成成功 |

この2点が設計を決めている。

1. **生成が速い**ので、事前生成の準備画面は要らない。初回再生時にその場で作れる。
2. **AAC なら十分小さい**が、リポジトリに入れると本数に比例して肥大する。
   台本だけをコミットし、音声はローカルキャッシュに置く。

また Premium / Enhanced(Siri品質)の音声は本開発機に未インストールであり、
既定の音声の自然さは本番のTOEFL音声に及ばない。
音質を上げたい場合はシステム設定から音声を追加し、台本の `voice` を差し替える。
**生成層を差し替えれば外部TTSにも移行できる形にしておく。**

## 全体構成

```
docs/data/listening/listening_NNN.json      台本＋設問(コミットする)
              │
              │ 初回再生時
              ▼
app/src/SpeechSynthesizer.swift             say を呼んで m4a を生成(複数話者なら結合)
              │
              ▼
~/Documents/TOEFLReading/audio/listening_NNN.m4a    キャッシュ(コミットしない)
              │
              ▼
audio://local/listening_NNN.m4a             <audio> が再生
```

### `audio://` スキームを足す理由

既存の `app://` は `PathResolver` がリポジトリ外への参照を拒否する。
「リポジトリ外を読めない」ことは `2026-08-11-local-app-shell-design.md` の検証項目であり、
テストもある。音声キャッシュは `~/Documents/` にあるためこの保証と両立しない。

スキームを分けることで `app://` の保証はそのまま維持され、既存テストも変更不要になる。
`audio://` は自身のルート(キャッシュディレクトリ)の外を拒否する。

## ファイル構成

新規:

```
docs/data/listening/index.json
docs/data/listening/listening_NNN.json
scripts/validate_listening.py
scripts/update_listening_index.py
app/src/SpeechSynthesizer.swift          say の呼び出しと結合
app/src/AudioSchemeHandler.swift         audio:// の配信
app/src/SpeechHandler.swift              JS からの生成要求を受ける窓口
app/ui/listening.html                    一覧
app/ui/listening-player.html             解答・復習
app/ui/js/speech.native.js               window.Speech
app/ui/js/listening.native.js            window.ListeningStore
app/ui/js/listening.js                   一覧と解答・復習のロジック
app/ui/js/script.js                      台本の描画
```

変更:

```
app/src/main.swift                       ハンドラ2本とスキーム1本の登録
app/src/LogHandlers.swift                StoreHandler にファイル名を注入可能にする
app/build.sh                             新規 Swift ファイルを追加
app/tests/run.sh                         新規テストを追加
app/ui/index.html                        リスニングへの導線
docs/js/vocab.js                         台本でも使えるよう引数を一般化する
```

リスニング固有のJSは `app/ui/js/` に置く。**UIを公開サイトに載せない**以上、
`docs/` へ置くと使われないコードを公開サイトに配信することになるためである。
単語クリックの処理だけは既存の `docs/js/vocab.js` を読み込んで共用する
(`app/ui/reader.html` が既に同じことをしている)。

## 問題データ

### `docs/data/listening/index.json`

`docs/data/index.json` と同じ形。`update_listening_index.py` が生成する。

```json
{
  "items": [
    { "id": "listening_001", "type": "lecture", "title": "...", "topic": "科学",
      "added": "2026-08-19", "word_count": 610 }
  ]
}
```

再生時間は保存しない。台本が変われば実時間も変わり、二重管理になるためである。
一覧には `word_count` から毎分150語で概算した目安を表示する。

### `docs/data/listening/listening_NNN.json`

```json
{
  "id": "listening_001",
  "type": "lecture",
  "title": "Coral Reefs and Repeated Stress",
  "topic": "科学",
  "added": "2026-08-19",
  "word_count": 610,
  "speakers": [
    { "id": "professor", "role": "教授", "voice": "Daniel" }
  ],
  "script": [
    { "speaker": "professor", "text": "Okay, so last time we were talking about how coral reefs respond to changes in water temperature." }
  ],
  "questions": [
    {
      "id": 1,
      "type": "Gist-Content",
      "question": "What is the lecture mainly about?",
      "choices": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct": "B",
      "explanation": "日本語の解説。台本の該当箇所を引用して根拠を示す。"
    }
  ]
}
```

Conversation の場合は `speakers` が2人になる。

```json
"speakers": [
  { "id": "student", "role": "学生",   "voice": "Samantha" },
  { "id": "advisor", "role": "事務員", "voice": "Daniel" }
]
```

`questions` の形は読解パッセージと同一である。したがって**採点UIと結果表示はそのまま流用できる**。
読解と違い `target_word` は持たない(語彙問題は音声では成立しにくいため)。

設問タイプは TOEFL リスニング準拠:
`Gist-Content` / `Gist-Purpose` / `Detail` / `Function` / `Attitude` / `Inference`

### 検証(`scripts/validate_listening.py`)

`validate_passage.py` `validate_writing.py` と同じ流儀。合格時は `OK: ...` を出して終了コード0、
違反は `ERROR: ...` を出して1。

| 規則 |
|---|
| `id` が `listening_NNN`(3桁ゼロ埋め)である |
| `type` が `conversation` または `lecture` である |
| `topic` が読解と同じトピック集合に含まれる |
| `speakers` は lecture なら1人、conversation なら2人 |
| `speakers[].voice` が空でない文字列である |
| `script` の各 `speaker` が `speakers[].id` のいずれかと一致する |
| `script` が空でなく、各 `text` が空でない |
| `word_count` が `script` の実語数と一致する(`validate_passage.py` と同じ語数の数え方) |
| 語数が lecture は500〜700、conversation は300〜450の範囲にある(範囲外は警告) |
| `questions` がちょうど6問である |
| 設問タイプが上記6種のいずれかで、3種類以上が混在する |
| `correct` が A〜D のいずれかで、同一文字が4回以上現れない |
| `choices` に A〜D が揃い、いずれも空でない |
| `explanation` が空でない |

`voice` が実在するかは検証しない。環境ごとにインストール状況が異なるためで、
実行時にフォールバックして対応する(後述)。

## 音声生成層

### `app/src/SpeechSynthesizer.swift`

```swift
final class SpeechSynthesizer {
    init(cacheDirectory: URL)
    func cachedURL(for id: String) -> URL?                      // 無ければ nil
    func synthesize(id: String, utterances: [Utterance]) throws -> URL
}

struct Utterance { let voice: String; let text: String }
```

- 発話が1つなら `say` を1回呼んで最終ファイルへ直接書く
- 発話が複数なら一時ディレクトリへ個別に生成し、AVFoundation(`AVMutableComposition` +
  `AVAssetExportSession`)で1本へ結合してからキャッシュへ移す
- `say` の呼び出しは必ず `--file-format=m4af --data-format=aac` を付ける
- 生成は一時ファイルへ書いてから最終パスへ移動する。途中で失敗した半端なファイルを
  キャッシュとして残さないため

結合を Swift に寄せるのは、発話ごとのファイルを JS で連続再生すると発話間が途切れるためである。
再生側から見れば常に1ファイルになり、JS が単純になる。

エラーは列挙型で表し、`ClaudeRunner` と同様に**すべてのケースに日本語の説明を持たせる**。

```swift
enum SpeechError: Error {
    case sayFailed(String)          // say が非ゼロ終了
    case mergeFailed(String)        // 結合に失敗
    case cacheUnwritable(String)    // キャッシュ先に書けない
}
```

### `app/src/AudioSchemeHandler.swift`

`ContentSchemeHandler` と同じ作りで、ルートだけがキャッシュディレクトリになる。

- `audio://local/<ファイル名>` を `<cacheDirectory>/<ファイル名>` へ解決する
- `..` を含む要求や、解決後のパスがルート外を指す要求は 404 で拒否する
- `Content-Type: audio/mp4` を返す
- `HTTPURLResponse` を返す(素の `URLResponse` を返すと fetch のステータスが0になる不具合が
  過去にあったため。`2026-08-11-local-app-shell-design.md` 参照)

### `app/src/SpeechHandler.swift`

JS からの生成要求を受ける窓口。既存の `store` / `essays` / `grader` / `dictionary` と同じ
`WKScriptMessageHandlerWithReply` の作法に従い、**`speech` という名前で登録する**。

保存側の `StoreHandler` は `listening` という名前で登録するため(後述)、名前は衝突しない。

| action | 引数 | 応答 |
|---|---|---|
| `prepare` | `id`, `utterances`(voice と text の配列) | `{ url }` |

キャッシュがあれば生成せずに URL を返す。無ければ生成してから返す。

### `window.Speech`(`app/ui/js/speech.native.js`)

```js
window.Speech = {
  async prepare(id, utterances)   // → { url } / 失敗時は例外
}
```

**名前に注意**: `window.Audio` はブラウザ標準の `Audio` コンストラクタであり、上書きしてはならない。
`window.speechSynthesis` も標準APIである。衝突を避けて `window.Speech` とする。

公開版のスタブ(`speech.web.js`)は作らない。リスニングのUIは公開サイトに載せないため、
`window.Speech` を呼ぶページがアプリ側にしか存在しないからである。
(辞書機能では公開版にも `reader.html` があるためスタブが必要だった。ここは事情が異なる。)

## 画面と状態遷移

### `app/ui/listening.html`(一覧)

`app/ui/index.html` および `app/ui/writing.html` と同型。
カードに タイトル / 種別(会話・講義) / トピック / 概算の長さ / 最新スコアのバッジを出す。

### `app/ui/listening-player.html`(解答・復習)

`reader.html` と同じく `?id=listening_NNN&mode=solve|study` で切り替える。

**解答モード**

```
準備中 ──(音声生成、通常5秒以内)──▶ 再生中 ──(音声終了)──▶ 設問 ──▶ 採点結果
                                                                      │
                                                              ▼(復習へ)
                                                                  解説モード
```

| 状態 | 内容 |
|---|---|
| 準備中 | 「音声を準備しています」と表示。キャッシュ済みなら一瞬で通過する |
| 再生中 | **再生は1回のみ。一時停止は可、シークは不可**(本番準拠)。台本は表示しない |
| 設問 | 音声終了後に開始。1問ずつ表示し、Back で戻れる(読解の解答モードと同じ) |
| 採点結果 | 正答数・所要時間・誤答一覧。「解説モードで復習する」ボタン |

音声の再生中に設問を出さないのは、本番のリスニングが同じ順序だからである。

**復習モード**

| ペイン | 内容 |
|---|---|
| 左 | 台本全文。話者名を行頭に出す。**単語をクリックすると右に解説が出る** |
| 右 | タブ2つ。「単語解説」と「問題の解説」 |

音声はこのモードでは自由に再生・一時停止できる。

台本には手書きの語彙解説を持たせないため、すべての単語が「未収録」の経路に入り、
**システム辞書(ウィズダム英和)が引かれる**。`feature/dictionary-lookup` で追加した機能が
そのまま活きる。

## 既存コードへの手入れ

今回の作業に必要な範囲だけを一般化する。無関係なリファクタリングはしない。

### `docs/js/vocab.js`

現在 `renderStudy(passage)` が `passage.body` と `passage.vocab` に直接依存している。
これを「テキスト」と「語彙辞書」を受け取る形にする。

- 読解は `renderStudy({ text: passage.body, vocab: passage.vocab })` 相当の呼び方になる
- リスニングは台本を連結したテキストと空の語彙辞書を渡す
- 公開版の挙動は変わらない(既存のJSテストで確認する)

台本は話者ごとに行が分かれるため、行の描画だけは `app/ui/js/script.js` に分ける。
単語のクリック処理と右ペインの描画は `vocab.js` を共用する。

### `app/src/LogHandlers.swift`

`StoreHandler` が保存先ファイル名を `attempts.jsonl` に固定している。
これを初期化時に注入できるようにし、2つ目のインスタンスを `listening` という名前で登録する。
ハンドラをもう1本書かずに済み、重複が増えない。

## 保存形式

`~/Documents/TOEFLReading/listening.jsonl`(追記専用、既存の `JSONLinesFile` を再利用)

```json
{ "listeningId": "listening_001", "score": 4, "total": 6, "elapsedSec": 312,
  "answers": ["B","A","D","C","A","B"], "finishedAt": "2026-08-19T10:00:00.000Z" }
```

読解の `attempts.jsonl` と同じ形。`store.native.js` と同型の `listening.native.js` が
`window.ListeningStore` を提供する(`init` / `attempts` / `latest` / `saveAttempt`)。

音声キャッシュは `~/Documents/TOEFLReading/audio/`。**上限や自動削除は設けない**。
1本あたり約1.2MB、100本でも約120MBに収まるためである。

## エラー処理

| 事象 | 挙動 |
|---|---|
| `say` が失敗した | 画面にエラー内容を出し、**台本だけで復習モードに入れる**。解答モードには入れない |
| 指定した声が環境に無い | `say` が既定の声で生成する。画面に「指定の音声が見つからないため既定の音声を使用」と出す |
| キャッシュが壊れて再生できない | ファイルを削除して1度だけ再生成する。それでも失敗したらエラー表示 |
| キャッシュ先に書けない | エラーを表示する。黙って無音にはしない |
| 台本JSONが読めない | 一覧へ戻る導線つきのエラーを表示(読解の `renderError` と同じ) |

音声が出ないことを黙って無視する経路は作らない。

## テスト

| 層 | 対象 |
|---|---|
| Swift 単体 | `SpeechSynthesizer`: 1発話の生成、複数発話の結合、失敗時に半端なファイルを残さない、エラーに日本語の説明がある |
| Swift 単体 | `AudioSchemeHandler`: 正常な要求を配信する、`..` を含む要求を拒否する、ルート外への解決を拒否する |
| Swift 結合 | `SpeechHandler` を実 WKWebView 越しに叩き、`prepare` が URL を返すことを確認(辞書機能と同じ手法) |
| Python | `validate_listening.py` の各規則。正常データと、規則ごとの違反データ |
| JS | `listening.native.js`(並べ替え・キャッシュ更新)、台本の描画 |
| JS | `vocab.js` の一般化後も**読解の既存テストが通る**こと |
| 実機通し | 一覧 → 解答(準備→再生→設問→採点) → 復習(台本表示・単語クリックで辞書) |

Swift のテストは音声を実際に生成するため、一時ディレクトリを使い、既存のキャッシュには触れない。
`say` が使えない環境では単体テストをスキップする(辞書のテストと同じ方針で、
スキップ判定は実装に尋ねず外形で行う)。

## 問題の生成(`/new-listening`)

`/new-passage` `/new-writing` と同じ形のコマンドを追加する。手順:

1. `docs/data/listening/` から次のIDを決める
2. 種別(conversation / lecture)とトピックを決め、既存と重複しないテーマを選ぶ
3. 台本と設問6問を生成して `listening_NNN.json` に保存する
4. `python3 scripts/validate_listening.py <file>` で検証する
5. `python3 scripts/update_listening_index.py` でマニフェストを更新する
6. サマリを表示し、承認後にコミットする

生成は Claude Code のセッション内で行うため API 課金は発生しない。

## やらないこと

- **公開サイト(GitHub Pages)へのリスニングUIの搭載。** 音声生成が macOS の `say` に依存するため。
  台本データは配信可能な場所に置くが、UIは載せない(ライティングと同じ判断)
- Integrated Writing(読む+聴く+書く)。本機能で前提は揃うが、別スペックで扱う
- メモ取りのUI。本番では許されるが、まず出題と復習を成立させる
- 台本の区間再生(行をクリックしてその範囲だけ聴き直す)。
  発話単位で生成する設計なので後から足せるが、今回は入れない
- 語彙解説の手書き。システム辞書で代替する
- 話速の調整
- 音声キャッシュの自動削除や容量上限
- 外部TTS(OpenAI等)への対応。生成層を差し替えれば移行できる形にはしておく

## 依存

復習モードの単語クリックは辞書機能(`SystemDictionary` / `DictionaryHandler` / `dict.native.js`)に依存する。
この依存は 2026-08-19 に解消済みで、辞書機能は main へマージされている(`5ec6d67`)。
