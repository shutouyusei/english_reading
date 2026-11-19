use serde_json::{Map, Value};

pub const UNAVAILABLE_MESSAGE: &str = "This feature is not available yet";

/// Text-to-speech is left for the future. For now it always returns an error.
pub fn handle_speech(_payload: &Map<String, Value>) -> Result<Value, String> {
    Err(UNAVAILABLE_MESSAGE.to_string())
}
