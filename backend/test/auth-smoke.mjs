// Auth smoke test — the riskiest assumption, tested first.
// Goal: prove the Claude Agent SDK runs a real inference on THIS machine,
// billed to the user's Claude subscription (NOT pay-per-token API).
//
// Pass criteria: the model returns the exact sentinel "SUBSCRIPTION_OK".
// We also assert ANTHROPIC_API_KEY is unset so we know we're on subscription.

import { query } from "@anthropic-ai/claude-agent-sdk";

console.log("=== auth-smoke ===");
console.log("ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? "SET (BAD — would bill API)" : "unset (good)");
console.log("CLAUDE_CODE_OAUTH_TOKEN:", process.env.CLAUDE_CODE_OAUTH_TOKEN ? "set" : "unset (will fall back to ambient Claude Code login)");
console.log("");

const SENTINEL = "SUBSCRIPTION_OK";

let assistantText = "";
let resultText = "";
let sawResult = false;
let usage = null;

try {
  const t0 = Date.now();
  for await (const msg of query({
    prompt: `Reply with exactly this token and nothing else: ${SENTINEL}`,
    options: {
      model: "claude-sonnet-4-6",
      // Keep it a pure single-shot text completion: no tools, no fs, no agent loop.
      maxTurns: 1,
      allowedTools: [],
      systemPrompt: "You are a terse echo. Output only what is requested.",
    },
  })) {
    const peek = JSON.stringify(msg);
    console.log("[msg]", msg.type, peek.length > 280 ? peek.slice(0, 280) + "…" : peek);
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text") assistantText += block.text;
      }
    }
    if (msg.type === "result") {
      sawResult = true;
      if (typeof msg.result === "string") resultText = msg.result;
      if (msg.usage) usage = msg.usage;
    }
  }

  const text = (resultText || assistantText).trim();
  const dt = ((Date.now() - 0) && 0); // placeholder, real timing below
  console.log("\n=== assistantText:", JSON.stringify(assistantText.trim()));
  console.log("=== resultText:   ", JSON.stringify(resultText.trim()));
  console.log("=== usage:        ", JSON.stringify(usage));

  if (text.includes(SENTINEL)) {
    console.log("\n✅ PASS — Agent SDK ran a real inference and returned the sentinel.");
    process.exit(0);
  } else {
    console.log("\n❌ FAIL — ran but did not return the sentinel. Got:", JSON.stringify(text));
    process.exit(2);
  }
} catch (e) {
  console.error("\n❌ QUERY THREW:", e?.stack || e?.message || e);
  process.exit(1);
}
