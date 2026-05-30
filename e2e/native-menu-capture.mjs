// Capture the REAL native context menu showing the extension's item.
// Playwright's right-click opens Chromium's native menu; ImageMagick `import`
// grabs the xvfb root window (the native menu is a separate X popup).
// Run: xvfb-run -a node native-menu-capture.mjs
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const EXT = path.resolve(import.meta.dirname, "..", "extension");
const fixture = "file://" + path.join(import.meta.dirname, "fixtures", "links.html");
const out = path.join(import.meta.dirname, "native-menu.png");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytd-native-"));

const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: "/usr/bin/chromium",
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-position=0,0",
    "--window-size=1366,900",
    // xvfb has no GPU: force software rendering into the X window so `import` can read it
    "--disable-gpu",
    "--disable-gpu-compositing",
  ],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  console.log("extension id:", new URL(sw.url()).host);

  const page = await ctx.newPage();
  await page.goto(fixture);
  await page.waitForSelector("#yt");
  const box = await page.locator("#yt").boundingBox();

  // Right-click the youtube link → native menu opens at the cursor.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await new Promise((r) => setTimeout(r, 1500)); // let the native menu paint

  execSync(`import -window root "${out}"`, { stdio: "inherit" });
  console.log("captured:", out);
} catch (e) {
  console.error("capture failed:", e?.message || e);
  process.exitCode = 1;
} finally {
  await ctx.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
