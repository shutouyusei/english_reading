---
description: Generate a new TOEFL reading passage, its quiz and its vocabulary notes, and update the site data
---

# /new-passage — add a new reading passage

Carry out the steps below in order. The authoritative schema is section 5 of
`docs/superpowers/specs/2026-08-04-toefl-vocab-app-design.md`.

**Everything in the data file is written in English**, including explanations and
vocabulary notes. Do not use any other language.

## 1. Decide the next ID
- Take the next sequential ID (`passage_NNN`, zero-padded to 3 digits) from the existing
  files in `docs/data/reading/`.
- Check the topics and themes of the existing passages in `docs/data/reading/index.json`.

## 2. Generate the passage and the quiz
Build the JSON under the conditions below and save it as `docs/data/reading/passage_NNN.json`:
- `body`: academic English of 450-500 words (TOEFL iBT reading difficulty, 3-5 paragraphs,
  paragraphs separated by `\n\n`)
- `topic`: exactly one of `Science` / `Society` / `History` / `Arts` / `Environment`,
  choosing one that the existing passages use least. The theme must not overlap with an
  existing one
- `questions`: 5 questions. Mix at least 3 of the `type` values Factual / Inference /
  Vocabulary / Reference / Rhetorical Purpose. A Vocabulary question sets `target_word` to
  a word that occurs in the body (every other type sets it to `null`). Spread `correct`
  across A-D (the same letter at most 3 times).
  `explanation` is written in English and gives the evidence by quoting the passage
  **verbatim in double quotes** ("..."). Use single quotes ('...') for paraphrases and for
  single terms, so that double quotes always mean the exact words of the passage
- `word_count`: the actual word count; `added`: today's date (YYYY-MM-DD); `vocab`: `{}` at
  this stage

## 3. Extract the hard vocabulary
`python3 scripts/extract_hard_words.py docs/data/reading/passage_NNN.json`
Remove obvious proper nouns (names of people and places) from the printed list. The rest
are the words to explain.

## 4. Generate the vocabulary notes
For each word from step 3, write the following and merge it into `vocab` in the JSON (the
notes are in English):
- `etymology`: the origin of the word, broken into prefix, root and suffix
- `definition`: a concise definition
- `usage_in_passage`: a quotation from the passage and an explanation of the logical role
  the word plays there
- `related_terms`: 3-4 related words (English)
- `context_sentence`: the one sentence of the passage that contains the word, copied
  exactly as it is

## 5. Validate and update the index
`python3 scripts/validate_passage.py docs/data/reading/passage_NNN.json`
`python3 scripts/update_index.py reading`
If an error is reported, fix it and run again.

## 6. Confirm and commit
- Show the user a summary: title, topic, word count, breakdown of question types, and the
  number of vocabulary entries.
- After the user approves:
  `git add docs/data && git commit -m "content: add passage_NNN <title>"`
  If a remote is configured, also run `git push`.
