// Side panel: connects to the native-messaging host (spawned on demand by the
// browser), streams the distillation back, and renders it as it arrives. No
// localhost server, no token — the host's allowed_origins binds it to this
// extension's id.

import { extractVideoId, watchUrl } from "./util.js";
import { marked } from "./vendor/marked.esm.js";

marked.setOptions({ gfm: true, breaks: false });

const HOST = "com.yt_distill.host";
const $ = (id) => document.getElementById(id);
let currentRun = 0;
let lastVideoId = null;
let lastMarkdown = "";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Defense in depth: the brief is model output, and renderMd() sinks marked's
// output into innerHTML. marked passes raw HTML through verbatim, and a video
// transcript can prompt-inject the model into emitting HTML — so render any raw
// HTML (block or inline) as inert text, never live markup. marked already drops
// javascript: URLs on links/images; this closes the last sink (<img> beacons,
// <iframe>, etc.). The distill contract is Markdown-only, so this never touches
// legitimate output.
marked.use({ renderer: { html: ({ text }) => esc(text) } });

// Inline SVG (Lucide-style strokes) — no emoji as functional iconography.
const ICON = {
  spark: '<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z"/></svg>',
  source: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>',
  warn: '<svg class="icon warn" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  err: '<svg class="icon err" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
};

function setStatus(html) { $("status").innerHTML = html; }
function clearStatus() { $("status").innerHTML = ""; }
function renderMd(md) { $("summary").innerHTML = marked.parse(md); }

function showMeta(m) {
  const id = m.id || lastVideoId;
  const sub = [m.channel, m.duration, m.captionKind].filter(Boolean).map(esc).join(" · ");
  const source = id
    ? `<a class="source" href="${esc(watchUrl(id))}" target="_blank" rel="noopener">watch ${ICON.source}</a>`
    : "";
  $("meta").innerHTML =
    `<div class="title">${esc(m.title || m.id || "")}</div>` +
    `<div class="sub"><span>${sub}</span>${source}</div>`;
}

function showSkeleton() {
  $("summary").innerHTML =
    '<div class="skeleton">' +
    '<div class="sk head"></div>' +
    '<div class="sk"></div><div class="sk short"></div><div class="sk"></div><div class="sk shorter"></div>' +
    '<div class="sk head"></div>' +
    '<div class="sk short"></div><div class="sk"></div><div class="sk shorter"></div>' +
    "</div>";
}

function fmtTokens(n) {
  if (!n) return "";
  if (n < 1000) return `${n} tok`;
  const k = n / 1000;
  return `${(k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, ""))}k tok`;
}

function showReceipt({ out, rl, src }) {
  const parts = ["Distilled", fmtTokens(out), rl, src].filter(Boolean);
  $("receipt-text").innerHTML = ICON.spark + `<span class="body">${esc(parts.join(" · "))}</span>`;
  $("receipt").hidden = false;
}

function summarize(videoId, { mode = "auto" } = {}) {
  const id = extractVideoId(videoId) || videoId;
  lastVideoId = id;
  const run = ++currentRun;
  $("empty").hidden = true;
  $("receipt").hidden = true;
  resetWatchBtn();
  $("meta").innerHTML = "";
  lastMarkdown = "";
  showSkeleton();
  setStatus(`<span class="spin"></span> Starting…`);

  let acc = "";
  let gotMsg = false;
  let finished = false;

  let port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    $("summary").innerHTML = "";
    setStatus(`${ICON.err} Native host unavailable. Run <code>./install.sh</code> and reload the extension.`);
    return;
  }

  port.onMessage.addListener((msg) => {
    if (run !== currentRun) { try { port.disconnect(); } catch {} return; }
    gotMsg = true;
    if (msg.type === "meta") {
      showMeta(msg);
      setStatus(`<span class="spin"></span> Distilling…`);
    } else if (msg.type === "delta") {
      acc += msg.text;
      lastMarkdown = acc;
      renderMd(acc);
    } else if (msg.type === "done") {
      finished = true;
      acc = msg.text || acc;
      lastMarkdown = acc;
      renderMd(acc);
      clearStatus();
      showReceipt({
        out: msg.usage?.output_tokens,
        rl: msg.rateLimitType ? "subscription" : "",
        src: msg.source === "gemini" ? "Gemini (watched video)" : "",
      });
      try { port.disconnect(); } catch {}
    } else if (msg.type === "error") {
      finished = true;
      $("summary").innerHTML = "";
      if (msg.code === "NO_TRANSCRIPT") {
        setStatus(
          `${ICON.warn} No captions for this video.` +
          (msg.available?.length ? ` Languages: ${esc(msg.available.slice(0, 8).join(", "))}.` : "") +
          ` Try <b>Re-watch with Gemini</b> from the <b>⋯</b> menu (needs <code>GEMINI_API_KEY</code> in .env).`
        );
      } else if (msg.code === "NO_GEMINI_KEY") {
        setStatus(`${ICON.warn} ${esc(msg.message)}`);
      } else {
        setStatus(`${ICON.err} ${esc(msg.message || "error")}`);
      }
      try { port.disconnect(); } catch {}
    }
  });

  port.onDisconnect.addListener(() => {
    if (run !== currentRun || finished) return;
    $("summary").innerHTML = "";
    const err = chrome.runtime.lastError;
    if (err && !gotMsg) {
      setStatus(`${ICON.err} Native host failed: ${esc(err.message || "")}.<br>Run <code>./install.sh</code>; make sure <code>claude</code> is logged in and <code>node</code> is on PATH.`);
    } else if (!gotMsg) {
      setStatus(`${ICON.err} Native host produced no output. Check <code>./install.sh</code> ran and dependencies are installed.`);
    } else {
      setStatus(`${ICON.warn} Connection closed before finishing.`);
    }
  });

  try {
    port.postMessage({ type: "summarize", videoId: id, mode });
  } catch (e) {
    setStatus(`${ICON.err} Couldn't message native host: ${esc(e.message)}`);
  }
}

