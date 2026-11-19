---
description: Generate one TOEFL listening item and add it to docs/data/listening/
---

# /new-listening — add a new listening item

Carry out the steps below in order. The authoritative schema is the "Question data"
section of `docs/superpowers/specs/2026-08-19-listening-design.md`.

**Everything in the data file is written in English**, including speaker roles and
explanations. Do not use any other language.

## 1. Decide the next ID
- Take the next sequential ID (`listening_NNN`, zero-padded to 3 digits) from the existing
  files in `docs/data/listening/`.
- Check every existing `type`, `topic` and `title` in `docs/data/listening/index.json`.

## 2. Decide the type, topic and speakers
- `type`: if the argument says `lecture` or `conversation`, follow it. Otherwise look at
  the existing files in `docs/data/listening/` and pick the type with fewer items.
- `topic`: exactly one of `Science` / `Society` / `History` / `Arts` / `Environment`,
  choosing one that the existing items use least. The theme must not overlap with an
  existing one. Avoid overlap not only within listening but also with the themes in
  `docs/data/reading/index.json` (reading).
- `speakers`: 1 for a lecture, 2 for a conversation.
  `role` is shown in the list and at the start of each line in review mode, so write it in
  English with a capital first letter (`Professor`, `Student`, `Office staff`,
  `Gallery staff` and so on).
  `id` is a short lowercase English word (`professor`, `student`, `advisor`).

### Use only the 3 voices confirmed in this environment for `voice`

| voice | locale |
|---|---|
| `Samantha` | en_US |
| `Daniel` | en_GB |
| `Karen` | en_AU |

`say -v '?'` lists other English voices too, but they are either novelty voices such as
`Bad News`, `Bubbles` and `Zarvox`, or voices such as `Albert` and `Fred` that do not suit
study material read aloud. **Do not use any voice other than these 3.**

Do not confuse what the pre-check protects with what it does not:

- A name that is **not** in `say -v '?'` always fails at playback.
  `SpeechSynthesizer` compares the voice with the list of voices before calling `say`, and
  raises an error on the spot if the voice is missing
  (`say` exits with code 0 and silently substitutes the default voice when given a voice
  that does not exist, so without the pre-check the learner would study with a different
  voice and never notice)
- A name that **is** in `say -v '?'` but is not one of the 3 above (`Albert`, `Fred` and
  so on) **passes the pre-check and plays as it is.** `validate_listening.py` does not
  check that a `voice` exists either. In other words, nothing catches a wrong choice here
  by machine: validation and the build both pass, and the result is study material with
  audio that is hard to follow

> Current state: the pre-check described above belonged to the former macOS app. In the
> Rust app the `speech` handler is a placeholder that always returns an error
> (`app-shell/src/ipc/placeholder.rs`), so no audio is generated yet. Keep to the 3 voices
> anyway, so that the data is ready when speech synthesis is implemented.

In a conversation, **give the 2 speakers different voices**. With the same voice the
speakers cannot be told apart in the audio.

## 3. Write the script
`script` is an array of `{ "speaker": ..., "text": ... }`. Split it into lines by unit of
meaning, 1-3 sentences per line.
Consecutive lines by the same speaker are folded into one utterance when the audio is
generated, so how finely the lines are split does not affect audio quality.

**Word count** (`word_count` must match this actual count):

| type | words |
|---|---|
| `lecture` | 500-700 |
| `conversation` | 300-450 |

**Always write it as spoken language.** As a rule the learner can listen only once. This
is a different thing from prose that can be read again.

- **Use contractions.** This was actually missed once: `listening_001` had 676 words and 0
  contractions. Write `Let's start with decay`, not `Let us start with decay`;
  `I'm not persuaded`, not `I am not persuaded`; `And they don't.`, not `And they do not.`
  Tidying only the discourse markers (`Okay, so`, `Now,`, `Right,`) does not make it sound
  like a lecture if the wording itself stays stiff.
  **A conversation should have more contractions than any other register.** If `I'll`,
  `you've`, `that's`, `doesn't` and `we're` are not mixed in naturally, rewrite it.
