// Transcript extraction — a faithful Node port of the user's proven yt-mcp recipe:
//   yt-dlp -J (info + caption-track maps) -> prefer manual lang, then auto lang,
//   then lang.* prefixes -> pick json3 (clean) then vtt -> fetch track URL directly.
// Runs from the user's residential IP (the single biggest reliability factor for
// YouTube transcripts; datacenter IPs get blocked, local does not).

import { spawn } from "node:child_process";
import { DistillerError } from "./errors.js";

// Reuse the user's existing cookie env if set; allow a backend-specific override.
const COOKIES_BROWSER =
  process.env.YT_DISTILL_COOKIES_FROM_BROWSER ||
  process.env.YT_MCP_COOKIES_FROM_BROWSER ||
  null;

// The installer bundles yt-dlp into the project's bin/ and points the launcher
// here via YT_DISTILL_YTDLP. Fall back to a yt-dlp on PATH when it isn't set.
const YT_DLP = process.env.YT_DISTILL_YTDLP || "yt-dlp";

// Caption files are small static downloads; cap them so a stalled fetch can't
// hang the one-shot native host forever (yt-dlp itself already has a timeout).
const CAPTION_FETCH_TIMEOUT_MS = 30_000;

/** Normalize a videoId or any YouTube URL into a canonical watch URL. */
export function normalizeUrl(input) {
  if (!input) throw new DistillerError("no video id/url", { code: "NO_INPUT" });
  if (/^[\w-]{11}$/.test(input)) return `https://www.youtube.com/watch?v=${input}`;
  return input;
}

/** Extract the 11-char video id from a URL or id. */
export function extractVideoId(input) {
  if (!input) return null;
  if (/^[\w-]{11}$/.test(input)) return input;
  const m =
    input.match(/[?&]v=([\w-]{11})/) ||
    input.match(/youtu\.be\/([\w-]{11})/) ||
    input.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
  return m ? m[1] : null;
}

function runYtDlp(args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(YT_DLP, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new DistillerError("yt-dlp timed out", { code: "YTDLP_TIMEOUT" }));
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) =>
      reject(
        e.code === "ENOENT"
          ? new DistillerError(
              "yt-dlp not found — re-run the yt-distiller installer, or put yt-dlp on PATH",
              { code: "YTDLP_MISSING", cause: e }
            )
          : new DistillerError(`yt-dlp failed to start: ${e.message}`, { code: "YTDLP_ERROR", cause: e })
      )
    );
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(out)
        : reject(new DistillerError(`yt-dlp exited ${code}: ${err.slice(-600).trim()}`, { code: "YTDLP_FAILED" }));
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

/** Available subtitle languages for a video: { manual, auto } (parity with yt-mcp). */
export async function listLanguages(input) {
  const info = await fetchVideoInfo(input);
  return {
    manual: Object.keys(info.subtitles || {}).sort(),
    auto: Object.keys(info.automatic_captions || {}).sort(),
  };
}

export function pickTrack(info, lang) {
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

export function pickFormat(formats) {
  for (const ext of ["json3", "vtt", "srv3", "srv2", "srv1"]) {
    const f = formats.find((x) => x.ext === ext);
    if (f) return f;
  }
  return formats[0];
}

export function parseJson3(raw) {
  const data = JSON.parse(raw);
  const parts = [];
  for (const ev of data.events || []) {
    const t = (ev.segs || []).map((s) => s.utf8 || "").join("").trim();
    if (t) parts.push(t);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function parseVtt(raw) {
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
    throw new DistillerError(
      `No transcript for lang='${lang}'. Available: ${avail.slice(0, 15).join(", ")}${
        avail.length > 15 ? "…" : ""
      }`,
      { code: "NO_TRANSCRIPT", meta, available: avail }
    );
  }

  const fmt = pickFormat(track.formats);
  const res = await fetch(fmt.url, {
    headers: { "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(CAPTION_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new DistillerError(`caption fetch failed: HTTP ${res.status}`, { code: "CAPTION_FETCH_FAILED" });
  const raw = await res.text();
  const transcript = fmt.ext === "json3" ? parseJson3(raw) : parseVtt(raw);

  if (!transcript) {
    throw new DistillerError("caption track was empty after parsing", {
      code: "NO_TRANSCRIPT",
      meta,
    });
  }

  return { ...meta, transcript, captionKind: `${track.kind} ${track.lang}`, lang: track.lang };
}
