import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const overlay = new URL("../overlay/", import.meta.url);
async function standalone(name) {
  const source = await readFile(new URL(name, overlay), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
const { youtubeIdFromUrl, validateYouTubeItem, prepareYouTubeQueue } = await standalone("youtubeUtils.js");
const { scanYouTubePage } = await standalone("youtubeScan.js");
const { YouTubeNativeClient, HOST_NAME } = await standalone("youtubeNative.js");
const ID = "dQw4w9WgXcQ";
const OTHER_ID = "abcdefghijk";
const video = (id = ID) => ({ platform: "youtube", youtubeId: id, title: "A useful video title", url: `https://www.youtube.com/watch?v=${id}` });

test("YouTube IDs support watch, Shorts, live, short links and private embeds only on genuine hosts", () => {
  for (const url of [`https://www.youtube.com/watch?v=${ID}&list=x`, `https://m.youtube.com/shorts/${ID}`, `https://youtube.com/live/${ID}`, `https://youtu.be/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}`]) assert.equal(youtubeIdFromUrl(url), ID);
  for (const url of [`https://youtube.com.evil.test/watch?v=${ID}`, `https://evil.test/watch?v=${ID}`, `ftp://youtube.com/watch?v=${ID}`, `https://a:b@youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}extra`]) assert.equal(youtubeIdFromUrl(url), "");
});

test("YouTube queue validates identities, canonicalizes URLs and keeps titles without usernames or ID suffixes", () => {
  const item = validateYouTubeItem(video());
  assert.equal(item.filename, "A useful video title");
  assert.equal(item.url, `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(prepareYouTubeQueue([video(), video(), video(OTHER_ID)]).length, 2);
  assert.throws(() => validateYouTubeItem({ ...video(), url: `https://youtube.com/watch?v=${OTHER_ID}` }), /match/);
  assert.throws(() => validateYouTubeItem({ ...video(), youtubeId: "../../file" }), /invalid/);
  assert.throws(() => prepareYouTubeQueue([]), /1 and 100/);
  assert.throws(() => prepareYouTubeQueue(Array.from({ length: 101 }, () => video())), /1 and 100/);
});

function scanFixture(url, { title = "Current video - YouTube", anchors = [] } = {}) {
  const parsed = new URL(url);
  return vm.runInNewContext(`(${scanYouTubePage.toString()})()`, {
    location: { hostname: parsed.hostname, href: url }, URL, innerHeight: 800, innerWidth: 1200,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    document: { title, querySelector: () => null, querySelectorAll: () => anchors },
  });
}
function anchor(id, { top = 20, title = "Listed video" } = {}) {
  const titleNode = { getAttribute: () => title, textContent: title };
  return {
    href: `https://youtube.com/watch?v=${id}`, getAttribute: () => "", textContent: title,
    getBoundingClientRect: () => ({ width: 300, height: 180, top, bottom: top + 180, left: 0, right: 300 }),
    closest: () => ({ querySelector: () => titleNode }), querySelector: () => null,
  };
}
test("watch pages expose the current video, not recommendations", () => {
  const scan = scanFixture(`https://www.youtube.com/watch?v=${ID}`, { anchors: [anchor(OTHER_ID)] });
  assert.equal(scan.items.length, 1);
  assert.equal(scan.items[0].youtubeId, ID);
  assert.equal(scan.items[0].title, "Current video");
});
test("Shorts and embedded pages expose their current video", () => {
  for (const url of [`https://youtube.com/shorts/${ID}`, `https://www.youtube-nocookie.com/embed/${ID}`, `https://youtu.be/${ID}`]) assert.equal(scanFixture(url).items[0].youtubeId, ID);
});
test("listing pages include only visible valid cards and remove duplicates", () => {
  const scan = scanFixture("https://www.youtube.com/results?search_query=video", {
    anchors: [anchor(ID), anchor(ID), anchor(OTHER_ID, { top: 1500 }), anchor("invalid")],
  });
  assert.equal(scan.items.length, 1);
  assert.equal(scan.items[0].title, "Listed video");
  assert.equal(scanFixture("https://example.com", { anchors: [anchor(ID)] }).isYouTube, false);
});

function event() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: value => [...listeners].forEach(fn => fn(value)), listeners };
}
function fakeNative({ autoReady = true } = {}) {
  const messages = [];
  const port = { onMessage: event(), onDisconnect: event(), disconnected: false,
    postMessage(message) {
      messages.push(message);
      if (autoReady && message.cmd === "ping") queueMicrotask(() => port.onMessage.emit({ event: "ready", protocol: 1, version: "1.0", outputDir: "C:\\Videos" }));
    },
    disconnect() { port.disconnected = true; },
  };
  const runtime = { connectNative(name) { assert.equal(name, HOST_NAME); return port; } };
  const client = new YouTubeNativeClient({ runtime, handshakeMs: 50, cancelMs: 50 });
  return { client, port, messages, runtime };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("native jobs send only video IDs and accept matching completion with saved path", async () => {
  const { client, port, messages } = fakeNative();
  const phases = [];
  const result = client.download(ID, { onProgress: info => phases.push(info) });
  await tick();
  const request = messages.find(message => message.cmd === "download");
  assert.deepEqual(Object.keys(request).sort(), ["cmd", "requestId", "videoId"]);
  assert.match(request.requestId, /^[A-Za-z0-9_-]{1,64}$/);
  port.onMessage.emit({ event: "complete", requestId: "old", filename: "wrong.mp4", path: "wrong" });
  assert.ok(client.pending);
  port.onMessage.emit({ event: "progress", requestId: request.requestId, phase: "downloading", percent: 200 });
  assert.equal(phases[0].percent, 100);
  port.onMessage.emit({ event: "complete", requestId: request.requestId, filename: "Actual title.mp4", path: "C:\\Videos\\Actual title.mp4" });
  assert.deepEqual(await result, { filename: "Actual title.mp4", path: "C:\\Videos\\Actual title.mp4" });
  assert.equal(client.pending, null);
  client.close();
});

test("job errors allow a subsequent job while concurrent jobs are rejected", async () => {
  const { client, port } = fakeNative();
  const first = client.download(ID);
  const failure = assert.rejects(first, /not available/);
  await tick();
  await assert.rejects(client.download(OTHER_ID), /already downloading/);
  port.onMessage.emit({ event: "error", requestId: client.pending.requestId, error: "Video not available" });
  await failure;
  const second = client.download(OTHER_ID);
  await tick();
  port.onMessage.emit({ event: "complete", requestId: client.pending.requestId, filename: "Next.mp4", path: "C:\\Videos\\Next.mp4" });
  assert.equal((await second).filename, "Next.mp4");
  client.close();
});

test("cancellation waits for the host response and completion can win the race", async () => {
  const { client, port, messages } = fakeNative();
  const controller = new AbortController();
  const result = client.download(ID, { signal: controller.signal });
  await tick();
  const requestId = client.pending.requestId;
  controller.abort();
  assert.deepEqual(messages.at(-1), { cmd: "cancel", requestId });
  assert.ok(client.pending);
  port.onMessage.emit({ event: "complete", requestId, filename: "Saved.mp4", path: "C:\\Saved.mp4" });
  assert.equal((await result).filename, "Saved.mp4");
  client.close();
});

test("confirmed cancellation rejects and clears the active job", async () => {
  const { client, port } = fakeNative();
  const controller = new AbortController();
  const result = client.download(ID, { signal: controller.signal });
  const rejection = assert.rejects(result, { name: "AbortError" });
  await tick();
  const requestId = client.pending.requestId;
  controller.abort();
  port.onMessage.emit({ event: "cancelled", requestId });
  await rejection;
  assert.equal(client.pending, null);
  client.close();
});

test("missing helper, setup errors and incompatible versions give installation guidance", async () => {
  const missing = new YouTubeNativeClient({ runtime: { connectNative() { throw new Error("Host not registered"); } } });
  await assert.rejects(missing.connect(), /Windows installer/);
  for (const message of [{ event: "error", code: "setup_required", error: "FFmpeg missing" }, { event: "ready", protocol: 9 }]) {
    const { client, port } = fakeNative({ autoReady: false });
    const result = client.connect();
    const rejection = assert.rejects(result, /Windows installer/);
    port.onMessage.emit(message);
    await rejection;
    assert.equal(port.disconnected, true);
  }
});

test("disconnects and queue closure reject active work without claiming completion", async () => {
  for (const close of [false, true]) {
    const { client, port, runtime } = fakeNative();
    const result = client.download(ID);
    const rejection = assert.rejects(result, close ? /queue was closed/ : /helper disconnected/);
    await tick();
    if (close) client.close();
    else { runtime.lastError = { message: "Native host has exited" }; port.onDisconnect.emit(); }
    await rejection;
    assert.equal(client.pending, null);
    assert.equal(port.onMessage.listeners.size, 0);
  }
});

test("malformed completion cannot report a file as saved", async () => {
  const { client, port } = fakeNative();
  const result = client.download(ID);
  const rejection = assert.rejects(result, /without a saved filename/);
  await tick();
  port.onMessage.emit({ event: "complete", requestId: client.pending.requestId });
  await rejection;
  client.close();
});

test("helper handshake and ignored cancellation have finite timeouts", async () => {
  const silent = fakeNative({ autoReady: false });
  await assert.rejects(silent.client.connect(), /did not respond/);
  assert.equal(silent.port.disconnected, true);
  const { client, port } = fakeNative();
  const controller = new AbortController();
  const result = client.download(ID, { signal: controller.signal });
  const rejection = assert.rejects(result, { name: "AbortError" });
  await tick();
  controller.abort();
  await rejection;
  assert.equal(port.disconnected, true);
});

const popupSource = (await readFile(new URL("popup.js", overlay), "utf8"))
  .replace(/^import \{ YouTubeNativeClient \} from "\.\/youtubeNative\.js";\s*/, "");

function popupFixture({ youtube = true, ready = true } = {}) {
  const native = fakeNative({ autoReady: ready });
  const elements = new Map();
  const windowEvents = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: "", className: "", listeners: new Map(),
      classList: { toggle() {} }, setAttribute() {}, replaceChildren() {}, addEventListener(event, listener) { this.listeners.set(event, listener); } });
    return elements.get(id);
  };
  let handshakeMs;
  class PopupClient extends YouTubeNativeClient {
    constructor(options) { handshakeMs = options.handshakeMs; super({ ...options, runtime: native.runtime }); }
  }
  vm.runInNewContext(popupSource, {
    YouTubeNativeClient: PopupClient,
    chrome: { runtime: { getManifest: () => ({ version: "1.4.2" }), sendMessage: async () => ({ ok: true, items: [], ...(youtube ? { platform: "youtube" } : {}) }) }, tabs: { query: async () => [{ id: 1 }] } },
    document: { getElementById: element }, window: { addEventListener: (event, listener) => windowEvents.set(event, listener) },
    setInterval() {}, setTimeout, clearTimeout, URL,
  });
  return { ...native, element, windowEvents, get handshakeMs() { return handshakeMs; } };
}

