// Native-messaging host: Chrome/Brave spawns this on demand when the side panel
// connects, it does ONE distillation streaming results back, then exits. Nothing
// runs idle. Same pipeline as server.js, over the native-messaging stdio protocol
// (4-byte little-endian length prefix + JSON, per message).

import path from "node:path";
import { getTranscript, fetchVideoInfo, normalizeUrl } from "./lib/transcript.js";
import { distill } from "./lib/distill.js";
import { distillViaGemini, geminiAvailable } from "./lib/gemini.js";

// Load .env (project root / backend) for GEMINI_API_KEY etc.
for (const p of [path.join(import.meta.dirname, "..", ".env"), path.join(import.meta.dirname, ".env")]) {
  try { process.loadEnvFile(p); } catch {}
}
// Subscription auth only — never let a stray API key bill per-token.
delete process.env.ANTHROPIC_API_KEY;

// ---- native-messaging framing ----
function send(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

let inbuf = Buffer.alloc(0);
let busy = false;

process.stdin.on("data", (chunk) => {
  inbuf = Buffer.concat([inbuf, chunk]);
  while (inbuf.length >= 4) {
    const len = inbuf.readUInt32LE(0);
    if (inbuf.length < 4 + len) break;
    const body = inbuf.subarray(4, 4 + len);
    inbuf = inbuf.subarray(4 + len);
    let msg;
    try { msg = JSON.parse(body.toString("utf8")); } catch { continue; }
    dispatch(msg);
  }
});
process.stdin.on("end", () => process.exit(0));

// Exit shortly after a job completes so the host never lingers. The panel also
// disconnects on done/error (-> stdin 'end' -> immediate exit); this is a backstop
// that gives stdout time to flush the final message.
function finish() {
  setTimeout(() => process.exit(0), 2500);
}

async function dispatch(msg) {
  if (msg?.type === "ping") { send({ type: "pong", gemini: geminiAvailable() }); return; }
  if (msg?.type !== "summarize" || busy) return;
  busy = true;
  try {
    await summarize(msg);
  } catch (e) {
    send({ type: "error", code: e.code || "ERROR", message: e.message || String(e) });
  } finally {
    finish();
  }
}

async function summarize(msg) {
  const input = msg.url || msg.videoId;
  if (!input) { send({ type: "error", code: "NO_INPUT", message: "missing videoId" }); return; }
  const mode = msg.mode || "auto";
  const watchUrl = normalizeUrl(input);

  // Forced visual path (the "⟳ video" button).
  if (mode === "video") {
    if (!geminiAvailable()) { send({ type: "error", code: "NO_GEMINI_KEY", message: "Set GEMINI_API_KEY in .env to use the video path." }); return; }
    let meta = {};
    try { const i = await fetchVideoInfo(input); meta = { id: i.id, title: i.title, channel: i.channel || i.uploader, duration: i.duration_string }; } catch {}
    send({ type: "meta", ...meta, captionKind: "Gemini (watching video)", url: watchUrl });
    const r = await distillViaGemini(watchUrl, { onText: (c) => send({ type: "delta", text: c }) });
    send({ type: "done", text: r.text, source: "gemini" });
    return;
  }

  // Default: transcript → Claude, auto-escalate to Gemini on no captions.
  let video;
  try {
    video = await getTranscript(input, { lang: msg.lang || "en" });
  } catch (e) {
    if (e.code === "NO_TRANSCRIPT" && geminiAvailable()) {
      send({ type: "meta", id: e.meta?.id, title: e.meta?.title, channel: e.meta?.channel, duration: e.meta?.duration, captionKind: "no captions → Gemini video", url: e.meta?.url || watchUrl });
      const r = await distillViaGemini(e.meta?.url || watchUrl, { onText: (c) => send({ type: "delta", text: c }) });
      send({ type: "done", text: r.text, source: "gemini" });
      return;
    }
    send({ type: "error", code: e.code || "ERROR", message: e.message || String(e), available: e.available });
    return;
  }

  send({ type: "meta", id: video.id, title: video.title, channel: video.channel, duration: video.duration, captionKind: video.captionKind, url: video.url });
  const { text, usage, rateLimitType } = await distill(video, { model: msg.model, onText: (c) => send({ type: "delta", text: c }) });
  send({ type: "done", text, usage, rateLimitType, source: "claude" });
}
