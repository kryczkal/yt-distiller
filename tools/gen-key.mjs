// One-time: generate the extension keypair. The public key (base64 DER SPKI) goes
// in manifest.json "key" to PIN a stable extension ID (so the native-messaging
// allowed_origins always matches). Private key saved (gitignored) for future .crx packing.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const spkiDer = publicKey.export({ type: "spki", format: "der" });
const keyB64 = spkiDer.toString("base64");

// Chrome extension ID = first 16 bytes of SHA-256(DER public key), each hex nibble mapped 0-f -> a-p.
const hash = crypto.createHash("sha256").update(spkiDer).digest();
const id = [...hash.subarray(0, 16)]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("")
  .split("")
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");

const outDir = path.join(import.meta.dirname, "..", "native-host");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "extension-key.pem"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

console.log("EXTENSION_ID=" + id);
console.log("MANIFEST_KEY=" + keyB64);
