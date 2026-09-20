import test from "node:test";
import assert from "node:assert/strict";
import { createMessageHandler } from "../background.js";

const sender = { id: "extension-id", url: "chrome-extension://extension-id/popup.html" };
const blobItem = { url: "blob:https://example.test/abc", videoId: "v1", documentId: "doc-1", frameId: 7, filename: "clip.mp4" };

function fixture() {
  const calls = { scripts: [], downloads: [], tabs: [], fetches: [] };
  const chromeApi = {
    runtime: { id: sender.id, getURL: path => `chrome-extension://${sender.id}/${path}` },
    scripting: { executeScript: async args => {
      calls.scripts.push(args);
      if (args.args[0] === "STATUS") return [{ documentId: "doc-1", frameId: 7, result: {
        ok: true, canRecord: true, recording: false, directUrl: args.args[1].directUrl, streamUrl: args.args[1].streamUrl,
      } }];
      return [{ documentId: "doc-1", frameId: 7, result: { ok: true, kind: "blob", size: 123 } }];
    } },
    downloads: { download: async args => { calls.downloads.push(args); return 42; } },
    tabs: { create: async args => { calls.tabs.push(args); return { id: 22 }; } },
  };
  const fetchImpl = async (...args) => {
    calls.fetches.push(args);
    return { ok: true, status: 200, headers: new Headers({ "content-length": "1200", "content-type": "video/mp4" }) };
  };
  return { calls, chromeApi, handle: createMessageHandler({ chromeApi, fetchImpl, action: () => {} }) };
}

test("blob downloads run in their original MAIN-world document instead of chrome.downloads", async () => {
  const { calls, handle } = fixture();
  const response = await handle({ cmd: "DOWNLOAD_MEDIA", tabId: 10, item: blobItem }, sender);
  assert.equal(response.ok, true);
  assert.equal(calls.downloads.length, 0);
  assert.equal(calls.scripts.length, 1);
  assert.deepEqual(calls.scripts[0].target, { tabId: 10, documentIds: ["doc-1"] });
  assert.equal(calls.scripts[0].world, "MAIN");
  assert.equal(calls.scripts[0].args[0], "DOWNLOAD");
});

test("blob metadata is inspected in the page and is never fetched by the worker", async () => {
  const { calls, handle } = fixture();
  const response = await handle({ cmd: "PROBE_MEDIA", tabId: 10, item: blobItem }, sender);
  assert.equal(response.ok, true);
  assert.equal(response.size, 123);
  assert.equal(response.sizeHuman, "123 B");
  assert.equal(calls.fetches.length, 0);
  assert.deepEqual(calls.scripts.map(call => call.args[0]), ["STATUS", "INSPECT"]);
});

test("an expired document fails without falling back to another frame", async () => {
  const { calls, chromeApi, handle } = fixture();
  chromeApi.scripting.executeScript = async args => { calls.scripts.push(args); return []; };
  const response = await handle({ cmd: "DOWNLOAD_MEDIA", tabId: 10, item: blobItem }, sender);
  assert.equal(response.ok, false);
  assert.match(response.error, /Rescan/);
  assert.equal(calls.scripts.length, 1);
  assert.equal(calls.downloads.length, 0);
});

test("verified direct URLs take priority over a blob and its HLS alternative", async () => {
  const { calls, handle } = fixture();
  const response = await handle({ cmd: "DOWNLOAD_MEDIA", tabId: 10, item: {
    ...blobItem, directUrl: "https://example.test/full.mp4", streamUrl: "https://example.test/master.m3u8",
  } }, sender);
  assert.equal(response.ok, true);
  assert.equal(response.downloadId, 42);
  assert.equal(calls.downloads[0].url, "https://example.test/full.mp4");
  assert.equal(calls.downloads[0].saveAs, true);
  assert.equal(calls.tabs.length, 0);
  assert.equal(calls.scripts.length, 1);
  assert.equal(calls.scripts[0].args[0], "STATUS");
});

test("HLS downloads open the persistent assembler with correctly encoded URL and filename", async () => {
  const { calls, handle } = fixture();
  const streamUrl = "https://example.test/master.m3u8?token=a&other=b#fragment";
  const response = await handle({ cmd: "DOWNLOAD_MEDIA", tabId: 10, item: { ...blobItem, filename: "clip & title.mp4", streamUrl } }, sender);
  assert.equal(response.ok, true);
  assert.equal(calls.downloads.length, 0);
  const target = new URL(calls.tabs[0].url);
  assert.equal(target.pathname, "/download.html");
  const params = new URLSearchParams(target.hash.slice(1));
  assert.equal(params.get("url"), streamUrl);
  assert.equal(params.get("filename"), "clip & title.mp4");
});

