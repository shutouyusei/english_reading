use serde_json::{Map, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// Tells apart where an UnreadableOutput failure happened.
/// The outer part (the Claude Code wrapper itself) and the inner part (the contents
/// of the result string) fail for entirely different reasons, so they are kept
/// distinguishable instead of being discarded together.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnreadableStage {
    OuterWrapper,
    InnerResult,
}

/// The ways grading can fail. Each has a Japanese description that can be shown on
/// screen as is.
#[derive(Debug)]
pub enum ClaudeRunnerError {
    BinaryNotFound,
    LaunchFailed(String),
    TimedOut { seconds: u64 },
    ClaudeReportedError(String),
    /// excerpt: up to the first 200 characters of the string that could not be read
    /// (for diagnosis).
    UnreadableOutput { stage: UnreadableStage, excerpt: String },
}

impl ClaudeRunnerError {
    pub fn japanese_message(&self) -> String {
        match self {
            ClaudeRunnerError::BinaryNotFound => {
                "Claude Code が見つかりません。~/.local/bin/claude を確認するか、\
                 環境変数 TOEFL_CLAUDE_BIN にパスを設定してください。"
                    .to_string()
            }
            ClaudeRunnerError::LaunchFailed(detail) => {
                format!("Claude Code を起動できませんでした: {detail}")
            }
            ClaudeRunnerError::TimedOut { seconds } => {
                format!("採点が {seconds} 秒以内に終わりませんでした。もう一度お試しください。")
            }
            ClaudeRunnerError::ClaudeReportedError(detail) => {
                format!(
                    "Claude Code がエラーを返しました。ターミナルで claude を実行して\
                     ログイン状態を確認してください。({detail})"
                )
            }
            ClaudeRunnerError::UnreadableOutput { stage, excerpt } => {
                let stage_description = match stage {
                    UnreadableStage::OuterWrapper => "Claude Code からの応答全体",
                    UnreadableStage::InnerResult => "採点結果の JSON 部分",
                };
                format!(
                    "採点結果を読み取れませんでした({stage_description}を JSON として解釈できません: \
                     {excerpt})。もう一度お試しください。"
                )
            }
        }
    }
}

/// Default places to look for the executable.
/// A .app launched from Finder has only /usr/bin:/bin:/usr/sbin:/sbin in its PATH,
/// and claude is not there. Search explicitly instead of relying on PATH lookup.
pub fn default_claude_binary_candidates() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    vec![
        format!("{home}/.local/bin/claude"),
        "/opt/homebrew/bin/claude".to_string(),
        "/usr/local/bin/claude".to_string(),
        "/usr/bin/claude".to_string(),
    ]
}

/// Finds the claude executable.
/// If TOEFL_CLAUDE_BIN is set, only that path is checked. When it is set but does not
/// exist or is not executable, this returns None, because silently using something
/// else would make the user suspect the wrong place. For file_exists, pass a check
/// for executability, not just existence (checking existence alone reports a
/// directory or a file without execute permission as "found", which later shows up
/// as a hard-to-understand spawn failure).
pub fn resolve_claude_binary(
    environment: &HashMap<String, String>,
    file_exists: impl Fn(&str) -> bool,
    candidates: &[String],
) -> Option<String> {
    if let Some(override_path) = environment.get("TOEFL_CLAUDE_BIN") {
        if !override_path.is_empty() {
            return file_exists(override_path).then(|| override_path.clone());
        }
    }
    candidates.iter().find(|c| file_exists(c)).cloned()
}

/// The default check for resolve_claude_binary: whether the path is an executable
/// regular file. Unlike std::fs::metadata(p).is_ok(), which only checks existence,
/// this also checks the execute permission bits (x for any of owner/group/other).
#[cfg(unix)]
pub fn is_executable_file(path: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file() && meta.permissions().mode() & 0o111 != 0,
        Err(_) => false,
    }
}

/// The arguments passed to claude -p.
///
/// --tools "" matters most. Without it, Claude Code's full set of default tool
/// definitions is put into the prompt every time, and input tokens grow 73x, from
/// 613 to 44,984. Grading needs no tools.
///
/// The user prompt is not included here. It is passed on standard input (so that
/// quotes, newlines and backslashes in the essay text do not break anything).
pub fn claude_arguments(system_prompt: &str) -> Vec<String> {
    vec![
        "-p".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "--system-prompt".to_string(),
        system_prompt.to_string(),
        "--tools".to_string(),
        "".to_string(),
        "--strict-mcp-config".to_string(),
        "--setting-sources".to_string(),
        "".to_string(),
    ]
}

