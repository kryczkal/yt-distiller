// End-to-end brain test: videoId -> transcript -> distilled summary.
// Usage: node test/distill-test.mjs <videoId|url> [model]
import { getTranscript } from "../lib/transcript.js";
import { distill } from "../lib/distill.js";

const input = process.argv[2] || "Gjnup-PuquQ";
const model = process.argv[3];

const v = await getTranscript(input);
console.error(
  `[transcript] "${v.title}" by ${v.channel} — ${v.transcript.length} chars ` +
  `(~${Math.round(v.transcript.length / 4)} tok), ${v.captionKind}`
);

const t0 = Date.now();
const { text, usage, rateLimitType } = await distill(v, model ? { model } : {});
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log("\n========= DISTILLED =========\n");
console.log(text);
console.log("\n========= /DISTILLED =========");
console.error(
  `\n[usage] input=${usage?.input_tokens} ` +
  `cache_create=${usage?.cache_creation_input_tokens} ` +
  `cache_read=${usage?.cache_read_input_tokens} ` +
  `output=${usage?.output_tokens} | rateLimit=${rateLimitType} | ${dt}s | ` +
  `${text.length} chars out`
);
