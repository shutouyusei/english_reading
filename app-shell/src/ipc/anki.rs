use serde_json::{json, Map, Value};
use toefl_core::anki_client::AnkiClient;

pub fn handle_anki(payload: &Map<String, Value>, client: &AnkiClient) -> Result<Value, String> {
    let action = payload.get("action").and_then(Value::as_str).unwrap_or("");
    if action != "request" {
        return Err(format!("未知の action: {action}"));
    }

    let anki_action = payload
        .get("ankiAction")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "ankiAction が含まれていません".to_string())?;
    let params = payload.get("params").cloned().unwrap_or_else(|| json!({}));

    // JS 側で「結果なし」と「エラー」を区別できるよう、常に result キーを置く
    // (Swift版 AnkiHandler と同じ)。
    client
        .request(anki_action, params)
        .map(|result| json!({ "result": result }))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;
    use toefl_core::anki_client::AnkiClient;

    /// 127.0.0.1:1 は特権ポートで、通常は何も listen していないため
    /// 確実に接続拒否(AnkiError::NotRunning相当)になる。
    fn unreachable_client() -> AnkiClient {
        AnkiClient::new("http://127.0.0.1:1", Duration::from_millis(200))
    }

    #[test]
    fn missing_anki_action_is_rejected() {
        let payload = json!({"action": "request"}).as_object().unwrap().clone();
        let result = handle_anki(&payload, &unreachable_client());
        assert_eq!(result, Err("ankiAction が含まれていません".to_string()));
    }

    #[test]
    fn unknown_action_is_rejected() {
        let payload = json!({"action": "other"}).as_object().unwrap().clone();
        let result = handle_anki(&payload, &unreachable_client());
        assert_eq!(result, Err("未知の action: other".to_string()));
    }

    #[test]
    fn unreachable_anki_returns_japanese_error() {
        let payload = json!({"action": "request", "ankiAction": "deckNames"})
            .as_object()
            .unwrap()
            .clone();
        let result = handle_anki(&payload, &unreachable_client());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Anki"));
    }
}
