use serde_json::{Map, Value};
use toefl_core::jsonlines_log::JsonLinesFile;

pub fn handle_essays(payload: &Map<String, Value>, log: &JsonLinesFile) -> Result<Option<Value>, String> {
    let action = payload.get("action").and_then(Value::as_str).unwrap_or("");
    match action {
        "loadAll" => {
            let rows = log.load_all();
            Ok(Some(Value::Array(rows.into_iter().map(Value::Object).collect())))
        }
        "saveEssay" => save_row(payload, "essay", log),
        "saveGrade" => save_row(payload, "grade", log),
        other => Err(format!("未知の action: {other}")),
    }
}

/// `kind` は Rust 側で付ける。JS から渡させると付け忘れが起きうる(Swift版と同じ理由)。
fn save_row(payload: &Map<String, Value>, kind: &str, log: &JsonLinesFile) -> Result<Option<Value>, String> {
    let mut row = payload
        .get(kind)
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| format!("{kind} の中身が含まれていません"))?;
    row.insert("kind".to_string(), Value::String(kind.to_string()));
    log.append(&row).map_err(|e| format!("書き込みに失敗しました: {e}"))?;
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use toefl_core::jsonlines_log::JsonLinesFile;

    fn temp_log() -> (JsonLinesFile, PathBuf) {
        let dir = std::env::temp_dir().join(format!("essays-test-{}", uuid_like()));
        (JsonLinesFile::new(&dir, "essays.jsonl"), dir)
    }

    fn uuid_like() -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        format!(
            "{}-{:?}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    }

    #[test]
    fn save_essay_tags_row_with_kind_essay() {
        let (log, dir) = temp_log();
        let payload = json!({
            "action": "saveEssay",
            "essay": {"essayId": "e1", "promptId": "p1", "writtenAt": "2026-09-03T00:00:00Z"}
        })
        .as_object()
        .unwrap()
        .clone();
        let result = handle_essays(&payload, &log);
        assert_eq!(result, Ok(None));

        let rows = log.load_all();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get("kind").unwrap(), "essay");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_grade_tags_row_with_kind_grade() {
        let (log, dir) = temp_log();
        let payload = json!({
            "action": "saveGrade",
            "grade": {"essayId": "e1", "gradedAt": "2026-09-03T00:00:01Z"}
        })
        .as_object()
        .unwrap()
        .clone();
        let result = handle_essays(&payload, &log);
        assert_eq!(result, Ok(None));

        let rows = log.load_all();
        assert_eq!(rows[0].get("kind").unwrap(), "grade");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_all_returns_mixed_rows() {
        let (log, dir) = temp_log();
        handle_essays(
            &json!({"action": "saveEssay", "essay": {"essayId": "e1"}}).as_object().unwrap().clone(),
            &log,
        )
        .unwrap();
        handle_essays(
            &json!({"action": "saveGrade", "grade": {"essayId": "e1"}}).as_object().unwrap().clone(),
            &log,
        )
        .unwrap();

        let loaded = handle_essays(&json!({"action": "loadAll"}).as_object().unwrap().clone(), &log)
            .unwrap()
            .unwrap();
        assert_eq!(loaded.as_array().unwrap().len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_essay_without_essay_field_is_rejected() {
        let (log, dir) = temp_log();
        let payload = json!({"action": "saveEssay"}).as_object().unwrap().clone();
        let result = handle_essays(&payload, &log);
        assert_eq!(result, Err("essay の中身が含まれていません".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_action_is_rejected() {
        let (log, dir) = temp_log();
        let payload = json!({"action": "delete"}).as_object().unwrap().clone();
        let result = handle_essays(&payload, &log);
        assert_eq!(result, Err("未知の action: delete".to_string()));
        let _ = fs::remove_dir_all(&dir);
    }
}
