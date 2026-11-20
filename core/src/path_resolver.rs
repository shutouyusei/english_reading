use std::path::{Path, PathBuf};

/// Resolves a request path to a real file under `root`.
/// Returns None when it points outside the root (prevents directory traversal).
pub fn resolve_content_path(root: &Path, request_path: &str) -> Option<PathBuf> {
    let relative = request_path.strip_prefix('/').unwrap_or(request_path);
    let target = lexically_normalize(&root.join(relative));
    let root_normalized = lexically_normalize(root);

    if target != root_normalized && !target.starts_with(&root_normalized) {
        return None;
    }

    // Even when the lexical check passes, a symbolic link can still lead outside.
    // Check once more with the real paths (a path that does not exist cannot escape
    // through a symlink, so it is allowed).
    match (root.canonicalize(), target.canonicalize()) {
        (Ok(real_root), Ok(real_target)) => {
            if real_target != real_root && !real_target.starts_with(&real_root) {
                return None;
            }
        }
        _ => {}
    }

    Some(target)
}

/// Collapses `..` and `.` lexically (whether the file actually exists does not matter).
fn lexically_normalize(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                if !result.pop() {
                    result.push(component);
                }
            }
            Component::CurDir => {}
            other => result.push(other),
        }
    }
    result
}

/// Resolves a question ID to the real file of its question JSON.
/// The ID comes from the UI (JS), so always make sure it stays inside the repository.
/// Passing docs/data/writing/ itself as the "root" to resolve_content_path blocks any
/// route that uses .. to leave that folder (including to other files in the repository).
pub fn writing_prompt_path(root: &Path, prompt_id: &str) -> Option<PathBuf> {
    let writing_dir = root.join("docs/data/writing");
    resolve_content_path(&writing_dir, &format!("{prompt_id}.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolves_normal_path() {
        let root = Path::new("/tmp/repo");
        assert_eq!(
            resolve_content_path(root, "/docs/index.html"),
            Some(PathBuf::from("/tmp/repo/docs/index.html"))
        );
    }

    #[test]
    fn rejects_escape_to_parent() {
        let root = Path::new("/tmp/repo");
        assert_eq!(resolve_content_path(root, "/../etc/passwd"), None);
    }

    #[test]
    fn rejects_dotdot_in_middle() {
        let root = Path::new("/tmp/repo");
        assert_eq!(resolve_content_path(root, "/docs/../../etc/passwd"), None);
    }

    #[test]
    fn rejects_sibling_dir_with_same_prefix() {
        let root = Path::new("/tmp/repo");
        assert_eq!(resolve_content_path(root, "/../repo-evil/secret.txt"), None);
    }

    #[test]
    fn allows_dotdot_that_stays_inside_root() {
        let root = Path::new("/tmp/repo");
        assert_eq!(
            resolve_content_path(root, "/app/ui/../../docs/index.html"),
            Some(PathBuf::from("/tmp/repo/docs/index.html"))
        );
    }

    #[test]
    fn rejects_symlink_escape() {
        let tmp_root = std::env::temp_dir().join(format!("pathresolver-test-{}", std::process::id()));
        let outside = tmp_root.join("outside");
        let inside = tmp_root.join("inside");
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(&inside).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(&outside, inside.join("escape")).unwrap();

        let result = resolve_content_path(&inside, "/escape/secret.txt");

        fs::remove_dir_all(&tmp_root).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn writing_prompt_resolves_under_writing_dir() {
        let root = Path::new("/tmp/repo");
        assert_eq!(
            writing_prompt_path(root, "writing_001"),
            Some(PathBuf::from("/tmp/repo/docs/data/writing/writing_001.json"))
        );
    }

    #[test]
    fn writing_prompt_rejects_three_levels_up() {
        let root = Path::new("/tmp/repo");
        assert_eq!(writing_prompt_path(root, "../../../etc/hosts"), None);
    }

    #[test]
    fn writing_prompt_with_leading_slash_stays_inside() {
        let root = Path::new("/tmp/repo");
        assert_eq!(
            writing_prompt_path(root, "/etc/hosts"),
            Some(PathBuf::from("/tmp/repo/docs/data/writing/etc/hosts.json"))
        );
    }

    #[test]
    fn writing_prompt_rejects_dotdot_in_middle() {
        let root = Path::new("/tmp/repo");
        assert_eq!(writing_prompt_path(root, "a/../../b"), None);
    }
}
