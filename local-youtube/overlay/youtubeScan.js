// This entire function runs in the selected document; it uses only visible DOM.
export function scanYouTubePage() {
  const validId = /^[A-Za-z0-9_-]{11}$/;
  const isHost = hostname => /^(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com)$/.test(hostname) || hostname === "youtu.be";
  if (!isHost(location.hostname)) return { ok: true, isYouTube: false, items: [] };
  const videoId = value => {
    try {
      const url = new URL(value, location.href);
      if (!/^https?:$/.test(url.protocol) || !isHost(url.hostname) || url.username || url.password) return "";
      const parts = url.pathname.split("/").filter(Boolean);
      const id = url.hostname === "youtu.be" ? parts[0] : parts[0] === "watch" ? url.searchParams.get("v") :
        ["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : "";
      return validId.test(id || "") ? id : "";
    } catch { return ""; }
  };
  const text = node => (node?.getAttribute?.("title") || node?.textContent || "").replace(/\s+/g, " ").trim();
  const item = (id, title) => ({ platform: "youtube", kind: "youtube", youtubeId: id,
    title: title || "YouTube video", url: `https://www.youtube.com/watch?v=${id}` });
  const current = videoId(location.href);
  if (current) {
    const activeShort = document.querySelector("ytd-reel-video-renderer[is-active], ytd-reel-video-renderer[active]");
    const title = text(activeShort?.querySelector("h2, [id='video-title']")) ||
      text(document.querySelector("ytd-watch-metadata h1, #above-the-fold #title h1, h1.ytd-watch-metadata")) ||
      text(document.querySelector(".ytp-title-link")) ||
      document.querySelector('meta[property="og:title"]')?.content || document.title.replace(/\s*[-–|]\s*YouTube\s*$/i, "");
    return { ok: true, isYouTube: true, items: [item(current, title)] };
  }
  const visible = node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < innerHeight && rect.left < innerWidth && style.visibility !== "hidden" && style.display !== "none";
  };
  const items = [];
  const seen = new Set();
  for (const anchor of document.querySelectorAll('a[href*="/watch?"], a[href*="/shorts/"], a[href*="/live/"], a[href^="https://youtu.be/"]')) {
    if (!visible(anchor)) continue;
    const id = videoId(anchor.href);
    if (!id || seen.has(id)) continue;
    const card = anchor.closest("ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model, yt-shorts-lockup-view-model");
    const titleNode = card?.querySelector('#video-title, .yt-lockup-metadata-view-model__title, .shortsLockupViewModelHostMetadataTitle, h3, h2');
    const title = text(titleNode) || text(anchor) || anchor.querySelector("img")?.alt || "YouTube video";
    seen.add(id);
    items.push(item(id, title));
    if (items.length === 100) break;
  }
  return { ok: true, isYouTube: true, items };
}
