// Offline unit tests for the shared orchestration core. Uses the fake yt-dlp +
// data: caption fixture so the transcript path runs with no network. The raw
// distill path never touches Claude, so these are fully deterministic.
//
// transcript.js reads YT_DISTILL_YTDLP at module-eval time, so we set it BEFORE
// importing orchestrate (mirrors how the real transports load .env first).

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeFakeYtDlp, makeEmptyHome, EXPECTED_TRANSCRIPT } from "./fixture.mjs";

process.env.YT_DISTILL_YTDLP = makeFakeYtDlp();
const { orchestrate, claudeAuthAvailable } = await import("../lib/orchestrate.js");
const { getTranscript, listLanguages } = await import("../lib/transcript.js");

test("getTranscript — fetches + parses the data: caption track offline", async () => {
  const v = await getTranscript("abc12345678");
  assert.equal(v.transcript, EXPECTED_TRANSCRIPT);
  assert.equal(v.title, "Test Title");
  assert.equal(v.captionKind, "auto en");
});

test("listLanguages — reports manual vs auto tracks", async () => {
  const langs = await listLanguages("abc12345678");
  assert.deepEqual(langs, { manual: [], auto: ["en"] });
});

test("orchestrate raw — returns transcript + prompt, never calls Claude", async () => {
  const r = await orchestrate({ url: "abc12345678", distillMode: "raw" });
  assert.equal(r.kind, "raw");
  assert.equal(r.source, "raw");
  assert.equal(r.transcript, EXPECTED_TRANSCRIPT);
  assert.match(r.system, /distill/i);
  assert.match(r.prompt, new RegExp(EXPECTED_TRANSCRIPT));
});

test("orchestrate — calls onMeta with video metadata", async () => {
  let meta = null;
  await orchestrate({ url: "abc12345678", distillMode: "raw", onMeta: (m) => (meta = m) });
  assert.equal(meta.title, "Test Title");
  assert.equal(meta.channel, "Test Channel");
});

test("orchestrate auto — falls back to raw (with a note) when not logged into Claude", async () => {
  const savedHome = process.env.HOME;
  const savedToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  process.env.HOME = makeEmptyHome();
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    assert.equal(claudeAuthAvailable(), false, "precondition: no auth in empty HOME");
    const r = await orchestrate({ url: "abc12345678", distillMode: "auto" });
    assert.equal(r.kind, "raw");
    assert.match(r.note, /not logged into claude/i);
  } finally {
    process.env.HOME = savedHome;
    if (savedToken !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = savedToken;
  }
});

test("claudeAuthAvailable — true when CLAUDE_CODE_OAUTH_TOKEN is set", () => {
  const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "x";
  try {
    assert.equal(claudeAuthAvailable(), true);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved;
  }
});
