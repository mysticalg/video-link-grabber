import { pageAction } from "./contentScript.js";
import { prepareBatch } from "./batchUtils.js";
import { scanYouTubePage } from "./youtubeScan.js";
import { prepareYouTubeQueue, validateYouTubeItem } from "./youtubeUtils.js";
import {
  filenameForMedia, formatBytes, isExtensionUiSender, isManifest,
  probeHttpMedia, validateMediaItem, validateTabId,
} from "./mediaUtils.js";

const COMMANDS = new Set([
  "SCAN_TAB", "PROBE_MEDIA", "DOWNLOAD_MEDIA", "DOWNLOAD_BATCH", "START_RECORDING", "STOP_RECORDING",
]);

// Page scripts return metadata; blob bytes and recording state stay in their document.
export function createMessageHandler({ chromeApi = globalThis.chrome, fetchImpl = globalThis.fetch, action = pageAction } = {}) {
  async function openYouTubeQueue(items) {
    const params = new URLSearchParams({ items: JSON.stringify(items) });
    await chromeApi.tabs.create({ url: `${chromeApi.runtime.getURL("youtube.html")}#${params}` });
  }
  async function inDocument(tabId, item, command) {
    const results = await chromeApi.scripting.executeScript({
      target: { tabId, documentIds: [item.documentId] }, world: "MAIN", func: action, args: [command, item],
    });
    const response = results.find(result => result.documentId === item.documentId)?.result;
    if (!response || typeof response !== "object") {
      throw new Error("This video's page has changed. Rescan the page and try again.");
    }
    return response;
  }

  return async function handleMessage(message, sender) {
    if (!isExtensionUiSender(sender, chromeApi.runtime.id)) {
      return { ok: false, error: "Only the extension popup can perform this action." };
    }
    if (!COMMANDS.has(message?.cmd)) return { ok: false, error: "Unknown command." };
    try {
      const tabId = validateTabId(message.tabId);
      if (message.cmd === "DOWNLOAD_BATCH") {
        if (Array.isArray(message.items) && message.items.some(item => item?.platform === "youtube")) {
          if (message.items.length > 100) throw new Error("Select up to 100 videos.");
          const youtubeItems = prepareYouTubeQueue(message.items.filter(item => item?.platform === "youtube"));
          const otherItems = message.items.filter(item => item?.platform !== "youtube");
          const otherBatch = otherItems.length ? prepareBatch(tabId, otherItems) : null;
          await openYouTubeQueue(youtubeItems);
          if (otherBatch) await chromeApi.tabs.create({ url: `${chromeApi.runtime.getURL("batch.html")}#${otherBatch.fragment}` });
          return { ok: true, count: youtubeItems.length + (otherBatch?.items.length || 0), message: "Selected videos opened in download queues. Keep the queue tabs open. YouTube uses the local helper." };
        }
        const batch = prepareBatch(tabId, message.items);
        await chromeApi.tabs.create({ url: `${chromeApi.runtime.getURL("batch.html")}#${batch.fragment}` });
        return { ok: true, count: batch.items.length, message: `${batch.items.length} videos added to a download queue. Keep the queue tab open.` };
      }
      if (message.cmd === "SCAN_TAB") {
        const youtubeFrames = await chromeApi.scripting.executeScript({
          target: { tabId, allFrames: true }, world: "MAIN", func: scanYouTubePage,
        });
        const mainYouTubeFrame = youtubeFrames.find(frame => frame.frameId === 0 && frame.result?.isYouTube);
        const youtubeItems = [];
        const youtubeIds = new Set();
        const youtubeDocuments = new Set();
        for (const frame of mainYouTubeFrame ? [mainYouTubeFrame] : youtubeFrames) {
          if (!frame.result?.isYouTube) continue;
          youtubeDocuments.add(frame.documentId);
          for (const candidate of frame.result.items || []) {
            try {
              const item = validateYouTubeItem(candidate);
              if (!youtubeIds.has(item.youtubeId)) { youtubeItems.push(item); youtubeIds.add(item.youtubeId); }
            } catch { /* ignore invalid page metadata */ }
          }
        }
        if (mainYouTubeFrame) {
          return { ok: true, items: youtubeItems.slice(0, 100), platform: "youtube" };
        }
        const results = await chromeApi.scripting.executeScript({
          target: { tabId, allFrames: true }, world: "MAIN", func: action, args: ["SCAN"],
        });
        const seen = new Set();
        const items = [...youtubeItems];
        for (const frame of results) {
          if (youtubeDocuments.has(frame.documentId)) continue;
          if (!frame.result?.ok || !Array.isArray(frame.result.items) || !frame.documentId) continue;
          for (const candidate of frame.result.items) {
            try {
              const item = validateMediaItem({ ...candidate, frameId: frame.frameId, documentId: frame.documentId });
              const key = `${item.documentId}\n${item.videoId || ""}\n${item.url}`;
              if (seen.has(key)) continue;
              seen.add(key);
              items.push(item);
            } catch {
              // One invalid or unsafe source must not hide valid videos.
            }
          }
        }
        return { ok: true, items };
      }

      if (message.item?.platform === "youtube") {
        const item = validateYouTubeItem(message.item);
        if (message.cmd === "PROBE_MEDIA") return { ok: true, kind: "youtube", type: "youtube", filename: item.filename, canRecord: false };
        if (message.cmd !== "DOWNLOAD_MEDIA") throw new Error("Use Download for YouTube videos in this local build.");
        await openYouTubeQueue([item]);
        return { ok: true, kind: "youtube", message: "YouTube download opened in a new tab. Keep it open; the local helper saves the file." };
      }
      let item = validateMediaItem(message.item);
      const pageOwned = !item.url || item.isBlob || item.isData;
      let pageStatus = {};
      if (item.videoId && (message.cmd === "PROBE_MEDIA" ||
          (message.cmd === "DOWNLOAD_MEDIA" && (message.batch || item.directUrl || item.streamUrl)))) {
        // Source URLs and recording state can change while a popup remains open.
        // Refresh the owning player before taking a cached stream shortcut.
        pageStatus = await inDocument(tabId, item, "STATUS");
        if (!pageStatus.ok) return pageStatus;
        item = validateMediaItem({ ...item, ...pageStatus,
          directUrl: pageStatus.directUrl || "", streamUrl: pageStatus.streamUrl || "",
        });
      }
      if (message.cmd === "PROBE_MEDIA") {
        if (item.streamUrl && !item.directUrl) {
          return { ...pageStatus, ok: true, kind: "hls", directUrl: "", streamUrl: item.streamUrl, type: "application/vnd.apple.mpegurl", size: null, sizeHuman: "Unknown", isManifest: true };
        }
        if (pageOwned && !item.directUrl) {
          const response = await inDocument(tabId, item, "INSPECT");
          return { directUrl: "", streamUrl: "", ...response, sizeHuman: formatBytes(response.size) };
        }
        const response = await probeHttpMedia(item.directUrl || item.url, { fetchImpl });
        const manifest = !item.directUrl && (item.isManifest || isManifest(item.url, response.type));
        return { ...pageStatus, ...response, directUrl: item.directUrl, streamUrl: item.streamUrl,
          filename: filenameForMedia({ ...item, type: response.type || item.type }),
          kind: manifest ? "manifest" : "direct", isManifest: manifest };
      }
      if (message.cmd === "DOWNLOAD_MEDIA") {
        if (message.batch && pageStatus.recording) throw new Error("This video is being recorded. Stop recording and retry it.");
        if (!item.directUrl && item.streamUrl) {
          if (message.batch) return { ok: true, kind: "hls", streamUrl: item.streamUrl, filename: item.filename };
          const params = new URLSearchParams({ url: item.streamUrl, filename: item.filename || "video" });
          await chromeApi.tabs.create({ url: `${chromeApi.runtime.getURL("download.html")}#${params}` });
          return { ok: true, message: "Stream download opened in a new tab." };
        }
        if (pageOwned && !item.directUrl) return await inDocument(tabId, item, "DOWNLOAD");
        if (message.batch && item.isManifest && !item.directUrl) throw new Error("This source is a playlist, not a supported video download.");
        const filename = filenameForMedia(item);
        const downloadId = await chromeApi.downloads.download({
          url: item.directUrl || item.url, filename, conflictAction: "uniquify", saveAs: !message.batch,
        });
        return {
          ok: true, downloadId, filename,
          message: item.isManifest && !item.directUrl ? "Playlist download requested. This is a playlist, not the complete video." : "Download requested. Check Chrome's downloads for progress.",
        };
      }
      return await inDocument(tabId, item, message.cmd);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  };
}

if (globalThis.chrome?.runtime?.onMessage) {
  const handleMessage = createMessageHandler();
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!COMMANDS.has(message?.cmd)) return false;
    handleMessage(message, sender).then(sendResponse, error => sendResponse({ ok: false, error: String(error) }));
    return true;
  });
}
