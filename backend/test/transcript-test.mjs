// Standalone transcript test. Usage: node test/transcript-test.mjs <videoId|url> [lang]
import { getTranscript } from "../lib/transcript.js";

const input = process.argv[2] || "Gjnup-PuquQ"; // default: Fireship "Docker in 100 Seconds"
const lang = process.argv[3] || "en";

const t0 = Date.now();
try {
  const r = await getTranscript(input, { lang });
  const dt = Date.now() - t0;
  console.log("=== META ===");
  console.log({ id: r.id, title: r.title, channel: r.channel, duration: r.duration, captionKind: r.captionKind });
  console.log(`=== TRANSCRIPT (${r.transcript.length} chars, ~${Math.round(r.transcript.length / 4)} tokens, fetched in ${dt}ms) ===`);
  console.log(r.transcript.slice(0, 800) + (r.transcript.length > 800 ? "\n…[truncated]" : ""));
  console.log("\n=== TAIL (last 300) ===");
  console.log(r.transcript.slice(-300));
} catch (e) {
  console.error("FAILED:", e.code || "", e.message);
  if (e.available) console.error("available langs:", e.available.slice(0, 30).join(", "));
  process.exit(1);
}
