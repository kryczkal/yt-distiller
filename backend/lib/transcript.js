// Transcript extraction — a faithful Node port of the user's proven yt-mcp recipe:
//   yt-dlp -J (info + caption-track maps) -> prefer manual lang, then auto lang,
//   then lang.* prefixes -> pick json3 (clean) then vtt -> fetch track URL directly.
// Runs from the user's residential IP (the single biggest reliability factor for
// YouTube transcripts; datacenter IPs get blocked, local does not).

import { spawn } from "node:child_process";

// Reuse the user's existing cookie env if set; allow a backend-specific override.
const COOKIES_BROWSER =
  process.env.YT_DISTILL_COOKIES_FROM_BROWSER ||
  process.env.YT_MCP_COOKIES_FROM_BROWSER ||
  null;

/** Normalize a videoId or any YouTube URL into a canonical watch URL. */
export function normalizeUrl(input) {
  if (!input) throw new Error("no video id/url");
  if (/^[\w-]{11}$/.test(input)) return `https://www.youtube.com/watch?v=${input}`;
  return input;
}

/** Extract the 11-char video id from a URL or id. */
export function extractVideoId(input) {
  if (/^[\w-]{11}$/.test(input)) return input;
  const m =
    input.match(/[?&]v=([\w-]{11})/) ||
    input.match(/youtu\.be\/([\w-]{11})/) ||
    input.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
  return m ? m[1] : null;
}

function runYtDlp(args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) =>
      reject(e.code === "ENOENT" ? new Error("yt-dlp not found on PATH") : e)
    );
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(out)
        : reject(new Error(`yt-dlp exited ${code}: ${err.slice(-600).trim()}`));
    });
  });
}

/** yt-dlp -J: full info json including subtitles / automatic_captions / metadata. */
export async function fetchVideoInfo(url) {
  const args = ["-J", "--skip-download", "--no-warnings", "--no-progress"];
  if (COOKIES_BROWSER) args.push("--cookies-from-browser", COOKIES_BROWSER);
  args.push(normalizeUrl(url));
  const out = await runYtDlp(args);
  return JSON.parse(out);
}

function pickTrack(info, lang) {
  const subs = info.subtitles || {};
  const auto = info.automatic_captions || {};
  if (subs[lang]) return { formats: subs[lang], kind: "manual", lang };
  if (auto[lang]) return { formats: auto[lang], kind: "auto", lang };
  for (const [l, f] of Object.entries(subs))
    if (l.startsWith(lang)) return { formats: f, kind: "manual", lang: l };
  for (const [l, f] of Object.entries(auto))
    if (l.startsWith(lang)) return { formats: f, kind: "auto", lang: l };
  return null;
}

function pickFormat(formats) {
  for (const ext of ["json3", "vtt", "srv3", "srv2", "srv1"]) {
    const f = formats.find((x) => x.ext === ext);
    if (f) return f;
  }
  return formats[0];
}

function parseJson3(raw) {
  const data = JSON.parse(raw);
  const parts = [];
  for (const ev of data.events || []) {
    const t = (ev.segs || []).map((s) => s.utf8 || "").join("").trim();
    if (t) parts.push(t);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function parseVtt(raw) {
  const lines = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    if (/^(WEBVTT|NOTE|STYLE|Kind:|Language:|align:|position:)/.test(s)) continue;
    if (s.includes("-->")) continue;
    const clean = s.replace(/<[^>]+>/g, "").trim(); // strip inline timing tags
    if (clean) lines.push(clean);
  }
  // collapse the rolling-window duplication of auto-captions
  const dedup = [];
  for (const l of lines) if (!dedup.length || dedup[dedup.length - 1] !== l) dedup.push(l);
  return dedup.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Fetch a video's metadata + flattened transcript text.
 * @returns {Promise<{id,title,channel,duration,durationSec,url,transcript,captionKind,lang}>}
 * @throws  Error with .code = "NO_TRANSCRIPT" when no caption track matches.
 */
export async function getTranscript(input, { lang = "en" } = {}) {
  const info = await fetchVideoInfo(input);
  const meta = {
    id: info.id,
    title: info.title,
    channel: info.channel || info.uploader || null,
    duration: info.duration_string || (info.duration ? `${info.duration}s` : null),
    durationSec: info.duration ?? null,
    url: info.webpage_url || normalizeUrl(input),
  };

  const track = pickTrack(info, lang);
  if (!track) {
    const avail = [
      ...new Set([
        ...Object.keys(info.subtitles || {}),
        ...Object.keys(info.automatic_captions || {}),
      ]),
    ].sort();
    const e = new Error(
      `No transcript for lang='${lang}'. Available: ${avail.slice(0, 15).join(", ")}${
        avail.length > 15 ? "…" : ""
      }`
    );
    e.code = "NO_TRANSCRIPT";
    e.meta = meta;
    e.available = avail;
    throw e;
  }

  const fmt = pickFormat(track.formats);
  const res = await fetch(fmt.url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`caption fetch failed: HTTP ${res.status}`);
  const raw = await res.text();
  const transcript = fmt.ext === "json3" ? parseJson3(raw) : parseVtt(raw);

  if (!transcript) {
    const e = new Error("caption track was empty after parsing");
    e.code = "NO_TRANSCRIPT";
    e.meta = meta;
    throw e;
  }

  return { ...meta, transcript, captionKind: `${track.kind} ${track.lang}`, lang: track.lang };
}
