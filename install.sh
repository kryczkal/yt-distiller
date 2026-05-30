#!/usr/bin/env bash
# Install the native-messaging host so the extension can spawn the backend
# on demand. Run once. Re-run if you move the project folder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.yt_distill.host"
LAUNCHER="$ROOT/native-host-launcher.sh"

command -v node   >/dev/null || { echo "❌ node not found on PATH"; exit 1; }
command -v yt-dlp >/dev/null || echo "⚠️  yt-dlp not found — needed for transcripts."
command -v claude >/dev/null || echo "⚠️  'claude' CLI not found — needed for subscription auth (Claude Code, logged in)."

chmod +x "$LAUNCHER" "$ROOT/backend/native-host.mjs" 2>/dev/null || true
[ -d "$ROOT/backend/node_modules" ] || { echo "Installing backend deps…"; npm install --prefix "$ROOT/backend"; }

EXT_ID="$(node "$ROOT/tools/ext-id.mjs")"
echo "Extension id (pinned): $EXT_ID"

MANIFEST_JSON="$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "YouTube Distiller native host",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
)"

installed=0
for dir in \
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
  "$HOME/.config/google-chrome/NativeMessagingHosts" \
  "$HOME/.config/chromium/NativeMessagingHosts"; do
  parent="$(dirname "$dir")"
  if [ -d "$parent" ]; then
    mkdir -p "$dir"
    printf '%s\n' "$MANIFEST_JSON" > "$dir/$HOST_NAME.json"
    echo "installed → $dir/$HOST_NAME.json"
    installed=$((installed + 1))
  fi
done

if [ "$installed" -eq 0 ]; then
  echo "⚠️  No Brave/Chrome/Chromium profile dir found under ~/.config. Open the browser once, then re-run ./install.sh."
  exit 1
fi

echo
echo "✅ Native host installed for $installed browser(s)."
echo "Next: load the unpacked extension (extension/ folder). It will have id $EXT_ID."
echo "Optional Gemini fallback: cp .env.example .env  and add GEMINI_API_KEY."
