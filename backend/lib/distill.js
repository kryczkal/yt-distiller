// Distillation step: run the transcript through Claude via the Agent SDK,
// configured as a BARE completion (no built-in tools, no settings, no MCP) so
// it spends the user's subscription quota only on the system prompt + transcript.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { SUMMARIZER_SYSTEM, buildDistillPrompt } from "./distill-prompt.js";
import { DistillerError } from "./errors.js";
import { config } from "./config.js";

// Strip ANTHROPIC_API_KEY from the child env: it outranks the subscription
// OAuth token in the SDK's auth precedence, so a stray key = silent API billing.
function cleanEnv() {
  const e = { ...process.env };
  delete e.ANTHROPIC_API_KEY;
  return e;
}

/**
 * @param {{title?,channel?,duration?,captionKind?,transcript:string}} video
 * @param {{model?:string, onText?:(chunk:string)=>void}} [opts]
 * @returns {Promise<{text:string, usage:object|null, rateLimitType:string|null}>}
 */
export async function distill(video, { model = config.distillModel, onText = null } = {}) {
  const prompt = buildDistillPrompt(video);

  let streamed = "";
  let assistantText = "";
  let resultText = "";
  let usage = null;
  let rateLimitType = null;
  let isError = false;
  let errorText = null;

  for await (const msg of query({
    prompt,
    options: {
      model,
      systemPrompt: SUMMARIZER_SYSTEM, // string => replaces the Claude Code preset
      tools: [], // disable ALL built-in tools (no 18.8k-token tool schemas)
      settingSources: [], // SDK isolation: ignore ~/.claude + project settings/CLAUDE.md
      strictMcpConfig: true, // ignore every ambient MCP config
      maxTurns: 1, // single-shot completion, no agent loop
      env: cleanEnv(),
      includePartialMessages: Boolean(onText),
    },
  })) {
    switch (msg.type) {
      case "rate_limit_event":
        rateLimitType = msg.rate_limit_info?.rateLimitType ?? rateLimitType;
        break;
      case "stream_event": {
        const ev = msg.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          streamed += ev.delta.text;
          onText?.(ev.delta.text);
        }
        break;
      }
      case "assistant":
        if (msg.message?.content) {
          let t = "";
          for (const b of msg.message.content) if (b.type === "text") t += b.text;
          if (t) assistantText = t;
        }
        break;
      case "result":
        usage = msg.usage || null;
        if (typeof msg.result === "string") resultText = msg.result;
        if (msg.is_error) {
          isError = true;
          errorText = msg.result || msg.subtype || "unknown error";
        }
        break;
    }
  }

  const text = (streamed || assistantText || resultText).trim();
  if (!text && isError) throw new DistillerError(`distillation failed: ${errorText}`, { code: "DISTILL_FAILED" });
  if (!text) throw new DistillerError("distillation produced no text", { code: "DISTILL_EMPTY" });
  return { text, usage, rateLimitType };
}
