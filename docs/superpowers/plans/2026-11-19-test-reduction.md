# Test reduction plan

Date: 2026-11-19. Status: **done**.

Goal: fewer tests to maintain while adding the four modes. 306 tests before, 185 planned (121 cut).

Outcome: 161 tests (Python 37, JS 44, Rust core 57, Rust app-shell 23). The count is 24 below
the plan because the Japanese system-dictionary feature was removed in the same pass, which
deleted `dictformat.test.js` (20) and the rest of `dict.native.test.js` (4). Test titles below
are the Japanese ones in use when the list was written; the surviving tests now have English
titles.

## Rules

- **Keep** tests that guard real damage: path traversal, losing `.jsonl` rows, parsing
  `claude` grading output, HTTP range handling for audio, regressions of bugs already fixed.
- **Cut** tests that restate a constant or message, repeat one rule with a slightly
  different bad input, or check a default that no caller depends on.
- **Merge** where several tests assert one thing each about the same value.

## Summary

| Suite | File | Now | After |
|---|---|---|---|
| Python | `test_extract_hard_words.py` | 8 | 4 |
| Python | `test_update_index.py` | 3 | 3 |
| Python | `test_validate_listening.py` | 37 | 14 |
| Python | `test_validate_passage.py` | 7 | 7 |
| Python | `test_validate_writing.py` | 23 | 9 |
| JS | `anki_request.test.js` | 5 | 3 |
| JS | `dict.native.test.js` | 10 | 4 |
| JS | `dictformat.test.js` | 20 | 20 |
| JS | `escape.test.js` | 5 | 2 |
| JS | `essays.native.test.js` | 15 | 8 |
| JS | `listening_player_error_retry.test.js` | 2 | 2 |
| JS | `listening_player_source.test.js` | 7 | 3 |
| JS | `listening_player_utterances.test.js` | 4 | 3 |
| JS | `listening.native.test.js` | 9 | 4 |
| JS | `native-ipc-shim.test.js` | 6 | 5 |
| JS | `store.native.test.js` | 10 | 5 |
| JS | `store.web.test.js` | 6 | 4 |
| JS | `study_source.test.js` | 5 | 2 |
| JS | `textmatch.test.js` | 3 | 3 |
| Rust core | `anki_client.rs` | 5 | 4 |
| Rust core | `byte_range.rs` | 19 | 11 |
| Rust core | `claude_runner.rs` | 30 | 17 |
| Rust core | `content_scheme.rs` | 5 | 5 |
| Rust core | `grade.rs` | 4 | 2 |
| Rust core | `jsonlines_log.rs` | 9 | 6 |
| Rust core | `path_resolver.rs` | 12 | 12 |
| Rust app-shell | `content.rs` | 3 | 2 |
| Rust app-shell | `platform.rs` | 4 | 3 |
| Rust app-shell | `ipc/anki.rs` | 3 | 2 |
| Rust app-shell | `ipc/essays.rs` | 5 | 3 |
| Rust app-shell | `ipc/grader.rs` | 3 | 2 |
| Rust app-shell | `ipc/mod.rs` | 13 | 8 |
| Rust app-shell | `ipc/placeholder.rs` | 2 | 0 |
| Rust app-shell | `ipc/store.rs` | 4 | 3 |
| | **Total** | **306** | **185** |

## Tests to cut, by file

### Python

`test_extract_hard_words.py` (cut 4)
- `test_plain_word_returns_lowercase_self`
- `test_short_stems_are_not_produced`
- `test_dedup_keeps_first_occurrence_order`
- `test_words_shorter_than_four_letters_are_ignored`

`test_validate_listening.py` (cut 23)
- `test_invalid_id_shape_is_reported`
- `test_invalid_type_is_reported`
- `test_unknown_topic_is_reported`
- `test_empty_voice_is_reported`
- `test_empty_script_is_reported`
- `test_empty_line_text_is_reported`
- `test_unknown_question_type_is_reported`
- `test_too_few_distinct_types_is_reported`
- `test_missing_choice_key_is_reported`
- `test_empty_explanation_is_reported`
- `test_invalid_added_format_is_reported`
- `test_empty_title_is_reported`
- `test_duplicate_speaker_id_is_reported`
- `test_conversation_with_same_voice_for_both_speakers_is_reported`
- `test_lecture_single_speaker_voice_is_not_checked_for_reuse`
- `test_non_integer_word_count_is_reported`
- `test_bool_word_count_is_reported`
- `test_same_correct_letter_three_times_is_allowed`
- `test_japanese_only_quotation_is_not_checked`
- `test_double_bracket_quotation_is_checked_too`
- `test_period_added_to_a_quoted_fragment_is_allowed`
- `test_quote_check_reports_the_offending_question`
- `test_malformed_script_line_does_not_crash_the_quote_check`

`test_validate_writing.py` (cut 14)
- `test_email_with_empty_situation_string_fails`
- `test_email_with_situation_not_string_fails`
- `test_email_with_empty_recipient_string_fails`
- `test_email_with_recipient_not_string_fails`
- `test_email_with_must_include_not_list_fails`
- `test_email_with_must_include_empty_string_entry_fails`
- `test_discussion_without_professor_text_fails`
- `test_discussion_with_student_post_missing_text_fails`
- `test_unknown_type_fails`
- `test_zero_target_minutes_fails`
- `test_bad_date_fails`
- `test_empty_title_fails`
- `test_target_minutes_as_bool_fails`
- `test_target_minutes_negative_fails`

