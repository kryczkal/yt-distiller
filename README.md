# YouTube Distiller

**Right-click any YouTube video → dense brief in the side panel — or call it from Claude Code/Desktop.** Claude subscription — no API key.

<p align="center">
  <img src="docs/demo.gif" width="720" alt="Right-click a video; brief streams in the side panel" />
</p>

Distillation, not a summary — facts, numbers, and names stay; filler goes. `yt-dlp` for the transcript, Claude Agent SDK for the brief. Native host spawns on demand, exits when done.

Two surfaces, one core: the **browser extension** and an **MCP server** (the merged-in [`yt-mcp`](#mcp-server)) both run over the same `backend/lib/` — no duplicated logic.

## Install

**Linux or macOS** · Node ≥ 20 · Claude Code logged in (Pro/Max). One line:

```bash
curl -fsSL https://raw.githubusercontent.com/kryczkal/yt-distiller/main/bootstrap.sh | sh
```

It prints a plan of everything it touches and asks before doing anything — preview with `… | sh -s -- --dry-run`, skip the prompt with `--yes`. Bundles `yt-dlp` and registers the native host; no sudo, and nothing lands on your `$PATH` except a `yt-distiller` helper. It also **offers** to register the MCP server (decline with `--no-mcp`, force with `--with-mcp`). Then, once:

1. `brave://extensions` → **Developer mode** on
2. **Load unpacked** → `~/.yt-distiller/extension`

Manage it later: `yt-distiller doctor` · `yt-distiller update` · `yt-distiller uninstall`. *(Windows: not yet.)*

## Use

- **Distill** — right-click → **✦ Distill this video** (toolbar icon or paste URL)
- **Mark watched** — muted 2× play, like, close tab
- **Gemini** — no captions, or **⟳ video** for visual content; `GEMINI_API_KEY` in `.env`

## MCP server

The same engine is exposed as an MCP server, so any MCP client (Claude Code/Desktop) can pull transcripts and distill videos. Register it during install, or anytime with `yt-distiller mcp` (remove with `yt-distiller mcp uninstall`). For Claude Desktop, add `mcp-launcher.sh` under `mcpServers` in `claude_desktop_config.json`.

Tools:

- **`get_transcript`**`(url, lang="en")` — transcript as plain text.
- **`list_transcript_languages`**`(url)` — `{ manual, auto }` available caption languages.
- **`distill`**`(url, lang="en", mode="auto", raw=false)` — the dense brief. Runs on your Claude subscription; if you're not logged into Claude on that machine it gracefully returns the transcript + the distillation prompt for the calling model to run (the same fallback you get with `raw=true`). `mode="video"` uses Gemini to watch the video.

YouTube fork of [steipete/summarize](https://github.com/steipete/summarize), on subscription billing instead of an API key. Subsumes the standalone `yt-mcp` (transcript recipe, now in `backend/lib/transcript.js`).

MIT
