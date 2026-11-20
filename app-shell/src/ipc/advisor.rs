use serde_json::{json, Map, Value};
use std::path::Path;
use toefl_core::advise::study_advice;
use toefl_core::jsonlines_log::JsonLinesFile;

/// Study advice from Claude. Each answer is appended to advice.jsonl together with the
/// statistics it was based on, so the dashboard can show the latest one without asking
/// again.
pub fn handle_advisor(payload: &Map<String, Value>, root: &Path, log: &JsonLinesFile) -> Result<Value, String> {
    let action = payload.get("action").and_then(Value::as_str).unwrap_or("");
    match action {
        "latest" => Ok(log.load_all().pop().map(Value::Object).unwrap_or(Value::Null)),
        "advise" => {
            let bad_shape = || "The advice request is malformed".to_string();
            let stats = payload.get("stats").and_then(Value::as_object).ok_or_else(bad_shape)?;
            let created_at = payload.get("createdAt").and_then(Value::as_str).ok_or_else(bad_shape)?;

            let advice = study_advice(root, stats).map_err(|e| e.user_message())?;
            let row = json!({ "createdAt": created_at, "stats": stats, "advice": advice });
            let Value::Object(row) = row else { unreachable!("json! built an object") };
            log.append(&row).map_err(|e| format!("Could not write the file: {e}"))?;
            Ok(Value::Object(row))
        }
        other => Err(format!("unknown action: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_log() -> (JsonLinesFile, PathBuf) {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("advisor-test-{}-{nanos}", std::process::id()));
        (JsonLinesFile::new(&dir, "advice.jsonl"), dir)
    }

    fn payload(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn latest_returns_the_last_saved_row_or_null() {
        let (log, dir) = temp_log();
        let root = PathBuf::from("/tmp");
        let request = payload(json!({"action": "latest"}));
        assert_eq!(handle_advisor(&request, &root, &log), Ok(Value::Null));

        log.append(&payload(json!({"createdAt": "2026-11-19T00:00:00Z"}))).unwrap();
        log.append(&payload(json!({"createdAt": "2026-11-20T00:00:00Z"}))).unwrap();
        let latest = handle_advisor(&request, &root, &log).unwrap();
        assert_eq!(latest["createdAt"], "2026-11-20T00:00:00Z");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn advise_without_stats_is_rejected_before_claude_is_started() {
        let (log, _dir) = temp_log();
        let request = payload(json!({"action": "advise", "createdAt": "2026-11-20T00:00:00Z"}));
        let result = handle_advisor(&request, &PathBuf::from("/tmp"), &log);
        assert_eq!(result, Err("The advice request is malformed".to_string()));
    }
}
