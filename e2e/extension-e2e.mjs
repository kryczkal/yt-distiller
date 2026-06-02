// Browser e2e for the NATIVE-MESSAGING transport. Loads the unpacked extension
// (pinned id), installs the native host manifest into the profile, then drives
// the side panel exactly as the context-menu click does (pending video -> the
// panel connects to the spawned host -> streamed distillation -> rendered).
//
// Run: xvfb-run -a node extension-e2e.mjs [videoId]
import { chromium } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXT = path.join(ROOT, "extension");
const CHROMIUM = process.env.CHROMIUM_BIN || "/usr/bin/chromium";
const PINNED = "gdkokdffammbmjfginiefihojdkomjgc";
const HOST_NAME = "com.yt_distill.host";
const LAUNCHER = path.join(ROOT, "native-host-launcher.sh");
const VIDEO = process.argv[2] || "Gjnup-PuquQ";

const fail = (m) => { console.error("❌ " + m); process.exitCode = 1; };
const ok = (m) => console.log("✅ " + m);

const hostManifest = JSON.stringify({
  name: HOST_NAME, description: "yt-distill native host", path: LAUNCHER,
  type: "stdio", allowed_origins: [`chrome-extension://${PINNED}/`],
}, null, 2);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytd-nm-"));
// Native-messaging host dir = <user-data-dir>/NativeMessagingHosts. Also drop a
// copy in the user-level chromium dir as a fallback for host discovery.
const nmDirs = [path.join(userDataDir, "NativeMessagingHosts"), path.join(os.homedir(), ".config", "chromium", "NativeMessagingHosts")];
const wrote = [];
for (const d of nmDirs) {
  try { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, `${HOST_NAME}.json`), hostManifest); wrote.push(path.join(d, `${HOST_NAME}.json`)); } catch {}
}

const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu"],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  extId === PINNED ? ok(`extension loaded with PINNED id: ${extId}`) : fail(`id ${extId} != pinned ${PINNED} (native host won't match!)`);

  const menuProbe = await sw.evaluate(() => {
    const mk = (s) => new Promise((r) => chrome.contextMenus.create({ ...s, id: s.id + "-probe" }, () => r(chrome.runtime.lastError?.message || null)));
    return Promise.all([
      mk({ id: "lnk", title: "p", contexts: ["link"], targetUrlPatterns: ["*://*.youtube.com/watch?v=*", "*://youtu.be/*"] }),
      mk({ id: "pg", title: "p", contexts: ["page", "video"], documentUrlPatterns: ["*://*.youtube.com/watch?v=*"] }),
    ]);
  });
  menuProbe.every((e) => e === null) ? ok("Chrome accepted both context-menu specs") : fail("menu spec rejected: " + JSON.stringify(menuProbe));

  // simulate the context-menu click's stash
  await sw.evaluate(async ([vid]) => {
    await chrome.storage.session.set({ pending: { videoId: vid, url: "https://www.youtube.com/watch?v=" + vid, ts: Date.now() } });
  }, [VIDEO]);
  ok("stashed pending video (context-menu click effect)");

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  ok("sidepanel.html loaded — connecting to native host…");

  // Terminal state: on success the panel clears #status and reveals the
  // #receipt footer ("Distilled · …"); on failure it leaves the error in
  // #status. (null arg slot so the timeout lands in `options`, not the page-fn
  // argument — otherwise Playwright's 30s default silently applies.)
  await page.waitForFunction(
    () => {
      const receipt = document.getElementById("receipt");
      const done = receipt && !receipt.hasAttribute("hidden") &&
        /Distilled/i.test(document.getElementById("receipt-text")?.textContent || "");
      const errored = /No captions|error|Native host|Connection closed/i.test(
        document.getElementById("status")?.textContent || ""
      );
      return done || errored;
    },
    null,
    { timeout: 150000 }
  );

  const meta = (await page.textContent("#meta"))?.trim();
  const status = (await page.textContent("#status"))?.trim();
  const receipt = (await page.textContent("#receipt-text"))?.trim();
  const summary = (await page.textContent("#summary"))?.trim();
  const mdBlocks = await page.locator("#summary p, #summary li, #summary strong, #summary h1, #summary h2, #summary h3").count();
  await page.screenshot({ path: path.join(import.meta.dirname, "native-e2e.png"), fullPage: true });

  console.log("\n--- META ---\n" + meta);
  console.log("--- STATUS ---\n" + status);
  console.log("--- RECEIPT ---\n" + receipt);
  console.log(`--- SUMMARY (${summary?.length || 0} chars, ${mdBlocks} md blocks) ---\n` + (summary?.slice(0, 400) || "") + "…");

  if (/Native host (failed|produced)/i.test(status || "")) fail("native host did not run: " + status);
  else if ((summary?.length || 0) > 400 && mdBlocks > 0) ok("native-messaging distillation streamed + rendered in the side panel");
  else fail(`no distillation rendered (len=${summary?.length}, blocks=${mdBlocks}, status=${status})`);
  if (/subscription/.test(receipt || "")) ok("receipt shows subscription billing");
  errors.length ? fail("page JS errors: " + errors.join("; ")) : ok("no page JS errors");
} catch (e) {
  fail("e2e threw: " + (e?.stack || e?.message || e));
} finally {
  await ctx.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  for (const f of wrote) { try { fs.rmSync(f, { force: true }); } catch {} }
}
console.log(process.exitCode ? "\n=== NATIVE-MESSAGING E2E FAILED ===" : "\n=== NATIVE-MESSAGING E2E PASSED ===");
