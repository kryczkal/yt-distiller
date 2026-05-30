# YouTube Distiller

**Right-click any YouTube video → dense brief in the side panel.** Claude subscription — no API key.

<p align="center">
  <img src="docs/demo.gif" width="720" alt="Right-click a video; brief streams in the side panel" />
</p>

Distillation, not a summary — facts, numbers, and names stay; filler goes. `yt-dlp` for the transcript, Claude Agent SDK for the brief. Native host spawns on demand, exits when done.

## Install

Node ≥ 20, `yt-dlp` on PATH, Claude Code logged in (Pro/Max).

```bash
./install.sh
```

Load `extension/` unpacked at `brave://extensions` (Developer mode on).

## Use

- **Distill** — right-click → **✦ Distill this video** (toolbar icon or paste URL)
- **Mark watched** — muted 2× play, like, close tab
- **Gemini** — no captions, or **⟳ video** for visual content; `GEMINI_API_KEY` in `.env`

YouTube fork of [steipete/summarize](https://github.com/steipete/summarize), on subscription billing instead of an API key.

MIT
