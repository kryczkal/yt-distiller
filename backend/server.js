// Local backend for the YouTube distiller browser extension.
//
// Security posture (research-driven):
//  - binds to 127.0.0.1 ONLY (never 0.0.0.0)
//  - requires a shared-secret header (x-yt-distill-token) on /summarize
//  - the Agent SDK runs with tools:[] so this port cannot run shell/fs even if reached
//
// Protocol: POST /summarize streams newline-delimited JSON (NDJSON):
//   {"type":"meta", ...video metadata}
//   {"type":"delta","text":"..."}   (0+ — live tokens)
//   {"type":"done","text":"<full>","usage":{...},"rateLimitType":"five_hour"}
//   {"type":"error","code":"...","message":"..."}

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getTranscript, extractVideoId } from "./lib/transcript.js";
import { distill } from "./lib/distill.js";

const PORT = Number(process.env.YT_DISTILL_PORT || 8765);
const HOST = "127.0.0.1";
const VERSION = "0.1.0";

// ---- shared secret: env override, else a stable generated token on disk ----
function loadToken() {
  if (process.env.YT_DISTILL_TOKEN) return process.env.YT_DISTILL_TOKEN.trim();
  const dir = path.join(os.homedir(), ".config", "yt-distill");
  const file = path.join(dir, "token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (t) return t;
  } catch {}
  const tok = randomBytes(24).toString("base64url");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, tok, { mode: 0o600 });
  return tok;
}
const TOKEN = loadToken();

function setCors(req, res) {
  // Extension pages/service-worker fetches; reflect the extension origin. Token
  // auth + 127.0.0.1 binding are the real guards, not CORS.
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-yt-distill-token");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => {
      d += c;
      if (d.length > 2_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check — no auth, lets the extension detect "backend up".
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "yt-distill", version: VERSION });
    return;
  }

  if (req.method === "POST" && url.pathname === "/summarize") {
    if (req.headers["x-yt-distill-token"] !== TOKEN) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    const input = payload.url || payload.videoId;
    if (!input) {
      sendJson(res, 400, { error: "missing videoId or url" });
      return;
    }
    const lang = payload.lang || "en";
    const model = payload.model || undefined;

    // Stream NDJSON.
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
    const write = (obj) => res.write(JSON.stringify(obj) + "\n");

    const vid = extractVideoId(input) || input;
    try {
      const video = await getTranscript(input, { lang });
      write({
        type: "meta",
        id: video.id,
        title: video.title,
        channel: video.channel,
        duration: video.duration,
        captionKind: video.captionKind,
        url: video.url,
      });

      const { text, usage, rateLimitType } = await distill(video, {
        model,
        onText: (chunk) => write({ type: "delta", text: chunk }),
      });

      write({ type: "done", text, usage, rateLimitType });
    } catch (e) {
      write({
        type: "error",
        code: e.code || "ERROR",
        message: e.message || String(e),
        videoId: vid,
        available: e.available || undefined,
      });
    } finally {
      res.end();
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`yt-distill backend v${VERSION} listening on http://${HOST}:${PORT}`);
  console.log(`token: ${TOKEN}`);
  console.log(`(set YT_DISTILL_TOKEN to override; persisted at ~/.config/yt-distill/token)`);
  if (process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY is set in this process — distill() strips it from the child, but unset it to be safe.");
  }
});
