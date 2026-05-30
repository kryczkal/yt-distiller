// Real-browser e2e: loads the unpacked extension in Chromium and exercises the
// full chain. Validates (1) the extension/service-worker loads, (2) Chrome
// accepts our exact context-menu specs, (3) the side panel page loads with no
// JS errors, (4) the EXACT context-menu code path (pending video -> auto
// summarize) streams a real distillation from the backend and renders it.
//
// Run: xvfb-run -a node extension-e2e.mjs [videoId]
import { chromium } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const EXT = path.resolve(import.meta.dirname, "..", "extension");
const CHROMIUM = process.env.CHROMIUM_BIN || "/usr/bin/chromium";
const BACKEND = process.env.YT_DISTILL_BACKEND || "http://127.0.0.1:8765";
const TOKEN = process.env.YT_DISTILL_TOKEN || "devtoken";
const VIDEO = process.argv[2] || "Gjnup-PuquQ"; // Fireship "Docker in 100 Seconds"

const fail = (m) => { console.error("❌ " + m); process.exitCode = 1; };
const ok = (m) => console.log("✅ " + m);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytd-profile-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  headless: false, // MV3 extensions require headful; xvfb supplies the display
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

try {
  // --- 1. service worker / extension id ---
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  ok(`extension loaded — id=${extId}`);

  const apis = await sw.evaluate(() => ({
    contextMenus: !!chrome.contextMenus,
    sidePanel: !!chrome.sidePanel,
    storage: !!chrome.storage,
  }));
  if (apis.contextMenus && apis.sidePanel && apis.storage) ok("service worker has contextMenus + sidePanel + storage APIs");
  else fail("missing APIs in SW: " + JSON.stringify(apis));

  // --- 2. Chrome accepts our EXACT menu specs (validates the trigger registration) ---
  const menuProbe = await sw.evaluate(() => {
    const mk = (spec) => new Promise((res) =>
      chrome.contextMenus.create({ ...spec, id: spec.id + "-probe" }, () =>
        res(chrome.runtime.lastError?.message || null)));
    return Promise.all([
      mk({ id: "lnk", title: "p", contexts: ["link"], targetUrlPatterns: ["*://*.youtube.com/watch?v=*", "*://youtu.be/*", "*://*.youtube.com/shorts/*"] }),
      mk({ id: "pg", title: "p", contexts: ["page", "video", "image", "frame"], documentUrlPatterns: ["*://*.youtube.com/watch?v=*", "*://*.youtube.com/shorts/*"] }),
    ]);
  });
  if (menuProbe.every((e) => e === null)) ok("Chrome accepted both context-menu specs (link + page) — trigger registration valid");
  else fail("context-menu spec rejected: " + JSON.stringify(menuProbe));

  // --- 3. configure extension + simulate the context-menu click's effect ---
  await sw.evaluate(async ([backend, token, videoId]) => {
    await chrome.storage.local.set({ backendUrl: backend, token });
    // exactly what background.js onClicked stashes before opening the panel:
    await chrome.storage.session.set({ pending: { videoId, url: "https://www.youtube.com/watch?v=" + videoId, ts: Date.now() } });
  }, [BACKEND, TOKEN, VIDEO]);
  ok("stashed pending video (simulating the context-menu click) + configured backend");

  // --- 4. open the REAL side panel page; init() should auto-summarize from pending ---
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  ok("sidepanel.html loaded");

  // wait for the stream to COMPLETE (done event sets "✦ Distilled …" in #status)
  await page.waitForFunction(
    () => /Distilled|No transcript|error|Can't reach/i.test(document.getElementById("status")?.textContent || ""),
    { timeout: 150000 }
  );

  const meta = (await page.textContent("#meta"))?.trim();
  const status = (await page.textContent("#status"))?.trim();
  const summary = (await page.textContent("#summary"))?.trim();
  // markdown rendered = marked produced real block elements (not raw text)
  const mdBlocks = await page.locator("#summary p, #summary li, #summary strong, #summary h1, #summary h2, #summary h3, #summary pre").count();

  console.log("\n--- META ---\n" + meta);
  console.log("--- STATUS ---\n" + status);
  console.log(`--- SUMMARY (${summary.length} chars, ${mdBlocks} markdown blocks rendered) ---`);
  console.log(summary.slice(0, 500) + "…");

  const shot = path.join(import.meta.dirname, "e2e-sidepanel.png");
  await page.screenshot({ path: shot, fullPage: true });
  ok("screenshot saved: " + shot);

  if (summary.length > 400 && mdBlocks > 0) ok("distillation rendered as markdown in the side panel");
  else fail(`summary too short or not rendered as markdown (len=${summary.length}, blocks=${mdBlocks})`);
  if (/subscription|five_hour/.test(status)) ok("status shows subscription billing");
  if (errors.length) fail("page JS errors:\n  " + errors.join("\n  "));
  else ok("no page JS errors");
} catch (e) {
  fail("e2e threw: " + (e?.stack || e?.message || e));
} finally {
  await ctx.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
console.log(process.exitCode ? "\n=== E2E FAILED ===" : "\n=== E2E PASSED ===");
