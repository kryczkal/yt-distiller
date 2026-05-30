// Service worker: registers the context-menu trigger and opens the side panel.
// No content script, no YouTube DOM — the video URL comes straight from the
// right-clicked link (info.linkUrl) or the watch page (info.pageUrl), so this
// survives any YouTube redesign.

import { extractVideoId, watchUrl } from "./util.js";

const VIDEO_LINK_PATTERNS = [
  "*://*.youtube.com/watch?v=*",
  "*://*.youtube.com/shorts/*",
  "*://m.youtube.com/watch?v=*",
  "*://youtu.be/*",
];
const WATCH_PAGE_PATTERNS = [
  "*://*.youtube.com/watch?v=*",
  "*://*.youtube.com/shorts/*",
  "*://m.youtube.com/watch?v=*",
];

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    // Right-click a thumbnail / link anywhere (feed, search, sidebar) — summarize without opening.
    chrome.contextMenus.create({
      id: "ytd-link",
      title: "✦ Distill this video",
      contexts: ["link"],
      targetUrlPatterns: VIDEO_LINK_PATTERNS,
    });
    // Right-click on the watch page itself (player, page, thumbnail image).
    chrome.contextMenus.create({
      id: "ytd-page",
      title: "✦ Distill this video",
      contexts: ["page", "video", "image", "frame"],
      documentUrlPatterns: WATCH_PAGE_PATTERNS,
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "ytd-link" && info.menuItemId !== "ytd-page") return;
  const source = info.linkUrl || info.pageUrl || tab?.url || "";
  const videoId = extractVideoId(source);
  if (!videoId) return;

  // Stash for the panel to pick up on (re)load, and message it if already open.
  await chrome.storage.session.set({
    pending: { videoId, url: watchUrl(videoId), ts: Date.now() },
  });

  if (tab?.windowId != null) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (e) {
      // open() must run in a user gesture; the context-menu click qualifies.
      console.warn("sidePanel.open failed:", e);
    }
  }
  chrome.runtime.sendMessage({ type: "summarize", videoId }).catch(() => {});
});

// Clicking the toolbar icon opens the panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
