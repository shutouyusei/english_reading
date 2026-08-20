---
description: TOEFLリスニングの問題を1本生成して docs/data/listening/ に追加する
---

# /new-listening — 新しいリスニング問題を追加する

以下の手順を順番に実行する。スキーマの正は
`docs/superpowers/specs/2026-08-19-listening-design.md` の「問題データ」節。

## 1. 次のIDを決める
- `docs/data/listening/` の既存ファイルから連番の次のID(`listening_NNN`、3桁ゼロ埋め)を決める。
- `docs/data/listening/index.json` で既存の `type` `topic` `title` を全て確認する。

## 2. 種別・トピック・話者を決める
- `type`: 引数で `lecture` か `conversation` が指定されていればそれに従い、
  無ければ `docs/data/listening/` の既存ファイルを見て少ない方を選ぶ。
- `topic`: 科学/社会/歴史/芸術/環境 のうち既存で使用が少ないもの。テーマは既存と重複させない。
  リスニング内だけでなく `docs/data/index.json`(読解)のテーマとも重ねない。
- `speakers`: lecture は1人、conversation は2人。
  `role` は一覧と復習モードの行頭に出るので日本語で書く(`教授` `学生` `事務員` など)。
  `id` は英小文字の短い語(`professor` `student` `advisor`)。

### `voice` はこの環境で確認済みの3つだけを使う

| voice | ロケール |
|---|---|
| `Samantha` | en_US |
| `Daniel` | en_GB |
| `Karen` | en_AU |

`say -v '?'` には他にも英語の声が並ぶが、`Bad News` `Bubbles` `Zarvox` のようなネタ声か、
教材の読み上げに向かない声である。**この3つ以外を書くと再生時に必ず失敗する。**
`SpeechSynthesizer` は `say` を呼ぶ前に声の一覧と突き合わせ、無い声ならその場でエラーにする
(`say` は存在しない声を渡されても終了コード0で既定の声に黙って差し替えるため、
事前確認しないと「気づかないまま違う声で学習する」ことになる)。
`validate_listening.py` は `voice` の実在を確かめない。ここで間違えると**検証は通り、再生した瞬間に落ちる**。

conversation では**2人に別々の声を割り当てる**。同じ声にすると音声上で話者が区別できない。

## 3. 台本を書く
`script` は `{ "speaker": ..., "text": ... }` の配列。意味のまとまりで行に分け、1行1〜3文にする。
連続する同じ話者の行は音声生成時に1つの発話へ畳まれるので、行の細かさは音声の質に影響しない。

**語数**(`word_count` はこの実語数と一致させる):

| type | 語数 |
|---|---|
| `lecture` | 500〜700 |
| `conversation` | 300〜450 |

**必ず話し言葉として書く。** 学習者は原則1回しか聴けない。読み返せる文章とは別物である。

- **短縮形を使う。** これは実際に外した点である。`listening_001` は676語で短縮形が0個だった。
  `Let us start with decay` ではなく `Let's start with decay`、`I am not persuaded` ではなく
  `I'm not persuaded`、`And they do not.` ではなく `And they don't.`。
  談話標識(`Okay, so` `Now,` `Right,`)だけ整えても、語のレベルが硬いままだと講義に聞こえない。
  **conversation は全文体の中で最も短縮形が多くなるはず**で、`I'll` `you've` `that's` `doesn't`
  `we're` が自然に混ざっていなければ書き直す。
- 1文を短くする。長い従属節や挿入句は、音だけでは係り受けを追えない。
- 主語を先に出す。倒置や後置修飾の重ね掛けをしない。
- conversation は相槌・言い直し・割り込みを入れて会話らしくする。ただし単なる `Uh-huh.` の
  往復にはせず、双方が情報を足していくこと。

**TTS が読み違える表記を使わない:**

| 使わない | 代わりに |
|---|---|
| ダッシュ(`—` `--`) | 文を切るか読点にする |
| 括弧 | 文に開く |
| `e.g.` `i.e.` `etc.` | `for example` `that is` `and so on` |
| 桁区切りの数字(`1,500`) | `fifteen hundred` と語で書く |
| 記号・箇条書き | 使わない |

## 4. 設問を6問書く
`questions` の形は読解パッセージと同一(`target_word` は持たない)。

- ちょうど6問。`type` は `Gist-Content` / `Gist-Purpose` / `Detail` / `Function` / `Attitude` /
  `Inference` から**3種類以上**を混ぜる。**先頭は `Gist-Content`** にする
  (本番の出題順に合わせる。全体像を先に問い、細部は後に置く)。
- `correct` はA〜Dに分散させる(同一文字は最大3回)。
- `choices` は4つとも同じくらいの長さにする。正解だけ長い、正解だけ具体的、は避ける。
- **誤答は台本に照らして明確に誤りであること。** 「正解ほど良くない」だけの選択肢を作らない。
  台本に出ない話題、台本と逆のこと、台本では別の話者が言ったこと、を使う。
- `explanation` は日本語。**台本の該当箇所を引用して**正解の根拠を示し、
  続けて他の3つが誤りである理由も台本に照らして書く。

書き終えたら**6問すべてについて自分で検算する。** 各問で、正解の根拠になる台本の行を1つ引用でき、
かつ残り3つが台本のどこと矛盾するかを言えること。ここが最も高くつく欠陥である。

## 5. 残りのフィールドを埋める
`word_count` は実語数、`added` は今日の日付(YYYY-MM-DD)。

## 6. 検証してマニフェストを更新する
```
python3 scripts/validate_listening.py docs/data/listening/listening_NNN.json
python3 scripts/update_listening_index.py
```
`ERROR` は当然直す。**語数の `WARNING` も残さない。** 台本を伸縮させて範囲に収める。

## 7. 音声を確認する
アプリをビルドして起動し、実際に再生する。
```
sh app/build.sh && open app/build/TOEFLReading.app
```
確かめること:
- 音声が生成され、最後まで再生できる
- conversation では**途中で声が切り替わる**(切り替わらなければ声の割り当てを疑う)
- 復習モードで各行の頭に `role` が出て、台本の単語をクリックすると辞書が引ける

生成した音声はキャッシュに置かれ、リポジトリには入らない。
`git status` に `docs/data/listening/audio` が出ないことも確認する。

## 8. 確認とコミット
- タイトル・種別・トピック・語数・話者と声・設問タイプ内訳・正解の分布をユーザーに表示する。
- ユーザーの承認後:
  `git add docs/data/listening && git commit -m "content: add listening_NNN <title>"`
  リモートが設定済みなら `git push` も行う。

生成はこのセッション内で行うので API 課金は発生しない。