// --- overflow menu ---
const menu = $("menu");
const menuBtn = $("menu-btn");
function closeMenu() { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
function openMenu() { menu.hidden = false; menuBtn.setAttribute("aria-expanded", "true"); $("url-input").focus(); }
menuBtn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? openMenu() : closeMenu(); });
document.addEventListener("click", (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) closeMenu(); });

// --- actions ---
$("go").addEventListener("click", () => {
  const v = extractVideoId($("url-input").value.trim());
  if (v) { closeMenu(); summarize(v); }
  else setStatus(`${ICON.warn} Couldn't find a video id in that URL.`);
});
$("url-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go").click(); });
$("tab").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const v = extractVideoId(tab?.url || "");
  if (v) { closeMenu(); summarize(v); }
  else setStatus(`${ICON.warn} The current tab isn't a YouTube video.`);
});
$("video").addEventListener("click", () => {
  const v = lastVideoId || extractVideoId($("url-input").value.trim());
  if (v) { closeMenu(); summarize(v, { mode: "video" }); }
  else setStatus(`${ICON.warn} Distill a video first (or paste a URL), then re-watch.`);
});

// --- copy the brief ---
let copyTimer = null;
$("copy").addEventListener("click", async () => {
  if (!lastMarkdown) return;
  const btn = $("copy");
  try {
    await navigator.clipboard.writeText(lastMarkdown);
    btn.classList.add("done");
    btn.innerHTML = ICON.check + '<span class="copy-label">Copied</span>';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      btn.classList.remove("done");
      btn.innerHTML = ICON.copy + '<span class="copy-label">Copy</span>';
    }, 1600);
  } catch {
    btn.innerHTML = ICON.copy + '<span class="copy-label">Press ⌘C</span>';
  }
});

// --- mark as watched (nudge YouTube's recommendations) ---
// Opens the video in a background tab, force-plays it muted at 2× to clock real
// watch-time (the dominant "recommend more like this" signal), best-effort Likes
// it, then closes the tab. Entirely client-side — the native host isn't involved.
const WATCH = { targetSec: 25, maxWallMs: 18000, rate: 2, like: true, loadTimeoutMs: 15000 };
let watching = false;

function setWatchBtn(state, label, { disabled = false } = {}) {
  const btn = $("watch");
  btn.classList.remove("busy", "done", "err");
  if (state === "busy" || state === "done" || state === "err") btn.classList.add(state);
  const icon =
    state === "busy" ? '<span class="spin"></span>'
    : state === "done" ? ICON.check
    : state === "err" ? ICON.warn
    : ICON.eye;
  btn.innerHTML = icon + `<span class="watch-label">${esc(label)}</span>`;
  btn.disabled = disabled;
}
function resetWatchBtn() {
  watching = false;
  setWatchBtn("idle", "Mark watched", { disabled: false });
}

// Briefly show a line in the status area, then restore it — but never clobber a
// status that something else (e.g. a new distill) set in the meantime.
function flashStatus(html, ms = 5000) {
  setStatus(html);
  const snapshot = $("status").innerHTML;
  setTimeout(() => { if ($("status").innerHTML === snapshot) clearStatus(); }, ms);
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(listener); } catch {}
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.get(tabId).then((t) => { if (t?.status === "complete") finish(); }).catch(() => {});
  });
}

async function markWatched(videoId) {
  const id = extractVideoId(videoId) || videoId;
  if (!id || watching) return;
  watching = true;
  setWatchBtn("busy", "Opening…", { disabled: true });

  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: watchUrl(id), active: false });
    await waitForTabComplete(tab.id, WATCH.loadTimeoutMs);
    setWatchBtn("busy", WATCH.like ? "Watching + liking…" : "Watching…", { disabled: true });

    const [inj] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: engagePage,
      args: [{ targetSec: WATCH.targetSec, maxWallMs: WATCH.maxWallMs, rate: WATCH.rate, doLike: WATCH.like }],
    });
    const res = inj?.result || {};

    if (res.watched) {
      const likedNote = WATCH.like ? (res.liked ? " + liked" : ", but couldn’t find the Like button") : "";
      setWatchBtn("done", res.liked ? "Watched + liked" : "Watched", { disabled: true });
      flashStatus(`${ICON.check} Marked as watched${likedNote}. YouTube will factor this into your recommendations.`);
    } else {
      setWatchBtn("err", "Try again", { disabled: false });
      flashStatus(`${ICON.warn} Couldn’t register a watch — the player never started. Try again.`, 7000);
    }
  } catch (e) {
    setWatchBtn("err", "Try again", { disabled: false });
    const msg = String(e?.message || e || "");
    const hint = /cannot access|permission|host/i.test(msg)
      ? " If you just updated the extension, reload it at chrome://extensions to grant youtube.com access."
      : "";
    flashStatus(`${ICON.err} Couldn’t mark watched: ${esc(msg)}.${hint}`, 8000);
  } finally {
    if (tab?.id != null) { try { await chrome.tabs.remove(tab.id); } catch {} }
    watching = false;
  }
}

