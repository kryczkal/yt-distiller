#!/usr/bin/env bash
# Native-messaging launcher: Chrome/Brave execs this; it runs the Node host.
# Self-locating so the installed manifest can point an absolute path here.
DIR="$(cd "$(dirname "$0")" && pwd)"
# Browsers spawn with a minimal env — make node/claude/yt-dlp findable, and
# prefer the installer's bundled yt-dlp (in DIR/bin) over anything on PATH.
export PATH="$DIR/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
[ -x "$DIR/bin/yt-dlp" ] && export YT_DISTILL_YTDLP="$DIR/bin/yt-dlp"
exec node "$DIR/backend/native-host.mjs"
