// Gemini visual fallback: when a video has no usable captions (or is visual-heavy),
// hand the YouTube URL directly to Gemini's native-video API, which watches the
// actual frames+audio. Free tier (2.5 Flash), PUBLIC videos only.

import { SUMMARIZER_SYSTEM_VIDEO } from "./distill-prompt.js";
import { DistillerError } from "./errors.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// Generous cap (Gemini watches the whole video, which can legitimately take a
// while) but not infinite — a hung request must not pin the one-shot host open.
const GEMINI_TIMEOUT_MS = 180_000;

export function geminiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Distill a YouTube video by having Gemini watch it. Streams text via onText.
 * @param {string} youtubeUrl  canonical watch URL (PUBLIC videos only)
 * @param {{model?:string, onText?:(s:string)=>void}} [opts]
 * @returns {Promise<{text:string, source:"gemini", model:string}>}
 */
export async function distillViaGemini(youtubeUrl, { model = process.env.GEMINI_MODEL || "gemini-2.5-flash", onText = null } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new DistillerError("GEMINI_API_KEY not set", { code: "NO_GEMINI_KEY" });

  const body = {
    systemInstruction: { parts: [{ text: SUMMARIZER_SYSTEM_VIDEO }] },
    contents: [{
      role: "user",
      parts: [
        { fileData: { fileUri: youtubeUrl } },
        { text: "Distill this video into the tightest load-bearing document, following your instructions exactly. Read on-screen text/code/numbers off the frames and keep them verbatim." },
      ],
    }],
    generationConfig: { temperature: 0.3 },
  };

  const url = `${ENDPOINT}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (e) {
    throw new DistillerError("Gemini request failed: " + (e.message || e), { code: "GEMINI_ERROR", cause: e });
  }

  if (!res.ok || !res.body) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { try { detail = await res.text(); } catch {} }
    throw new DistillerError(`Gemini HTTP ${res.status}: ${String(detail).slice(0, 300)}`, {
      code: res.status === 429 ? "GEMINI_RATE_LIMIT" : "GEMINI_ERROR",
    });
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let obj;
      try { obj = JSON.parse(payload); } catch { continue; }
      if (obj?.error) throw new DistillerError("Gemini: " + (obj.error.message || "error"), { code: "GEMINI_ERROR" });
      for (const p of obj?.candidates?.[0]?.content?.parts || []) {
        if (p.text) { text += p.text; onText?.(p.text); }
      }
    }
  }

  text = text.trim();
  if (!text) throw new DistillerError("Gemini returned no text (private/unlisted video, or content filtered)", { code: "GEMINI_EMPTY" });
  return { text, source: "gemini", model };
}
