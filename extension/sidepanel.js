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

// Inline SVG (Lucide-style strokes) — no emoji as functional iconography.
const ICON = {
  spark: '<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z"/></svg>',
  source: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>',
  warn: '<svg class="icon warn" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  err: '<svg class="icon err" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
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
