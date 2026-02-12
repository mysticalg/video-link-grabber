// background.js (service worker, MV3)
const BYTE_UNITS = ["B","KB","MB","GB","TB"];
function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "Unknown";
  let i = 0;
  while (n >= 1024 && i < BYTE_UNITS.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${BYTE_UNITS[i]}`;
}

async function headThenRange(url) {
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow" });
    const type = head.headers.get("content-type");
    const lenStr = head.headers.get("content-length");
    let size = lenStr ? parseInt(lenStr, 10) : null;
    if ((size == null || Number.isNaN(size)) && head.ok) {
      // Try a tiny ranged GET to infer size from Content-Range (if supported)
      const range = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow" });
      const cr = range.headers.get("content-range");
      if (cr) {
        const m = cr.match(/\/(\d+)$/);
        if (m) size = parseInt(m[1], 10);
      }
      if (!size) {
        const len2 = range.headers.get("content-length");
        if (len2) size = parseInt(len2, 10);
      }
    }
    return { ok: head.ok, status: head.status, type, size, sizeHuman: fmtBytes(size ?? -1) };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.cmd === "PROBE_HEADERS" && typeof msg.url === "string") {
    headThenRange(msg.url).then(sendResponse);
    return true; // keep message channel open for async response
  }
});