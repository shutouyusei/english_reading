use crate::claude_runner::{
    render_template, resolve_claude_binary, run_claude, split_prompt_file, ClaudeRunnerError,
};
use crate::path_resolver::writing_prompt_path;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

/// ディスカッションの投稿群を、そのままプロンプトに貼れる平文にする。
pub fn describe_discussion(discussion: Option<&Value>) -> String {
    let Some(discussion) = discussion.and_then(Value::as_object) else {
        return String::new();
    };
    let mut lines: Vec<String> = Vec::new();
    if let Some(professor) = discussion.get("professor_post").and_then(Value::as_object) {
        let name = professor.get("name").and_then(Value::as_str).unwrap_or("Professor");
        lines.push(format!("{name}:"));
        lines.push(professor.get("text").and_then(Value::as_str).unwrap_or("").to_string());
    }
    if let Some(posts) = discussion.get("student_posts").and_then(Value::as_array) {
        for post in posts {
            let Some(post) = post.as_object() else { continue };
            let name = post.get("name").and_then(Value::as_str).unwrap_or("Student");
            lines.push(String::new());
            lines.push(format!("{name}:"));
            lines.push(post.get("text").and_then(Value::as_str).unwrap_or("").to_string());
        }
    }
    lines.join("\n")
}

/// 問題文と採点用テンプレートを読み込み、claude -p を起動して採点する。
/// promptId は JS から来るため、writing_prompt_path 経由でリポジトリ外や
/// docs/data/writing の外を指せないことを確かめる。
pub fn grade_essay(
    root: &Path,
    prompt_id: &str,
    prompt_type: &str,
    essay_text: &str,
) -> Result<Map<String, Value>, ClaudeRunnerError> {
    let binary = resolve_claude_binary(
        &std::env::vars().collect(),
        |p| std::fs::metadata(p).is_ok(),
        &crate::claude_runner::default_claude_binary_candidates(),
    )
    .ok_or(ClaudeRunnerError::BinaryNotFound)?;

    let prompt_path = writing_prompt_path(root, prompt_id)
        .ok_or_else(|| ClaudeRunnerError::LaunchFailed(format!("問題ID \"{prompt_id}\" のパスが不正です")))?;

    let template_name = if prompt_type == "discussion" {
        "grade-discussion"
    } else {
        "grade-email"
    };
    let template_path = root.join(format!("app/prompts/{template_name}.md"));

    let load_failure = || ClaudeRunnerError::LaunchFailed("問題または採点プロンプトを読み込めません".to_string());

    let prompt_data = std::fs::read(&prompt_path).map_err(|_| load_failure())?;
    let prompt: Map<String, Value> = match serde_json::from_slice(&prompt_data) {
        Ok(Value::Object(map)) => map,
        _ => return Err(load_failure()),
    };
    let template_text = std::fs::read_to_string(&template_path).map_err(|_| load_failure())?;
    let (system, user_template) = split_prompt_file(&template_text).ok_or_else(load_failure)?;

    let must_include = prompt
        .get("must_include")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();

    let mut values = HashMap::new();
    values.insert(
        "instructions".to_string(),
        prompt.get("instructions").and_then(Value::as_str).unwrap_or("").to_string(),
    );
    values.insert(
        "situation".to_string(),
        prompt.get("situation").and_then(Value::as_str).unwrap_or("").to_string(),
    );
    values.insert(
        "recipient".to_string(),
        prompt.get("recipient").and_then(Value::as_str).unwrap_or("").to_string(),
    );
    values.insert("must_include".to_string(), must_include);
    values.insert("discussion".to_string(), describe_discussion(prompt.get("discussion")));
    values.insert("essay".to_string(), essay_text.to_string());

    let user_prompt = render_template(&user_template, &values);

    let started = Instant::now();
    run_claude(&binary, &system, &user_prompt, 180).map(|mut grade| {
        grade.insert(
            "runnerMs".to_string(),
            Value::from(started.elapsed().as_millis() as i64),
        );
        grade
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_discussion_is_empty_string() {
        assert_eq!(describe_discussion(None), "");
    }

    #[test]
    fn formats_professor_post_only() {
        let discussion = json!({
            "professor_post": { "name": "Dr. Lee", "text": "What do you think?" }
        });
        assert_eq!(
            describe_discussion(Some(&discussion)),
            "Dr. Lee:\nWhat do you think?"
        );
    }

    #[test]
    fn formats_professor_and_student_posts() {
        let discussion = json!({
            "professor_post": { "name": "Dr. Lee", "text": "What do you think?" },
            "student_posts": [
                { "name": "Alice", "text": "I agree." },
                { "name": "Bob", "text": "I disagree." }
            ]
        });
        assert_eq!(
            describe_discussion(Some(&discussion)),
            "Dr. Lee:\nWhat do you think?\n\nAlice:\nI agree.\n\nBob:\nI disagree."
        );
    }

    #[test]
    fn missing_names_fall_back_to_defaults() {
        let discussion = json!({
            "professor_post": { "text": "Hello" },
            "student_posts": [{ "text": "Hi" }]
        });
        assert_eq!(
            describe_discussion(Some(&discussion)),
            "Professor:\nHello\n\nStudent:\nHi"
        );
    }

}
