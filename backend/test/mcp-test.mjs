// MCP integration smoke: spawns the real mcp-server.mjs over stdio (via the SDK
// client) and exercises all three tools against the offline fake-yt-dlp fixture,
// with an empty HOME so `distill` takes the no-auth raw fallback. No network,
// no Claude login required. Run: `npm run smoke:mcp`.

import path from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { makeFakeYtDlp, makeEmptyHome, EXPECTED_TRANSCRIPT } from "./fixture.mjs";

const server = path.join(import.meta.dirname, "..", "mcp-server.mjs");
const VID = "abc12345678";

const transport = new StdioClientTransport({
  command: "node",
  args: [server],
  env: {
    PATH: process.env.PATH,
    HOME: makeEmptyHome(), // simulate "not logged into Claude" → raw fallback
    YT_DISTILL_YTDLP: makeFakeYtDlp(),
  },
});

const client = new Client({ name: "mcp-smoke", version: "0" });
await client.connect(transport);

const textOf = (res) => res.content.map((c) => c.text).join("");

try {
  // 1. exactly the three expected tools
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["distill", "get_transcript", "list_transcript_languages"]);
  console.log("✓ tools:", names.join(", "));

  // 2. get_transcript
  const t = await client.callTool({ name: "get_transcript", arguments: { url: VID } });
  assert.equal(textOf(t).trim(), EXPECTED_TRANSCRIPT);
  console.log("✓ get_transcript →", JSON.stringify(textOf(t)));

  // 3. list_transcript_languages
  const l = await client.callTool({ name: "list_transcript_languages", arguments: { url: VID } });
  assert.deepEqual(JSON.parse(textOf(l)), { manual: [], auto: ["en"] });
  console.log("✓ list_transcript_languages →", textOf(l).replace(/\s+/g, " "));

  // 4. distill default → no-auth raw fallback (transcript + prompt + note)
  const d = await client.callTool({ name: "distill", arguments: { url: VID } });
  const out = textOf(d);
  assert.match(out, /not logged into claude/i);
  assert.match(out, /--- SYSTEM ---/);
  assert.match(out, /--- TASK ---/);
  assert.match(out, new RegExp(EXPECTED_TRANSCRIPT));
  console.log("✓ distill (no auth) → raw fallback with note");

  console.log("\nAll MCP smoke checks passed.");
} finally {
  await client.close();
}
process.exit(0);