$("watch").addEventListener("click", () => { if (lastVideoId) markWatched(lastVideoId); });

// Injected into the (background) watch tab. Self-contained — no outer scope, no
// imports — because chrome.scripting serializes it as source. Drives the standard
// HTML5 <video> (a web standard, far more stable than YouTube's button DOM). The
// Like click is strictly best-effort and guarded so it can never un-like or hit
// Dislike.
async function engagePage({ targetSec, maxWallMs, rate, doLike }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + maxWallMs;

  let v = null;
  while (Date.now() < deadline) {
    v = document.querySelector("video");
    if (v && v.readyState >= 2) break;
    await sleep(250);
  }
  if (!v) return { watched: false, liked: false, reason: "no-video" };

  const pin = () => {
    try { v.muted = true; v.volume = 0; } catch {}
    try { if (rate && v.playbackRate !== rate) v.playbackRate = rate; } catch {}
  };
  const play = async () => { try { await v.play(); } catch {} };

  pin();
  await play();

  const dur = v.duration && isFinite(v.duration) ? v.duration : 0;
  const target = Math.max(5, dur ? Math.min(targetSec, dur - 1) : targetSec);
  const startCt = v.currentTime || 0;
  let advanced = 0;

  while (Date.now() < deadline) {
    const skip = document.querySelector(
      ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button"
    );
    if (skip) { try { skip.click(); } catch {} }
    pin();
    if (v.paused || v.ended) await play();
    advanced = (v.currentTime || 0) - startCt;
    if (advanced >= target || v.ended) break;
    await sleep(500);
  }

  let liked = false;
  if (doLike) liked = clickLike();

  return { watched: advanced > 0 || (v.currentTime || 0) > startCt, liked, advanced: Math.round(advanced) };

  function clickLike() {
    // The like component is its own element, separate from dislike, so targeting
    // it can't toggle the wrong button.
    let btn =
      document.querySelector("ytd-watch-metadata like-button-view-model button") ||
      document.querySelector("like-button-view-model button");
    if (!btn) {
      // Heuristic fallback: a control labelled "like" but never "dislike".
      const labelOf = (b) => (b.getAttribute("aria-label") || b.getAttribute("title") || "").trim();
      btn = Array.from(document.querySelectorAll("button[aria-label], button[title]"))
        .find((b) => { const s = labelOf(b); return /\blike\b/i.test(s) && !/dislike/i.test(s); }) || null;
    }
    if (!btn) return false;
    if (btn.getAttribute("aria-pressed") === "true") return true; // already liked — don't toggle off
    try { btn.click(); } catch { return false; }
    return true;
  }
}

// --- reading text size ---
const BASE_PX = 15.5, MIN_PX = 12, MAX_PX = 24, STEP_PX = 1.5;
let fontPx = BASE_PX;
function applyFont() {
  document.documentElement.style.setProperty("--reading-size", `${fontPx}px`);
  $("font-reset").textContent = `${Math.round((fontPx / BASE_PX) * 100)}%`;
}
function setFont(px, persist = true) {
  fontPx = Math.min(MAX_PX, Math.max(MIN_PX, Math.round(px * 10) / 10));
  applyFont();
  if (persist) { try { chrome.storage.local.set({ fontPx }); } catch {} }
}
applyFont();
$("font-inc").addEventListener("click", () => setFont(fontPx + STEP_PX));
$("font-dec").addEventListener("click", () => setFont(fontPx - STEP_PX));
$("font-reset").addEventListener("click", () => setFont(BASE_PX));
// Make the native zoom gesture resize the brief, not the whole panel.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "=" || e.key === "+") { e.preventDefault(); setFont(fontPx + STEP_PX); }
  else if (e.key === "-" || e.key === "_") { e.preventDefault(); setFont(fontPx - STEP_PX); }
  else if (e.key === "0") { e.preventDefault(); setFont(BASE_PX); }
});

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "summarize" && m.videoId) summarize(m.videoId);
});

(async function init() {
  const { fontPx: savedPx } = await chrome.storage.local.get("fontPx");
  if (typeof savedPx === "number") setFont(savedPx, false);
  const { pending } = await chrome.storage.session.get("pending");
  if (pending?.videoId && Date.now() - pending.ts < 60_000) summarize(pending.videoId);
})();
