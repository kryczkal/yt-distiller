# ✦ YouTube Distiller

**Right-click any YouTube video → a tight, fluff-free distillation of its knowledge, in a side panel.** Runs on *your* Claude subscription via a host the browser spawns on demand — nothing runs in the background.

```
right-click a video  →  ✦ Distill this video  →  read the brief in the side panel
```

Not a "summary" in the usual sense. It compresses the *delivery* — sponsor reads, "smash subscribe," rambling, restatement — to nothing, and preserves the *knowledge* losslessly: every claim, number, name, step, mechanism. The prompt synthesizes the `/distill`, `/explain`, and `/tight-prose` philosophies — **compress the delivery, never the knowledge.**

## Why

Most explainer videos are a 20-minute delivery vehicle for two golden sentences. The information is real; the *time density* is terrible — you sit through an intro, a sponsor, three restatements, and a "before we begin, smash subscribe" to reach the part you came for.

My workflow was to paste the URL into Gemini and type "summarize." Every video. It worked — but it was a tab switch, a copy-paste, and a prompt every single time, friction that turned "is this worth watching?" into a chore.

YouTube Distiller is that workflow collapsed into a right-click. No tab switch, no prompt to type, no opening the video. It reads the transcript (not the page), distills it on the subscription you already pay for, and streams the brief into a side panel next to whatever you're doing. When a video genuinely needs eyes — a coding demo, slides, charts — one button re-runs it through Gemini *watching* the video instead.

And when the brief tells you the video was worth it, **Mark watched** feeds that back to YouTube — so your recommendations learn from what you actually found valuable, without you sitting through it.

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
- **Transport = native messaging.** The extension carries its own backend; Chrome/Brave launches it only when you distill and kills it the moment it's done. Load the extension and forget it — no idle process, no localhost port.

## Install

**Prerequisites**

- **Node ≥ 20** and **yt-dlp** on your `PATH`
- **Claude Code logged in** with a Pro/Max subscription — the host reuses that login automatically, no API key. (Headless alternative: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`.)
- A Chromium-family browser (Brave, Chromium, or Chrome)

**1. Register the native host** (once)

```bash
./install.sh
```

Installs backend deps and registers the native-messaging host for every Brave/Chrome/Chromium profile it finds, pinned to the extension's id. Re-run only if you move the folder.

**2. Load the extension**

1. Open `brave://extensions` (or `chrome://extensions`)
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select the `extension/` folder

The id is pinned to `gdkokdffammbmjfginiefihojdkomjgc` — what `install.sh` allow-listed.

## Use it

**Distill** — right-click any video (a feed thumbnail, a search result, the sidebar, or the open watch page) → **✦ Distill this video**. The panel opens and the brief streams in. Nothing was running until that click. The toolbar icon opens the panel too — paste a URL, or distill the current tab.

**Mark watched** *(post-distill)* — once a brief lands, the footer offers **👁 Mark watched**. It opens the video in a background tab, plays it muted at 2× to clock real watch-time, best-effort clicks **Like**, then closes the tab. That writes to your actual watch history — the dominant "recommend more like this" signal — so the algorithm learns from the briefs you judged worth it, without you watching. Needs you signed into YouTube; the Like is public. (One DOM-coupled spot, guarded so it can never un-like or hit Dislike.)

**Watch with Gemini** *(optional — visual videos)* — the transcript→Claude path covers ~95% of videos. For the rest, `cp .env.example .env` and add a free [`GEMINI_API_KEY`](https://aistudio.google.com/apikey):

- **Auto** — a video with **no captions** falls back to Gemini *watching* it.
- **Manual** — the **⟳ video** button re-distills by watching, for demos/slides/charts where the spoken words miss what's on screen.

Gemini's free tier accepts **public videos only**.

## The subscription path

- **Personal, single-user** use of your own token — which Anthropic permits. Routing *other people's* usage through your Pro/Max token violates the ToS, so don't repackage this as a shared service. To share, point the host at an API key (`ANTHROPIC_API_KEY` in `.env`, ~$0.01–0.04 per video).
- Before **June 15, 2026**, SDK usage draws from your normal 5-hour / weekly limits; after, a separate monthly Agent-SDK credit.
- The receipt shows `subscription` when a request drew from your subscription rate limit.

## Security

- The native host's `allowed_origins` binds it to this extension's id — no other page or extension can spawn it. No open network port.
- The Agent SDK runs with **all tools disabled** (`tools: []`) — the host can't touch your shell or filesystem.
- "Mark watched" injects one tiny script on `youtube.com` (mute, play, best-effort Like) — the only place the project touches a page DOM, scoped by `host_permissions` to youtube.com.
- `GEMINI_API_KEY` lives in `.env` (gitignored), never in the extension. The extension's private signing key (`*.pem`) is gitignored too.

## Layout

```
backend/
  native-host.mjs        native-messaging host (stdio) — the on-demand backend
  lib/transcript.js      yt-dlp transcript extraction (ported from yt-mcp)
  lib/distill.js         Claude Agent SDK, bare completion on the subscription
  lib/distill-prompt.js  distillation system prompt (text + video variants)
  lib/gemini.js          Gemini native-video fallback
  server.js              OPTIONAL localhost HTTP mode (debug; unused by the extension)
extension/               MV3 extension — contextMenus + sidePanel, pinned key/id
  background.js          context-menu trigger, opens the panel
  sidepanel.js           streams + renders the brief; "mark watched" orchestration
native-host-launcher.sh  what the browser execs
install.sh               registers the native host per browser
tools/                   key generation + id derivation
e2e/                     Playwright tests — real Chromium/Brave, real youtube.com
```

## Testing

```bash
# native-host pipeline, no browser (speaks the wire protocol):
node e2e/native-host-test.mjs <videoId>

# full native-messaging e2e in real Chromium (installs host, drives the panel):
cd e2e && npm install && xvfb-run -a node extension-e2e.mjs <videoId>
#   …in Brave:   CHROMIUM_BIN=/usr/bin/brave xvfb-run -a node extension-e2e.mjs

# "mark watched" wiring (offline — manifest perms, button, no JS errors):
cd e2e && xvfb-run -a node mark-watched-test.mjs
```

## Acknowledgements

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — transcript extraction.
- [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview) — subscription-billed distillation.
- [marked](https://github.com/markedjs/marked) — the markdown renderer (vendored).
