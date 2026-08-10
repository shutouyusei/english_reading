#!/bin/sh
# Swift のユニットテスト。ソースとテストを1つの実行ファイルにまとめてビルドする。
set -e
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)

PATH_RESOLVER_OUT="$TMP/test_path_resolver"
swiftc -O app/src/PathResolver.swift app/tests/test_path_resolver.swift -o "$PATH_RESOLVER_OUT"
"$PATH_RESOLVER_OUT"

ATTEMPTS_LOG_OUT="$TMP/test_attempts_log"
swiftc -O app/src/AttemptsLog.swift app/tests/test_attempts_log.swift -o "$ATTEMPTS_LOG_OUT"
"$ATTEMPTS_LOG_OUT"

echo "Swift tests: all passed"
