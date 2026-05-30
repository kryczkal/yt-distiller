// Offline smoke test for the "Mark watched" feature. Verifies the manifest still
// loads with the new permissions (scripting + youtube host access), the side
// panel wires up the #watch button without JS errors, and the chrome APIs the
// feature relies on are actually granted in the panel context. Does NOT exercise
// real playback/Like — that needs a logged-in YouTube account (manual test).
//
// Run: xvfb-run -a node mark-watched-test.mjs
import { chromium } from "playwright-core";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXT = path.join(ROOT, "extension");
const CHROMIUM = process.env.CHROMIUM_BIN || "/usr/bin/chromium";
const PINNED = "gdkokdffammbmjfginiefihojdkomjgc";

const fail = (m) => { console.error("❌ " + m); process.exitCode = 1; };
const ok = (m) => console.log("✅ " + m);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytd-mw-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: CHROMIUM,
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu"],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  extId === PINNED ? ok(`extension loaded with new manifest, pinned id ${extId}`) : fail(`id ${extId} != pinned ${PINNED}`);

  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  manifest.permissions?.includes("scripting") ? ok("manifest grants 'scripting'") : fail("manifest missing 'scripting'");
  (manifest.host_permissions || []).some((h) => /youtube\.com/.test(h))
    ? ok(`manifest grants youtube host access (${manifest.host_permissions.join(", ")})`)
    : fail("manifest missing youtube host_permissions");

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 360, height: 720 }); // realistic side-panel width
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.waitForTimeout(400); // let the module finish init()

  (await page.locator("#watch").count()) === 1 ? ok("#watch button present") : fail("#watch button missing");
  const label = (await page.locator("#watch .watch-label").textContent())?.trim();
  label === "Mark watched" ? ok(`button label = "${label}"`) : fail(`unexpected button label "${label}"`);

  const granted = await page.evaluate(() => ({
    scripting: typeof chrome?.scripting?.executeScript === "function",
    tabsCreate: typeof chrome?.tabs?.create === "function",
    tabsRemove: typeof chrome?.tabs?.remove === "function",
    onUpdated: !!chrome?.tabs?.onUpdated?.addListener,
  }));
  granted.scripting ? ok("chrome.scripting.executeScript available in panel") : fail("chrome.scripting unavailable");
  granted.tabsCreate && granted.tabsRemove && granted.onUpdated
    ? ok("chrome.tabs create/remove/onUpdated available") : fail("chrome.tabs API incomplete: " + JSON.stringify(granted));

  // Force the (normally post-distill) footer visible to capture the control visually.
  await page.evaluate(() => {
    document.getElementById("empty").hidden = true;
    document.getElementById("receipt").hidden = false;
    document.getElementById("receipt-text").innerHTML =
      '<svg class="spark" viewBox="0 0 24 24"><path d="M12 2l1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z"/></svg><span class="body">Distilled · 2.3k tok · subscription</span>';
  });
  await page.screenshot({ path: path.join(import.meta.dirname, "mark-watched.png"), fullPage: true });
  ok("screenshot saved → e2e/mark-watched.png");

  errors.length ? fail("page JS errors: " + errors.join("; ")) : ok("no page JS errors on panel load");
} catch (e) {
  fail("smoke threw: " + (e?.stack || e?.message || e));
} finally {
  await ctx.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
console.log(process.exitCode ? "\n=== MARK-WATCHED SMOKE FAILED ===" : "\n=== MARK-WATCHED SMOKE PASSED ===");
