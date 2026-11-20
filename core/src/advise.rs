use crate::claude_runner::{run_prompt_template, ClaudeRunnerError};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::Path;

const ADVICE_TIMEOUT_SECONDS: u64 = 180;

/// Asks claude -p for study advice. `stats` is the summary the dashboard computed from
/// the learner's records; it is pasted into app/prompts/advise.md as JSON.
pub fn study_advice(root: &Path, stats: &Map<String, Value>) -> Result<Map<String, Value>, ClaudeRunnerError> {
    let stats_json = serde_json::to_string_pretty(stats).unwrap_or_else(|_| "{}".to_string());
    let mut values = HashMap::new();
    values.insert("stats".to_string(), stats_json);
    run_prompt_template(root, "advise", &values, ADVICE_TIMEOUT_SECONDS)
}

#[cfg(test)]
mod tests {
    use crate::claude_runner::split_prompt_file;
    use std::path::PathBuf;

    /// No other test reads the real prompt files, so a broken separator or a renamed
    /// placeholder would only show up when the learner presses the button.
    #[test]
    fn every_prompt_file_splits_and_keeps_its_placeholders() {
        let prompts = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../app/prompts");
        let expected = [
            ("advise", vec!["{{stats}}"]),
            ("grade-email", vec!["{{instructions}}", "{{situation}}", "{{recipient}}", "{{must_include}}", "{{essay}}"]),
            ("grade-discussion", vec!["{{instructions}}", "{{discussion}}", "{{essay}}"]),
        ];
        for (name, placeholders) in expected {
            let text = std::fs::read_to_string(prompts.join(format!("{name}.md")))
                .unwrap_or_else(|e| panic!("cannot read {name}.md: {e}"));
            let (system, user) = split_prompt_file(&text).unwrap_or_else(|| panic!("{name}.md does not split"));
            assert!(!system.trim().is_empty(), "{name}.md has an empty system part");
            for placeholder in placeholders {
                assert!(user.contains(placeholder), "{name}.md lacks {placeholder}");
            }
        }
    }
}
