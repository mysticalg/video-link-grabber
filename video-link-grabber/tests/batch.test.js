import test from "node:test";
import assert from "node:assert/strict";
import { prepareBatch } from "../batchUtils.js";
import { waitForDownload } from "../streamDownload.js";

const item = { url: "blob:https://example.test/one", documentId: "doc", videoId: "video-1", filename: "Rooftop view.mp4", directUrl: "https://example.test/full.mp4", streamUrl: "https://example.test/master.m3u8" };

test("batch collapses a player and its separately discovered file and playlist", () => {
  const batch = prepareBatch(42, [item,
    { ...item, videoId: "", url: item.directUrl, directUrl: "", streamUrl: "" },
    { ...item, videoId: "", url: item.streamUrl, directUrl: "" },
  ]);
  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].filename, "Rooftop view.mp4");
  const params = new URLSearchParams(batch.fragment);
  assert.equal(params.get("tabId"), "42");
  assert.deepEqual(JSON.parse(params.get("items")), batch.items);
});

test("batch preserves separate videos and rejects invalid or unsupported jobs atomically", () => {
  assert.equal(prepareBatch(42, [item, { ...item, url: "https://example.test/second.mp4", videoId: "video-2", directUrl: "", streamUrl: "" }]).items.length, 2);
  for (const invalid of [
    [], Array(101).fill(item),
    [{ ...item, recording: true }],
    [{ ...item, url: "javascript:alert(1)" }],
    [item, { ...item, url: "https://example.test/dash.mpd", videoId: "", directUrl: "", streamUrl: "" }],
    [{ ...item, url: "", directUrl: "", streamUrl: "" }],
  ]) assert.throws(() => prepareBatch(42, invalid));
  assert.throws(() => prepareBatch(-1, [item]));
});

function downloadApi(searchImpl) {
  const listeners = new Set();
  const cancelled = [];
  return { listeners, cancelled, api: { downloads: {
    onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    search: searchImpl,
    cancel: async id => { cancelled.push(id); },
  } }, emit: change => [...listeners].forEach(fn => fn(change)) };
}

test("download completion handles files that finished before listener registration", async () => {
  const f = downloadApi(async query => {
    assert.deepEqual(query, { id: 7 });
    return [{ id: 7, state: "complete" }];
  });
  await waitForDownload(7, { chromeApi: f.api });
  assert.equal(f.listeners.size, 0);
});

test("download waiter ignores unrelated downloads and cleans up after interruption", async () => {
  const f = downloadApi(async () => [{ state: "in_progress" }]);
  const waiting = waitForDownload(7, { chromeApi: f.api });
  f.emit({ id: 8, state: { current: "complete" } });
  assert.equal(f.listeners.size, 1);
  f.emit({ id: 7, state: { current: "interrupted" }, error: { current: "NETWORK_FAILED" } });
  await assert.rejects(waiting, /NETWORK_FAILED/);
  assert.equal(f.listeners.size, 0);
});

test("cancelling a queue cancels only its current download and removes its listener", async () => {
  const f = downloadApi(async () => [{ state: "in_progress" }]);
  const controller = new AbortController();
  const waiting = waitForDownload(7, { signal: controller.signal, chromeApi: f.api });
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.deepEqual(f.cancelled, [7]);
  assert.equal(f.listeners.size, 0);
});

test("cancellation racing with a completed file does not mark it for a duplicate retry", async () => {
  const f = downloadApi(async () => [{ state: "complete" }]);
  const controller = new AbortController();
  controller.abort();
  await waitForDownload(7, { signal: controller.signal, chromeApi: f.api });
  assert.equal(f.listeners.size, 0);
});
