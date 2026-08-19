#!/bin/sh
# TOEFLReading.app をビルドする。Xcode プロジェクトも署名も使わない。
set -e
cd "$(dirname "$0")/.."

APP="app/build/TOEFLReading.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TOEFL Reading</string>
  <key>CFBundleDisplayName</key><string>TOEFL Reading</string>
  <key>CFBundleIdentifier</key><string>local.toefl.reading</string>
  <key>CFBundleExecutable</key><string>TOEFLReading</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

swiftc -O app/src/PathResolver.swift app/src/JSONLinesLog.swift \
  app/src/ClaudeRunner.swift app/src/ContentSchemeHandler.swift \
  app/src/LogHandlers.swift app/src/GradeHandler.swift \
  app/src/SystemDictionary.swift app/src/DictionaryHandler.swift \
  app/src/SpeechSynthesizer.swift \
  app/src/main.swift \
  -o "$APP/Contents/MacOS/TOEFLReading"

echo "ビルド完了: $APP"
echo "起動: open \"$APP\""