test("direct HLS rows use the assembler, while DASH rows save their playlist", async () => {
  const { calls, handle } = fixture();
  await handle({ cmd: "DOWNLOAD_MEDIA", tabId: 10, item: { ...blobItem, url: "https://example.test/master.m3u8" } }, sender);
  await handle({ cmd: "DOWNLOAD_MEDIA", tabId: 10, item: { ...blobItem, url: "https://example.test/master.mpd", filename: "master.mpd" } }, sender);
  assert.equal(calls.tabs.length, 1);
  assert.equal(calls.downloads.length, 1);
  assert.equal(calls.downloads[0].url, "https://example.test/master.mpd");
});

test("scanning collects all frames, preserves their documents, and discards unsafe URLs", async () => {
  const { calls, chromeApi, handle } = fixture();
  chromeApi.scripting.executeScript = async args => {
    calls.scripts.push(args);
    return [
      { frameId: 0, documentId: "doc-main", result: { ok: true, items: [{ ...blobItem }, { url: "javascript:alert(1)" }] } },
      { frameId: 7, documentId: "doc-iframe", result: { ok: true, items: [{ ...blobItem }] } },
    ];
  };
  const response = await handle({ cmd: "SCAN_TAB", tabId: 10 }, sender);
  assert.equal(response.ok, true);
  assert.equal(response.items.length, 2);
  assert.deepEqual(response.items.map(item => [item.frameId, item.documentId]), [[0, "doc-main"], [7, "doc-iframe"]]);
  assert.deepEqual(calls.scripts[0].target, { tabId: 10, allFrames: true });
});

test("untrusted callers and unsupported associated URLs perform no privileged operation", async () => {
  const { calls, handle } = fixture();
  const unauthorized = await handle({ cmd: "DOWNLOAD_MEDIA", tabId: 10, item: blobItem }, { ...sender, url: "https://example.test/", tab: { id: 10 } });
  assert.equal(unauthorized.ok, false);
  const unsafe = await handle({ cmd: "DOWNLOAD_MEDIA", tabId: 10, item: { ...blobItem, directUrl: "javascript:alert(1)" } }, sender);
  assert.equal(unsafe.ok, false);
  assert.equal(calls.scripts.length + calls.downloads.length + calls.tabs.length, 0);
});

test("HLS probes carry live recording state after playback stops on the page", async () => {
  const { chromeApi, handle } = fixture();
  let recording = true;
  chromeApi.scripting.executeScript = async args => [{ documentId: "doc-1", result: {
    ok: true, canRecord: true, recording, streamUrl: args.args[1].streamUrl,
  } }];
  const message = { cmd: "PROBE_MEDIA", tabId: 10, item: { ...blobItem, streamUrl: "https://example.test/master.m3u8" } };
  const started = await handle(message, sender);
  assert.equal(started.kind, "hls");
  assert.equal(started.recording, true);
  recording = false;
  const stopped = await handle(message, sender);
  assert.equal(stopped.recording, false);
});

test("associated downloads refresh a signed source and reject recycled players", async () => {
  const { calls, chromeApi, handle } = fixture();
  const message = { cmd: "DOWNLOAD_MEDIA", tabId: 10, item: { ...blobItem, directUrl: "https://example.test/old.mp4" } };
  chromeApi.scripting.executeScript = async () => [{ documentId: "doc-1", result: {
    ok: true, recording: false, directUrl: "https://example.test/refreshed.mp4",
  } }];
  await handle(message, sender);
  assert.equal(calls.downloads[0].url, "https://example.test/refreshed.mp4");
  chromeApi.scripting.executeScript = async () => [{ documentId: "doc-1", result: {
    ok: false, recording: false, error: "The player has changed. Rescan the page first.",
  } }];
  const stale = await handle(message, sender);
  assert.equal(stale.ok, false);
  assert.equal(stale.recording, false);
  assert.equal(calls.downloads.length, 1);
});

test("probes explicitly clear an associated URL that the page no longer reports", async () => {
  const { calls, chromeApi, handle } = fixture();
  chromeApi.scripting.executeScript = async args => [{ documentId: "doc-1", result: args.args[0] === "STATUS"
    ? { ok: true, recording: false, canRecord: true }
    : { ok: true, kind: "stream", recording: false, canRecord: true } }];
  const response = await handle({ cmd: "PROBE_MEDIA", tabId: 10, item: {
    ...blobItem, directUrl: "https://example.test/expired.mp4", streamUrl: "https://example.test/old.m3u8",
  } }, sender);
  assert.equal(response.directUrl, "");
  assert.equal(response.streamUrl, "");
  assert.equal(response.kind, "stream");
  assert.equal(calls.fetches.length, 0);
});