- Keep each sentence short. Long subordinate clauses and parentheticals cannot be followed
  by ear alone.
- Put the subject first. Do not use inversion or stack up post-modifiers.
- In a conversation, add back-channel responses, rephrasing and interruptions so that it
  sounds like talk. But do not make it a mere exchange of `Uh-huh.`; both sides must keep
  adding information.

**Do not use notation that TTS misreads:**

| Do not use | Instead |
|---|---|
| Dashes (`—`, `--`) | End the sentence or use a comma |
| Parentheses | Work the content into the sentence |
| `e.g.` `i.e.` `etc.` | `for example` `that is` `and so on` |
| Numbers with digit separators (`1,500`) | Spell them out as words: `fifteen hundred` |
| Symbols and bullet lists | Do not use them |

## 4. Write 6 questions
`questions` has the same shape as in a reading passage (without `target_word`).

- Exactly 6 questions. Mix **at least 3** of the `type` values `Gist-Content` /
  `Gist-Purpose` / `Detail` / `Function` / `Attitude` / `Inference`.
  **The first question is `Gist-Content`**
  (this follows the order of the real test: ask about the whole first, details later).
- Spread `correct` across A-D (the same letter at most 3 times).
- Make all 4 `choices` about the same length. Avoid a correct answer that is the only long
  one or the only specific one.
- **A wrong answer must be clearly wrong when checked against the script.** Do not write a
  choice that is merely "not as good as the correct one". Use a subject the script never
  raises, the opposite of what the script says, or something a different speaker said.
- `explanation` is written in English. **Quote the relevant part of the script** to show
  the evidence for the correct answer, then explain, again against the script, why each of
  the other 3 is wrong.
- **Quotation rule: double quotes ("...") are used only for verbatim quotes of the script.**
  Paraphrases and single terms go in single quotes ('...').
  `validate_listening.py` checks every double-quoted text (straight or curly) and reports
  an error if it does not appear in the script. A quote may run across consecutive script
  lines, and a period added at the end of a quoted fragment is accepted; any other
  difference in wording or punctuation is an error. Single-quoted text is not checked.

When you have finished, **check all 6 questions yourself.** For each question you must be
able to quote 1 script line that is the evidence for the correct answer, and say which
part of the script each of the other 3 contradicts. This is the most costly kind of defect.

## 5. Fill in the remaining fields
`word_count` is the actual word count, and `added` is today's date (YYYY-MM-DD).

## 6. Validate and update the manifest
```
python3 scripts/validate_listening.py docs/data/listening/listening_NNN.json
python3 scripts/update_index.py listening
```
Fix every `ERROR`, of course. **Do not leave a word-count `WARNING` either.** Lengthen or
shorten the script until it fits the range.

## 7. Check the audio
Build the app, start it, and actually play the item.
```
sh app-shell/build.sh && TOEFL_REPO_ROOT="$(pwd)" app-shell/target/release/app_shell
```
What to check:
- The audio is generated and plays to the end
- In a conversation, **the voice changes partway through** (if it does not, suspect the
  voice assignment)
- In review mode, `role` appears at the start of each line, and clicking a word in the
  script opens the word panel with a link to Cambridge Dictionary

> Current state: because the `speech` handler is a placeholder, the first 2 checks cannot
> pass yet. Until speech synthesis is implemented, check that the item appears in the
> list, and tell the user that the audio was not verified.

Generated audio is placed in a cache and does not enter the repository.
Also check that `docs/data/listening/audio` does not appear in `git status`.

## 8. Confirm and commit
- Show the user: title, type, topic, word count, speakers and voices, breakdown of
  question types, and distribution of correct answers.
- After the user approves:
  `git add docs/data/listening && git commit -m "content: add listening_NNN <title>"`
  If a remote is configured, also run `git push`.

Generation happens inside this session, so no API charges are incurred.
