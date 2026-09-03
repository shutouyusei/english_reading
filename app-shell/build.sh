#!/bin/sh
# app-shell の release バイナリをビルドする。
# .app バンドル化は別タスク(docs/superpowers/specs/2026-09-03-cross-platform-shell-design.md
# の「未確定事項」参照)。
set -e
cd "$(dirname "$0")/.."

cargo build --release --manifest-path app-shell/Cargo.toml

BIN="app-shell/target/release/app_shell"
echo "ビルド完了: $BIN"
echo "起動: TOEFL_REPO_ROOT=\"\$(pwd)\" \"$BIN\""
