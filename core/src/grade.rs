use crate::claude_runner::{run_prompt_template, ClaudeRunnerError};
use crate::path_resolver::writing_prompt_path;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

const GRADING_TIMEOUT_SECONDS: u64 = 180;

/// Turns the discussion posts into plain text that can be pasted into the prompt as is.
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

/// Loads the question and the grading template, then runs claude -p to grade.
/// promptId comes from JS, so it goes through writing_prompt_path to make sure it
/// cannot point outside the repository or outside docs/data/writing.
pub fn grade_essay(
    root: &Path,
    prompt_id: &str,
    prompt_type: &str,
    essay_text: &str,
) -> Result<Map<String, Value>, ClaudeRunnerError> {
    let prompt_path = writing_prompt_path(root, prompt_id)
        .ok_or_else(|| ClaudeRunnerError::PromptUnavailable(format!("the prompt ID \"{prompt_id}\" is not valid")))?;
    let prompt_failure = || {
        ClaudeRunnerError::PromptUnavailable(format!("the prompt file for \"{prompt_id}\" could not be read"))
    };
    let prompt_data = std::fs::read(&prompt_path).map_err(|_| prompt_failure())?;
    let prompt: Map<String, Value> = match serde_json::from_slice(&prompt_data) {
        Ok(Value::Object(map)) => map,
        _ => return Err(prompt_failure()),
    };

    let template_name = if prompt_type == "discussion" {
        "grade-discussion"
    } else {
        "grade-email"
    };

    let text_field = |name: &str| prompt.get(name).and_then(Value::as_str).unwrap_or("").to_string();
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
    values.insert("instructions".to_string(), text_field("instructions"));
    values.insert("situation".to_string(), text_field("situation"));
    values.insert("recipient".to_string(), text_field("recipient"));
    values.insert("must_include".to_string(), must_include);
    values.insert("discussion".to_string(), describe_discussion(prompt.get("discussion")));
    values.insert("essay".to_string(), essay_text.to_string());

    let started = Instant::now();
    run_prompt_template(root, template_name, &values, GRADING_TIMEOUT_SECONDS).map(|mut grade| {
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
