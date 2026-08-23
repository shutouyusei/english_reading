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

SYSTEM_DICTIONARY_OUT="$TMP/test_system_dictionary"
swiftc -O app/src/SystemDictionary.swift app/tests/test_system_dictionary.swift \
  -o "$SYSTEM_DICTIONARY_OUT"
"$SYSTEM_DICTIONARY_OUT"

# JS から Swift の辞書引きまでを WKWebView 越しに通す。
DICTIONARY_HANDLER_OUT="$TMP/test_dictionary_handler"
swiftc -O app/src/SystemDictionary.swift app/src/DictionaryHandler.swift \
  app/tests/test_dictionary_handler.swift -o "$DICTIONARY_HANDLER_OUT"
"$DICTIONARY_HANDLER_OUT"

SPEECH_SYNTHESIZER_OUT="$TMP/test_speech_synthesizer"
swiftc -O app/src/SpeechSynthesizer.swift app/tests/test_speech_synthesizer.swift \
  -o "$SPEECH_SYNTHESIZER_OUT"
"$SPEECH_SYNTHESIZER_OUT"

# JS から Swift の音声生成までを WKWebView 越しに通す。
SPEECH_HANDLER_OUT="$TMP/test_speech_handler"
swiftc -O app/src/PathResolver.swift app/src/ContentSchemeHandler.swift \
  app/src/SpeechSynthesizer.swift app/src/SpeechHandler.swift \
  app/tests/test_speech_handler.swift -o "$SPEECH_HANDLER_OUT"
"$SPEECH_HANDLER_OUT"

AUDIO_SCHEME_OUT="$TMP/test_audio_scheme"
swiftc -O app/src/PathResolver.swift app/tests/test_audio_scheme.swift -o "$AUDIO_SCHEME_OUT"
"$AUDIO_SCHEME_OUT"

ANKI_CLIENT_OUT="$TMP/test_anki_client"
swiftc -O app/src/AnkiClient.swift app/tests/test_anki_client.swift -o "$ANKI_CLIENT_OUT"
"$ANKI_CLIENT_OUT"

# 起動から一覧描画までの通し確認。WKWebView を実際に動かすため単体テストより遅い。
SMOKE_OUT="$TMP/test_smoke_app"
swiftc -O app/src/PathResolver.swift app/tests/test_smoke_app.swift -o "$SMOKE_OUT"
REPO="$(pwd)" "$SMOKE_OUT"

echo "Swift tests: all passed"
