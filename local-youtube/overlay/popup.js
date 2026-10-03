import { YouTubeNativeClient } from "./youtubeNative.js";

const results = document.getElementById("results");
const status = document.getElementById("status");
const scanButton = document.getElementById("scanBtn");
const count = document.getElementById("resultCount");
const template = document.getElementById("itemTpl");
const selectionBar = document.getElementById("selectionBar");
const selectAll = document.getElementById("selectAll");
const selectionCount = document.getElementById("selectionCount");
const downloadSelected = document.getElementById("downloadSelected");
const selectionStatus = document.getElementById("selectionStatus");
const helperStatus = document.getElementById("helperStatus");
const helperSetup = document.getElementById("helperSetup");
document.getElementById("buildLabel").textContent = `v${chrome.runtime.getManifest().version}`;
let helperProbe = null;
const selectedSources = new Set();
const MAX_SELECTION = 100;
let scanGeneration = 0;
let rows = [];
let scanning = false;
let batchStarting = false;
let polling = false;
let activeProbes = 0;
const probeQueue = [];

const fallbackThumbnail = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><rect width="160" height="100" fill="#edf2f8"/><rect x="51" y="30" width="58" height="40" rx="9" fill="#d7e1ee"/><path d="M75 40 L91 50 L75 60 Z" fill="#627690"/></svg>'
);

function setStatus(message, error = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("error", error);
}

async function checkYouTubeHelper(generation) {
  const client = new YouTubeNativeClient({ handshakeMs: 3000 });
  helperProbe = client;
  helperStatus.hidden = false;
  helperStatus.className = "helperStatus";
  helperStatus.textContent = "Checking YouTube helper…";
  helperSetup.hidden = true;
  try {
    await client.connect();
    if (generation !== scanGeneration) return;
    helperStatus.className = "helperStatus ready";
    helperStatus.textContent = "YouTube helper ready";
  } catch {
    if (generation !== scanGeneration) return;
    helperStatus.className = "helperStatus error";
    helperStatus.textContent = "Helper unavailable. Download and install the helper below.";
    helperSetup.hidden = false;
  } finally {
    client.close();
    if (helperProbe === client) helperProbe = null;
  }
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1));
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

function humanType(value) {
  const type = String(value || "").split(";")[0].toLowerCase();
  const types = {
    youtube: "YouTube",
    mp4: "MP4", "video/mp4": "MP4", webm: "WebM", "video/webm": "WebM",
    ogg: "Ogg", ogv: "Ogg", "video/ogg": "Ogg", mov: "QuickTime", "video/quicktime": "QuickTime",
    m4v: "M4V", mkv: "Matroska", m3u8: "HLS playlist", "application/vnd.apple.mpegurl": "HLS playlist",
    "application/x-mpegurl": "HLS playlist", mpd: "DASH playlist", "application/dash+xml": "DASH playlist"
  };
  return types[type] || type;
}

function canOpen(url) {
  try { return ["http:", "https:"].includes(new URL(url).protocol); }
  catch { return false; }
}

