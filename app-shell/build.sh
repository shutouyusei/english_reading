#!/bin/sh
# Builds the app-shell release binary.
# Bundling into a .app is a separate task (see the "open questions" section of
# docs/superpowers/specs/2026-09-03-cross-platform-shell-design.md).
set -e
cd "$(dirname "$0")/.."

cargo build --release --manifest-path app-shell/Cargo.toml

BIN="app-shell/target/release/app_shell"
echo "ビルド完了: $BIN"
echo "起動: TOEFL_REPO_ROOT=\"\$(pwd)\" \"$BIN\""
