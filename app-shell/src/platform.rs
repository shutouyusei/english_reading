use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// `TOEFL_REPO_ROOT` が設定されていればそれを、なければ起動時のカレントディレクトリを
/// 返す(既存Swift版 main.swift の起動時解決と同じ規約)。
pub fn resolve_repo_root(env: &HashMap<String, String>, current_dir: &Path) -> PathBuf {
    match env.get("TOEFL_REPO_ROOT") {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => current_dir.to_path_buf(),
    }
}

/// OSごとのデータディレクトリ既定値。Windows枝はこの開発環境ではビルド・検証されない
/// (docs/superpowers/specs/2026-09-03-cross-platform-shell-design.md 参照)。
#[cfg(target_os = "macos")]
pub fn default_data_dir(home: &Path) -> PathBuf {
    home.join("Documents/TOEFLReading")
}

#[cfg(target_os = "linux")]
pub fn default_data_dir(home: &Path) -> PathBuf {
    home.join(".local/share/toefl-reading")
}

#[cfg(target_os = "windows")]
pub fn default_data_dir(home: &Path) -> PathBuf {
    home.join("AppData/Roaming/toefl-reading")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};

    #[test]
    fn uses_env_override_when_present() {
        let mut env = HashMap::new();
        env.insert("TOEFL_REPO_ROOT".to_string(), "/tmp/custom-root".to_string());
        let result = resolve_repo_root(&env, Path::new("/tmp/cwd"));
        assert_eq!(result, PathBuf::from("/tmp/custom-root"));
    }

    #[test]
    fn falls_back_to_current_dir_when_env_missing() {
        let env = HashMap::new();
        let result = resolve_repo_root(&env, Path::new("/tmp/cwd"));
        assert_eq!(result, PathBuf::from("/tmp/cwd"));
    }

    #[test]
    fn falls_back_to_current_dir_when_env_empty() {
        let mut env = HashMap::new();
        env.insert("TOEFL_REPO_ROOT".to_string(), "".to_string());
        let result = resolve_repo_root(&env, Path::new("/tmp/cwd"));
        assert_eq!(result, PathBuf::from("/tmp/cwd"));
    }

    #[test]
    fn default_data_dir_is_under_home() {
        let home = Path::new("/Users/example");
        let dir = default_data_dir(home);
        assert!(dir.starts_with(home));
        assert_ne!(dir, home);
    }
}
