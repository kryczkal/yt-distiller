# YouTube Distiller

Right-click a YouTube video → dense brief in the side panel. Transcript via yt-dlp, distillation via your Claude subscription. Browser spawns the native host on demand; nothing idle.

## Install

Node ≥ 20, `yt-dlp` on PATH, Claude Code logged in (Pro/Max).

```bash
./install.sh
```

Load `extension/` unpacked at `brave://extensions` (Developer mode on).

## Use

- **Distill** — right-click a video → **✦ Distill this video** (or toolbar icon / paste URL)
- **Mark watched** — after a brief; opens video muted at 2×, likes it, closes tab
- **Gemini** — auto when no captions, or **⟳ video** for visual content; `cp .env.example .env` + `GEMINI_API_KEY`

MIT