function isHls(url, type) {
  return /(?:application|audio)\/(?:x-|vnd\.apple\.)?mpegurl/i.test(type || "") || /\.m3u8(?:[?#]|$)/i.test(url || "");
}

async function request(cmd, tabId, item) {
  const response = await chrome.runtime.sendMessage({ cmd, tabId, ...(item ? { item } : {}) });
  if (!response) throw new Error("The extension did not respond. Reload it and refresh this page.");
  return response;
}

function isCurrent(row) {
  return row.generation === scanGeneration && row.element.isConnected;
}

function setItemStatus(row, message = "", error = false) {
  row.notice.textContent = message;
  row.notice.hidden = !message;
  row.notice.classList.toggle("error", error);
}

function sourceKey(row) {
  return row.item.directUrl || row.item.streamUrl || row.item.url || "";
}

function canSelect(row) {
  if (!isCurrent(row) || row.busy || row.recording || ["pending", "unavailable"].includes(row.kind)) return false;
  if (row.item.directUrl || row.item.streamUrl) return true;
  return !!row.item.url && row.kind !== "stream" && row.kind !== "manifest" && !row.item.isManifest;
}

function setSelectionStatus(message = "", error = false) {
  selectionStatus.textContent = message;
  selectionStatus.hidden = !message;
  selectionStatus.classList.toggle("error", error);
}

function updateSelection() {
  const available = new Set(rows.filter(canSelect).map(sourceKey));
  for (const key of selectedSources) {
    if (!available.has(key)) selectedSources.delete(key);
  }
  for (const row of rows) {
    const selectable = canSelect(row);
    row.select.checked = selectable && selectedSources.has(sourceKey(row));
    row.select.disabled = scanning || batchStarting || !selectable;
    row.select.setAttribute("aria-label", `Select ${row.title.textContent}`);
    row.select.title = selectable ? "Select this video to download with others" :
      row.kind === "pending" ? "Checking whether this video can be downloaded" : "This video is not available for a group download";
    row.element.classList.toggle("selected", row.select.checked);
  }
  selectionBar.hidden = !rows.length;
  selectionCount.textContent = `${selectedSources.size} selected`;
  selectAll.checked = available.size > 0 && selectedSources.size >= Math.min(MAX_SELECTION, available.size);
  selectAll.indeterminate = selectedSources.size > 0 && selectedSources.size < available.size;
  selectAll.disabled = scanning || batchStarting || !available.size;
  selectAll.setAttribute("aria-label", available.size > MAX_SELECTION ? `Select up to ${MAX_SELECTION} available videos` : "Select all available videos");
  downloadSelected.disabled = scanning || batchStarting || !selectedSources.size;
  downloadSelected.textContent = batchStarting ? "Starting…" : "Download selected";
}

function updateRow(row, refreshSelection = true) {
  const { item, button } = row;
  // Keep the complete filename accessible when the compact card clips long text.
  row.title.title = row.title.textContent;
  const source = item.directUrl || item.streamUrl || item.url;
  row.open.hidden = !canOpen(source);
  if (!row.open.hidden) row.open.href = source;
  row.copy.hidden = !source;
  row.element.classList.toggle("recording", row.recording);
  row.badge.textContent = item.platform === "youtube" ? "YouTube · local helper" : row.recording ? "Recording" : item.directUrl ? "Video file" :
    item.streamUrl ? "Stream download" : row.kind === "pending" ? "Checking source" :
    row.kind === "stream" ? "Stream" : row.kind === "unavailable" ? "Unavailable" :
    item.isManifest || row.kind === "manifest" ? "Playlist" : row.kind === "blob" ? "Blob file" : "Video file";
  row.type.textContent = humanType(row.mediaType);
  row.size.textContent = formatBytes(row.bytes);
  row.type.hidden = !row.type.textContent;
  row.size.hidden = !row.size.textContent;

  let help = "";
  if (item.platform === "youtube") help = "Saves video and audio with the local helper. Install it once, then keep the download queue tab open.";
  else if (row.recording) help = "Recording from playback. Keep this page open. Stop here or use the control on the page to save.";
  else if (item.streamUrl && !item.directUrl) help = "Downloads media chunks into an MP4. Keep the progress tab open until it finishes.";
  else if (row.kind === "stream" && !item.directUrl) help = "Play the video and Rescan. If needed, refresh X after reloading the extension.";
  else if (row.kind === "blob") help = "Keep the video page open until the download starts.";
  else if (item.isManifest || row.kind === "manifest") help = "Saves the playlist only. This source has no supported stream download.";
  row.help.textContent = help;
  row.help.hidden = !help;

  button.textContent = row.busy ? "Working…" : row.recording ? "Stop & save" :
    item.directUrl ? "Download" : item.streamUrl ? "Download stream" : row.kind === "pending" ? "Checking…" :
    row.kind === "stream" || row.kind === "unavailable" ? "Source not found" :
    item.isManifest || row.kind === "manifest" ? "Save playlist" : "Download";
  button.disabled = batchStarting || row.busy || (!row.recording && !item.directUrl && !item.streamUrl &&
    ["pending", "unavailable", "stream"].includes(row.kind));
  button.setAttribute("aria-label", `${button.textContent}: ${row.title.textContent}`);
  row.recordButton.hidden = !row.canRecord || row.recording || !!item.directUrl ||
    !(row.kind === "stream" || row.kind === "unavailable" || item.streamUrl);
  row.recordButton.disabled = batchStarting || row.busy;
  row.recordButton.setAttribute("aria-label", `Record while playing: ${row.title.textContent}`);
  row.recordButton.setAttribute("title", "Records from the current playback position in real time as re-encoded WebM; quality may differ. Start playback and keep the video page open.");
  row.open.setAttribute("aria-label", `Open source: ${row.title.textContent}`);
  if (refreshSelection) updateSelection();
}

function applyProbe(row, info) {
  const wasRecording = row.recording;
  if (typeof info.directUrl === "string") row.item.directUrl = info.directUrl;
  if (typeof info.streamUrl === "string") row.item.streamUrl = info.streamUrl;
  if (info.kind === "unavailable") {
    row.item.directUrl = "";
    row.item.streamUrl = "";
  } else if (!row.item.streamUrl && canOpen(row.item.url) && isHls(row.item.url, info.type)) {
    row.item.streamUrl = row.item.url;
  }
  if (typeof info.isManifest === "boolean") row.item.isManifest = info.isManifest;
  if (info.kind) row.kind = info.kind;
  else if (row.kind === "pending") row.kind = info.ok ? "blob" : "unavailable";
  if (typeof info.canRecord === "boolean") row.canRecord = info.canRecord;
  if (typeof info.recording === "boolean") row.recording = info.recording;
  if (info.type) row.mediaType = info.type;
  if (Number.isFinite(Number(info.size))) row.bytes = Number(info.size);
  if (info.filename) {
    row.item.filename = info.filename;
    row.title.textContent = info.filename;
  }
  if (info.ok && info.kind === "stream" && !row.recording) {
    // An MSE blob failing a file fetch is an expected stream, not a download failure.
    setItemStatus(row, wasRecording ? "Recording has stopped. Check the page control or your downloads." : "");
  }
  else if (info.error) setItemStatus(row, info.error, true);
  else if (info.message) setItemStatus(row, info.message);
  else if (wasRecording && !row.recording) setItemStatus(row, "Recording has stopped. Check the control on the page or your downloads.");
  updateRow(row);
}

async function probeRow(row) {
  const version = row.version;
  try {
    const info = await request("PROBE_MEDIA", row.tabId, row.item);
    if (!isCurrent(row) || version !== row.version || row.busy) return;
    applyProbe(row, info);
  } catch (error) {
    if (!isCurrent(row) || version !== row.version || row.busy) return;
    if (row.kind === "pending") row.kind = "unavailable";
    setItemStatus(row, error.message || "Unable to check this source.", true);
    updateRow(row);
  }
}

function drainProbes() {
  while (activeProbes < 4 && probeQueue.length) {
    const job = probeQueue.shift();
    if (!isCurrent(job.row)) { job.resolve(); continue; }
    activeProbes++;
    void probeRow(job.row).catch(() => {
      // Keep the probe queue moving if a row becomes invalid while rendering.
    }).finally(() => {
      activeProbes--;
      job.resolve();
      drainProbes();
    });
  }
}

async function probeRows(pending) {
  await Promise.all(pending.map(row => new Promise(resolve => {
    probeQueue.push({ row, resolve });
    drainProbes();
  })));
}

async function actOnRow(row, requestedCommand) {
  if (!isCurrent(row) || row.busy || batchStarting) return;
  const command = requestedCommand || (row.recording ? "STOP_RECORDING" : "DOWNLOAD_MEDIA");
  row.busy = true;
  row.version++;
  setItemStatus(row);
  updateRow(row);
  try {
    const info = await request(command, row.tabId, row.item);
    if (!isCurrent(row)) return;
    applyProbe(row, info);
    if (!info.ok) {
      setItemStatus(row, info.error || info.message || "This action could not be completed.", true);
    } else {
      if (command === "START_RECORDING") row.recording = true;
      if (command === "STOP_RECORDING") row.recording = false;
      setItemStatus(row, info.message || (command === "START_RECORDING" ? "Recording started. Play the part you want to save." :
        command === "STOP_RECORDING" ? "Recording stopped. Check your downloads." : "Download started. Check your browser's downloads."));
    }
  } catch (error) {
    if (isCurrent(row)) setItemStatus(row, error.message || "The action failed. Refresh the page and try again.", true);
  } finally {
    row.busy = false;
    if (isCurrent(row)) updateRow(row);
  }
}

async function startSelectedDownloads() {
  if (scanning || batchStarting) return;
  updateSelection();
  const chosen = [];
  const seen = new Set();
  for (const row of rows) {
    const key = sourceKey(row);
    if (!canSelect(row) || !selectedSources.has(key) || seen.has(key)) continue;
    seen.add(key);
    chosen.push(row);
  }
  if (!chosen.length) return;
  const generation = scanGeneration;
  const items = chosen.slice(0, MAX_SELECTION).map(row => {
    // Discard probes that started before the user chose these exact sources.
    row.version++;
    return { ...row.item };
  });
  batchStarting = true;
  scanButton.disabled = true;
  setSelectionStatus("Opening your download queue…");
  for (const row of rows) updateRow(row, false);
  updateSelection();
  try {
    const response = await chrome.runtime.sendMessage({ cmd: "DOWNLOAD_BATCH", tabId: chosen[0].tabId, items });
    if (!response) throw new Error("The extension did not respond. Reload it and refresh this page.");
    if (!response.ok) throw new Error(response.error || response.message || "Could not start the selected downloads.");
    if (generation !== scanGeneration) return;
    selectedSources.clear();
    setSelectionStatus(response.message || `${response.count || items.length} videos queued in a new tab. Keep that tab and the video page open until they finish.`);
  } catch (error) {
    if (generation === scanGeneration) setSelectionStatus(error.message || "Could not start the selected downloads.", true);
  } finally {
    batchStarting = false;
    if (generation === scanGeneration) {
      scanButton.disabled = scanning;
      for (const row of rows) updateRow(row, false);
      updateSelection();
    }
  }
}

function renderItems(items, tabId, generation) {
  results.replaceChildren();
  rows = [];
  selectedSources.clear();
  setSelectionStatus();
  count.textContent = `${items.length} ${items.length === 1 ? "source" : "sources"} found`;
  if (!items.length) {
    setStatus("No video sources found. Open or play a video, then Rescan. On YouTube lists, scroll the videos you want into view.");
    updateSelection();
    return;
  }
  setStatus("");
  for (const sourceItem of items) {
    const item = { ...sourceItem };
    if (!item.streamUrl && isHls(item.url, item.type)) item.streamUrl = item.url;
    const element = template.content.firstElementChild.cloneNode(true);
    const row = {
      element, item, tabId, generation, version: 0, busy: false,
      recording: !!item.recording, canRecord: !!item.canRecord,
      kind: item.isBlob || item.isData ? "pending" : !item.url ? "stream" : "direct",
      mediaType: item.type, bytes: item.size,
      title: element.querySelector(".title"), type: element.querySelector(".type"),
      size: element.querySelector(".size"), badge: element.querySelector(".badge"),
      help: element.querySelector(".help"), notice: element.querySelector(".itemStatus"),
      button: element.querySelector(".download"), recordButton: element.querySelector(".record"),
      open: element.querySelector(".open"), copy: element.querySelector(".copy"),
      select: element.querySelector(".selectVideo")
    };
    const thumbnail = element.querySelector(".thumb");
    thumbnail.src = item.poster || fallbackThumbnail;
    thumbnail.addEventListener("error", () => {
      if (thumbnail.src !== fallbackThumbnail) thumbnail.src = fallbackThumbnail;
    });
    row.title.textContent = item.filename || (item.videoId ? "Page video" : "Video source");
    element.querySelector(".from").textContent = item.from ? `Found in ${item.from}` : "Found on this page";
    row.open.setAttribute("aria-label", `Open source: ${row.title.textContent}`);
    const copy = row.copy;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.directUrl || item.streamUrl || item.url);
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy URL"; }, 1500);
      } catch {
        setItemStatus(row, "Could not copy this URL. Check clipboard access.", true);
      }
    });
    row.button.addEventListener("click", () => { void actOnRow(row); });
    row.recordButton.addEventListener("click", () => { void actOnRow(row, "START_RECORDING"); });
    row.select.addEventListener("change", () => {
      if (!canSelect(row) || scanning || batchStarting) { updateSelection(); return; }
      const key = sourceKey(row);
      setSelectionStatus();
      if (!row.select.checked) selectedSources.delete(key);
      else if (selectedSources.size < MAX_SELECTION || selectedSources.has(key)) selectedSources.add(key);
      else setSelectionStatus(`Choose up to ${MAX_SELECTION} videos at a time.`);
      updateSelection();
    });
    results.appendChild(element);
    rows.push(row);
    updateRow(row, false);
  }
  updateSelection();
  void probeRows(rows);
}

