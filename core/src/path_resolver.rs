use std::path::{Path, PathBuf};

/// app:// への要求パスを、リポジトリルート配下の実ファイルへ解決する。
/// ルートの外を指す場合は None を返す(ディレクトリ脱出の防止)。
pub fn resolve_content_path(root: &Path, request_path: &str) -> Option<PathBuf> {
    let relative = request_path.strip_prefix('/').unwrap_or(request_path);
    let target = lexically_normalize(&root.join(relative));
    let root_normalized = lexically_normalize(root);

    if target != root_normalized && !target.starts_with(&root_normalized) {
        return None;
    }

    // 字句チェックを通っても、シンボリックリンクで外へ出られる場合がある。
    // 実体のパスでもう一度確かめる(存在しないパスは symlink 脱出のしようがないため許可する)。
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

/// `..` や `.` を字句的に畳み込む(実ファイルの存在有無は問わない)。
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

/// 問題IDから問題JSONの実ファイルを解決する。
/// ID は画面(JS)から来るため、リポジトリ配下に収まることを必ず確かめる。
/// docs/data/writing/ 自体を「ルート」として resolve_content_path に渡すことで、
/// .. を使って同フォルダの外(リポジトリ内の他ファイルも含む)へ出る経路を塞ぐ。
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
    fn resolves_without_leading_slash() {
        let root = Path::new("/tmp/repo");
        assert_eq!(
            resolve_content_path(root, "docs/index.html"),
            Some(PathBuf::from("/tmp/repo/docs/index.html"))
        );
    }

    #[test]
    fn allows_root_itself() {
        let root = Path::new("/tmp/repo");
        assert_eq!(resolve_content_path(root, "/"), Some(PathBuf::from("/tmp/repo")));
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
