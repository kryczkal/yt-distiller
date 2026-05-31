// Offline test for the installer (install.sh + tools/lib.sh + tools/yt-distiller).
// Runs install.sh against throwaway $HOME dirs with seams:
//   YT_DISTILL_OS=linux|macos|windows   force the OS branch
//   YT_DISTILL_YTDLP_URL=file:///nope    force the yt-dlp download to fail
//   YT_DISTILL_NO_TTY=1                  force the "no terminal" branch
// A fake `yt-dlp` on PATH stands in for the system fallback, so nothing is
// downloaded and no network is touched.
//
// Run: node e2e/install-test.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const INSTALL = path.join(REPO, "install.sh");
const SHIM = path.join(REPO, "tools", "yt-distiller");
const LAUNCHER = path.join(REPO, "native-host-launcher.sh");
const HOST_JSON = "com.yt_distill.host.json";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); } };

if (!fs.existsSync(path.join(REPO, "backend", "node_modules"))) {
  console.error("backend/node_modules missing — run `npm install --prefix backend` first.");
  process.exit(2);
}

const EXT_ID = spawnSync("node", [path.join(REPO, "tools", "ext-id.mjs")], { encoding: "utf8" }).stdout.trim();
ok(/^[a-p]{32}$/.test(EXT_ID), `derived a valid extension id (${EXT_ID.slice(0, 8)}…)`);

// A fake yt-dlp so the system-fallback path completes with no download.
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "ytd-bin-"));
fs.writeFileSync(path.join(fakeBin, "yt-dlp"), "#!/bin/sh\necho 2099.12.31\n", { mode: 0o755 });

const tmpHomes = [];
function freshHome({ linux = [], macos = [] } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ytd-home-"));
  tmpHomes.push(home);
  for (const rel of linux) fs.mkdirSync(path.join(home, ".config", rel), { recursive: true });
  for (const rel of macos) fs.mkdirSync(path.join(home, "Library", "Application Support", rel), { recursive: true });
  return home;
}
function run(args, home, extraEnv = {}, { withFakeYtdlp = true } = {}) {
  const PATH = (withFakeYtdlp ? fakeBin + path.delimiter : "") + process.env.PATH;
  return spawnSync("bash", [INSTALL, ...args], {
    encoding: "utf8",
    env: {
      ...process.env, HOME: home, PATH,
      YT_DISTILL_YTDLP_URL: "file:///nonexistent-yt-dlp-xyz",
      ...extraEnv,
    },
  });
}
const linuxManifest = (home, vendor) =>
  path.join(home, ".config", vendor, "NativeMessagingHosts", HOST_JSON);
const macManifest = (home, vendor) =>
  path.join(home, "Library", "Application Support", vendor, "NativeMessagingHosts", HOST_JSON);
const shimLink = (home) => path.join(home, ".local", "bin", "yt-distiller");

// 1. Fresh Linux install writes correct manifests + shim.
console.log("\n[1] linux install (--yes)");
{
  const home = freshHome({ linux: ["BraveSoftware/Brave-Browser", "google-chrome"] });
  const r = run(["--yes"], home, { YT_DISTILL_OS: "linux" });
  ok(r.status === 0, "exit 0");
  const brave = linuxManifest(home, "BraveSoftware/Brave-Browser");
  const chrome = linuxManifest(home, "google-chrome");
  ok(fs.existsSync(brave) && fs.existsSync(chrome), "manifest written to Brave + Chrome dirs");
  const m = JSON.parse(fs.readFileSync(brave, "utf8"));
  ok(m.allowed_origins?.[0] === `chrome-extension://${EXT_ID}/`, "allowed_origins has the derived id");
  ok(m.path === LAUNCHER, "manifest path points at the launcher");
  ok(m.type === "stdio" && m.name === "com.yt_distill.host", "manifest name/type correct");
  ok(fs.lstatSync(shimLink(home)).isSymbolicLink() && fs.readlinkSync(shimLink(home)) === SHIM, "shim symlink → tools/yt-distiller");

  // 2. Idempotent re-run.
  const r2 = run(["--yes"], home, { YT_DISTILL_OS: "linux" });
  ok(r2.status === 0 && fs.existsSync(brave), "[2] idempotent re-run stays valid, exit 0");
}

// 3. macOS layout uses the Library path, not ~/.config.
console.log("\n[3] macos layout (--yes)");
{
  const home = freshHome({ macos: ["Google/Chrome"] });
  const r = run(["--yes"], home, { YT_DISTILL_OS: "macos" });
  ok(r.status === 0, "exit 0");
  ok(fs.existsSync(macManifest(home, "Google/Chrome")), "manifest under ~/Library/Application Support/Google/Chrome");
  ok(!fs.existsSync(path.join(home, ".config")), "no ~/.config written on macOS");
}

