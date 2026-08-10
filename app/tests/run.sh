#!/bin/sh
# Swift のユニットテスト。ソースとテストを1つの実行ファイルにまとめてビルドする。
set -e
cd "$(dirname "$0")/../.."
OUT=$(mktemp -d)/test_path_resolver
swiftc -O app/src/PathResolver.swift app/tests/test_path_resolver.swift -o "$OUT"
"$OUT"
echo "Swift tests: all passed"
