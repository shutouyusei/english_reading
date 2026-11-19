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

/// The ways grading can fail. Each has a description that can be shown on screen as is.
#[derive(Debug)]
pub enum ClaudeRunnerError {
    BinaryNotFound,
    /// The writing prompt or the grading template could not be loaded, so Claude Code
    /// was never started.
    PromptUnavailable(String),
    LaunchFailed(String),
    TimedOut { seconds: u64 },
    ClaudeReportedError(String),
    /// excerpt: up to the first 200 characters of the string that could not be read
    /// (for diagnosis).
    UnreadableOutput { stage: UnreadableStage, excerpt: String },
}

impl ClaudeRunnerError {
    pub fn user_message(&self) -> String {
        match self {
            ClaudeRunnerError::BinaryNotFound => {
                "Claude Code was not found. Check ~/.local/bin/claude, or set the \
                 TOEFL_CLAUDE_BIN environment variable to its path."
                    .to_string()
            }
            ClaudeRunnerError::PromptUnavailable(detail) => {
                format!("Could not prepare the essay for grading: {detail}")
            }
            ClaudeRunnerError::LaunchFailed(detail) => {
                format!("Could not start Claude Code: {detail}")
            }
            ClaudeRunnerError::TimedOut { seconds } => {
                format!("Grading did not finish within {seconds} seconds. Please try again.")
            }
            ClaudeRunnerError::ClaudeReportedError(detail) => {
                format!(
                    "Claude Code returned an error. Run claude in a terminal and check \
                     that you are logged in. ({detail})"
                )
            }
            ClaudeRunnerError::UnreadableOutput { stage, excerpt } => {
                let stage_description = match stage {
                    UnreadableStage::OuterWrapper => "the whole response from Claude Code",
                    UnreadableStage::InnerResult => "the JSON part of the grading result",
                };
                format!(
                    "Could not read the grading result ({stage_description} is not valid \
                     JSON: {excerpt}). Please try again."
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
                .unwrap_or_else(|_| "(data that is not valid UTF-8)".to_string());
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
            .unwrap_or("no details given")
            .to_string();
        return Err(ClaudeRunnerError::ClaudeReportedError(detail));
    }

    let Some(body) = wrapper.get("result").and_then(Value::as_str) else {
        return Err(ClaudeRunnerError::UnreadableOutput {
            stage: UnreadableStage::InnerResult,
            excerpt: "the result field is not a string".to_string(),
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

    let mut stdin = child.stdin.take().expect("stdin was opened as a pipe");
    let mut stdout = child.stdout.take().expect("stdout was opened as a pipe");
    let mut stderr = child.stderr.take().expect("stderr was opened as a pipe");
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
            Err(_) => Err(std::io::Error::other("could not lock the child process")),
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
                    format!("exit code {}", status.code().unwrap_or(-1))
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

    // The most important regression guard: without --tools "" input tokens grow 73x.
    #[test]
    fn arguments_isolate_claude_and_pass_the_prompt() {
        let args = claude_arguments("SYS");
        let value_after = |flag: &str| {
            let i = args
                .iter()
                .position(|a| a == flag)
                .unwrap_or_else(|| panic!("{flag} is missing"));
            args[i + 1].clone()
        };
        assert_eq!(value_after("--tools"), "");
        assert_eq!(value_after("--setting-sources"), "");
        assert_eq!(value_after("--system-prompt"), "SYS");
        assert!(args.contains(&"--output-format".to_string()));
        assert!(args.contains(&"json".to_string()));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
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
    fn drops_placeholders_without_a_value() {
        let rendered = render_template("keep {{known}} drop {{unknown}}", &values(&[("known", "X")]));
        assert_eq!(rendered, "keep X drop ");
    }

    // Regression test: when a value happens to contain the {{...}} of another known key,
    // substituting that other key must not rewrite it (the bug that one String::replace
    // per key would cause). HashMap iteration order is not fixed, so the expected string
    // is one that holds whichever key is handled first.
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

    // Regression test: on timeout, the child process held by the waiting thread must be
    // killed. The stand-in for claude sleeps longer than the timeout.
    #[test]
    fn run_claude_kills_the_child_process_on_timeout() {
        // run_claude passes claude_arguments (-p --output-format json ...), so a shell
        // script that ignores its arguments and sleeps stands in for the real binary.
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
        // The script would sleep for 10 seconds if left alone, so returning soon after
        // the 1-second timeout is indirect evidence that the child was killed.
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
}