test("popup identifies the local version and closes the helper after a bounded readiness ping", async () => {
  const popup = popupFixture();
  await tick();
  assert.equal(popup.element("buildLabel").textContent, "v1.4.2");
  assert.equal(popup.element("helperStatus").textContent, "YouTube helper ready");
  assert.equal(popup.element("helperSetup").hidden, true);
  assert.equal(popup.handshakeMs, 3000);
  assert.deepEqual(popup.messages, [{ cmd: "ping" }]);
  assert.equal(popup.port.disconnected, true);
  assert.equal(popup.port.onMessage.listeners.size, 0);
});

test("popup helper errors give setup guidance and closing a pending popup releases the native port", async () => {
  const missing = popupFixture({ ready: false });
  await tick();
  missing.port.onMessage.emit({ event: "error", error: "Helper setup required" });
  await tick();
  assert.match(missing.element("helperStatus").textContent, /Helper unavailable.*install/);
  assert.equal(missing.element("helperSetup").hidden, false);
  assert.equal(missing.port.disconnected, true);
  const pending = popupFixture({ ready: false });
  await tick();
  pending.windowEvents.get("pagehide")();
  await tick();
  assert.equal(pending.port.disconnected, true);
  assert.equal(pending.port.onMessage.listeners.size, 0);
});

