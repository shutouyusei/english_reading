use std::path::Path;
use toefl_core::content_scheme::build_content_response;

/// 純粋なロジック部分。wryの型に依存しないので単体テストしやすい。
/// ファイルが見つからない・読めない場合は404を組み立てる。
pub fn respond(root: &Path, request_path: &str, range_header: Option<&str>) -> (u16, Vec<(String, String)>, Vec<u8>) {
    match build_content_response(root, request_path, range_header) {
        Some(response) => (response.status, response.headers, response.body),
        None => (404, Vec::new(), b"not found".to_vec()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("content-test-{}", uuid_like()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn uuid_like() -> String {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        format!(
            "{}-{:?}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    }

    #[test]
    fn missing_file_returns_404() {
        let dir = temp_root();
        let (status, _, _) = respond(&dir, "/nope.html", None);
        assert_eq!(status, 404);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn existing_file_returns_200_with_body_and_content_type() {
        let dir = temp_root();
        fs::write(dir.join("hello.html"), b"<p>hi</p>").unwrap();
        let (status, headers, body) = respond(&dir, "/hello.html", None);
        assert_eq!(status, 200);
        assert!(headers.iter().any(|(k, v)| k == "Content-Type" && v.starts_with("text/html")));
        assert_eq!(body, b"<p>hi</p>");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn escaping_the_root_returns_404() {
        let dir = temp_root();
        let (status, _, _) = respond(&dir, "/../../etc/passwd", None);
        assert_eq!(status, 404);
        let _ = fs::remove_dir_all(&dir);
    }
}