async function scan() {
  if (batchStarting) return;
  const generation = ++scanGeneration;
  helperProbe?.close();
  helperStatus.hidden = true;
  helperSetup.hidden = true;
  scanning = true;
  selectedSources.clear();
  setSelectionStatus();
  updateSelection();
  scanButton.disabled = true;
  scanButton.textContent = "Scanning…";
  results.setAttribute("aria-busy", "true");
  setStatus("Looking for video sources…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active browser tab found.");
    const response = await request("SCAN_TAB", tab.id);
    if (generation !== scanGeneration) return;
    if (!response.ok) throw new Error(response.error || "Cannot scan this page. Refresh it and try again. Browser settings and other restricted pages cannot be scanned.");
    const items = Array.isArray(response.items) ? response.items : [];
    renderItems(items, tab.id, generation);
    if (response.platform === "youtube" || items.some(item => item.platform === "youtube")) void checkYouTubeHelper(generation);
  } catch (error) {
    if (generation !== scanGeneration) return;
    rows = [];
    results.replaceChildren();
    count.textContent = "";
    setStatus(error.message || "Cannot scan this page. Refresh it and try again.", true);
    updateSelection();
  } finally {
    if (generation === scanGeneration) {
      scanning = false;
      scanButton.disabled = false;
      scanButton.textContent = "Rescan";
      results.setAttribute("aria-busy", "false");
      updateSelection();
    }
  }
}

scanButton.addEventListener("click", () => { void scan(); });
window.addEventListener("pagehide", () => helperProbe?.close());
selectAll.addEventListener("change", () => {
  if (scanning || batchStarting) return;
  selectedSources.clear();
  if (selectAll.checked) {
    for (const row of rows) {
      if (canSelect(row) && selectedSources.size < MAX_SELECTION) selectedSources.add(sourceKey(row));
    }
    const available = new Set(rows.filter(canSelect).map(sourceKey)).size;
    setSelectionStatus(available > MAX_SELECTION ? `Selected the first ${MAX_SELECTION} available videos. Download these, then choose another group.` : "");
  } else setSelectionStatus();
  updateSelection();
});
downloadSelected.addEventListener("click", () => { void startSelectedDownloads(); });
setInterval(async () => {
  if (polling) return;
  const active = rows.filter(row => row.recording && !row.busy);
  if (!active.length) return;
  polling = true;
  try { await probeRows(active); }
  finally { polling = false; }
}, 2500);
void scan();
