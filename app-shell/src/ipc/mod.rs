mod anki;
mod essays;
mod grader;
mod placeholder;
mod store;

use serde_json::{Map, Value};

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Handler {
    Store,
    Listening,
    Essays,
    Grader,
    Anki,
    Dictionary,
    Speech,
}

#[derive(Debug, PartialEq)]
pub enum IpcParseError {
    InvalidJson,
    MissingRequestId,
    MissingHandler,
    UnknownHandler(String),
}

#[derive(Debug, PartialEq)]
pub struct IpcRequest {
    pub request_id: String,
    pub handler: Handler,
    pub payload: Map<String, Value>,
}

/// JS から届いた `{handler, requestId, ...payload}` を解析する。
pub fn parse_ipc_request(raw: &str) -> Result<IpcRequest, IpcParseError> {
    let value: Value = serde_json::from_str(raw).map_err(|_| IpcParseError::InvalidJson)?;
    let mut object = match value {
        Value::Object(map) => map,
        _ => return Err(IpcParseError::InvalidJson),
    };

    let request_id = match object.remove("requestId") {
        Some(Value::String(s)) if !s.is_empty() => s,
        _ => return Err(IpcParseError::MissingRequestId),
    };

    let handler_name = match object.remove("handler") {
        Some(Value::String(s)) => s,
        _ => return Err(IpcParseError::MissingHandler),
    };

    let handler = match handler_name.as_str() {
        "store" => Handler::Store,
        "listening" => Handler::Listening,
        "essays" => Handler::Essays,
        "grader" => Handler::Grader,
        "anki" => Handler::Anki,
        "dictionary" => Handler::Dictionary,
        "speech" => Handler::Speech,
        other => return Err(IpcParseError::UnknownHandler(other.to_string())),
    };

    Ok(IpcRequest { request_id, handler, payload: object })
}

/// `window.__toeflIpcResolve(requestId, result, error)` を呼ぶJSを組み立てる。
/// `Value` の `Display` 実装がJSONエンコードするので、引用符・バックスラッシュ等の
/// エスケープはここで手作業しない。
pub fn format_resolve_script(request_id: &str, result: Option<&Value>, error: Option<&str>) -> String {
    let request_id_json = Value::String(request_id.to_string());
    let result_json = result.cloned().unwrap_or(Value::Null);
    let error_json = match error {
        Some(message) => Value::String(message.to_string()),
        None => Value::Null,
    };
    format!("window.__toeflIpcResolve({request_id_json}, {result_json}, {error_json})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_json_is_rejected() {
        assert_eq!(parse_ipc_request("not json"), Err(IpcParseError::InvalidJson));
    }

    #[test]
    fn non_object_json_is_rejected() {
        assert_eq!(parse_ipc_request("42"), Err(IpcParseError::InvalidJson));
    }

    #[test]
    fn missing_request_id_is_rejected() {
        let raw = r#"{"handler":"store","action":"loadAll"}"#;
        assert_eq!(parse_ipc_request(raw), Err(IpcParseError::MissingRequestId));
    }

    #[test]
    fn missing_handler_is_rejected() {
        let raw = r#"{"requestId":"1","action":"loadAll"}"#;
        assert_eq!(parse_ipc_request(raw), Err(IpcParseError::MissingHandler));
    }

    #[test]
    fn unknown_handler_is_rejected() {
        let raw = r#"{"requestId":"1","handler":"unknown"}"#;
        assert_eq!(
            parse_ipc_request(raw),
            Err(IpcParseError::UnknownHandler("unknown".to_string()))
        );
    }

    #[test]
    fn routes_each_known_handler() {
        for (name, expected) in [
            ("store", Handler::Store),
            ("listening", Handler::Listening),
            ("essays", Handler::Essays),
            ("grader", Handler::Grader),
            ("anki", Handler::Anki),
            ("dictionary", Handler::Dictionary),
            ("speech", Handler::Speech),
        ] {
            let raw = format!(r#"{{"requestId":"1","handler":"{name}","action":"x"}}"#);
            let parsed = parse_ipc_request(&raw).unwrap();
            assert_eq!(parsed.handler, expected);
            assert_eq!(parsed.request_id, "1");
        }
    }

    #[test]
    fn payload_excludes_request_id_and_handler_but_keeps_rest() {
        let raw = r#"{"requestId":"1","handler":"store","action":"loadAll"}"#;
        let parsed = parse_ipc_request(raw).unwrap();
        assert_eq!(parsed.payload.get("action").unwrap(), "loadAll");
        assert!(parsed.payload.get("requestId").is_none());
        assert!(parsed.payload.get("handler").is_none());
    }

    #[test]
    fn formats_success_with_result() {
        let result = serde_json::json!({"ok": true});
        let script = format_resolve_script("42", Some(&result), None);
        assert_eq!(script, r#"window.__toeflIpcResolve("42", {"ok":true}, null)"#);
    }

    #[test]
    fn formats_success_with_no_result() {
        let script = format_resolve_script("1", None, None);
        assert_eq!(script, r#"window.__toeflIpcResolve("1", null, null)"#);
    }

    #[test]
    fn error_message_is_valid_json_encoded() {
        let message = "quote\" and \\backslash";
        let script = format_resolve_script("1", None, Some(message));
        // 手書きのエスケープ文字列を避けるため、生成された断片を逆方向にパースして確認する。
        let error_part = script
            .strip_prefix("window.__toeflIpcResolve(\"1\", null, ")
            .and_then(|s| s.strip_suffix(')'))
            .expect("prefix/suffix should match");
        let parsed: Value = serde_json::from_str(error_part).unwrap();
        assert_eq!(parsed, Value::String(message.to_string()));
    }
}
