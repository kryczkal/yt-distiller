// Side panel: connects to the native-messaging host (spawned on demand by the
// browser), streams the distillation back, and renders it as it arrives. No
// localhost server, no token — the host's allowed_origins binds it to this
// extension's id.

import { extractVideoId } from "./util.js";
import { marked } from "./vendor/marked.esm.js";

marked.setOptions({ gfm: true, breaks: false });

const HOST = "com.yt_distill.host";
const $ = (id) => document.getElementById(id);
let currentRun = 0;
let lastVideoId = null;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function setStatus(html) { $("status").innerHTML = html; }
function renderMd(md) { $("summary").innerHTML = marked.parse(md); }
function showMeta(m) {
  $("meta").innerHTML =
    `<div class="title">${esc(m.title || m.id || "")}</div>` +
    `<div class="sub">${[m.channel, m.duration, m.captionKind].filter(Boolean).map(esc).join(" · ")}</div>`;
}

function summarize(videoId, { mode = "auto" } = {}) {
  const id = extractVideoId(videoId) || videoId;
  lastVideoId = id;
  const run = ++currentRun;
  $("empty").hidden = true;
  $("meta").innerHTML = "";
  $("summary").innerHTML = "";
  setStatus(`<span class="spin"></span> Starting…`);

  let acc = "";
  let gotMsg = false;
  let finished = false;

  let port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    setStatus(`❌ Native host unavailable. Run <code>./install.sh</code> and reload the extension.`);
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
      renderMd(acc);
    } else if (msg.type === "done") {
      finished = true;
      acc = msg.text || acc;
      renderMd(acc);
      const rl = msg.rateLimitType ? "subscription" : "";
      const out = msg.usage?.output_tokens;
      const src = msg.source === "gemini" ? " · Gemini (watched video)" : "";
      setStatus(`✦ Distilled${out ? ` · ${out} tokens` : ""}${rl ? ` · ${rl}` : ""}${src}`);
      try { port.disconnect(); } catch {}
    } else if (msg.type === "error") {
      finished = true;
      if (msg.code === "NO_TRANSCRIPT") {
        setStatus(
          `⚠️ No captions for this video.` +
          (msg.available?.length ? ` Languages: ${esc(msg.available.slice(0, 8).join(", "))}.` : "") +
          ` Try <b>⟳ video</b> (needs <code>GEMINI_API_KEY</code> in .env).`
        );
      } else if (msg.code === "NO_GEMINI_KEY") {
        setStatus(`⚠️ ${esc(msg.message)}`);
      } else {
        setStatus(`❌ ${esc(msg.message || "error")}`);
      }
      try { port.disconnect(); } catch {}
    }
  });

  port.onDisconnect.addListener(() => {
    if (run !== currentRun || finished) return;
    const err = chrome.runtime.lastError;
    if (err && !gotMsg) {
      setStatus(`❌ Native host failed: ${esc(err.message || "")}.<br>Run <code>./install.sh</code>; make sure <code>claude</code> is logged in and <code>node</code> is on PATH.`);
    } else if (!gotMsg) {
      setStatus(`❌ Native host produced no output. Check <code>./install.sh</code> ran and dependencies are installed.`);
    } else {
      setStatus(`⚠️ Connection closed before finishing.`);
    }
  });

  try {
    port.postMessage({ type: "summarize", videoId: id, mode });
  } catch (e) {
    setStatus(`❌ Couldn't message native host: ${esc(e.message)}`);
  }
}

// --- wiring ---
$("go").addEventListener("click", () => {
  const v = extractVideoId($("url-input").value.trim());
  if (v) summarize(v);
  else setStatus("⚠️ Couldn't find a video id in that URL.");
});
$("url-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go").click(); });
$("tab").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const v = extractVideoId(tab?.url || "");
  if (v) summarize(v);
  else setStatus("⚠️ The current tab isn't a YouTube video.");
});
$("video").addEventListener("click", () => {
  const v = lastVideoId || extractVideoId($("url-input").value.trim());
  if (v) summarize(v, { mode: "video" });
  else setStatus("⚠️ Distill a video first (or paste a URL), then re-run from the video.");
});

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "summarize" && m.videoId) summarize(m.videoId);
});

(async function init() {
  const { pending } = await chrome.storage.session.get("pending");
  if (pending?.videoId && Date.now() - pending.ts < 60_000) summarize(pending.videoId);
})();
