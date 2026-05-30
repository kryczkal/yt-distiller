// REAL youtube.com check: load the extension, open the live search page, scrape
// actual thumbnail hrefs, and prove every one matches the context-menu link
// pattern + extractVideoId parses it. (The distillation path is covered by
// extension-e2e.mjs; this isolates the real-site trigger surface — no backend.)
// Run: xvfb-run -a node real-youtube-e2e.mjs [query]
import { chromium } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { extractVideoId } from "../extension/util.js";

const EXT = path.resolve(import.meta.dirname, "..", "extension");
const query = process.argv[2] || "fireship";
const fail = (m) => { console.error("❌ " + m); process.exitCode = 1; };
const ok = (m) => console.log("✅ " + m);

// the EXACT patterns from background.js ytd-link item, as regexes
const LINK_PATTERNS = [/^https?:\/\/([^/]*\.)?youtube\.com\/watch\?v=/, /^https?:\/\/youtu\.be\//, /^https?:\/\/([^/]*\.)?youtube\.com\/shorts\//];
const matchesPattern = (url) => LINK_PATTERNS.some((re) => re.test(url));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytd-real-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: "/usr/bin/chromium", headless: false, viewport: null, locale: "en-US",
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--lang=en-US"],
});

try {
  const page = await ctx.newPage();
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('a[href*="/watch?v="]', { timeout: 30000 });
  await page.screenshot({ path: path.join(import.meta.dirname, "real-youtube-search.png") });
  ok(`live youtube.com search loaded: "${await page.title()}"`);

  const hrefs = await page.$$eval('a[href*="/watch?v="]', (els) => [...new Set(els.map((e) => e.href))].slice(0, 12));
  let matched = 0, extracted = 0;
  console.log(`\nscraped ${hrefs.length} real watch links:`);
  for (const h of hrefs) {
    const m = matchesPattern(h), id = extractVideoId(h);
    if (m) matched++;
    if (id) extracted++;
    console.log(`  ${m ? "✓" : "✗"}pattern ${id ? "id=" + id : "NO-ID"}  ${h.slice(0, 76)}`);
  }
  hrefs.length > 0 && matched === hrefs.length ? ok(`all ${hrefs.length} real hrefs match the context-menu link pattern`) : fail(`only ${matched}/${hrefs.length} matched`);
  extracted === hrefs.length ? ok(`extractVideoId parsed all ${hrefs.length} real hrefs`) : fail(`extractVideoId failed on ${hrefs.length - extracted}`);
} catch (e) {
  fail("real-youtube e2e threw: " + (e?.stack || e?.message || e));
} finally {
  await ctx.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
console.log(process.exitCode ? "\n=== REAL-YOUTUBE E2E FAILED ===" : "\n=== REAL-YOUTUBE E2E PASSED ===");
