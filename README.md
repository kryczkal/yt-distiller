# YouTube Distiller

**Right-click any YouTube video → dense brief in the side panel.** Your Claude subscription, no API key.

<p align="center">
  <img src="docs/demo.gif" width="720" alt="Right-click a video; the side panel streams a distillation" />
</p>

Transcript via `yt-dlp`, distillation via Claude Agent SDK. Browser spawns the native host on demand; it exits when the brief is done.

## Install

Node ≥ 20, `yt-dlp` on PATH, Claude Code logged in (Pro/Max).

```bash
./install.sh
```

Load `extension/` unpacked at `brave://extensions` (Developer mode on).

## Use

- **Distill** — right-click → **✦ Distill this video** (or toolbar icon / paste URL)
- **Mark watched** — after a brief; muted 2× play, like, close tab
- **Gemini** — no captions or **⟳ video** for visual content; `cp .env.example .env` + `GEMINI_API_KEY`

MIT
