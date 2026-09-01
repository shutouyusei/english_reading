use crate::byte_range::{parse_byte_range, ByteRangeRequest};
use crate::path_resolver::resolve_content_path;
use std::path::Path;

/// スキームハンドラが返す応答。呼び出し側(Tauriのプロトコルハンドラ等)が
/// これをそのままHTTPレスポンスに変換する。
pub struct ContentResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

fn mime_type_for(extension: &str) -> &'static str {
    match extension.to_lowercase().as_str() {
        "html" => "text/html",
        "js" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "m4a" => "audio/mp4",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

/// 指定したルート配下の実ファイルを、Range 要求も踏まえて読み出す。
/// root は app:// ならリポジトリルート、audio:// なら音声キャッシュを渡す。
/// どちらの場合も resolve_content_path がルート外への脱出を拒否する。
///
/// <audio> は音声ファイルを Range 要求で読む。全体を 200 で返し続けると
/// 音声要素が networkState=3 (NETWORK_NO_SOURCE) に落ち、一切再生されない
/// (詳しい経緯は byte_range.rs 参照)。
///
/// ファイルが解決できない・読めない場合は None(呼び出し側で 404 にする)。
pub fn build_content_response(
    root: &Path,
    request_path: &str,
    range_header: Option<&str>,
) -> Option<ContentResponse> {
    let file = resolve_content_path(root, request_path)?;
    let data = std::fs::read(&file).ok()?;

    let extension = file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let mime = mime_type_for(extension);

    let mut headers = vec![
        ("Content-Type".to_string(), format!("{mime}; charset=utf-8")),
        ("Accept-Ranges".to_string(), "bytes".to_string()),
    ];

    let range = parse_byte_range(range_header, data.len() as i64);
    let (status, body) = match range {
        ByteRangeRequest::Whole => (200, data.clone()),
        ByteRangeRequest::Partial { start, end } => {
            headers.push((
                "Content-Range".to_string(),
                format!("bytes {start}-{end}/{}", data.len()),
            ));
            (206, data[start as usize..=end as usize].to_vec())
        }
        ByteRangeRequest::Unsatisfiable => {
            headers.push((
                "Content-Range".to_string(),
                format!("bytes */{}", data.len()),
            ));
            (416, Vec::new())
        }
    };
    headers.push(("Content-Length".to_string(), body.len().to_string()));

    Some(ContentResponse {
        status,
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TempDir(std::path::PathBuf);
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_dir(name: &str) -> TempDir {
        let dir = std::env::temp_dir().join(format!("content-scheme-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    #[test]
    fn missing_file_returns_none() {
        let dir = temp_dir("missing");
        assert!(build_content_response(&dir.0, "/nope.html", None).is_none());
    }

    #[test]
    fn escaping_the_root_returns_none() {
        let dir = temp_dir("escape");
        let secret = dir.0.parent().unwrap().join("secret.txt");
        fs::write(&secret, "secret").unwrap();
        assert!(build_content_response(&dir.0, "/../secret.txt", None).is_none());
        let _ = fs::remove_file(&secret);
    }

    #[test]
    fn whole_file_is_200_with_content_type() {
        let dir = temp_dir("whole");
        fs::write(dir.0.join("index.html"), "<html></html>").unwrap();

        let response = build_content_response(&dir.0, "/index.html", None).unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(response.body, b"<html></html>");
        assert!(response
            .headers
            .iter()
            .any(|(k, v)| k == "Content-Type" && v == "text/html; charset=utf-8"));
        assert!(response
            .headers
            .iter()
            .any(|(k, v)| k == "Content-Length" && v == "13"));
    }

    #[test]
    fn partial_range_is_206_with_content_range() {
        let dir = temp_dir("partial");
        fs::write(dir.0.join("audio.m4a"), b"0123456789").unwrap();

        let response = build_content_response(&dir.0, "/audio.m4a", Some("bytes=2-4")).unwrap();

        assert_eq!(response.status, 206);
        assert_eq!(response.body, b"234");
        assert!(response
            .headers
            .iter()
            .any(|(k, v)| k == "Content-Range" && v == "bytes 2-4/10"));
        assert!(response
            .headers
            .iter()
            .any(|(k, v)| k == "Content-Type" && v == "audio/mp4; charset=utf-8"));
    }

    #[test]
    fn unsatisfiable_range_is_416_with_empty_body() {
        let dir = temp_dir("unsatisfiable");
        fs::write(dir.0.join("audio.m4a"), b"0123456789").unwrap();

        let response =
            build_content_response(&dir.0, "/audio.m4a", Some("bytes=100-")).unwrap();

        assert_eq!(response.status, 416);
        assert!(response.body.is_empty());
        assert!(response
            .headers
            .iter()
            .any(|(k, v)| k == "Content-Range" && v == "bytes */10"));
    }
}
