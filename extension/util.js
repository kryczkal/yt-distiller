// Shared helpers (ES module, imported by background.js and sidepanel.js).

/** Extract the 11-char YouTube video id from a URL or a bare id. */
export function extractVideoId(input) {
  if (!input) return null;
  if (/^[\w-]{11}$/.test(input)) return input;
  const m =
    input.match(/[?&]v=([\w-]{11})/) ||
    input.match(/youtu\.be\/([\w-]{11})/) ||
    input.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
  return m ? m[1] : null;
}

export function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}
