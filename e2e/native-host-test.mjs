// Standalone test of the native-messaging host: spawn it, speak the wire protocol
// (4-byte LE length + JSON) to stdin, read framed messages from stdout.
// Run: node native-host-test.mjs [videoId] [mode]
import { spawn } from "node:child_process";
import path from "node:path";

const HOST = path.resolve(import.meta.dirname, "..", "backend", "native-host.mjs");
const videoId = process.argv[2] || "Gjnup-PuquQ";
const mode = process.argv[3] || "auto";

const frame = (obj) => {
  const j = Buffer.from(JSON.stringify(obj), "utf8");
  const h = Buffer.alloc(4); h.writeUInt32LE(j.length, 0);
  return Buffer.concat([h, j]);
};

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
const child = spawn("node", [HOST], { stdio: ["pipe", "pipe", "inherit"], env });

let buf = Buffer.alloc(0);
const msgs = [];
child.stdout.on("data", (c) => {
  buf = Buffer.concat([buf, c]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const body = buf.subarray(4, 4 + len);
    buf = buf.subarray(4 + len);
    let m; try { m = JSON.parse(body.toString("utf8")); } catch { continue; }
    msgs.push(m);
    if (m.type === "delta") process.stdout.write(".");
    if (m.type === "done" || m.type === "error") child.stdin.end(); // mimic panel disconnect
  }
});

child.on("exit", (code) => {
  const meta = msgs.find((m) => m.type === "meta");
  const deltas = msgs.filter((m) => m.type === "delta");
  const done = msgs.find((m) => m.type === "done");
  const err = msgs.find((m) => m.type === "error");
  console.log("\nexit code:", code);
  console.log("meta:", meta ? `${meta.title} / ${meta.captionKind}` : "none");
  console.log("deltas:", deltas.length, "| done source:", done?.source, "| len:", done?.text?.length, "| rate:", done?.rateLimitType);
  console.log("error:", err ? JSON.stringify(err) : "none");
  if (done?.text && deltas.length > 0 && !err) { console.log("\n=== HEAD ===\n" + done.text.slice(0, 350)); console.log("\n✅ NATIVE HOST OK"); process.exit(0); }
  console.log("❌ NATIVE HOST FAILED"); process.exit(1);
});

child.stdin.write(frame({ type: "summarize", videoId, mode }));
