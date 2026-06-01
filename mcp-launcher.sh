#!/usr/bin/env bash
# MCP launcher: an MCP client (Claude Code/Desktop) execs this; it runs the Node
# MCP server. Self-locating so a registration can point an absolute path here.
DIR="$(cd "$(dirname "$0")" && pwd)"
# Clients may spawn with a minimal env — make node/claude/yt-dlp findable, and
# prefer the installer's bundled yt-dlp (in DIR/bin) over anything on PATH.
export PATH="$DIR/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
[ -x "$DIR/bin/yt-dlp" ] && export YT_DISTILL_YTDLP="$DIR/bin/yt-dlp"
exec node "$DIR/backend/mcp-server.mjs"
