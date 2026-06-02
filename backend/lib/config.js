// Single source of truth for backend tunables read from the environment, so env
// access isn't scattered across the lib modules (one place to see every knob,
// one place for the YT_MCP_* back-compat policy). Read ONCE here at module eval
// and frozen.
//
// Lifecycle: like the modules that import it, this reads process.env at eval
// time, so it MUST only be reached through the dynamically-imported lib graph —
// i.e. after a transport has called process.loadEnvFile(). native-host.mjs /
// mcp-server.mjs both dynamic-import the libs after loading .env, so config.js
// (pulled in by that subtree) always sees the loaded values.
//
// Deliberately NOT here: runtime-varying state. Claude-auth presence is probed
// live in orchestrate.js (it can change between calls and tests toggle it), and
// the ANTHROPIC_API_KEY strip is an env mutation the transports own.

const DEFAULT_DISTILL_MODEL = "claude-sonnet-4-6";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export const config = Object.freeze({
  // yt-dlp binary: the installer bundles one and the launcher points here via
  // YT_DISTILL_YTDLP; fall back to a yt-dlp on PATH when it isn't set.
  ytdlpPath: process.env.YT_DISTILL_YTDLP || "yt-dlp",

  // Reuse browser cookies for age-gated/region-locked videos. Honor the legacy
  // yt-mcp variable name so older setups keep working.
  cookiesBrowser:
    process.env.YT_DISTILL_COOKIES_FROM_BROWSER ||
    process.env.YT_MCP_COOKIES_FROM_BROWSER ||
    null,

  // Claude model for transcript distillation.
  distillModel: process.env.YT_DISTILL_MODEL || DEFAULT_DISTILL_MODEL,

  // Gemini visual fallback (optional — null disables the "watch the video" path).
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  geminiModel: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
});
