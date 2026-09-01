use serde_json::Value;
use std::fmt;
use std::time::Duration;

/// Anki への追加が失敗した理由。画面にそのまま出せる日本語を持たせる。
///
/// 「繋がらない」を一括りにしないのが要点。ブラウザの fetch はネットワーク不達も
/// CORS 拒否も同じ "Load failed" にしてしまい、利用者にも作者にも原因が分からなかった。
#[derive(Debug)]
pub enum AnkiError {
    /// 接続そのものができない。Anki が起動していないか AnkiConnect が入っていない。
    NotRunning,
    /// 繋がったが Anki 側がエラーを返した。文言は Anki のものをそのまま渡す。
    AnkiReported(String),
    /// 繋がったが応答を解釈できない。AnkiConnect 以外が同じポートを使っている場合など。
    UnreadableResponse(String),
    /// HTTP のステータスが 200 でない。
    BadStatus(u16),
}

impl fmt::Display for AnkiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AnkiError::NotRunning => write!(
                f,
                "Anki に接続できません。Anki を起動し、AnkiConnect アドオンが有効か確認してください"
            ),
            AnkiError::AnkiReported(message) => write!(f, "Anki がエラーを返しました: {message}"),
            AnkiError::UnreadableResponse(detail) => {
                write!(f, "Anki の応答を解釈できません: {detail}")
            }
            AnkiError::BadStatus(code) => write!(f, "Anki が異常な応答を返しました(HTTP {code})"),
        }
    }
}

impl std::error::Error for AnkiError {}

/// AnkiConnect の HTTP API を叩く。
pub struct AnkiClient {
    endpoint: String,
    timeout: Duration,
}

impl Default for AnkiClient {
    fn default() -> Self {
        Self::new("http://127.0.0.1:8765", Duration::from_secs(10))
    }
}

impl AnkiClient {
    pub fn new(endpoint: impl Into<String>, timeout: Duration) -> Self {
        Self {
            endpoint: endpoint.into(),
            timeout,
        }
    }

    /// 呼び出し側のスレッドを塞いで待つ。重いので必ずメインスレッド以外から呼ぶこと。
    pub fn request(&self, action: &str, params: Value) -> Result<Option<Value>, AnkiError> {
        let body = serde_json::json!({
            "action": action,
            "version": 6,
            "params": params,
        });

        let agent = ureq::AgentBuilder::new()
            .timeout_connect(self.timeout)
            .timeout(self.timeout)
            .build();

        let response = agent
            .post(&self.endpoint)
            .set("Content-Type", "application/json")
            .send_string(&body.to_string());

        // 接続拒否もタイムアウトも、利用者にとっては「Anki が居ない」で同じ。
        let response = match response {
            Ok(response) => response,
            Err(ureq::Error::Status(code, _)) => return Err(AnkiError::BadStatus(code)),
            Err(ureq::Error::Transport(_)) => return Err(AnkiError::NotRunning),
        };

        let text = response
            .into_string()
            .map_err(|e| AnkiError::UnreadableResponse(format!("応答を読めません: {e}")))?;

        let payload: Value = serde_json::from_str(&text).map_err(|_| {
            let head: String = text.chars().take(60).collect();
            AnkiError::UnreadableResponse(if head.is_empty() {
                "(読めないバイト列)".to_string()
            } else {
                head
            })
        })?;
        let Value::Object(payload) = payload else {
            let head: String = text.chars().take(60).collect();
            return Err(AnkiError::UnreadableResponse(head));
        };

        // AnkiConnect は成功時も error キーを null で返す。null と文字列を区別する。
        if let Some(Value::String(message)) = payload.get("error") {
            if !message.is_empty() {
                return Err(AnkiError::AnkiReported(message.clone()));
            }
        }
        Ok(payload.get("result").cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command};
    use std::thread;

    struct StubServer(Child);
    impl Drop for StubServer {
        fn drop(&mut self) {
            let _ = self.0.kill();
        }
    }

    /// AnkiConnect の代役を python3 で立てる。実際の HTTP をやり取りするため、
    /// クライアントとヘッダの扱いまで含めて確かめられる。
    fn start_stub_server(port: u16, mode: &str) -> StubServer {
        let script = format!(
            r#"
import http.server, json, sys
MODE = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n).decode())
        if MODE == "ok":
            out = json.dumps({{"result": {{"echo": req.get("action")}}, "error": None}}).encode()
        elif MODE == "anki_error":
            out = json.dumps({{"result": None, "error": "deck not found"}}).encode()
        else:
            out = b"not json at all"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", {port}), H).serve_forever()
"#
        );
        let child = Command::new("python3")
            .args(["-c", &script, mode])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("python3 stub server起動に失敗した");
        thread::sleep(Duration::from_millis(500));
        StubServer(child)
    }

    fn endpoint(port: u16) -> String {
        format!("http://127.0.0.1:{port}")
    }

    fn contains_japanese(text: &str) -> bool {
        text.chars().any(|c| {
            let v = c as u32;
            (0x3040..=0x309F).contains(&v)
                || (0x30A0..=0x30FF).contains(&v)
                || (0x4E00..=0x9FFF).contains(&v)
        })
    }

    #[test]
    fn extracts_result_from_a_normal_response() {
        let _server = start_stub_server(18765, "ok");
        let client = AnkiClient::new(endpoint(18765), Duration::from_secs(5));
        let result = client.request("version", serde_json::json!({})).unwrap();
        assert_eq!(result.unwrap()["echo"], "version");
    }

    #[test]
    fn distinguishes_anki_not_running() {
        let offline = AnkiClient::new(endpoint(18799), Duration::from_secs(3));
        let error = offline.request("version", serde_json::json!({})).unwrap_err();
        assert!(matches!(error, AnkiError::NotRunning));
        assert!(contains_japanese(&error.to_string()));
    }

    #[test]
    fn treats_anki_reported_error_as_failure() {
        let _server = start_stub_server(18766, "anki_error");
        let client = AnkiClient::new(endpoint(18766), Duration::from_secs(5));
        let error = client
            .request("addNote", serde_json::json!({}))
            .unwrap_err();
        match error {
            AnkiError::AnkiReported(message) => assert_eq!(message, "deck not found"),
            other => panic!("expected AnkiReported, got {other:?}"),
        }
    }

    #[test]
    fn treats_non_json_response_as_failure() {
        let _server = start_stub_server(18767, "garbage");
        let client = AnkiClient::new(endpoint(18767), Duration::from_secs(5));
        let error = client.request("version", serde_json::json!({})).unwrap_err();
        assert!(matches!(error, AnkiError::UnreadableResponse(_)));
    }

    #[test]
    fn every_error_has_a_japanese_description() {
        let all = [
            AnkiError::NotRunning,
            AnkiError::AnkiReported("x".into()),
            AnkiError::UnreadableResponse("x".into()),
            AnkiError::BadStatus(500),
        ];
        for e in all {
            assert!(contains_japanese(&e.to_string()), "{e}");
        }
    }
}
