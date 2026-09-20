// HLS VOD collection; remuxing the resulting media is the caller's responsibility.
// Playlist semantics follow RFC 8216. Encrypted and discontinuous streams are
// rejected rather than producing a silently incomplete or corrupt download.
export const MAX_HLS_BYTES = 512 * 1024 * 1024;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_PLAYLIST_DEPTH = 4;
const MAX_SEGMENTS = 20000;
const REQUEST_TIMEOUT_MS = 30000;

function fail(message) { throw new Error(message); }

function httpUrl(value, base) {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u0020\u007f]/.test(value)) fail("Invalid HLS resource URL.");
  let url;
  try { url = new URL(value, base); } catch { fail("Invalid HLS resource URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail("HLS resources must use HTTP or HTTPS without embedded credentials.");
  if (/\{\$/.test(value)) fail("HLS variable substitution is not supported.");
  url.hash = "";
  return url.href;
}

function integer(value, label, allowZero = false) {
  if (!/^\d+$/.test(String(value))) fail(`Invalid ${label} in HLS playlist.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1)) fail(`Invalid ${label} in HLS playlist.`);
  return result;
}

export function parseAttributeList(value) {
  const attributes = Object.create(null);
  let offset = 0;
  while (offset < value.length) {
    const keyMatch = /^[ \t]*([A-Z0-9-]+)=/.exec(value.slice(offset));
    if (!keyMatch) fail("Malformed HLS attribute list.");
    const key = keyMatch[1];
    if (Object.hasOwn(attributes, key)) fail(`Duplicate HLS attribute: ${key}.`);
    offset += keyMatch[0].length;
    let field;
    if (value[offset] === '"') {
      const end = value.indexOf('"', offset + 1);
      if (end < 0) fail("Unterminated quoted HLS attribute.");
      field = value.slice(offset + 1, end);
      offset = end + 1;
    } else {
      const comma = value.indexOf(",", offset);
      const end = comma < 0 ? value.length : comma;
      field = value.slice(offset, end).trim();
      if (!field || /["\s]/.test(field)) fail("Malformed HLS attribute value.");
      offset = end;
    }
    attributes[key] = field;
    while (/[ \t]/.test(value[offset] || "\n")) offset++;
    if (offset === value.length) break;
    if (value[offset++] !== "," || offset === value.length) fail("Malformed HLS attribute separator.");
  }
  return attributes;
}

function rangeSpec(value) {
  const match = /^(\d+)(?:@(\d+))?$/.exec(value);
  if (!match) fail("Invalid HLS byte range.");
  return { length: integer(match[1], "byte-range length"), offset: match[2] === undefined ? null : integer(match[2], "byte-range offset", true) };
}

function resolveRange(spec, url, previous) {
  if (!spec) return null;
  const start = spec.offset === null ? (previous?.url === url && previous.range ? previous.range.end + 1 : null) : spec.offset;
  if (start === null) fail("An implicit HLS byte range needs the preceding range on the same resource.");
  const end = start + spec.length - 1;
  if (!Number.isSafeInteger(end)) fail("HLS byte range is too large.");
  return { start, end };
}

function sameResource(left, right) {
  return left?.url === right?.url && left?.range?.start === right?.range?.start && left?.range?.end === right?.range?.end;
}

export function parseHlsPlaylist(text, playlistUrl) {
  const url = httpUrl(playlistUrl);
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map(line => line.trim());
  if (lines[0] !== "#EXTM3U") fail("The server did not return a valid HLS playlist.");
  const variants = [], renditions = [], segments = [];
  let pendingVariant = null, pendingDuration = null, pendingRange = null;
  let init = null, previousMap = null, previousSegment = null, endList = false, mediaTags = false;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    if (!line.startsWith("#")) {
      const resourceUrl = httpUrl(line, url);
      if (pendingVariant) {
        variants.push({ ...pendingVariant, url: resourceUrl });
        pendingVariant = null;
      } else {
        if (pendingDuration === null) fail("An HLS media segment is missing its EXTINF duration.");
        if (segments.length >= MAX_SEGMENTS) fail("This HLS playlist has too many segments.");
        const segment = { url: resourceUrl, duration: pendingDuration, range: resolveRange(pendingRange, resourceUrl, previousSegment) };
        segments.push(segment);
        previousSegment = segment;
        pendingDuration = pendingRange = null;
      }
      continue;
    }
    const colon = line.indexOf(":");
    const tag = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1);
    switch (tag) {
      case "#EXT-X-STREAM-INF": {
        if (pendingVariant) fail("An HLS variant is missing its playlist URL.");
        const attrs = parseAttributeList(value);
        pendingVariant = { bandwidth: integer(attrs.BANDWIDTH, "BANDWIDTH"), codecs: attrs.CODECS || "", resolution: attrs.RESOLUTION || "", audioGroup: attrs.AUDIO || "", videoGroup: attrs.VIDEO || "", hdcpLevel: attrs["HDCP-LEVEL"] || "NONE" };
        break;
      }
      case "#EXT-X-MEDIA": {
        const attrs = parseAttributeList(value);
        renditions.push({ type: attrs.TYPE, groupId: attrs["GROUP-ID"], name: attrs.NAME || "", default: attrs.DEFAULT === "YES", autoselect: attrs.AUTOSELECT === "YES", url: attrs.URI === undefined ? null : httpUrl(attrs.URI, url) });
        break;
      }
      case "#EXTINF": {
        mediaTags = true;
        if (pendingDuration !== null) fail("An HLS segment is missing its URL.");
        const durationText = value.split(",", 1)[0];
        if (!/^\d+(?:\.\d+)?$/.test(durationText) || !Number.isFinite(Number(durationText))) fail("Invalid HLS segment duration.");
        pendingDuration = Number(durationText);
        break;
      }
      case "#EXT-X-BYTERANGE":
        mediaTags = true;
        if (pendingRange) fail("Duplicate HLS byte range for a segment.");
        pendingRange = rangeSpec(value);
        break;
      case "#EXT-X-MAP": {
        mediaTags = true;
        const attrs = parseAttributeList(value);
        const mapUrl = httpUrl(attrs.URI, url);
        const map = { url: mapUrl, range: resolveRange(attrs.BYTERANGE !== undefined ? rangeSpec(attrs.BYTERANGE) : null, mapUrl, previousMap) };
        if ((init && !sameResource(init, map)) || (!init && segments.length)) fail("HLS streams that change their initialization section are not supported.");
        init = map;
        previousMap = map;
        break;
      }
      case "#EXT-X-KEY":
      case "#EXT-X-SESSION-KEY": {
        const attrs = parseAttributeList(value);
        if (attrs.METHOD !== "NONE" || (attrs.KEYFORMAT && attrs.KEYFORMAT !== "identity")) fail("Encrypted or DRM-protected HLS streams are not supported.");
        break;
      }
      case "#EXT-X-ENDLIST": endList = true; mediaTags = true; break;
      case "#EXT-X-GAP": fail("This HLS playlist contains missing segments (EXT-X-GAP)."); break;
      case "#EXT-X-DISCONTINUITY": fail("HLS streams with discontinuities are not supported."); break;
      case "#EXT-X-I-FRAMES-ONLY": fail("An HLS preview-only playlist cannot be downloaded as a complete video."); break;
      case "#EXT-X-SKIP": fail("Partial HLS playlists cannot be downloaded as a complete video."); break;
      case "#EXT-X-DEFINE": fail("HLS variable substitution is not supported."); break;
      case "#EXT-X-TARGETDURATION":
      case "#EXT-X-MEDIA-SEQUENCE":
      case "#EXT-X-PLAYLIST-TYPE": mediaTags = true; break;
      default: break;
    }
  }
  if (pendingVariant || pendingDuration !== null || pendingRange) fail("The HLS playlist ends before a referenced resource URL.");
  if (variants.length) {
    if (mediaTags || segments.length) fail("The HLS playlist mixes master and media entries.");
    return { type: "master", url, variants, renditions };
  }
  if (renditions.length) fail("The HLS master playlist has no playable video variants.");
  if (!endList) fail("This is a live or unfinished HLS stream. Only complete videos (EXT-X-ENDLIST) can be downloaded.");
  if (!segments.length) fail("The HLS playlist contains no complete media segments.");
  return { type: "media", url, init, segments, duration: segments.reduce((sum, item) => sum + item.duration, 0) };
}

function supportedVariant(variant, renditions, track) {
  if (variant.hdcpLevel !== "NONE" || variant.videoGroup) return false;
  // These codecs can be copied into MP4 by the bundled remuxer. A missing CODECS
  // attribute is legal; the remuxer will inspect the actual media in that case.
  if (variant.codecs) {
    const codecs = variant.codecs.split(",").map(codec => codec.trim());
    if (!codecs.every(codec => /^(?:avc[13]|hev1|hvc1|av01|mp4a|ac-3|ec-3|opus)(?:\.|$)/i.test(codec))) return false;
    if (track === "video" && !codecs.some(codec => /^(?:avc[13]|hev1|hvc1|av01)(?:\.|$)/i.test(codec))) return false;
  }
  return !variant.audioGroup || renditions.some(item => item.type === "AUDIO" && item.groupId === variant.audioGroup);
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Download cancelled.", "AbortError");
}

async function cancelBody(response) { try { await response.body?.cancel(); } catch {} }

async function awaitWithAbort(promise, signal) {
  checkAbort(signal);
  let rejectAbort;
  const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(signal.reason || new DOMException("Download cancelled.", "AbortError"));
  signal.addEventListener("abort", onAbort, { once: true });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

async function readResponse(response, state, limit, signal) {
  const announced = response.headers.get("content-length");
  if (announced !== null && /^\d+$/.test(announced) && (Number(announced) > limit || Number(announced) > MAX_HLS_BYTES - state.downloadedBytes)) {
    await cancelBody(response);
    fail("HLS download exceeds the 512 MiB limit or the playlist is too large.");
  }
  if (!response.body?.getReader) fail("The HLS server returned an empty or unreadable response.");
  const reader = response.body.getReader();
  const cancelReader = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancelReader, { once: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      size += value.byteLength;
      state.downloadedBytes += value.byteLength;
      if (size > limit || state.downloadedBytes > MAX_HLS_BYTES) fail("HLS download exceeds the 512 MiB limit or the playlist is too large.");
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  } finally { signal.removeEventListener("abort", cancelReader); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function request(url, range, state, limit = MAX_HLS_BYTES) {
  checkAbort(state.signal);
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(state.signal.reason || new DOMException("Download cancelled.", "AbortError"));
  state.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("HLS request timed out after 30 seconds.")), REQUEST_TIMEOUT_MS);
  try {
    const headers = range ? { Range: `bytes=${range.start}-${range.end}` } : {};
    const fetchImpl = state.fetchImpl;
    const response = await awaitWithAbort(fetchImpl(httpUrl(url), { method: "GET", credentials: "include", signal: controller.signal, headers }), controller.signal);
    const finalUrl = response.url ? httpUrl(response.url) : url;
    if (response.status !== 200 && response.status !== 206) {
      await cancelBody(response);
      fail(`HLS request failed (HTTP ${response.status}).`);
    }
    if (response.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(response.headers.get("content-range") || "");
      if (!range || !match || Number(match[1]) !== range.start || Number(match[2]) !== range.end || (match[3] !== "*" && (!Number.isSafeInteger(Number(match[3])) || Number(match[3]) <= range.end))) {
        await cancelBody(response);
        fail("The HLS server returned an incorrect Content-Range.");
      }
    }
    let bytes = await readResponse(response, state, limit, controller.signal);
    if (range) {
      if (response.status === 206) {
        if (bytes.byteLength !== range.end - range.start + 1) fail("The HLS byte-range response was truncated or has the wrong length.");
      } else {
        // Some CDNs ignore Range and return the whole file. Never append that
        // whole response once per segment: extract the exact requested interval.
        if (bytes.byteLength <= range.end) fail("The HLS server returned too few bytes for the requested range.");
        bytes = bytes.slice(range.start, range.end + 1);
      }
    }
    if (!bytes.byteLength) fail("The HLS server returned an empty resource.");
    return { bytes, url: finalUrl };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    state.signal?.removeEventListener("abort", onCallerAbort);
  }
}

async function resolvePlaylist(url, state, track, depth = 0, ancestors = new Set()) {
  if (depth >= MAX_PLAYLIST_DEPTH) fail("HLS playlist nesting exceeds the supported depth of four.");
  url = httpUrl(url);
  if (ancestors.has(url)) fail("The HLS playlist contains a reference cycle.");
  state.onProgress?.({ phase: "playlist", track, url, downloadedBytes: state.downloadedBytes, completedSegments: 0, totalSegments: 0 });
  const response = await request(url, null, state, MAX_PLAYLIST_BYTES);
  if (response.url !== url && ancestors.has(response.url)) fail("The HLS playlist contains a redirect cycle.");
  const nextAncestors = new Set([...ancestors, url, response.url]);
  const playlist = parseHlsPlaylist(new TextDecoder("utf-8", { fatal: true }).decode(response.bytes), response.url);
  if (playlist.type === "media") return { playlist };
  const variant = playlist.variants.filter(item => supportedVariant(item, playlist.renditions, track)).sort((a, b) => b.bandwidth - a.bandwidth)[0];
  if (!variant) fail("This HLS master has no supported unprotected video variant and audio group.");
  const selected = await resolvePlaylist(variant.url, state, track, depth + 1, nextAncestors);
  let audio = selected.audio;
  if (variant.audioGroup) {
    const group = playlist.renditions.filter(item => item.type === "AUDIO" && item.groupId === variant.audioGroup);
    const rendition = group.find(item => item.default) || group.find(item => item.autoselect) || group[0];
    if (rendition.url) {
      if (audio) fail("Multiple nested external HLS audio renditions are not supported.");
      const resolvedAudio = await resolvePlaylist(rendition.url, state, "audio", depth + 1, nextAncestors);
      if (resolvedAudio.audio) fail("Nested external HLS audio renditions are not supported.");
      audio = resolvedAudio.playlist;
    }
  }
  return { ...selected, audio, variant };
}

async function collectTrack(playlist, state, track) {
  const resources = [...(playlist.init ? [playlist.init] : []), ...playlist.segments];
  const chunks = [];
  let length = 0;
  for (let index = 0; index < resources.length; index++) {
    checkAbort(state.signal);
    const resource = resources[index];
    const { bytes } = await request(resource.url, resource.range, state);
    chunks.push(bytes);
    length += bytes.byteLength;
    state.retainedBytes += bytes.byteLength;
    if (state.retainedBytes > MAX_HLS_BYTES) fail("The assembled HLS download exceeds the 512 MiB limit.");
    state.onProgress?.({ phase: "download", track, url: resource.url, completedSegments: Math.max(0, index + 1 - (playlist.init ? 1 : 0)), totalSegments: playlist.segments.length, downloadedBytes: state.downloadedBytes });
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const extension = playlist.init || /\.(?:mp4|m4[asv]|cmf[av])$/i.test(new URL(playlist.segments[0].url).pathname) ? "mp4" : "ts";
  return { bytes, extension, url: playlist.url, segmentCount: playlist.segments.length, duration: playlist.duration };
}

export async function collectHls(url, { fetchImpl = globalThis.fetch, signal, onProgress } = {}) {
  const state = { fetchImpl, signal, onProgress, downloadedBytes: 0, retainedBytes: 0 };
  const selected = await resolvePlaylist(url, state, "video");
  const video = await collectTrack(selected.playlist, state, "video");
  const audio = selected.audio ? await collectTrack(selected.audio, state, "audio") : undefined;
  return { video, ...(audio ? { audio } : {}), ...(selected.variant ? { variant: selected.variant } : {}), totalBytes: state.retainedBytes, downloadedBytes: state.downloadedBytes };
}