test("popup does not start the YouTube helper on generic pages", async () => {
  const popup = popupFixture({ youtube: false });
  await tick();
  assert.equal(popup.messages.length, 0);
  assert.equal(popup.element("helperStatus").hidden, true);
});

const temp = await mkdtemp(join(tmpdir(), "vlg-youtube-unit-"));
await writeFile(join(temp, "package.json"), '{"type":"module"}');
for (const name of ["background.js", "youtubeUtils.js", "youtubeScan.js"]) await copyFile(new URL(name, overlay), join(temp, name));
for (const name of ["contentScript.js", "batchUtils.js", "mediaUtils.js"]) await copyFile(new URL(`../../video-link-grabber/${name}`, import.meta.url), join(temp, name));
const { createMessageHandler } = await import(pathToFileURL(join(temp, "background.js")));
test.after(() => rm(temp, { recursive: true, force: true }));

function backgroundFixture({ youtubeFrames = [], genericFrames = [] } = {}) {
  const calls = [];
  const chromeApi = {
    runtime: { id: "testid", getURL: path => `chrome-extension://testid/${path}` },
    tabs: { create: async info => { calls.push({ tab: info }); } },
    scripting: { executeScript: async config => { calls.push({ script: config }); return config.func.name === "scanYouTubePage" ? youtubeFrames : genericFrames; } },
    downloads: { download: async () => { calls.push({ download: true }); return 1; } },
  };
  const handle = createMessageHandler({ chromeApi });
  return { calls, send: message => handle(message, { id: "testid", url: "chrome-extension://testid/popup.html" }), handle };
}
test("YouTube scans never return page blobs or googlevideo tracks", async () => {
  const fixture = backgroundFixture({
    youtubeFrames: [{ frameId: 0, documentId: "doc", result: { isYouTube: true, items: [video()] } },
      { frameId: 2, documentId: "ad-embed", result: { isYouTube: true, items: [video(OTHER_ID)] } }],
    genericFrames: [{ frameId: 0, documentId: "doc", result: { ok: true, items: [{ url: "https://r1.googlevideo.com/video.mp4" }] } }],
  });
  const response = await fixture.send({ cmd: "SCAN_TAB", tabId: 1 });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].platform, "youtube");
  assert.equal(fixture.calls.length, 1);
});
test("YouTube download and selected videos use the local queue, not Chrome downloads", async () => {
  const fixture = backgroundFixture();
  const response = await fixture.send({ cmd: "DOWNLOAD_BATCH", tabId: 1, items: [video(), video(), video(OTHER_ID)] });
  assert.equal(response.count, 2);
  assert.equal(fixture.calls.length, 1);
  assert.match(fixture.calls[0].tab.url, /^chrome-extension:\/\/testid\/youtube\.html#/);
  const probe = await fixture.send({ cmd: "PROBE_MEDIA", tabId: 1, item: video() });
  assert.equal(probe.kind, "youtube");
  await fixture.send({ cmd: "DOWNLOAD_MEDIA", tabId: 1, item: video() });
  assert.equal(fixture.calls.some(call => call.download), false);
});
test("background rejects external senders and invalid YouTube IDs before opening queues", async () => {
  const fixture = backgroundFixture();
  assert.equal((await fixture.handle({ cmd: "DOWNLOAD_MEDIA", tabId: 1, item: video() }, { id: "other", url: "https://youtube.com" })).ok, false);
  assert.equal((await fixture.send({ cmd: "DOWNLOAD_MEDIA", tabId: 1, item: { ...video(), youtubeId: "bad" } })).ok, false);
  assert.equal(fixture.calls.length, 0);
});
test("non-YouTube pages retain generic videos and embedded YouTube uses the local queue", async () => {
  const fixture = backgroundFixture({
    youtubeFrames: [{ frameId: 0, documentId: "main", result: { isYouTube: false, items: [] } }, { frameId: 2, documentId: "embed", result: { isYouTube: true, items: [video()] } }],
    genericFrames: [{ frameId: 0, documentId: "main", result: { ok: true, items: [{ url: "https://example.com/video.mp4", filename: "Example", documentId: "main" }] } }, { frameId: 2, documentId: "embed", result: { ok: true, items: [{ url: "blob:https://youtube.com/blob", documentId: "embed" }] } }],
  });
  const response = await fixture.send({ cmd: "SCAN_TAB", tabId: 1 });
  assert.equal(response.items.length, 2);
  assert.equal(response.items[0].platform, "youtube");
  assert.equal(response.items[1].url, "https://example.com/video.mp4");
});
