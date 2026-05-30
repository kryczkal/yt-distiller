# ✦ YouTube Distiller

Right-click any YouTube video → get a tight, fluff-free **distillation of its knowledge** in a side panel. Runs on **your Claude subscription** (not the paid API) via a host the browser spawns **on demand** — nothing runs in the background.

Not a "summary" in the usual sense: it compresses the *delivery* (sponsor reads, "smash subscribe", rambling, repetition) to nothing while preserving the *knowledge* losslessly — every claim, number, name, step, and mechanism. The prompt synthesizes the `/distill`, `/explain`, and `/tight-prose` philosophies: **compress the delivery, never the knowledge.**

## How it works

```
right-click a video  →  context menu (browser API — zero YouTube DOM, redesign-proof)
        │
        ▼
service worker  →  opens the side panel, hands it the video id
        │
        ▼
side panel  →  chrome.runtime.connectNative("com.yt_distill.host")
        │                    ↑ the browser SPAWNS the Node host on demand
        ▼
native host  →  yt-dlp transcript  →  Claude Agent SDK (your subscription)
        │            └─ no captions / "⟳ video" → Gemini watches the video
        ◄──── streamed messages (live tokens) ────
        │
        ▼
rendered as markdown, as it streams  →  host exits. Nothing left running.
```

Two deliberate choices:
- **Trigger = `chrome.contextMenus`**, a browser API. It reads the video URL straight from the right-clicked link, so it depends on **zero YouTube DOM** — it can't break on a redesign, and works from your feed, search, the sidebar, or the watch page without opening the video.
- **Transport = native messaging.** The extension carries its own backend; Chrome/Brave launches it only when you distill and kills it when done. Load the extension and forget it.

## Prerequisites

- **Node ≥ 20** and **yt-dlp** on your `PATH`
- **Claude Code logged in** with a Pro/Max subscription (you already are if you use `claude`). The host reuses that login automatically — no API key.
  - Portable/headless alternative: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`.
- A Chromium-family browser (Brave, Chromium, or Chrome)

## Setup

### 1. Install the native host (once)

```bash
./install.sh
```

This installs backend deps and registers the native-messaging host for every Brave/Chrome/Chromium profile it finds, pinned to the extension's id. Re-run only if you move the project folder.

### 2. Load the extension

1. Open `brave://extensions` (or `chrome://extensions`)
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select the `extension/` folder
4. *(optional)* pin it via the puzzle-piece icon

The extension's id is pinned to `gdkokdffammbmjfginiefihojdkomjgc`, which is what `install.sh` allow-listed.

### 3. Use it

Right-click any YouTube video — a thumbnail in your feed, a search result, the sidebar, or the open watch page — and choose **✦ Distill this video**. The side panel opens and the distillation streams in. Nothing was running until that click.

Toolbar icon opens the panel too; paste a URL + **Go**, or **Tab** to distill the current tab.

### Visual fallback (Gemini, optional)

Default path is transcript → Claude (covers ~95% of videos). To handle the rest, `cp .env.example .env` and add a free `GEMINI_API_KEY` ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)):

- **Auto:** a video with **no captions** falls back to Gemini *watching* the video.
- **Manual:** the **⟳ video** button re-distills by watching — for coding demos, slides, charts where the spoken words miss what's on screen.

Gemini's free tier accepts **public videos only** (not private/unlisted).

## Notes on the subscription path

- This is **personal, single-user** use of your own token — which Anthropic permits. Routing **other people's** usage through your Pro/Max token is against the ToS, so don't repackage it as a shared service. To share, switch the host to an API key (`ANTHROPIC_API_KEY` in `.env`, ~$0.01–0.04 per video).
- Before **June 15, 2026**, SDK usage draws from your normal 5-hour/weekly chat limits; after, a separate monthly Agent-SDK credit.
- The status line shows `subscription` when a request drew from your subscription rate limit.

## Security

- The native host's `allowed_origins` binds it to this extension's id — no other page or extension can invoke it. No open network port.
- The Agent SDK runs with **all tools disabled** (`tools: []`), so the host can't run shell/filesystem operations.
- Your `GEMINI_API_KEY` lives in `.env` (gitignored), never in the extension.

## Project layout

```
backend/
  native-host.mjs    native-messaging host (stdio protocol) — the on-demand backend
  lib/transcript.js  yt-dlp transcript extraction (ported from yt-mcp)
  lib/distill.js     Claude Agent SDK, bare completion on the subscription
  lib/distill-prompt.js  the distillation system prompt (text + video variants)
  lib/gemini.js      Gemini native-video fallback
  server.js          OPTIONAL localhost HTTP mode (debugging; not used by the extension)
extension/           MV3 extension (pinned key/id, contextMenus + sidePanel)
native-host-launcher.sh   what the browser execs
install.sh           registers the native host per browser
tools/               key generation + id derivation
e2e/                 Playwright tests (real Chromium/Brave, real youtube.com)
```

## Testing

```bash
# native host pipeline, no browser (speaks the wire protocol):
node e2e/native-host-test.mjs <videoId>

# full native-messaging e2e in real Chromium (installs host, drives the panel):
cd e2e && npm install && xvfb-run -a node extension-e2e.mjs <videoId>
#   …in real Brave:   CHROMIUM_BIN=/usr/bin/brave xvfb-run -a node extension-e2e.mjs
# real youtube.com trigger surface (scrape live links, validate patterns):
xvfb-run -a node real-youtube-e2e.mjs
```

## Alternative: HTTP mode

`backend/server.js` exposes the same pipeline over `127.0.0.1` (token-auth, NDJSON) for debugging or a different frontend: `./start.sh`. The extension itself uses native messaging and needs no server.
