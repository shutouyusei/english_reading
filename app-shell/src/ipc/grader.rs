use serde_json::{Map, Value};
use std::path::Path;
use toefl_core::grade::grade_essay;

pub fn handle_grader(payload: &Map<String, Value>, root: &Path) -> Result<Value, String> {
    let action = payload.get("action").and_then(Value::as_str).unwrap_or("");
    if action != "grade" {
        return Err(format!("unknown action: {action}"));
    }

    let bad_shape = || "The grading request is malformed".to_string();
    let prompt_id = payload.get("promptId").and_then(Value::as_str).ok_or_else(bad_shape)?;
    let prompt_type = payload.get("promptType").and_then(Value::as_str).ok_or_else(bad_shape)?;
    let essay_text = payload.get("essayText").and_then(Value::as_str).ok_or_else(bad_shape)?;

    grade_essay(root, prompt_id, prompt_type, essay_text)
        .map(Value::Object)
        .map_err(|e| e.user_message())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn missing_prompt_id_is_rejected() {
        let payload = json!({"action": "grade", "promptType": "email", "essayText": "hi"})
            .as_object()
            .unwrap()
            .clone();
        let result = handle_grader(&payload, &PathBuf::from("/tmp"));
        assert_eq!(result, Err("The grading request is malformed".to_string()));
    }
}
