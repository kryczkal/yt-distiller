// Verify the native-host LAUNCHER works the way a browser invokes it: spawn the
// launcher (not node directly) with a stripped-down env (minimal PATH), speak the
// wire protocol, expect a full distillation. If this passes, Brave will too.
import { spawn } from "node:child_process";
import path from "node:path";

const LAUNCHER = path.resolve(import.meta.dirname, "..", "native-host-launcher.sh");
const videoId = process.argv[2] || "Gjnup-PuquQ";

const frame = (o) => { const j = Buffer.from(JSON.stringify(o), "utf8"); const h = Buffer.alloc(4); h.writeUInt32LE(j.length, 0); return Buffer.concat([h, j]); };

// Emulate a browser-spawned process: minimal PATH (forces the launcher's PATH
// export to do its job), but keep HOME + dbus/runtime so credential lookup works.
const env = {
  HOME: process.env.HOME,
  PATH: "/usr/bin:/bin",
  DISPLAY: process.env.DISPLAY || "",
  DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "",
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "",
};

const child = spawn(LAUNCHER, [], { stdio: ["pipe", "pipe", "inherit"], env });
let buf = Buffer.alloc(0); const msgs = [];
child.stdout.on("data", (c) => {
  buf = Buffer.concat([buf, c]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0); if (buf.length < 4 + len) break;
    const b = buf.subarray(4, 4 + len); buf = buf.subarray(4 + len);
    let m; try { m = JSON.parse(b.toString("utf8")); } catch { continue; }
    msgs.push(m);
    if (m.type === "delta") process.stdout.write(".");
    if (m.type === "done" || m.type === "error") child.stdin.end();
  }
});
child.on("exit", (code) => {
  const done = msgs.find((m) => m.type === "done"); const err = msgs.find((m) => m.type === "error"); const deltas = msgs.filter((m) => m.type === "delta");
  console.log("\nexit:", code, "| deltas:", deltas.length, "| done:", done?.source, done?.text?.length, "| rate:", done?.rateLimitType, "| err:", err ? JSON.stringify(err) : "none");
  if (done?.text && !err) { console.log("✅ LAUNCHER OK — Brave will be able to run this"); process.exit(0); }
  console.log("❌ LAUNCHER FAILED"); process.exit(1);
});
child.stdin.write(frame({ type: "summarize", videoId }));