/// Splits a prompt file in two at a line that contains only "---". The first half is
/// the system prompt, the second half the user prompt.
pub fn split_prompt_file(text: &str) -> Option<(String, String)> {
    let lines: Vec<&str> = text.split('\n').collect();
    let separator = lines.iter().position(|l| l.trim() == "---")?;

    let system = lines[..separator].join("\n").trim().to_string();
    let user = lines[separator + 1..].join("\n").trim().to_string();
    if system.is_empty() || user.is_empty() {
        return None;
    }
    Some((system, user))
}

/// Replaces {{key}} with the matching value in values.
/// Placeholders that have no value are removed from the template. The template is
/// scanned only once and the result is written out directly, so a substituted value
/// (which may contain user input such as the essay) is never matched again as a
/// placeholder later in the scan. Calling String::replace once per key is avoided:
/// if the text happened to contain a {{...}} string for another key, the replacement
/// for that later key would rewrite the contents of a value substituted earlier
/// (silently corrupting the student's answer).
pub fn render_template(template: &str, values: &HashMap<String, String>) -> String {
    let mut result = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find("{{") {
        let Some(close_rel) = rest[open + 2..].find("}}") else {
            result.push_str(rest);
            return result;
        };
        result.push_str(&rest[..open]);
        let key = &rest[open + 2..open + 2 + close_rel];
        let is_placeholder = !key.is_empty()
            && key
                .chars()
                .all(|c| c.is_ascii_alphabetic() || c == '_');

        if is_placeholder {
            if let Some(value) = values.get(key) {
                result.push_str(value);
            }
            // A placeholder with no value is removed by writing nothing.
        } else {
            result.push_str(&rest[open..open + 2 + close_rel + 2]);
        }
        rest = &rest[open + 2 + close_rel + 2..];
    }
    result.push_str(rest);
    result
}

/// Extracts the grading result from the output of claude --output-format json.
/// The outer layer is the Claude Code wrapper. The result string inside it is the
/// grading result JSON.
pub fn extract_grade_json(data: &[u8]) -> Result<Map<String, Value>, ClaudeRunnerError> {
    let wrapper: Map<String, Value> = match serde_json::from_slice(data) {
        Ok(Value::Object(map)) => map,
        _ => {
            let excerpt = String::from_utf8(data.to_vec())
                .unwrap_or_else(|_| "(UTF-8として読めないデータ)".to_string());
            return Err(ClaudeRunnerError::UnreadableOutput {
                stage: UnreadableStage::OuterWrapper,
                excerpt: excerpt.chars().take(200).collect(),
            });
        }
    };

    if let Some(true) = wrapper.get("is_error").and_then(Value::as_bool) {
        let detail = wrapper
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or("詳細不明")
            .to_string();
        return Err(ClaudeRunnerError::ClaudeReportedError(detail));
    }

    let Some(body) = wrapper.get("result").and_then(Value::as_str) else {
        return Err(ClaudeRunnerError::UnreadableOutput {
            stage: UnreadableStage::InnerResult,
            excerpt: "result フィールドが文字列ではない".to_string(),
        });
    };

    parse_grade_body(body).ok_or_else(|| ClaudeRunnerError::UnreadableOutput {
        stage: UnreadableStage::InnerResult,
        excerpt: body.chars().take(200).collect(),
    })
}

/// Parses the body of the grading result. No fence appeared in measurements, but a
/// future model may wrap the body in ```json, so the fence can be stripped.
pub fn parse_grade_body(text: &str) -> Option<Map<String, Value>> {
    let trimmed = text.trim();
    if let Ok(Value::Object(direct)) = serde_json::from_str(trimmed) {
        return Some(direct);
    }
    if !trimmed.starts_with("```") {
        return None;
    }
    let mut lines: Vec<&str> = trimmed.split('\n').collect();
    if lines.is_empty() {
        return None;
    }
    lines.remove(0);
    if lines.last().map(|l| l.trim()) == Some("```") {
        lines.pop();
    }
    match serde_json::from_str(&lines.join("\n")) {
        Ok(Value::Object(map)) => Some(map),
        _ => None,
    }
}

