// Side panel: reads the pending video, streams the distillation from the local
// backend (NDJSON), and renders it as it arrives.

import { extractVideoId, watchUrl, DEFAULT_BACKEND } from "./util.js";
import { marked } from "./vendor/marked.esm.js";

marked.setOptions({ gfm: true, breaks: false });

const $ = (id) => document.getElementById(id);
const cfg = { backendUrl: DEFAULT_BACKEND, token: "" };
let currentRun = 0;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function setStatus(html) { $("status").innerHTML = html; }
function renderMd(md) { $("summary").innerHTML = marked.parse(md); }

async function loadCfg() {
  const s = await chrome.storage.local.get(["backendUrl", "token"]);
  if (s.backendUrl) cfg.backendUrl = s.backendUrl;
  if (s.token) cfg.token = s.token;
}

function showMeta(m) {
  $("meta").innerHTML =
    `<div class="title">${esc(m.title || m.id)}</div>` +
    `<div class="sub">${[m.channel, m.duration, m.captionKind].filter(Boolean).map(esc).join(" · ")}</div>`;
}

async function summarize(videoId) {
  const id = extractVideoId(videoId) || videoId;
  const run = ++currentRun;
  $("empty").hidden = true;
  $("meta").innerHTML = "";
  $("summary").innerHTML = "";
  setStatus(`<span class="spin"></span> Fetching transcript…`);

  let acc = "";
  try {
    const resp = await fetch(`${cfg.backendUrl}/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-yt-distill-token": cfg.token },
      body: JSON.stringify({ videoId: id }),
    });

    if (resp.status === 401) {
      setStatus(`❌ Backend rejected the token. Open <a href="#" id="o1">⚙ settings</a> and paste the token the backend printed.`);
      $("o1")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
      return;
    }
    if (!resp.ok) { setStatus(`❌ Backend error ${resp.status}`); return; }

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (run !== currentRun) { reader.cancel(); return; } // superseded
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === "meta") {
          showMeta(msg);
          setStatus(`<span class="spin"></span> Distilling…`);
        } else if (msg.type === "delta") {
          acc += msg.text;
          renderMd(acc);
        } else if (msg.type === "done") {
          acc = msg.text || acc;
          renderMd(acc);
          const rl = msg.rateLimitType === "five_hour" ? "subscription" : (msg.rateLimitType || "");
          const out = msg.usage?.output_tokens;
          setStatus(`✦ Distilled${out ? ` · ${out} tokens` : ""}${rl ? ` · ${rl}` : ""}`);
        } else if (msg.type === "error") {
          if (msg.code === "NO_TRANSCRIPT") {
            setStatus(
              `⚠️ No transcript available for this video.` +
              (msg.available?.length ? ` Available languages: ${esc(msg.available.slice(0, 8).join(", "))}` : "")
            );
          } else {
            setStatus(`❌ ${esc(msg.message || "error")}`);
          }
        }
      }
    }
    if (run === currentRun && !acc) setStatus(`⚠️ No output received.`);
  } catch (e) {
    setStatus(
      `❌ Can't reach the backend at <code>${esc(cfg.backendUrl)}</code>.<br>` +
      `Start it: <code>cd backend &amp;&amp; ./start.sh</code>`
    );
  }
}

// --- wiring ---
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
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

chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "summarize" && m.videoId) summarize(m.videoId);
});

(async function init() {
  await loadCfg();
  const { pending } = await chrome.storage.session.get("pending");
  if (pending?.videoId && Date.now() - pending.ts < 60_000) {
    summarize(pending.videoId);
  }
})();
