// Native-messaging host: Chrome/Brave spawns this on demand when the side panel
// connects, it does ONE distillation streaming results back, then exits. Nothing
// runs idle. Speaks the native-messaging stdio protocol (4-byte little-endian
// length prefix + JSON, per message).

import path from "node:path";

// Load .env (project root / backend) for GEMINI_API_KEY, YT_DISTILL_* etc. This
// MUST run before the lib modules load: they read process.env at module-eval time
// and ES imports are evaluated before this file's body, so the libs are imported
// dynamically below — only after .env is in place. Otherwise YT_DISTILL_MODEL /
// YT_DISTILL_COOKIES_FROM_BROWSER set in .env would be silently ignored.
for (const p of [path.join(import.meta.dirname, "..", ".env"), path.join(import.meta.dirname, ".env")]) {
  try { process.loadEnvFile(p); } catch {}
}
// Subscription auth only — never let a stray API key bill per-token.
delete process.env.ANTHROPIC_API_KEY;

const { getTranscript, fetchVideoInfo, normalizeUrl } = await import("./lib/transcript.js");
const { distill } = await import("./lib/distill.js");
const { distillViaGemini, geminiAvailable } = await import("./lib/gemini.js");

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
    void dispatch(msg); // dispatch wraps its own body — it never rejects
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
    // stderr only — stdout is the native-messaging channel. Chrome captures this.
    console.error("[yt-distiller] summarize failed:", e?.stack || e?.message || e);
    send({ type: "error", code: e.code || "ERROR", message: e.message || String(e) });
  } finally {
    finish();
  }
}

async function summarize(msg) {
  const raw = msg.url || msg.videoId;
  const input = typeof raw === "string" ? raw.trim() : "";
  if (!input) { send({ type: "error", code: "NO_INPUT", message: "missing videoId" }); return; }
  // Clamp panel-supplied fields to known-good shapes (defence at the trust boundary).
  const mode = msg.mode === "video" ? "video" : "auto";
  const lang = typeof msg.lang === "string" && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(msg.lang) ? msg.lang : "en";
  const model = typeof msg.model === "string" && msg.model.trim() ? msg.model.trim() : undefined;
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
    video = await getTranscript(input, { lang });
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
  const { text, usage, rateLimitType } = await distill(video, { model, onText: (c) => send({ type: "delta", text: c }) });
  send({ type: "done", text, usage, rateLimitType, source: "claude" });
}
