const MIME_EXTENSIONS = {
  "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
  "video/quicktime": "mov", "video/x-m4v": "m4v", "video/x-matroska": "mkv",
  "application/vnd.apple.mpegurl": "m3u8", "application/x-mpegurl": "m3u8",
  "audio/mpegurl": "m3u8", "audio/x-mpegurl": "m3u8", "application/dash+xml": "mpd",
};
const VIDEO_EXTENSIONS = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv|m3u8|mpd)$/i;

export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

export function validateUrl(value, { allowEmpty = false, httpOnly = false } = {}) {
  if (allowEmpty && value === "") return "";
  if (typeof value !== "string" || !value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid media URL.");
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid media URL."); }
  const allowed = httpOnly ? ["http:", "https:"] : ["http:", "https:", "blob:", "data:"];
  if (!allowed.includes(url.protocol)) throw new Error("This URL type is not supported.");
  if (url.username || url.password) throw new Error("URLs containing embedded credentials are not supported.");
  return url.href;
}

export function sanitizeFilename(value, fallback = "video") {
  let filename = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
    .replace(/^\.+/, "")
    .replace(/[.\s]+$/g, "")
    .trim();
  if (!filename) filename = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = `_${filename}`;
  if (filename.length > 180) {
    const suffix = filename.match(/\.[a-z0-9]{1,12}$/i)?.[0] || "";
    filename = filename.slice(0, 180 - suffix.length).replace(/[.\s]+$/g, "") + suffix;
  }
  return filename;
}

export function isManifest(url, type = "") {
  const mime = String(type).split(";")[0].trim().toLowerCase();
  let path = "";
  try { path = new URL(url).pathname; } catch { /* a source may not have a URL */ }
  return /\.(m3u8|mpd)$/i.test(path) || /^(?:m3u8|mpd)$/.test(mime)
    || /^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)|audio\/(?:x-)?mpegurl)$/.test(mime);
}

export function isHls(url, type = "") {
  const mime = String(type).split(";")[0].trim().toLowerCase();
  let path = "";
  try { path = new URL(url).pathname; } catch { /* no URL */ }
  return /\.m3u8$/i.test(path) || mime === "m3u8"
    || /^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl)|audio\/(?:x-)?mpegurl)$/.test(mime);
}

export function filenameForMedia(item) {
  let filename = item.filename;
  if (!filename && item.url) {
    try { filename = decodeURIComponent(new URL(item.url).pathname.split("/").pop()); } catch { /* use fallback */ }
  }
  filename = sanitizeFilename(filename, item.isManifest ? "playlist" : "video");
  const type = String(item.type || "").split(";")[0].trim().toLowerCase();
  let directExtension = "";
  if (item.directUrl) {
    try { directExtension = new URL(item.directUrl).pathname.match(/\.(mp4|webm|ogv|ogg|mov|m4v|mkv)$/i)?.[1]?.toLowerCase() || ""; } catch { /* validation happens at the message boundary */ }
  }
  const extension = directExtension || MIME_EXTENSIONS[type] || (/^(mp4|webm|ogv|ogg|mov|m4v|mkv|m3u8|mpd)$/.test(type) ? type : "");
  if (directExtension && VIDEO_EXTENSIONS.test(filename)) filename = filename.replace(VIDEO_EXTENSIONS, `.${directExtension}`);
  else if (extension && !VIDEO_EXTENSIONS.test(filename)) filename = sanitizeFilename(`${filename}.${extension}`);
  return filename;
}

export function validateTabId(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error("No valid browser tab was selected.");
  return value;
}

export function isExtensionUiSender(sender, extensionId) {
  return !!extensionId && sender?.id === extensionId
    && typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${extensionId}/`);
}

export function validateMediaItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("No video was selected.");
  const videoId = typeof value.videoId === "string" && value.videoId.length <= 256 ? value.videoId : "";
  const url = validateUrl(value.url, { allowEmpty: !!videoId });
  if (typeof value.documentId !== "string" || !value.documentId || value.documentId.length > 256) {
    throw new Error("The video's page is no longer available. Rescan and try again.");
  }
  const type = typeof value.type === "string" ? value.type.slice(0, 256) : "";
  const manifest = isManifest(url, type) || value.isManifest === true;
  const directUrl = value.directUrl ? validateUrl(value.directUrl, { httpOnly: true }) : "";
  const streamUrl = value.streamUrl ? validateUrl(value.streamUrl, { httpOnly: true })
    : (isHls(url, type) && /^https?:/.test(url) ? url : "");
  let poster = null;
  if (typeof value.poster === "string" && value.poster) {
    try { poster = validateUrl(value.poster); } catch { /* discard unsafe previews */ }
  }
  return {
    url, videoId, type, poster, directUrl, streamUrl,
    filename: filenameForMedia({ ...value, url, type, isManifest: manifest }),
    documentId: value.documentId,
    frameId: Number.isInteger(value.frameId) && value.frameId >= 0 ? value.frameId : 0,
    from: typeof value.from === "string" ? value.from.slice(0, 256) : "page",
    isBlob: url.startsWith("blob:"), isData: url.startsWith("data:"), isManifest: manifest,
    canRecord: value.canRecord === true, recording: value.recording === true,
  };
}

function headerSize(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

export function responseSize(response) {
  if (response.status === 206) {
    const range = response.headers.get("content-range")?.match(/^bytes\s+\d+-\d+\/(\d+)$/i);
    // Content-Length on 206 is the small response chunk, never the file size.
    return range ? headerSize(range[1]) : null;
  }
  return response.ok ? headerSize(response.headers.get("content-length")) : null;
}

export async function probeHttpMedia(url, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  url = validateUrl(url, { httpOnly: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let type = "";
  let head = null;
  try {
    try {
      head = await fetchImpl(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
      if (head.ok) type = head.headers.get("content-type") || "";
      const size = responseSize(head);
      if (head.ok && size !== null) return { ok: true, status: head.status, type, size, sizeHuman: formatBytes(size) };
    } catch (error) {
      if (controller.signal.aborted) throw error;
      // Some CDNs reject HEAD even though their GET works.
    }
    if (controller.signal.aborted) throw new Error("Metadata request timed out.");
    const response = await fetchImpl(url, {
      method: "GET", headers: { Range: "bytes=0-0" }, redirect: "follow", signal: controller.signal,
    });
    const size = responseSize(response);
    if (response.ok) type = response.headers.get("content-type") || type;
    // A server may ignore Range and send the full video. Never consume that body.
    try { await response.body?.cancel(); } catch { /* headers remain usable */ }
    return {
      ok: response.ok || !!head?.ok,
      status: response.ok ? response.status : (head?.status || response.status),
      type, size, sizeHuman: formatBytes(size),
    };
  } catch (error) {
    return {
      ok: false, status: 0, type, size: null, sizeHuman: "Unknown",
      error: controller.signal.aborted ? "Metadata request timed out." : (error?.message || String(error)),
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
