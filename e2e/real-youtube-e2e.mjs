// REAL youtube.com e2e: load the extension, open the live site, scrape actual
// thumbnail hrefs, prove the context-menu URL patterns + extractor match them,
// then distill a video the panel picked off the live page.
// Run: xvfb-run -a node real-youtube-e2e.mjs
import { chromium } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { extractVideoId } from "../extension/util.js";

const EXT = path.resolve(import.meta.dirname, "..", "extension");
const BACKEND = process.env.YT_DISTILL_BACKEND || "http://127.0.0.1:8765";
const TOKEN = process.env.YT_DISTILL_TOKEN || "devtoken";
const dir = import.meta.dirname;
const fail = (m) => { console.error("❌ " + m); process.exitCode = 1; };
const ok = (m) => console.log("✅ " + m);

// the EXACT patterns from background.js ytd-link item
const LINK_PATTERNS = [/^https?:\/\/([^/]*\.)?youtube\.com\/watch\?v=/, /^https?:\/\/youtu\.be\//, /^https?:\/\/([^/]*\.)?youtube\.com\/shorts\//];
const matchesPattern = (url) => LINK_PATTERNS.some((re) => re.test(url));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytd-real-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: "/usr/bin/chromium",
  headless: false,
  viewport: null,
  locale: "en-US",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run",
    "--no-default-browser-check", "--window-size=1366,1000", "--disable-gpu", "--lang=en-US"],
});

async function dismissConsent(page) {
  // Google consent appears as a redirect page or a modal; try several buttons.
  for (let i = 0; i < 3; i++) {
    try {
      const btn = page.getByRole("button", { name: /Accept all|Reject all|Accept the use|I agree/i }).first();
      if (await btn.count()) { await btn.click({ timeout: 4000 }); await page.waitForTimeout(2500); return true; }
    } catch {}
    // consent inside an iframe?
    for (const f of page.frames()) {
      try {
        const b = f.getByRole("button", { name: /Accept all|Reject all/i }).first();
        if (await b.count()) { await b.click({ timeout: 4000 }); await page.waitForTimeout(2500); return true; }
      } catch {}
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  ok(`extension loaded — id=${extId}`);
  await sw.evaluate(async ([b, t]) => { await chrome.storage.local.set({ backendUrl: b, token: t }); }, [BACKEND, TOKEN]);

  const page = await ctx.newPage();
  // Real search results — a live youtube.com page that reliably renders real
  // thumbnail/title links (the homepage feed is empty for a fresh logged-out profile).
  await page.goto("https://www.youtube.com/results?search_query=fireship", { waitUntil: "domcontentloaded", timeout: 60000 });
  await dismissConsent(page);
  console.log("url:", page.url(), "| title:", await page.title());

  await page.waitForSelector('a[href*="/watch?v="]', { timeout: 30000 });
  await page.screenshot({ path: path.join(dir, "real-youtube-search.png") });
  ok("live youtube.com search loaded (screenshot: real-youtube-search.png)");

  // scrape REAL thumbnail/title hrefs from the live DOM
  const hrefs = await page.$$eval('a[href*="/watch?v="]', (els) =>
    [...new Set(els.map((e) => e.href))].slice(0, 12));
  console.log(`\nscraped ${hrefs.length} real watch links:`);
  let matched = 0, extracted = 0;
  for (const h of hrefs) {
    const m = matchesPattern(h);
    const id = extractVideoId(h);
    if (m) matched++;
    if (id) extracted++;
    console.log(`  ${m ? "✓pattern" : "✗pattern"} ${id ? "id=" + id : "NO-ID"}  ${h.slice(0, 80)}`);
  }
  if (matched === hrefs.length && hrefs.length > 0) ok(`all ${hrefs.length} real hrefs match the context-menu link pattern`);
  else fail(`only ${matched}/${hrefs.length} real hrefs matched the menu pattern`);
  if (extracted === hrefs.length) ok(`extractVideoId parsed all ${hrefs.length} real hrefs`);
  else fail(`extractVideoId failed on ${hrefs.length - extracted} real hrefs`);

  // pick a real video off the live page and distill it through the side panel
  const realId = extractVideoId(hrefs.find((h) => extractVideoId(h)));
  ok(`picked real video off the live page: ${realId}`);
  await sw.evaluate(async ([vid]) => {
    await chrome.storage.session.set({ pending: { videoId: vid, url: "https://www.youtube.com/watch?v=" + vid, ts: Date.now() } });
  }, [realId]);

  const panel = await ctx.newPage();
  const errors = [];
  panel.on("pageerror", (e) => errors.push(String(e.message)));
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForFunction(
    () => /Distilled|No transcript|error|Can't reach/i.test(document.getElementById("status")?.textContent || ""),
    { timeout: 150000 });
  const status = (await panel.textContent("#status"))?.trim();
  const meta = (await panel.textContent("#meta"))?.trim();
  const summary = (await panel.textContent("#summary"))?.trim();
  await panel.screenshot({ path: path.join(dir, "real-youtube-panel.png"), fullPage: true });
  console.log("\n--- META ---\n" + meta);
  console.log("--- STATUS ---\n" + status);
  console.log(`--- SUMMARY (${summary?.length || 0} chars) ---\n` + (summary?.slice(0, 400) || "") + "…");

  if (/No transcript/i.test(status || "")) ok(`real video had no usable captions (expected for some) — graceful: ${status}`);
  else if ((summary?.length || 0) > 300) ok("distilled a real video scraped from the live youtube.com homepage");
  else fail("no distillation produced for the real video");
  if (errors.length) fail("panel JS errors: " + errors.join("; "));
} catch (e) {
  fail("real-youtube e2e threw: " + (e?.stack || e?.message || e));
} finally {
  await ctx.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
console.log(process.exitCode ? "\n=== REAL-YOUTUBE E2E FAILED ===" : "\n=== REAL-YOUTUBE E2E PASSED ===");
