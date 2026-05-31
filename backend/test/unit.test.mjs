// Offline unit tests for the pure parsing/extraction logic — the most
// regression-prone code and the highest-ROI to test: no network, no auth, fully
// deterministic. Run with `npm test` (node --test). Convention: `*.test.mjs` are
// these offline unit tests; `*-test.mjs` are the live-network smokes, run by hand.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractVideoId,
  normalizeUrl,
  pickTrack,
  pickFormat,
  parseJson3,
  parseVtt,
} from "../lib/transcript.js";
import { buildDistillPrompt } from "../lib/distill-prompt.js";
import { DistillerError } from "../lib/errors.js";

const VID = "Gjnup-PuquQ"; // 11 chars, exercises the hyphen in the id charset

test("extractVideoId — bare 11-char id passes through", () => {
  assert.equal(extractVideoId(VID), VID);
});

test("extractVideoId — watch?v= URL with trailing params", () => {
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${VID}&t=42s&list=PLabc`), VID);
});

test("extractVideoId — youtu.be short link", () => {
  assert.equal(extractVideoId(`https://youtu.be/${VID}?si=xyz`), VID);
});

test("extractVideoId — shorts / embed / live paths", () => {
  assert.equal(extractVideoId(`https://www.youtube.com/shorts/${VID}`), VID);
  assert.equal(extractVideoId(`https://www.youtube.com/embed/${VID}`), VID);
  assert.equal(extractVideoId(`https://www.youtube.com/live/${VID}`), VID);
});

test("extractVideoId — non-video input returns null", () => {
  assert.equal(extractVideoId("https://www.youtube.com/"), null);
  assert.equal(extractVideoId("not a url"), null);
  assert.equal(extractVideoId(""), null);
  assert.equal(extractVideoId(null), null);
});

test("normalizeUrl — bare id becomes a canonical watch URL", () => {
  assert.equal(normalizeUrl(VID), `https://www.youtube.com/watch?v=${VID}`);
});

test("normalizeUrl — an existing URL is returned unchanged", () => {
  const u = `https://youtu.be/${VID}`;
  assert.equal(normalizeUrl(u), u);
});

test("normalizeUrl — empty input throws a coded DistillerError", () => {
  assert.throws(() => normalizeUrl(""), (e) => e instanceof DistillerError && e.code === "NO_INPUT");
});

test("parseJson3 — joins event segments, trims, collapses whitespace", () => {
  const raw = JSON.stringify({
    events: [
      { segs: [{ utf8: "Hello" }, { utf8: " world" }] },
      { segs: [{ utf8: "\n" }] }, // whitespace-only -> dropped
      { segs: [{ utf8: "again" }] },
    ],
  });
  assert.equal(parseJson3(raw), "Hello world again");
});

test("parseJson3 — tolerates missing events/segs", () => {
  assert.equal(parseJson3(JSON.stringify({})), "");
  assert.equal(parseJson3(JSON.stringify({ events: [{}] })), "");
});

test("parseVtt — strips headers, cues, timestamps and inline tags", () => {
  const raw = [
    "WEBVTT",
    "Kind: captions",
    "Language: en",
    "",
    "00:00:01.000 --> 00:00:03.000",
    "<c>Hello</c> there",
    "",
    "00:00:03.000 --> 00:00:05.000",
    "general kenobi",
  ].join("\n");
  assert.equal(parseVtt(raw), "Hello there general kenobi");
});

test("parseVtt — collapses the rolling-window duplication of auto-captions", () => {
  const raw = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:02.000",
    "the quick brown",
    "00:00:02.000 --> 00:00:03.000",
    "the quick brown", // exact repeat of the previous line -> dropped
    "00:00:03.000 --> 00:00:04.000",
    "fox",
  ].join("\n");
  assert.equal(parseVtt(raw), "the quick brown fox");
});

test("pickTrack — prefers a manual track over auto for the same lang", () => {
  const info = {
    subtitles: { en: [{ ext: "vtt", url: "manual" }] },
    automatic_captions: { en: [{ ext: "vtt", url: "auto" }] },
  };
  const t = pickTrack(info, "en");
  assert.equal(t.kind, "manual");
  assert.equal(t.lang, "en");
});

test("pickTrack — falls back to auto when no manual track exists", () => {
  const info = { automatic_captions: { en: [{ ext: "vtt", url: "auto" }] } };
  assert.equal(pickTrack(info, "en").kind, "auto");
});

test("pickTrack — matches a lang prefix (en -> en-US)", () => {
  const info = { subtitles: { "en-US": [{ ext: "vtt", url: "x" }] } };
  const t = pickTrack(info, "en");
  assert.equal(t.lang, "en-US");
  assert.equal(t.kind, "manual");
});

test("pickTrack — returns null when nothing matches", () => {
  assert.equal(pickTrack({ subtitles: { fr: [] } }, "en"), null);
  assert.equal(pickTrack({}, "en"), null);
});

test("pickFormat — prefers json3, then vtt, over other formats", () => {
  assert.equal(pickFormat([{ ext: "srv1" }, { ext: "vtt" }, { ext: "json3" }]).ext, "json3");
  assert.equal(pickFormat([{ ext: "srv1" }, { ext: "vtt" }]).ext, "vtt");
});

test("pickFormat — falls back to the first format when none are preferred", () => {
  assert.equal(pickFormat([{ ext: "weird" }, { ext: "other" }]).ext, "weird");
});

test("buildDistillPrompt — includes provided metadata and the transcript", () => {
  const out = buildDistillPrompt({
    title: "T",
    channel: "C",
    duration: "1:23",
    captionKind: "manual en",
    transcript: "the body",
  });
  assert.match(out, /Title: T/);
  assert.match(out, /Channel: C/);
  assert.match(out, /Duration: 1:23/);
  assert.match(out, /Caption source: manual en/);
  assert.match(out, /the body/);
});

test("buildDistillPrompt — omits absent metadata fields cleanly", () => {
  const out = buildDistillPrompt({ transcript: "only body" });
  assert.doesNotMatch(out, /Title:/);
  assert.doesNotMatch(out, /Channel:/);
  assert.match(out, /only body/);
});
