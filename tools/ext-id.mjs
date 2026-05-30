// Print the extension id derived from extension/manifest.json "key".
// (Chrome computes the id the same way; install.sh uses this for allowed_origins.)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "extension", "manifest.json"), "utf8"));
if (!manifest.key) { console.error("manifest.json has no \"key\" — run tools/gen-key.mjs"); process.exit(1); }
const der = Buffer.from(manifest.key, "base64");
const hash = crypto.createHash("sha256").update(der).digest();
const id = [...hash.subarray(0, 16)]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("")
  .split("")
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");
process.stdout.write(id);
