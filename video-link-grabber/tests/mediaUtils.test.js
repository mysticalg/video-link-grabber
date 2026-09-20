import test from "node:test";
import assert from "node:assert/strict";
import { filenameForMedia, isExtensionUiSender, isManifest, probeHttpMedia, sanitizeFilename, validateMediaItem, validateUrl } from "../mediaUtils.js";

function reply(status, headers = {}, cancel = () => {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), body: { cancel } };
}

test("HEAD 405 falls back to a one-byte Range request and reports the total size", async () => {
  const requests = [];
  let cancelled = false;
  const result = await probeHttpMedia("https://example.test/video", { fetchImpl: async (url, options) => {
    requests.push(options);
    return options.method === "HEAD" ? reply(405) : reply(206, {
      "content-length": "1", "content-range": "bytes 0-0/123456", "content-type": "video/mp4",
    }, () => { cancelled = true; });
  } });
  assert.equal(result.ok, true);
  assert.equal(result.size, 123456);
  assert.equal(result.type, "video/mp4");
  assert.deepEqual(requests.map(request => request.method), ["HEAD", "GET"]);
  assert.equal(requests[1].headers.Range, "bytes=0-0");
  assert.equal(cancelled, true);
});

test("a 206 response with unknown total is never reported as a one-byte video", async () => {
  const result = await probeHttpMedia("https://example.test/video", { fetchImpl: async (url, options) => options.method === "HEAD"
    ? reply(200, { "content-type": "video/mp4" })
    : reply(206, { "content-length": "1", "content-range": "bytes 0-0/*" }) });
  assert.equal(result.ok, true);
  assert.equal(result.size, null);
  assert.equal(result.sizeHuman, "Unknown");
});

test("servers ignoring Range have their full response cancelled without reading it", async () => {
  let cancelled = 0;
  const result = await probeHttpMedia("https://example.test/video", { fetchImpl: async (url, options) => options.method === "HEAD"
    ? reply(405)
    : reply(200, { "content-length": "800000000" }, () => { cancelled++; }) });
  assert.equal(result.size, 800000000);
  assert.equal(cancelled, 1);
});

test("a successful HEAD does not request any video data, including zero-byte files", async () => {
  let requests = 0;
  const result = await probeHttpMedia("https://example.test/video", { fetchImpl: async () => {
    requests++;
    return reply(200, { "content-length": "0" });
  } });
  assert.equal(result.size, 0);
  assert.equal(requests, 1);
});

test("timed-out probes abort their network request", async () => {
  const result = await probeHttpMedia("https://example.test/video", { timeoutMs: 5, fetchImpl: async (url, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) });
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
});

test("rejects executable, local-file, credential-bearing and malformed URLs", () => {
  for (const url of ["javascript:alert(1)", "file:///C:/secrets.txt", "chrome://settings", "https://user:pass@example.test/video", "https://example.test/\nvideo", "not-a-url"]) {
    assert.throws(() => validateUrl(url));
  }
  assert.equal(validateUrl("blob:https://example.test/abc"), "blob:https://example.test/abc");
  assert.throws(() => validateUrl("blob:https://example.test/abc", { httpOnly: true }));
});

test("filenames cannot escape Downloads or use Windows reserved names", () => {
  assert.equal(sanitizeFilename("../../foo\\bar:video?.mp4"), "_.._foo_bar_video_.mp4");
  assert.equal(sanitizeFilename("CON.mp4"), "_CON.mp4");
  assert.equal(sanitizeFilename("...  "), "video");
  assert.equal(sanitizeFilename("a".repeat(220) + ".mp4").length, 180);
  assert.equal(filenameForMedia({ filename: "clip", type: "video/webm" }), "clip.webm");
  assert.equal(filenameForMedia({ filename: "clip.webm", type: "video/webm" }), "clip.webm");
});

test("only our extension UI can request privileged worker operations", () => {
  const good = { id: "abc", url: "chrome-extension://abc/popup.html" };
  assert.equal(isExtensionUiSender(good, "abc"), true);
  assert.equal(isExtensionUiSender({ ...good, tab: { id: 1 } }, "abc"), true);
  assert.equal(isExtensionUiSender({ ...good, id: "other" }, "abc"), false);
  assert.equal(isExtensionUiSender({ ...good, url: "https://example.test" }, "abc"), false);
  assert.equal(isExtensionUiSender({ ...good, tab: { id: 1 }, url: "https://example.test" }, "abc"), false);
  assert.equal(isExtensionUiSender({ ...good, url: "chrome-extension://abc.evil/popup.html" }, "abc"), false);
});

test("verified direct sources get their actual file extension even when a blob had none", () => {
  assert.equal(filenameForMedia({ filename: "video-1", directUrl: "https://video.twimg.com/clip.mp4?tag=1" }), "video-1.mp4");
  assert.equal(filenameForMedia({ filename: "video.m3u8", type: "application/vnd.apple.mpegurl", directUrl: "https://example.test/clip.mp4" }), "video.mp4");
});

test("requires the originating document and derives blob flags from the actual URL", () => {
  const item = validateMediaItem({ url: "blob:https://example.test/123", videoId: "v1", documentId: "doc-1", frameId: 4, isBlob: false });
  assert.equal(item.isBlob, true);
  assert.equal(item.frameId, 4);
  assert.equal(item.documentId, "doc-1");
  assert.throws(() => validateMediaItem({ url: "https://example.test/video.mp4" }));
  assert.throws(() => validateMediaItem({ url: "", documentId: "doc-1" }));
  assert.equal(validateMediaItem({ url: "", videoId: "v1", documentId: "doc-1" }).url, "");
});

test("identifies manifests by URL and MIME type without matching arbitrary URL query text", () => {
  assert.equal(isManifest("https://example.test/video.m3u8?token=x"), true);
  assert.equal(isManifest("https://example.test/video", "application/dash+xml"), true);
  assert.equal(isManifest("https://example.test/video.mp4?next=other.m3u8"), false);
});