### JS

`anki_request.test.js` (cut 2)
- "fetch 経路でも Anki が返した error を throw する"
- "params を省略してもブリッジには空オブジェクトが渡る"

`dict.native.test.js` (cut 6)
- "同じ語を二度引いてもブリッジは一度しか呼ばれない"
- "見つからなかった結果も覚えていて、二度目は問い合わせない"
- "大文字と小文字は同じ語として扱う"
- "空文字はブリッジに問い合わせない"
- "公開版の Dict は常に null を返す(辞書はアプリ版だけの機能)"
- "公開版とアプリ版は同じ口を持つ"

`dictformat.test.js` (cut 0) — left alone. The dictionary handler is a placeholder in the
Rust app, so this code is unreachable today; whether to delete the dictionary feature or
bring it back is a feature decision, not a test-count decision.

`escape.test.js` (cut 3)
- "escapeHtml neutralises a script tag"
- "escapeHtml leaves ordinary text untouched"
- "escapeHtml escapes every occurrence, not just the first"

`essays.native.test.js` (cut 7)
- "init は loadAll を一度だけ呼ぶ"
- "記録が無ければ空配列と null を返す"
- "再採点では gradedAt が新しい方を採る(古い採点が先に来ても)"
- "採点行が先に現れても突き合わせられる"
- "latest は最新のエッセイを返す"
- "loadAll が null を返しても落ちない"
- "init を二度呼んでも重複しない"

`listening_player_source.test.js` (cut 4)
- "vocab は空オブジェクトになる(手書きの語彙解説を持たない)"
- "lines の件数は script の件数と一致する"
- "latestResult は ListeningStore.latest(id) の返り値になる"
- "speakers に無い話者は id がそのまま speaker になる(現状の記録。実データには到達しない)"

`listening_player_utterances.test.js` (cut 1)
- "話者に対応する voice が無ければ空文字になる"

`listening.native.test.js` (cut 5)
- "init は loadAll を一度だけ呼ぶ"
- "履歴が無ければ空配列と null を返す"
- "ファイルが新しい順に並んでいても latest は変わらない"
- "loadAll が null を返しても落ちない"
- "init を二度呼んでも履歴が重複しない"

`native-ipc-shim.test.js` (cut 1)
- "異なるハンドラ名は個別のリクエストとして送られる"

`store.native.test.js` (cut 5)
- "init は loadAll を一度だけ呼ぶ"
- "履歴が無ければ空配列と null を返す"
- "ファイルが新しい順に並んでいても latest は変わらない"
- "loadAll が null を返しても落ちない"
- "init を二度呼んでも履歴が重複しない"

`store.web.test.js` (cut 2)
- "保存前は空配列と null を返す"
- "パッセージごとに独立している"

`study_source.test.js` (cut 3)
- "読解の行には話者が無い"
- "id・title・語彙・設問がそのまま移る"
- "採点結果と遷移先が渡したものになる"

### Rust core

`anki_client.rs` (cut 1)
- `every_error_has_a_japanese_description`

`byte_range.rs` (19 → 11)
- Merge into one `malformed_headers_are_whole`: `empty_string_is_whole`,
  `end_before_start_is_whole`, `non_bytes_unit_is_whole`, `non_numeric_is_whole`,
  `missing_dash_is_whole`, `multiple_ranges_are_whole`
- Cut: `ten_bytes_in_the_middle`, `tolerates_whitespace`, `real_world_tail_request`

`claude_runner.rs` (30 → 17)
- Merge into one `arguments_isolate_claude_and_pass_the_prompt`: the six `arguments_*` tests
- Cut: `none_found_is_none`, `empty_system_part_is_none`, `empty_user_part_is_none`,
  `allows_values_containing_newlines`, `keeps_brace_like_text_inside_a_substituted_value`,
  `is_executable_file_false_for_missing_path`, `is_executable_file_false_for_a_directory`,
  `every_error_has_a_non_empty_japanese_message`

`grade.rs` (cut 2)
- `empty_discussion_is_empty_string`
- `formats_professor_post_only`

`jsonlines_log.rs` (cut 3)
- `ignores_blank_lines`
- `empty_data_returns_empty_vec`
- `reads_mixed_kind_lines`

### Rust app-shell

`content.rs` (cut 1)
- `existing_file_returns_200_with_body_and_content_type` (covered in `core/src/content_scheme.rs`)

`platform.rs` (cut 1)
- `default_data_dir_is_under_home`

`ipc/anki.rs` (cut 1)
- `unknown_action_is_rejected`

`ipc/essays.rs` (cut 2)
- `load_all_returns_mixed_rows`
- `unknown_action_is_rejected`

`ipc/grader.rs` (cut 1)
- `unknown_action_is_rejected`

`ipc/mod.rs` (cut 5)
- `non_object_json_is_rejected`
- `missing_handler_is_rejected`
- `formats_success_with_no_result`
- `dispatches_store_loadall_to_empty_array`
- `dispatches_dictionary_to_placeholder_error`

`ipc/placeholder.rs` (cut 2)
- `dictionary_always_errors`
- `speech_always_errors`

`ipc/store.rs` (cut 1)
- `load_all_on_empty_log_returns_empty_array`

## Untouched

`test_update_index.py`, `test_validate_passage.py`, `dictformat.test.js`,
`listening_player_error_retry.test.js`, `textmatch.test.js`, `content_scheme.rs`,
`path_resolver.rs`.
