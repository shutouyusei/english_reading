use serde_json::Value;
use std::fmt;
use std::time::Duration;

/// Why adding to Anki failed. Each variant carries a message that can be shown on
/// screen as is.
///
/// The point is not to lump everything into "cannot connect". The browser's fetch turns
/// both an unreachable network and a CORS rejection into the same "Load failed", so
/// neither the user nor the author could tell the cause.
#[derive(Debug)]
pub enum AnkiError {
    /// Could not connect at all. Anki is not running or AnkiConnect is not installed.
    NotRunning,
    /// Connected, but Anki returned an error. The message is passed on as Anki wrote it.
    AnkiReported(String),
    /// Connected, but the response could not be parsed, e.g. when something other than
    /// AnkiConnect is using the same port.
    UnreadableResponse(String),
    BadStatus(u16),
}

impl fmt::Display for AnkiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AnkiError::NotRunning => write!(
                f,
                "Cannot connect to Anki. Start Anki and check that the AnkiConnect add-on is enabled."
            ),
            AnkiError::AnkiReported(message) => write!(f, "Anki returned an error: {message}"),
            AnkiError::UnreadableResponse(detail) => {
                write!(f, "Could not read the response from Anki: {detail}")
            }
            AnkiError::BadStatus(code) => write!(f, "Anki returned an unexpected response (HTTP {code})"),
        }
    }
}

impl std::error::Error for AnkiError {}

/// Calls the AnkiConnect HTTP API.
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

    /// Blocks the calling thread while it waits. It is slow, so always call it from a
    /// thread other than the main thread.
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

        // To the user, a refused connection and a timeout both mean "Anki is not there".
        let response = match response {
            Ok(response) => response,
            Err(ureq::Error::Status(code, _)) => return Err(AnkiError::BadStatus(code)),
            Err(ureq::Error::Transport(_)) => return Err(AnkiError::NotRunning),
        };

        let text = response
            .into_string()
            .map_err(|e| AnkiError::UnreadableResponse(format!("the response body could not be read: {e}")))?;

        let payload: Value = serde_json::from_str(&text).map_err(|_| {
            let head: String = text.chars().take(60).collect();
            AnkiError::UnreadableResponse(if head.is_empty() {
                "(empty response)".to_string()
            } else {
                head
            })
        })?;
        let Value::Object(payload) = payload else {
            let head: String = text.chars().take(60).collect();
            return Err(AnkiError::UnreadableResponse(head));
        };

        // AnkiConnect returns the error key as null even on success, so null and a
        // string are told apart.
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
    use std::io::{BufRead, BufReader};
    use std::process::{Child, Command};

    struct StubServer {
        child: Child,
        port: u16,
    }
    impl Drop for StubServer {
        fn drop(&mut self) {
            let _ = self.child.kill();
        }
    }

    /// Stands in for AnkiConnect with python3. Real HTTP is exchanged, so the client
    /// and its header handling are covered too. The stub binds a free port and prints
    /// it once it is listening, so tests neither share ports nor sleep.
    fn start_stub_server(mode: &str) -> StubServer {
        let script = String::from(
            r#"
import http.server, json, sys
MODE = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n).decode())
        if MODE == "ok":
            out = json.dumps({"result": {"echo": req.get("action")}, "error": None}).encode()
        elif MODE == "anki_error":
            out = json.dumps({"result": None, "error": "deck not found"}).encode()
        else:
            out = b"not json at all"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)
    def log_message(self, *a): pass
server = http.server.HTTPServer(("127.0.0.1", 0), H)
print(server.server_address[1], flush=True)
server.serve_forever()
"#,
        );
        let mut child = Command::new("python3")
            .args(["-c", &script, mode])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("failed to start the python3 stub server");
        let mut line = String::new();
        BufReader::new(child.stdout.take().expect("the stub server has no stdout"))
            .read_line(&mut line)
            .expect("failed to read the stub server's port");
        let port = line.trim().parse().expect("the stub server did not print a port");
        StubServer { child, port }
    }

    fn endpoint(port: u16) -> String {
        format!("http://127.0.0.1:{port}")
    }

    /// A port nothing listens on: bind a free one, then release it.
    fn unused_port() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("failed to bind a free port");
        listener.local_addr().expect("the listener has no address").port()
    }

    #[test]
    fn extracts_result_from_a_normal_response() {
        let server = start_stub_server("ok");
        let client = AnkiClient::new(endpoint(server.port), Duration::from_secs(5));
        let result = client.request("version", serde_json::json!({})).unwrap();
        assert_eq!(result.unwrap()["echo"], "version");
    }

    #[test]
    fn distinguishes_anki_not_running() {
        let offline = AnkiClient::new(endpoint(unused_port()), Duration::from_secs(3));
        let error = offline.request("version", serde_json::json!({})).unwrap_err();
        assert!(matches!(error, AnkiError::NotRunning));
        assert!(error.to_string().contains("Anki"));
    }

    #[test]
    fn treats_anki_reported_error_as_failure() {
        let server = start_stub_server("anki_error");
        let client = AnkiClient::new(endpoint(server.port), Duration::from_secs(5));
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
        let server = start_stub_server("garbage");
        let client = AnkiClient::new(endpoint(server.port), Duration::from_secs(5));
        let error = client.request("version", serde_json::json!({})).unwrap_err();
        assert!(matches!(error, AnkiError::UnreadableResponse(_)));
    }
}
