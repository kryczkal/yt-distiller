// Shared orchestration — the single source of truth for "URL → brief", used by
// BOTH transports: the native-messaging host (browser extension) and the MCP
// server. The transports stay thin (framing / streaming / process lifecycle);
// all the actual flow logic lives here so the two surfaces can never drift.
//
// Lifecycle note: this module statically imports the lib/* modules, which read
// process.env at eval time (YT_DISTILL_MODEL, cookie env, GEMINI_API_KEY). Both
// transports therefore import THIS module *dynamically*, only after they've
// loaded .env — see native-host.mjs / mcp-server.mjs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getTranscript, fetchVideoInfo, normalizeUrl, baseMetaFromInfo } from "./transcript.js";
import { distill } from "./distill.js";
import { distillViaGemini, geminiAvailable } from "./gemini.js";
import { SUMMARIZER_SYSTEM, buildDistillPrompt } from "./distill-prompt.js";
import { DistillerError } from "./errors.js";

/**
 * Is a Claude subscription login available to the Agent SDK? Mirrors the check
 * in tools/lib.sh's `yt_doctor`. We never fall back to ANTHROPIC_API_KEY (it
 * bills per-token and the transports strip it), so a missing login means we
 * cannot distill — the caller can degrade to raw mode instead of erroring.
 */
export function claudeAuthAvailable() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;
  try {
    return fs.existsSync(path.join(os.homedir(), ".claude", ".credentials.json"));
  } catch {
    return false;
  }
}

/**
 * Run a video through the pipeline.
 *
 * @param {object}   o
 * @param {string}   o.url                  video id or any YouTube URL
 * @param {string}  [o.lang="en"]           caption language prefix
 * @param {"auto"|"video"} [o.mode="auto"]  "video" forces the Gemini visual path
 * @param {string}  [o.model]               override the Claude model
 * @param {"full"|"raw"|"auto"} [o.distillMode="full"]
 *        full → run Claude, return the finished brief.
 *        raw  → skip Claude, return transcript + prompt for the caller to run.
 *        auto → full when logged into Claude, else raw (with a note).
 * @param {(meta:object)=>void} [o.onMeta]  called once with video metadata
 * @param {(chunk:string)=>void} [o.onText] called with streamed text chunks
 * @param {boolean} [o.allowGeminiFallback=true] auto-escalate to Gemini on no captions
 * @returns {Promise<
 *   | {kind:"brief", meta, text, source, captionKind, usage?, rateLimitType?}
 *   | {kind:"raw",   meta, transcript, system, prompt, captionKind, source:"raw", note:?string}
 * >}
 */
export async function orchestrate({
  url,
  lang = "en",
  mode = "auto",
  model,
  distillMode = "full",
  onMeta = null,
  onText = null,
  allowGeminiFallback = true,
}) {
  const input = typeof url === "string" ? url.trim() : "";
  if (!input) throw new DistillerError("missing video id/url", { code: "NO_INPUT" });
  const watchUrl = normalizeUrl(input);

  // Forced visual path (the "⟳ video" button / mode:"video").
  if (mode === "video") {
    if (!geminiAvailable())
      throw new DistillerError("Set GEMINI_API_KEY in .env to use the video path.", { code: "NO_GEMINI_KEY" });
    let meta = { url: watchUrl, captionKind: "Gemini (watching video)" };
    try {
      const i = await fetchVideoInfo(input);
      meta = { ...meta, ...baseMetaFromInfo(i) };
    } catch {
      /* metadata is best-effort; the visual distill still works without it */
    }
    onMeta?.(meta);
    const r = await distillViaGemini(watchUrl, { onText });
    return { kind: "brief", meta, text: r.text, source: "gemini", captionKind: meta.captionKind };
  }

  // Default: transcript → Claude, auto-escalating to the Gemini visual path
  // when the video has no usable captions.
  let video;
  try {
    video = await getTranscript(input, { lang });
  } catch (e) {
    if (e.code === "NO_TRANSCRIPT" && allowGeminiFallback && geminiAvailable()) {
      const meta = {
        id: e.meta?.id,
        title: e.meta?.title,
        channel: e.meta?.channel,
        duration: e.meta?.duration,
        url: e.meta?.url || watchUrl,
        captionKind: "no captions → Gemini video",
      };
      onMeta?.(meta);
      const r = await distillViaGemini(meta.url, { onText });
      return { kind: "brief", meta, text: r.text, source: "gemini", captionKind: meta.captionKind };
    }
    throw e;
  }

  const meta = {
    id: video.id,
    title: video.title,
    channel: video.channel,
    duration: video.duration,
    url: video.url,
    captionKind: video.captionKind,
  };
  onMeta?.(meta);

  // Decide whether to run Claude ourselves or hand the raw material back.
  let useRaw = distillMode === "raw";
  let note = null;
  if (distillMode === "auto") {
    if (claudeAuthAvailable()) {
      useRaw = false;
    } else {
      useRaw = true;
      note = "Not logged into Claude — returning the transcript and distill prompt for you to distill in-context.";
    }
  }

  if (useRaw) {
    return {
      kind: "raw",
      meta,
      source: "raw",
      transcript: video.transcript,
      system: SUMMARIZER_SYSTEM,
      prompt: buildDistillPrompt(video),
      captionKind: video.captionKind,
      note,
    };
  }

  const { text, usage, rateLimitType } = await distill(video, { model, onText });
  return { kind: "brief", meta, text, source: "claude", usage, rateLimitType, captionKind: video.captionKind };
}
