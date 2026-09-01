use serde_json::{Map, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// unreadable_output の失敗箇所を区別する。
/// 外側(Claude Code のラッパー自体)と内側(result 文字列の中身)は
/// 原因がまったく異なるため、まとめて捨てずに区別できるようにしておく。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnreadableStage {
    OuterWrapper,
    InnerResult,
}

/// 採点に失敗しうる経路。すべて画面にそのまま出せる日本語の説明を持つ。
#[derive(Debug)]
pub enum ClaudeRunnerError {
    BinaryNotFound,
    LaunchFailed(String),
    TimedOut { seconds: u64 },
    ClaudeReportedError(String),
    /// excerpt: 読み取れなかった文字列の先頭最大200文字(診断用)。
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

/// 実行ファイルの既定の探索先。
/// Finder から起動した .app の PATH は /usr/bin:/bin:/usr/sbin:/sbin しか無く、
/// claude はそこに存在しない。PATH 探索に頼らず明示的に探す。
pub fn default_claude_binary_candidates() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    vec![
        format!("{home}/.local/bin/claude"),
        "/opt/homebrew/bin/claude".to_string(),
        "/usr/local/bin/claude".to_string(),
        "/usr/bin/claude".to_string(),
    ]
}

/// claude の実行ファイルを見つける。
/// TOEFL_CLAUDE_BIN が設定されていればそれだけを見る。設定されているのに
/// 実在しない場合、黙って別のものを使うと利用者が誤った箇所を疑うため None を返す。
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

/// claude -p に渡す引数。
///
/// --tools "" が最も重要。これが無いと Claude Code の既定ツール定義一式が
/// 毎回プロンプトに載り、入力トークンが 613 から 44,984 へ 73 倍に膨らむ。
/// 採点にツールは要らない。
///
/// ユーザープロンプトはここに含めない。標準入力で渡す(エッセイ本文に
/// 引用符・改行・バックスラッシュが入っても壊れないため)。
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

/// プロンプトファイルを "---" だけの行で前後に分ける。前半がシステム、後半がユーザー。
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

/// {{key}} を values の値で置き換える。
/// 値の無いプレースホルダはテンプレート側であらかじめ取り除く。置換が終わった
/// 後の文字列(エッセイなど利用者の入力を含みうる)に対して除去処理を掛けると、
/// 本文中にたまたま {{...}} 形の文字列が含まれていた場合に生徒の回答を
/// 無断で書き換えてしまうため、対象を置換前のテンプレートだけに限定する。
pub fn render_template(template: &str, values: &HashMap<String, String>) -> String {
    let known_keys: std::collections::HashSet<&str> = values.keys().map(|k| k.as_str()).collect();
    let stripped = remove_unresolved_placeholders(template, &known_keys);
    let mut result = stripped;
    for (key, value) in values {
        result = result.replace(&format!("{{{{{key}}}}}"), value);
    }
    result
}

/// テンプレート中の {{key}} のうち、values に用意されていないものだけを取り除く。
fn remove_unresolved_placeholders(template: &str, known_keys: &std::collections::HashSet<&str>) -> String {
    let mut result = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find("{{") {
        let Some(close_rel) = rest[open + 2..].find("}}") else {
            result.push_str(rest);
            return result;
        };
        let key = &rest[open + 2..open + 2 + close_rel];
        let is_placeholder = !key.is_empty()
            && key
                .chars()
                .all(|c| c.is_ascii_alphabetic() || c == '_');

        if is_placeholder && !known_keys.contains(key) {
            result.push_str(&rest[..open]);
        } else {
            result.push_str(&rest[..open + 2 + close_rel + 2]);
        }
        rest = &rest[open + 2 + close_rel + 2..];
    }
    result.push_str(rest);
    result
}

/// claude --output-format json の出力から採点結果を取り出す。
/// 外側は Claude Code のラッパー。内側の result 文字列が採点結果の JSON。
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

/// 採点結果の本文をパースする。実測ではフェンスは付かなかったが、
/// 将来モデルが変わって ```json で囲む可能性があるので剥がせるようにしておく。
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

/// claude -p を起動して採点結果を得る。呼び出し側のスレッドを塞ぐので、
/// 画面から呼ぶときはバックグラウンドキューで実行すること。
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
    let user_prompt = user_prompt.to_string();
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(user_prompt.as_bytes());
        // 書き終えたら閉じる。stdin がドロップされることで EOF が子プロセスに伝わる。
    });

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut stdout = child.stdout.take().expect("stdoutをpipeで開いた");
        let mut stderr = child.stderr.take().expect("stderrをpipeで開いた");
        let mut out_buf = Vec::new();
        let mut err_buf = Vec::new();
        let _ = stdout.read_to_end(&mut out_buf);
        let _ = stderr.read_to_end(&mut err_buf);
        let status = child.wait();
        let _ = tx.send((status, out_buf, err_buf, child));
    });

    let _ = writer.join();

    match rx.recv_timeout(Duration::from_secs(timeout_seconds)) {
        Ok((status, out_buf, err_buf, _child)) => {
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
        Err(_) => Err(ClaudeRunnerError::TimedOut {
            seconds: timeout_seconds,
        }),
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
