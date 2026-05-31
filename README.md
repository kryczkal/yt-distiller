# YouTube Distiller

**Right-click any YouTube video → dense brief in the side panel.** Claude subscription — no API key.

<p align="center">
  <img src="docs/demo.gif" width="720" alt="Right-click a video; brief streams in the side panel" />
</p>

Distillation, not a summary — facts, numbers, and names stay; filler goes. `yt-dlp` for the transcript, Claude Agent SDK for the brief. Native host spawns on demand, exits when done.

## Install

**Linux or macOS** · Node ≥ 20 · Claude Code logged in (Pro/Max). One line:

```bash
curl -fsSL https://raw.githubusercontent.com/kryczkal/yt-distiller/main/bootstrap.sh | sh
```

It prints a plan of everything it touches and asks before doing anything — preview with `… | sh -s -- --dry-run`, skip the prompt with `--yes`. Bundles `yt-dlp` and registers the native host; no sudo, and nothing lands on your `$PATH` except a `yt-distiller` helper. Then, once:

1. `brave://extensions` → **Developer mode** on
2. **Load unpacked** → `~/.yt-distiller/extension`

Manage it later: `yt-distiller doctor` · `yt-distiller update` · `yt-distiller uninstall`. *(Windows: not yet.)*

## Use

- **Distill** — right-click → **✦ Distill this video** (toolbar icon or paste URL)
- **Mark watched** — muted 2× play, like, close tab
- **Gemini** — no captions, or **⟳ video** for visual content; `GEMINI_API_KEY` in `.env`

YouTube fork of [steipete/summarize](https://github.com/steipete/summarize), on subscription billing instead of an API key.

MIT
