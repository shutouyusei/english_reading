use serde_json::{Map, Value};
use toefl_core::jsonlines_log::JsonLinesFile;

/// store(読解)・listening どちらのIPCハンドラも、この共通実装をファイル名だけ
/// 変えて使う(Swift版 `StoreHandler` と同じ設計)。
pub fn handle_log_store(payload: &Map<String, Value>, log: &JsonLinesFile) -> Result<Option<Value>, String> {
    let action = payload.get("action").and_then(Value::as_str).unwrap_or("");
    match action {
        "loadAll" => {
            let rows = log.load_all();
            Ok(Some(Value::Array(rows.into_iter().map(Value::Object).collect())))
        }
        "saveAttempt" => {
            let attempt = payload
                .get("attempt")
                .and_then(Value::as_object)
                .ok_or_else(|| "attempt が含まれていません".to_string())?;
            log.append(attempt).map_err(|e| format!("書き込みに失敗しました: {e}"))?;
            Ok(None)
        }
        other => Err(format!("未知の action: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use toefl_core::jsonlines_log::JsonLinesFile;

    fn temp_log(filename: &str) -> (JsonLinesFile, PathBuf) {
        let dir = std::env::temp_dir().join(format!("store-test-{}", uuid_like()));
        (JsonLinesFile::new(&dir, filename), dir)
    }

    fn uuid_like() -> String {
        format!(
            "{}-{:?}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        )
    }

    #[test]
    fn load_all_on_empty_log_returns_empty_array() {
        let (log, dir) = temp_log("attempts.jsonl");
        let payload = json!({"action": "loadAll"}).as_object().unwrap().clone();
        let result = handle_log_store(&payload, &log);
        assert_eq!(result, Ok(Some(json!([]))));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_attempt_then_load_all_returns_it() {
        let (log, dir) = temp_log("attempts.jsonl");
        let save_payload = json!({
            "action": "saveAttempt",
            "attempt": {"passageId": "p1", "finishedAt": "2026-09-03T00:00:00Z"}
        })
        .as_object()
        .unwrap()
        .clone();
        let save_result = handle_log_store(&save_payload, &log);
        assert_eq!(save_result, Ok(None));

        let load_payload = json!({"action": "loadAll"}).as_object().unwrap().clone();
        let loaded = handle_log_store(&load_payload, &log).unwrap().unwrap();
        assert_eq!(loaded.as_array().unwrap().len(), 1);
        assert_eq!(loaded[0]["passageId"], "p1");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_attempt_without_attempt_field_is_rejected() {
        let (log, dir) = temp_log("attempts.jsonl");
        let payload = json!({"action": "saveAttempt"}).as_object().unwrap().clone();
        let result = handle_log_store(&payload, &log);
        assert_eq!(result, Err("attempt が含まれていません".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_action_is_rejected() {
        let (log, dir) = temp_log("attempts.jsonl");
        let payload = json!({"action": "delete"}).as_object().unwrap().clone();
        let result = handle_log_store(&payload, &log);
        assert_eq!(result, Err("未知の action: delete".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }
}
