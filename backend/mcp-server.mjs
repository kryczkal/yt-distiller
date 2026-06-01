// MCP server: exposes yt-distiller's YouTube capabilities to any MCP client
// (Claude Code/Desktop, etc.) over stdio. This is the SECOND transport — the
// browser uses native-host.mjs; both are thin adapters over lib/orchestrate.js.
//
// Unlike the native host (one-shot, spawn-on-demand), the MCP client owns this
// process's lifecycle, so it stays alive for the client session. It is still
// pure stdio and does nothing until a tool is called.

import path from "node:path";

// Load .env BEFORE importing the lib modules (they read process.env at module
// eval). Mirror native-host.mjs exactly so both surfaces honor the same config.
for (const p of [path.join(import.meta.dirname, "..", ".env"), path.join(import.meta.dirname, ".env")]) {
  try { process.loadEnvFile(p); } catch {}
}
// Subscription auth only — never let a stray API key bill per-token.
delete process.env.ANTHROPIC_API_KEY;

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = await import("zod");

const { getTranscript, listLanguages } = await import("./lib/transcript.js");
const { orchestrate } = await import("./lib/orchestrate.js");

const text = (s) => ({ content: [{ type: "text", text: s }] });
const errText = (s) => ({ content: [{ type: "text", text: s }], isError: true });

const server = new McpServer({ name: "yt-distiller", version: "0.1.0" });

server.registerTool(
  "get_transcript",
  {
    title: "Get YouTube transcript",
    description:
      "Fetch the transcript of a YouTube video as plain text (via yt-dlp). " +
      "For age-gated/members/private/region-locked videos set YT_DISTILL_COOKIES_FROM_BROWSER " +
      "(e.g. \"brave\", \"chrome\", \"firefox\") — YT_MCP_COOKIES_FROM_BROWSER is also accepted.",
    inputSchema: {
      url: z.string().describe("YouTube video URL or 11-char video id"),
      lang: z.string().default("en").describe("Language code prefix, e.g. \"en\". Falls back to closest match."),
    },
  },
  async ({ url, lang }) => {
    try {
      const v = await getTranscript(url, { lang: lang || "en" });
      return text(v.transcript);
    } catch (e) {
      return errText(`${e.code || "ERROR"}: ${e.message || String(e)}`);
    }
  }
);

server.registerTool(
  "list_transcript_languages",
  {
    title: "List transcript languages",
    description:
      "List available subtitle languages for a video. Returns { manual, auto }: " +
      "manual = human-authored, auto = machine-generated.",
    inputSchema: {
      url: z.string().describe("YouTube video URL or 11-char video id"),
    },
  },
  async ({ url }) => {
    try {
      const langs = await listLanguages(url);
      return text(JSON.stringify(langs, null, 2));
    } catch (e) {
      return errText(`${e.code || "ERROR"}: ${e.message || String(e)}`);
    }
  }
);

server.registerTool(
  "distill",
  {
    title: "Distill a YouTube video",
    description:
      "Distill a video into a dense, load-bearing brief (knowledge kept, scaffolding cut). " +
      "Default returns the finished brief, produced on your Claude subscription. " +
      "If you are not logged into Claude on this machine, it gracefully returns the transcript " +
      "plus the distillation prompt for you to run in-context. " +
      "Set raw=true to always get that raw material instead of a finished brief. " +
      "mode=\"video\" uses Gemini to watch the video (needs GEMINI_API_KEY); useful when there are no captions.",
    inputSchema: {
      url: z.string().describe("YouTube video URL or 11-char video id"),
      lang: z.string().default("en").describe("Caption language prefix, e.g. \"en\""),
      mode: z.enum(["auto", "video"]).default("auto").describe("\"auto\" = transcript→Claude; \"video\" = Gemini watches the video"),
      raw: z.boolean().default(false).describe("Return transcript + distill prompt instead of a finished brief"),
    },
  },
  async ({ url, lang, mode, raw }) => {
    try {
      const r = await orchestrate({
        url,
        lang: lang || "en",
        mode: mode || "auto",
        // raw=true forces raw; otherwise "auto" = brief when logged in, raw fallback when not.
        distillMode: raw ? "raw" : "auto",
      });
      if (r.kind === "raw") {
        const header = r.note ? `> ${r.note}\n\n` : "";
        return text(`${header}--- SYSTEM ---\n${r.system}\n\n--- TASK ---\n${r.prompt}`);
      }
      return text(r.text);
    } catch (e) {
      return errText(`${e.code || "ERROR"}: ${e.message || String(e)}`);
    }
  }
);

await server.connect(new StdioServerTransport());
