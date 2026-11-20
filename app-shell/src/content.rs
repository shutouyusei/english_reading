use std::path::Path;
use toefl_core::content_scheme::build_content_response;

/// The pure logic part. It does not depend on wry types, so it is easy to unit test.
/// Builds a 404 when the file cannot be found or read.
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
    fn escaping_the_root_returns_404() {
        let dir = temp_root();
        let (status, _, _) = respond(&dir, "/../../etc/passwd", None);
        assert_eq!(status, 404);
        let _ = fs::remove_dir_all(&dir);
    }
}
