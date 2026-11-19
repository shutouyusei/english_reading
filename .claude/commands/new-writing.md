---
description: Generate one TOEFL writing prompt and add it to docs/data/writing/
---

Create a new writing prompt.

1. Decide the format. If the argument says `email` or `discussion`, follow it. Otherwise
   look at the existing files in `docs/data/writing/` and pick the format with fewer prompts.
2. Make sure the subject does not overlap with an existing prompt.
   Read every `title` in `docs/data/writing/index.json` before deciding.
3. Decide the next number (`writing_002` comes after `writing_001`).
4. Write `docs/data/writing/writing_NNN.json`. Follow the schema in the "Question data"
   section of `docs/superpowers/specs/2026-08-11-writing-design.md`.
   - `email`: `situation` and `recipient` are required non-empty strings, and `must_include`
     is a non-empty list of non-empty strings. `discussion` is null
   - `discussion`: `situation`, `recipient` and `must_include` are null, and
     `discussion.student_posts` has exactly 2 entries
   - **Write everything in English.** Names of people, places and companies are English
     too. Do not use any other language
   - `target_minutes` is 7 for email and 10 for discussion

   **Length and shape** (use `writing_001` and `writing_002` as models):

   - Keep the `situation` of an `email` to **40-60 words in 3-4 sentences**. Describe just
     one concrete event that could happen in everyday life (for example: the bill for a
     rental car includes insurance that you declined). Do not pile on background
   - `must_include` has **3 items**. Each is a short imperative that starts with a verb
     (`explain what happened…` / `state what you would like…` / `ask when…`).
     The items are embedded in the grading prompt as they are, so word them so that they
     read as grading criteria
   - A `discussion`, by contrast, should give the student something substantial to read.
     `professor_post` is **150-200 words**, covers a concrete example and both of two
     opposing positions, and ends with a question.
     Each of the `student_posts` is **120-150 words**, and one of them refers to the other
     so that they engage with each other. Each must be an independent argument, not a
     short reply of agreement
5. Validate: `python3 scripts/validate_writing.py docs/data/writing/writing_NNN.json`
   If an error is reported, fix it before moving on.
6. Update the index: `python3 scripts/update_index.py writing`
7. Confirm and commit
- Show the user a summary: title, format, situation and required points.
- After the user approves:
  `git add docs/data/writing/ && git commit -m "content: add writing_NNN <title>"`
  If a remote is configured, also run `git push`.

Generation happens inside this session, so no API charges are incurred.
