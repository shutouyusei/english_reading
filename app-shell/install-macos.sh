#!/bin/sh
# Installs a double-clickable launcher, "TOEFL Study.app", into /Applications.
# The bundle only starts the binary built in this repository, with TOEFL_REPO_ROOT set to
# it, so the repository must stay where it is. Run this again after moving the repository.
set -e
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
BIN="$REPO_ROOT/app-shell/target/release/app_shell"
APP="/Applications/TOEFL Study.app"

if [ ! -x "$BIN" ]; then
  sh app-shell/build.sh
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Build AppIcon.icns from icon.png (rendered from icon.svg; re-render it with
# `rsvg-convert -w 1024 -h 1024 app-shell/icon.svg -o app-shell/icon.png`).
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" app-shell/icon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" app-shell/icon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/MacOS/launcher" <<EOF
#!/bin/sh
export TOEFL_REPO_ROOT="$REPO_ROOT"
exec "$BIN"
EOF
chmod +x "$APP/Contents/MacOS/launcher"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TOEFL Study</string>
  <key>CFBundleDisplayName</key><string>TOEFL Study</string>
  <key>CFBundleIdentifier</key><string>io.github.shutouyusei.toefl-study</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

echo "Installed: $APP"
echo "It starts $BIN with TOEFL_REPO_ROOT=$REPO_ROOT"