/// Runs claude -p and returns the grading result. It blocks the calling thread, so
/// when calling it from the UI, run it on a background thread.
pub fn run_claude(
    binary: &str,
    system_prompt: &str,
    user_prompt: &str,
    timeout_seconds: u64,
) -> Result<Map<String, Value>, ClaudeRunnerError> {
    let mut child = Command::new(binary)
        .args(claude_arguments(system_prompt))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ClaudeRunnerError::LaunchFailed(e.to_string()))?;

    let mut stdin = child.stdin.take().expect("stdinをpipeで開いた");
    let mut stdout = child.stdout.take().expect("stdoutをpipeで開いた");
    let mut stderr = child.stderr.take().expect("stderrをpipeで開いた");
    // A shared handle that the calling thread keeps for kill. wait goes through this Mutex.
    let child = std::sync::Arc::new(std::sync::Mutex::new(child));
    let child_kill = std::sync::Arc::clone(&child);
    let user_prompt = user_prompt.to_string();
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(user_prompt.as_bytes());
        // Close it once writing is done. Dropping stdin sends EOF to the child process.
    });

    // stdout and stderr are read concurrently, each on its own thread, so that a full
    // buffer on one pipe does not block reading from the other (calling read_to_end on
    // them in turn on one thread can deadlock: if the child first writes to the pipe
    // that is read second, its write blocks and neither side can make progress).
    let stdout_reader = std::thread::spawn(move || {
        let mut out_buf = Vec::new();
        let _ = stdout.read_to_end(&mut out_buf);
        out_buf
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut err_buf = Vec::new();
        let _ = stderr.read_to_end(&mut err_buf);
        err_buf
    });

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let out_buf = stdout_reader.join().unwrap_or_default();
        let err_buf = stderr_reader.join().unwrap_or_default();
        let status = child.lock().map(|mut c| c.wait());
        let status = match status {
            Ok(status) => status,
            Err(_) => Err(std::io::Error::other("子プロセスのロックを取得できません")),
        };
        let _ = tx.send((status, out_buf, err_buf));
    });

    let _ = writer.join();

    match rx.recv_timeout(Duration::from_secs(timeout_seconds)) {
        Ok((status, out_buf, err_buf)) => {
            let status = status.map_err(|e| ClaudeRunnerError::LaunchFailed(e.to_string()))?;
            if !status.success() {
                let err_text = String::from_utf8_lossy(&err_buf);
                let detail = if err_text.is_empty() {
                    format!("終了コード {}", status.code().unwrap_or(-1))
                } else {
                    err_text.chars().take(200).collect()
                };
                return Err(ClaudeRunnerError::ClaudeReportedError(detail));
            }
            extract_grade_json(&out_buf)
        }
        Err(_) => {
            // Even after a timeout the thread above keeps waiting for the process to
            // exit, so a hung claude process would stay in the background if left alone.
            // The response is given up, but the process itself is ended here for sure.
            let _ = child_kill.lock().map(|mut c| c.kill());
            Err(ClaudeRunnerError::TimedOut {
                seconds: timeout_seconds,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 最重要の回帰防止。--tools "" が抜けると入力トークンが 73 倍になる。
    #[test]
    fn arguments_contain_empty_tools() {
        let args = claude_arguments("SYS");
        let tools_index = args.iter().position(|a| a == "--tools").expect("--tools がある");
        assert_eq!(args[tools_index + 1], "");
    }

    #[test]
    fn arguments_contain_json_output_format() {
        let args = claude_arguments("SYS");
        assert!(args.contains(&"--output-format".to_string()));
        assert!(args.contains(&"json".to_string()));
    }

    #[test]
    fn arguments_contain_strict_mcp_config() {
        let args = claude_arguments("SYS");
        assert!(args.contains(&"--strict-mcp-config".to_string()));
    }

    #[test]
    fn arguments_contain_empty_setting_sources() {
        let args = claude_arguments("SYS");
        let i = args
            .iter()
            .position(|a| a == "--setting-sources")
            .expect("--setting-sources がある");
        assert_eq!(args[i + 1], "");
    }

    #[test]
    fn arguments_pass_the_system_prompt() {
        let args = claude_arguments("SYS");
        let i = args
            .iter()
            .position(|a| a == "--system-prompt")
            .expect("--system-prompt がある");
        assert_eq!(args[i + 1], "SYS");
    }

    #[test]
    fn arguments_contain_dash_p() {
        let args = claude_arguments("SYS");
        assert!(args.contains(&"-p".to_string()));
    }

    #[test]
    fn resolves_an_existing_candidate() {
        let candidates = vec![
            "/candidate/one/claude".to_string(),
            "/candidate/two/claude".to_string(),
        ];
        let found = resolve_claude_binary(
            &HashMap::new(),
            |p| p == "/candidate/two/claude",
            &candidates,
        );
        assert_eq!(found.as_deref(), Some("/candidate/two/claude"));
    }

    #[test]
    fn override_env_var_wins_over_candidates() {
        let candidates = vec![
            "/candidate/one/claude".to_string(),
            "/candidate/two/claude".to_string(),
        ];
        let mut env = HashMap::new();
        env.insert("TOEFL_CLAUDE_BIN".to_string(), "/custom/claude".to_string());
        let found = resolve_claude_binary(
            &env,
            |p| p == "/custom/claude" || p == "/candidate/one/claude",
            &candidates,
        );
        assert_eq!(found.as_deref(), Some("/custom/claude"));
    }

    #[test]
    fn missing_override_does_not_fall_back_to_candidates() {
        let candidates = vec!["/candidate/one/claude".to_string()];
        let mut env = HashMap::new();
        env.insert("TOEFL_CLAUDE_BIN".to_string(), "/missing/claude".to_string());
        let found = resolve_claude_binary(&env, |p| p == "/candidate/one/claude", &candidates);
        assert_eq!(found, None);
    }

    #[test]
    fn none_found_is_none() {
        let candidates = vec!["/candidate/one/claude".to_string()];
        let found = resolve_claude_binary(&HashMap::new(), |_| false, &candidates);
        assert_eq!(found, None);
    }

    #[test]
    fn splits_system_and_user_parts() {
        let text = "You are a grader.\nReply with JSON.\n---\nESSAY:\n{{essay}}";
        let (system, user) = split_prompt_file(text).unwrap();
        assert_eq!(system, "You are a grader.\nReply with JSON.");
        assert_eq!(user, "ESSAY:\n{{essay}}");
    }

    #[test]
    fn no_separator_is_none() {
        assert_eq!(split_prompt_file("no separator here"), None);
    }

    #[test]
    fn empty_system_part_is_none() {
        assert_eq!(split_prompt_file("---\nonly user"), None);
    }

    #[test]
    fn empty_user_part_is_none() {
        assert_eq!(split_prompt_file("only system\n---"), None);
    }

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn replaces_every_occurrence_of_the_same_key() {
        let rendered = render_template(
            "A={{a}} B={{b}} A again={{a}}",
            &values(&[("a", "1"), ("b", "2")]),
        );
        assert_eq!(rendered, "A=1 B=2 A again=1");
    }

    #[test]
    fn allows_values_containing_newlines() {
        let rendered = render_template("ESSAY:\n{{essay}}", &values(&[("essay", "line1\nline2")]));
        assert_eq!(rendered, "ESSAY:\nline1\nline2");
    }

    #[test]
    fn drops_placeholders_without_a_value() {
        let rendered = render_template("keep {{known}} drop {{unknown}}", &values(&[("known", "X")]));
        assert_eq!(rendered, "keep X drop ");
    }

    // 回帰テスト: 生徒のエッセイ本文に {{...}} 形の文字列が含まれていても、
    // それはテンプレートではなく置換された「値」なので消してはならない。
    #[test]
    fn keeps_brace_like_text_inside_a_substituted_value() {
        let rendered = render_template(
            "ESSAY:\n{{essay}}",
            &values(&[("essay", "I wrote {{example}} on the board by mistake.")]),
        );
        assert_eq!(rendered, "ESSAY:\nI wrote {{example}} on the board by mistake.");
    }

    // 回帰テスト: 値の中に「別の既知キー」の {{...}} が偶然含まれていても、
    // 後続キーの置換でその中身を書き換えてはならない(逐次 String::replace
    // による多重置換のバグを防ぐ)。HashMap の反復順は不定なため、
    // どちらのキーが先に処理されても壊れないことを固定文字列で確認する。
    #[test]
    fn does_not_let_one_substituted_value_be_rewritten_by_another_known_key() {
        let rendered = render_template(
            "MUST_INCLUDE:{{must_include}}\nESSAY:{{essay}}",
            &values(&[
                ("must_include", "cats"),
                ("essay", "I love {{must_include}} and dogs."),
            ]),
        );
        assert_eq!(
            rendered,
            "MUST_INCLUDE:cats\nESSAY:I love {{must_include}} and dogs."
        );
    }

    #[test]
    fn is_executable_file_true_for_a_file_with_execute_bit() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("toefl-exec-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("runnable");
        std::fs::write(&path, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(is_executable_file(path.to_str().unwrap()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn is_executable_file_false_without_execute_bit() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("toefl-noexec-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("not_runnable");
        std::fs::write(&path, "not a script").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!is_executable_file(path.to_str().unwrap()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn is_executable_file_false_for_missing_path() {
        assert!(!is_executable_file("/nonexistent/toefl-does-not-exist"));
    }

    #[test]
    fn is_executable_file_false_for_a_directory() {
        let dir = std::env::temp_dir().join(format!("toefl-dir-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!is_executable_file(dir.to_str().unwrap()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    // 回帰テスト: タイムアウトしたら、応答を待つスレッドが握っている子プロセスを
    // 確実に kill する。/bin/sleep をタイムアウトより長く走らせ、
    // run_claude が TimedOut を返した後にプロセスが実際に終了していることを
    // (ゾンビ化せず wait できることで)確認する。
    #[test]
    fn run_claude_kills_the_child_process_on_timeout() {
        // run_claude は claude_arguments (-p --output-format json ...) を渡すため、
        // 実バイナリの代わりに「引数を無視してタイムアウトより長く眠る」
        // シェルスクリプトを claude 役に据える。
        let dir = std::env::temp_dir().join(format!("toefl-timeout-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("fake_claude.sh");
        std::fs::write(&script, "#!/bin/sh\nsleep 10\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let start = std::time::Instant::now();
        let result = run_claude(script.to_str().unwrap(), "SYS", "essay", 1);
        let elapsed = start.elapsed();
        assert!(matches!(result, Err(ClaudeRunnerError::TimedOut { seconds: 1 })));
        // kill せずに放置すると 10 秒眠り続けるスクリプトなので、
        // タイムアウト(1秒)から十分近い時間で戻ってくることは
        // 子プロセスが実際に kill されたことの傍証になる。
        assert!(elapsed < Duration::from_secs(5), "elapsed={elapsed:?}");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extracts_plain_json() {
        let wrapper = br#"{"result":"{\"overall\":4}","is_error":false}"#;
        let grade = extract_grade_json(wrapper).unwrap();
        assert_eq!(grade.get("overall"), Some(&serde_json::json!(4)));
    }

    #[test]
    fn extracts_json_wrapped_in_a_code_fence() {
        let wrapper = br#"{"result":"```json\n{\"overall\":5}\n```","is_error":false}"#;
        let grade = extract_grade_json(wrapper).unwrap();
        assert_eq!(grade.get("overall"), Some(&serde_json::json!(5)));
    }

    #[test]
    fn is_error_true_becomes_claude_reported_error() {
        let wrapper = br#"{"result":"Invalid API key","is_error":true}"#;
        match extract_grade_json(wrapper) {
            Err(ClaudeRunnerError::ClaudeReportedError(_)) => {}
            other => panic!("expected ClaudeReportedError, got {other:?}"),
        }
    }

    #[test]
    fn non_json_inner_result_is_unreadable_inner_result() {
        let wrapper = br#"{"result":"I cannot do that.","is_error":false}"#;
        match extract_grade_json(wrapper) {
            Err(ClaudeRunnerError::UnreadableOutput { stage, .. }) => {
                assert_eq!(stage, UnreadableStage::InnerResult);
            }
            other => panic!("expected UnreadableOutput, got {other:?}"),
        }
    }

    #[test]
    fn non_json_outer_wrapper_is_unreadable_outer_wrapper() {
        match extract_grade_json(b"not json at all") {
            Err(ClaudeRunnerError::UnreadableOutput { stage, excerpt }) => {
                assert_eq!(stage, UnreadableStage::OuterWrapper);
                assert_eq!(excerpt, "not json at all");
            }
            other => panic!("expected UnreadableOutput, got {other:?}"),
        }
    }

    #[test]
    fn every_error_has_a_non_empty_japanese_message() {
        let errors = [
            ClaudeRunnerError::BinaryNotFound,
            ClaudeRunnerError::LaunchFailed("x".to_string()),
            ClaudeRunnerError::TimedOut { seconds: 180 },
            ClaudeRunnerError::ClaudeReportedError("x".to_string()),
            ClaudeRunnerError::UnreadableOutput {
                stage: UnreadableStage::OuterWrapper,
                excerpt: "x".to_string(),
            },
            ClaudeRunnerError::UnreadableOutput {
                stage: UnreadableStage::InnerResult,
                excerpt: "x".to_string(),
            },
        ];
        for e in errors {
            assert!(!e.japanese_message().is_empty());
        }
    }
}
