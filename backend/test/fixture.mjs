// Shared offline test fixture: a fake yt-dlp binary that emits canned `-J` JSON
// whose caption track is a `data:` URL, so the whole transcript path
// (yt-dlp → info → fetch caption → parse) runs with no network and no auth.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const JSON3 = JSON.stringify({ events: [{ segs: [{ utf8: "hello world" }] }] });
const CAPTION_DATA_URL = `data:application/json;base64,${Buffer.from(JSON3).toString("base64")}`;

const INFO = {
  id: "abc12345678",
  title: "Test Title",
  channel: "Test Channel",
  duration_string: "1:23",
  webpage_url: "https://www.youtube.com/watch?v=abc12345678",
  subtitles: {},
  automatic_captions: { en: [{ ext: "json3", url: CAPTION_DATA_URL }] },
};

/** Write an executable fake yt-dlp that prints INFO to stdout. Returns its path. */
export function makeFakeYtDlp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytd-fake-"));
  const bin = path.join(dir, "yt-dlp");
  // Emit the JSON regardless of args; tolerate the trailing newline yt-dlp adds.
  fs.writeFileSync(bin, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(INFO))} + "\\n");\n`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

/** A throwaway HOME with no ~/.claude/.credentials.json — simulates "not logged in". */
export function makeEmptyHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ytd-home-"));
}

export const EXPECTED_TRANSCRIPT = "hello world";
