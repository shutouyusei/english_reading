use serde_json::{Map, Value};
use std::fs;
use std::io;
use std::path::PathBuf;

/// Parses JSON Lines data one line at a time.
/// A broken line is dropped on its own; the other lines are not lost.
/// attempts.jsonl, listening.jsonl and essays.jsonl all use this.
pub fn parse_json_lines(data: &[u8]) -> Vec<Map<String, Value>> {
    data.split(|&b| b == 0x0A)
        .filter_map(|line| match serde_json::from_slice::<Value>(line) {
            Ok(Value::Object(map)) => Some(map),
            _ => None,
        })
        .collect()
}

/// An append-only JSON Lines file.
/// The reading log (attempts.jsonl), the listening log (listening.jsonl) and writing
/// (essays.jsonl) are handled the same way, so the read and write steps are kept here
/// in one place.
pub struct JsonLinesFile {
    path: PathBuf,
}

impl JsonLinesFile {
    pub fn new(directory: &std::path::Path, filename: &str) -> Self {
        Self {
            path: directory.join(filename),
        }
    }

    /// Returns an empty list when the file does not exist yet. Being unreadable is not
    /// an error in itself.
    pub fn load_all(&self) -> Vec<Map<String, Value>> {
        match fs::read(&self.path) {
            Ok(data) => parse_json_lines(&data),
            Err(_) => Vec::new(),
        }
    }

    /// Only adds one line at the end. Existing lines are never read or rewritten.
    pub fn append(&self, row: &Map<String, Value>) -> io::Result<()> {
        use std::io::Write;

        let mut line = serde_json::to_vec(row)?;
        line.push(0x0A);

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(&line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_lines_before_a_truncated_utf8_tail() {
        let mut data = b"{\"passageId\":\"passage_001\",\"score\":1}\n{\"passageId\":\"passage_002\",\"score\":0}".to_vec();
        data.push(0x0A);
        data.extend_from_slice(&[0xE6, 0x97]); // a 3-byte UTF-8 sequence cut off after 2 bytes
        let result = parse_json_lines(&data);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].get("passageId"), Some(&json!("passage_001")));
    }

    #[test]
    fn drops_only_the_broken_json_line() {
        let text = "{\"passageId\":\"passage_001\",\"score\":1}\n{\"passageId\":\"passage_002\",\"score\":0}\n{\"passageId\":\"passage_003\",";
        assert_eq!(parse_json_lines(text.as_bytes()).len(), 2);
    }

    fn row(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    #[test]
    fn file_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!("jsonl-test-{}", uuid_like()));
        let _cleanup = Cleanup(temp_dir.clone());

        let log = JsonLinesFile::new(&temp_dir, "rows.jsonl");

        assert!(log.load_all().is_empty());

        log.append(&row(&[("id", json!("a")), ("score", json!(1))])).unwrap();
        let after_first = log.load_all();
        assert_eq!(after_first.len(), 1);
        assert_eq!(after_first[0].get("id"), Some(&json!("a")));

        // The point: adding a second line keeps the first (append, not overwrite).
        log.append(&row(&[("id", json!("b")), ("score", json!(2))])).unwrap();
        log.append(&row(&[("id", json!("c")), ("score", json!(3))])).unwrap();
        let after_third = log.load_all();
        let ids: Vec<_> = after_third.iter().map(|r| r.get("id").unwrap().clone()).collect();
        assert_eq!(ids, vec![json!("a"), json!("b"), json!("c")]);

        // Each line ends with a newline. Without it the next read would see one merged line.
        let raw = fs::read_to_string(temp_dir.join("rows.jsonl")).unwrap();
        assert!(raw.ends_with('\n'));
        assert_eq!(raw.split('\n').filter(|l| !l.is_empty()).count(), 3);
    }

    #[test]
    fn creates_missing_directory_on_first_append() {
        let temp_dir = std::env::temp_dir().join(format!("jsonl-test-{}", uuid_like()));
        let _cleanup = Cleanup(temp_dir.clone());
        let nested_dir = temp_dir.join("not-created-yet");
        let nested = JsonLinesFile::new(&nested_dir, "rows.jsonl");

        nested.append(&row(&[("id", json!("z"))])).unwrap();

        assert_eq!(nested.load_all().len(), 1);
    }

    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn uuid_like() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        format!(
            "{}-{:?}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        )
    }
}
