use serde_json::{Map, Value};
use std::path::Path;
use toefl_core::grade::grade_essay;

pub fn handle_grader(payload: &Map<String, Value>, root: &Path) -> Result<Value, String> {
    let action = payload.get("action").and_then(Value::as_str).unwrap_or("");
    if action != "grade" {
        return Err(format!("未知の action: {action}"));
    }

    let bad_shape = || "採点要求の形式が不正です".to_string();
    let prompt_id = payload.get("promptId").and_then(Value::as_str).ok_or_else(bad_shape)?;
    let prompt_type = payload.get("promptType").and_then(Value::as_str).ok_or_else(bad_shape)?;
    let essay_text = payload.get("essayText").and_then(Value::as_str).ok_or_else(bad_shape)?;

    grade_essay(root, prompt_id, prompt_type, essay_text)
        .map(Value::Object)
        .map_err(|e| e.japanese_message())
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
        assert_eq!(result, Err("採点要求の形式が不正です".to_string()));
    }

    #[test]
    fn missing_essay_text_is_rejected() {
        let payload = json!({"action": "grade", "promptId": "p1", "promptType": "email"})
            .as_object()
            .unwrap()
            .clone();
        let result = handle_grader(&payload, &PathBuf::from("/tmp"));
        assert_eq!(result, Err("採点要求の形式が不正です".to_string()));
    }

    #[test]
    fn unknown_action_is_rejected() {
        let payload = json!({"action": "not-grade"}).as_object().unwrap().clone();
        let result = handle_grader(&payload, &PathBuf::from("/tmp"));
        assert_eq!(result, Err("未知の action: not-grade".to_string()));
    }
}
