# ✦ YouTube Distiller

Right-click any YouTube video → get a tight, fluff-free **distillation of its knowledge** in a side panel. Runs on **your Claude subscription** (not the paid API) via a small local backend.

Not a "summary" in the usual sense: it compresses the *delivery* (sponsor reads, "smash subscribe", rambling, repetition) to nothing while preserving the *knowledge* losslessly — every claim, number, name, step, and mechanism. The prompt is a synthesis of the `/distill`, `/explain`, and `/tight-prose` philosophies.

## How it works

```
right-click a video  →  context menu (browser API, no YouTube DOM)
        │
        ▼
service worker  →  opens the side panel, passes the video id
        │
        ▼
side panel  ──POST /summarize──►  local Node backend (127.0.0.1, shared-secret)
                                        │  yt-dlp → transcript
                                        │  Claude Agent SDK → distillation (your subscription)
                                        ◄──── streamed NDJSON (live tokens) ────
        │
        ▼
rendered as markdown, as it streams
```

The trigger is `chrome.contextMenus` — a **browser API**, so it reads the video URL straight from the right-clicked link and depends on **zero YouTube DOM**. It can't break on a YouTube redesign, and it works from your feed, search, the sidebar, or the watch page — you don't have to open the video.

## Prerequisites

- **Node ≥ 20** and **yt-dlp** on your `PATH`
- **Claude Code logged in** with a Pro/Max subscription (you already are if you use `claude`). The backend reuses that login automatically — no API key needed.
  - For a portable/headless token instead: `claude setup-token` → export `CLAUDE_CODE_OAUTH_TOKEN`.
- A Chromium-family browser (Brave, Chromium, or Chrome)

## Setup

### 1. Start the backend

```bash
./start.sh
```

It prints a line like `token: AbC123…`. Copy it. (It's also stored at `~/.config/yt-distill/token`.)

The launcher unsets `ANTHROPIC_API_KEY` so usage bills to your subscription, never the API.

### 2. Load the extension

1. Open `brave://extensions` (or `chrome://extensions`)
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select the `extension/` folder
4. Click the extension's **⚙ Settings**, paste the **token** from step 1, Save. (Backend URL defaults to `http://127.0.0.1:8765`.)

### 3. Use it

Right-click any YouTube video — a thumbnail in your feed, a search result, the sidebar, or the open video — and choose **✦ Distill this video**. The side panel opens and the distillation streams in.

You can also click the toolbar icon to open the panel, then paste a URL or hit **Tab** to distill the current tab.

## Configuration (env vars for the backend)

| Var | Default | Purpose |
|---|---|---|
| `YT_DISTILL_PORT` | `8765` | Backend port |
| `YT_DISTILL_TOKEN` | generated | Shared secret (override to a fixed value if you like) |
| `YT_DISTILL_MODEL` | `claude-sonnet-4-6` | Distillation model |
| `YT_DISTILL_COOKIES_FROM_BROWSER` | _unset_ | e.g. `brave` — read cookies for age-gated/region-locked videos |

## Notes on the subscription path

- This is **personal, single-user** use of your own subscription token — which Anthropic permits. Routing **other people's** usage through your Pro/Max token is against the ToS, so **don't distribute it as a shared service**. If you ever want to share it, switch the backend to an API key (`ANTHROPIC_API_KEY`, ~$0.01–0.04 per video).
- Before **June 15, 2026**, SDK usage draws from your normal 5-hour/weekly chat limits; after that date it uses a separate monthly Agent-SDK credit.
- The status line shows `subscription` when a request drew from your 5-hour subscription limit (vs. the API).

## Security

- Backend binds to `127.0.0.1` only and requires the shared-secret header.
- The Agent SDK runs with **all tools disabled** (`tools: []`), so the local port can't run shell/filesystem operations even if reached.

## Project layout

```
backend/         local server + pipeline
  server.js        127.0.0.1 HTTP, NDJSON streaming, token auth
  lib/transcript.js  yt-dlp transcript extraction (ported from yt-mcp)
  lib/distill.js     Claude Agent SDK, bare completion on the subscription
  lib/distill-prompt.js  the distillation system prompt
  test/            standalone tests (auth, transcript, distill)
extension/       MV3 extension (Chromium/Brave)
  background.js     contextMenus trigger + side panel
  sidepanel.*       streaming UI + markdown render
  options.*         backend URL + token
e2e/             Playwright: loads the extension in real Chromium, drives the panel
start.sh         subscription-safe launcher
```

## Testing

```bash
# backend brain (transcript → distillation), no browser:
cd backend && node test/distill-test.mjs <videoId>

# full browser e2e (loads the extension, drives the side panel):
cd e2e && npm install && xvfb-run -a node extension-e2e.mjs <videoId>
```
