// contentScript.js
// Scans the page DOM and HTML for video URLs. No DRM bypass, just link discovery.

const VIDEO_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|m3u8|mpd)(\?|#|$)/i;

function absoluteUrl(url, base = document.baseURI) {
  try {
    return String(new URL(url, base));
  } catch {
    return null;
  }
}

function gatherFromVideoTags() {
  const out = [];
  const mapPoster = new Map();
  document.querySelectorAll("video").forEach(v => {
    const poster = v.getAttribute("poster") || null;
    const sources = new Set();
    if (v.src) sources.add(v.currentSrc || v.src);
    v.querySelectorAll("source").forEach(s => { if (s.src) sources.add(s.src); });
    sources.forEach(u => {
      const abs = absoluteUrl(u);
      if (!abs) return;
      const type = v.getAttribute("type") || (u.match(VIDEO_EXT_RE)?.[1]?.toLowerCase()) || "";
      out.push({ url: abs, from: "video/source", type });
      if (poster) mapPoster.set(abs, absoluteUrl(poster));
    });
  });
  return { items: out, posters: mapPoster };
}

function gatherFromLinks() {
  const out = [];
  document.querySelectorAll("a[href]").forEach(a => {
    const href = a.getAttribute("href");
    const abs = absoluteUrl(href);
    if (!abs) return;
    if (VIDEO_EXT_RE.test(abs)) {
      out.push({ url: abs, from: "anchor", type: (abs.match(VIDEO_EXT_RE)?.[1]?.toLowerCase()) || "" });
    }
  });
  return out;
}

function gatherFromHTML() {
  const out = [];
  const html = document.documentElement.outerHTML;
  const urlRe = /https?:\/\/[^\s"'<>]+/g;
  const seen = new Set();
  let m;
  while ((m = urlRe.exec(html)) !== null) {
    const u = m[0];
    if (VIDEO_EXT_RE.test(u) && !seen.has(u)) {
      seen.add(u);
      out.push({ url: u, from: "html", type: (u.match(VIDEO_EXT_RE)?.[1]?.toLowerCase()) || "" });
    }
  }
  return out;
}

function dedupe(items) {
  const map = new Map();
  for (const it of items) {
    if (!it.url) continue;
    if (!map.has(it.url)) map.set(it.url, it);
  }
  return Array.from(map.values());
}

function pageThumbFallback() {
  const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
  if (og) return absoluteUrl(og);
  const linkImg = document.querySelector('link[rel="image_src"]')?.getAttribute("href");
  if (linkImg) return absoluteUrl(linkImg);
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.cmd === "SCAN_FOR_VIDEOS") {
    const { items: tagItems, posters } = gatherFromVideoTags();
    const items = dedupe([
      ...tagItems,
      ...gatherFromLinks(),
      ...gatherFromHTML()
    ]).map(it => ({ ...it, poster: posters.get(it.url) || null }));

    const pagePoster = pageThumbFallback();
    items.forEach(it => { if (!it.poster && pagePoster) it.poster = pagePoster; });

    // Annotate flags
    items.forEach(it => {
      it.isBlob = it.url.startsWith("blob:");
      it.isData = it.url.startsWith("data:");
      it.filename = (() => {
        try { return decodeURIComponent(new URL(it.url).pathname.split("/").pop() || "video"); }
        catch { return "video"; }
      })();
    });

    sendResponse({ ok: true, items });
  }
});