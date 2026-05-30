#!/usr/bin/env bash
# Native-messaging launcher: Chrome/Brave execs this; it runs the Node host.
# Self-locating so the installed manifest can point an absolute path here.
DIR="$(cd "$(dirname "$0")" && pwd)"
# Browsers may spawn with a minimal env — make sure node/claude/yt-dlp are findable.
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
exec node "$DIR/backend/native-host.mjs"
