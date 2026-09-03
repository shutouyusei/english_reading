use serde_json::{Map, Value};

pub const UNAVAILABLE_MESSAGE: &str = "この機能はまだ利用できません";

/// 辞書引きは将来対応(docs/superpowers/specs/2026-09-03-cross-platform-shell-design.md
/// のスコープ外)。今は常に失敗を返す。
pub fn handle_dictionary(_payload: &Map<String, Value>) -> Result<Value, String> {
    Err(UNAVAILABLE_MESSAGE.to_string())
}

/// 読み上げも同様に将来対応。
pub fn handle_speech(_payload: &Map<String, Value>) -> Result<Value, String> {
    Err(UNAVAILABLE_MESSAGE.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dictionary_always_errors() {
        let payload = json!({"action": "define", "word": "example"}).as_object().unwrap().clone();
        assert_eq!(handle_dictionary(&payload), Err(UNAVAILABLE_MESSAGE.to_string()));
    }

    #[test]
    fn speech_always_errors() {
        let payload = json!({"action": "prepare", "id": "x"}).as_object().unwrap().clone();
        assert_eq!(handle_speech(&payload), Err(UNAVAILABLE_MESSAGE.to_string()));
    }
}
