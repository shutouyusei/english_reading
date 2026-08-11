#!/bin/sh
# Swift のユニットテスト。ソースとテストを1つの実行ファイルにまとめてビルドする。
set -e
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)

PATH_RESOLVER_OUT="$TMP/test_path_resolver"
swiftc -O app/src/PathResolver.swift app/tests/test_path_resolver.swift -o "$PATH_RESOLVER_OUT"
"$PATH_RESOLVER_OUT"

JSONLINES_LOG_OUT="$TMP/test_jsonlines_log"
swiftc -O app/src/JSONLinesLog.swift app/tests/test_jsonlines_log.swift -o "$JSONLINES_LOG_OUT"
"$JSONLINES_LOG_OUT"

CLAUDE_RUNNER_OUT="$TMP/test_claude_runner"
swiftc -O app/src/ClaudeRunner.swift app/tests/test_claude_runner.swift -o "$CLAUDE_RUNNER_OUT"
"$CLAUDE_RUNNER_OUT"

# 起動から一覧描画までの通し確認。WKWebView を実際に動かすため単体テストより遅い。
SMOKE_OUT="$TMP/test_smoke_app"
swiftc -O app/src/PathResolver.swift app/tests/test_smoke_app.swift -o "$SMOKE_OUT"
REPO="$(pwd)" "$SMOKE_OUT"

echo "Swift tests: all passed"