// 4. --dry-run mutates nothing.
console.log("\n[4] --dry-run");
{
  const home = freshHome({ linux: ["BraveSoftware/Brave-Browser"] });
  const r = run(["--dry-run"], home, { YT_DISTILL_OS: "linux" });
  ok(r.status === 0, "exit 0");
  ok(/install location/.test(r.stdout) && /Proceed/.test(r.stdout) === false, "prints the plan, not a prompt");
  ok(!fs.existsSync(linuxManifest(home, "BraveSoftware/Brave-Browser")), "no manifest written");
  ok(!fs.existsSync(shimLink(home)), "no shim written");
}

// 5. --no-shim installs the host but skips the PATH shim.
console.log("\n[5] --no-shim");
{
  const home = freshHome({ linux: ["google-chrome"] });
  const r = run(["--yes", "--no-shim"], home, { YT_DISTILL_OS: "linux" });
  ok(r.status === 0 && fs.existsSync(linuxManifest(home, "google-chrome")), "manifest written");
  ok(!fs.existsSync(shimLink(home)), "no shim symlink created");
}

// 6. Windows is refused, nothing written.
console.log("\n[6] windows refusal");
{
  const home = freshHome({ linux: ["google-chrome"] });
  const r = run(["--yes"], home, { YT_DISTILL_OS: "windows" });
  ok(r.status !== 0, "nonzero exit");
  ok(/supported yet/i.test(r.stdout + r.stderr), "explains it's planned");
  ok(!fs.existsSync(linuxManifest(home, "google-chrome")), "nothing written");
}

// 7. No tty + no --yes refuses rather than auto-proceeding.
console.log("\n[7] non-interactive refusal");
{
  const home = freshHome({ linux: ["google-chrome"] });
  const r = run([], home, { YT_DISTILL_OS: "linux", YT_DISTILL_NO_TTY: "1" });
  ok(r.status !== 0, "nonzero exit");
  ok(/--yes/.test(r.stdout + r.stderr), "tells you to re-run with --yes");
  ok(!fs.existsSync(linuxManifest(home, "google-chrome")), "no system changes");
}

// 8. Never edits shell rc.
console.log("\n[8] no shell-rc edits");
{
  const home = freshHome({ linux: ["google-chrome"] });
  const rc = path.join(home, ".bashrc");
  fs.writeFileSync(rc, "# my bashrc\nexport FOO=1\n");
  const before = fs.readFileSync(rc);
  run(["--yes"], home, { YT_DISTILL_OS: "linux" });
  ok(Buffer.compare(before, fs.readFileSync(rc)) === 0, ".bashrc byte-identical after install");
}

// 9. yt-dlp hard-fail (download fails AND none on PATH) aborts. Best-effort:
//    skipped if a real yt-dlp is reachable without our fake.
console.log("\n[9] yt-dlp hard-fail");
{
  const hasSystem = spawnSync("bash", ["-c", "command -v yt-dlp"], { encoding: "utf8" }).status === 0;
  if (hasSystem) {
    console.log("  • skipped (a system yt-dlp is present, can't simulate 'none on PATH')");
  } else {
    const home = freshHome({ linux: ["google-chrome"] });
    const r = run(["--yes"], home, { YT_DISTILL_OS: "linux" }, { withFakeYtdlp: false });
    ok(r.status !== 0, "nonzero exit");
    ok(/yt-dlp/i.test(r.stdout + r.stderr), "names yt-dlp in the error");
  }
}

// 10. doctor + uninstall via the shim.
console.log("\n[10] doctor + uninstall");
{
  const home = freshHome({ linux: ["BraveSoftware/Brave-Browser"] });
  run(["--yes"], home, { YT_DISTILL_OS: "linux" });
  const env = { ...process.env, HOME: home, PATH: fakeBin + path.delimiter + process.env.PATH, YT_DISTILL_OS: "linux" };
  const doc = spawnSync("bash", [SHIM, "doctor"], { encoding: "utf8", env });
  ok(/native host registered/.test(doc.stdout), "doctor reports the host registered");
  const un = spawnSync("bash", [SHIM, "uninstall", "--yes"], { encoding: "utf8", env });
  ok(un.status === 0, "uninstall exits 0");
  ok(!fs.existsSync(linuxManifest(home, "BraveSoftware/Brave-Browser")), "manifest removed");
  ok(!fs.existsSync(shimLink(home)), "shim removed");
}

// cleanup
for (const d of [...tmpHomes, fakeBin]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

console.log(`\n${fail ? "✗" : "✓"} install-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
