import { prepareBatch } from "./batchUtils.js";
import { filenameForMedia } from "./mediaUtils.js";
import { assembleStream, waitForDownload } from "./streamDownload.js";

const $ = id => document.getElementById(id);
let rows = [];
let tabId;
let running = false;
let controller;
const sizeText = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function setRow(row, state, text) {
  row.state = state;
  row.element.dataset.state = state;
  row.status.textContent = text;
  row.progress.hidden = state !== "working";
}

function summarize() {
  const count = state => rows.filter(row => row.state === state).length;
  const parts = [`${count("complete")} downloaded`];
  if (count("requested")) parts.push(`${count("requested")} requested in page`);
  if (count("error")) parts.push(`${count("error")} failed`);
  if (count("cancelled")) parts.push(`${count("cancelled")} cancelled`);
  const waiting = count("queued");
  if (waiting) parts.push(`${waiting} waiting`);
  $("summary").textContent = `${running ? "Downloading" : "Queue finished"} · ${parts.join(" · ")}`;
}

async function processRow(row, signal) {
  setRow(row, "working", "Checking video source…");
  row.progress.removeAttribute("value");
  row.save.hidden = true;
  if (row.outputUrl) URL.revokeObjectURL(row.outputUrl);
  row.outputUrl = null;
  const info = await chrome.runtime.sendMessage({ cmd: "DOWNLOAD_MEDIA", tabId, item: row.item, batch: true });
  if (!info?.ok) throw new Error(info?.error || info?.message || "Could not start this download.");
  let downloadId = info.downloadId;
  if (info.kind === "hls") {
    signal.throwIfAborted();
    // Keep at most one prepared file after a browser save failure. Releasing it
    // before another assembly bounds retained media memory across large queues.
    for (const previous of rows) {
      if (previous !== row && previous.outputUrl) {
        URL.revokeObjectURL(previous.outputUrl);
        previous.outputUrl = null;
        previous.save.hidden = true;
        previous.status.textContent += " Prepared file released to free memory; use Retry unfinished.";
      }
    }
    const name = filenameForMedia({ ...row.item, filename: info.filename, outputExtension: "mp4" });
    row.title.textContent = name;
    const blob = await assembleStream(info.streamUrl, { signal, onProgress(info) {
      if (info.phase === "download") {
        row.progress.value = info.totalSegments ? info.completedSegments / info.totalSegments * 100 : 0;
        row.status.textContent = `Downloading ${info.track === "audio" ? "audio" : "video"} · ${info.completedSegments} of ${info.totalSegments} chunks · ${sizeText(info.downloadedBytes || 0)}`;
      } else {
        row.progress.removeAttribute("value");
        row.status.textContent = info.phase === "assemble" ? "Joining video and audio…" : "Reading playlist…";
      }
    } });
    signal.throwIfAborted();
    row.outputUrl = URL.createObjectURL(blob);
    row.save.href = row.outputUrl;
    row.save.download = name;
    row.save.hidden = false;
    downloadId = await chrome.downloads.download({ url: row.outputUrl, filename: name, conflictAction: "uniquify", saveAs: false });
  } else if (info.filename) row.title.textContent = info.filename;
  if (Number.isInteger(downloadId)) {
    row.status.textContent = "Saving file…";
    await waitForDownload(downloadId, { signal });
    setRow(row, "complete", "Downloaded.");
    // Retain at most a failed assembly for manual saving, not the whole batch.
    row.save.hidden = true;
    if (row.outputUrl) URL.revokeObjectURL(row.outputUrl);
    row.outputUrl = null;
  } else {
    // A page-owned blob save cannot be recalled or tracked by download ID.
    // Preserve its request if Cancel was clicked while the page was responding.
    setRow(row, "requested", "Requested in the original page. Check Chrome downloads; allow multiple downloads if prompted.");
  }
}

async function run() {
  if (running) return;
  running = true;
  controller = new AbortController();
  $("retry").hidden = true;
  $("cancel").hidden = false;
  summarize();
  for (const row of rows) {
    if (row.state !== "queued") continue;
    if (controller.signal.aborted) { setRow(row, "cancelled", "Cancelled before starting."); continue; }
    try { await processRow(row, controller.signal); }
    catch (error) {
      setRow(row, controller.signal.aborted ? "cancelled" : "error",
        controller.signal.aborted ? "Cancelled." : error.message || "Download failed.");
    }
    summarize();
  }
  running = false;
  $("cancel").hidden = true;
  $("retry").hidden = !rows.some(row => ["error", "cancelled"].includes(row.state));
  summarize();
}

$("cancel").addEventListener("click", () => controller?.abort());
$("retry").addEventListener("click", () => {
  rows.filter(row => ["error", "cancelled"].includes(row.state)).forEach(row => setRow(row, "queued", "Waiting…"));
  void run();
});
window.addEventListener("beforeunload", event => {
  if (running) { event.preventDefault(); event.returnValue = ""; }
});

try {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("tabId")) throw new Error("No source page was selected.");
  const batch = prepareBatch(Number(params.get("tabId")), JSON.parse(params.get("items") || "null"));
  // Consume the startup payload once. Reload/back/session restore must not
  // silently download the entire selection again or retain signed media URLs.
  history.replaceState(null, "", location.pathname);
  tabId = batch.tabId;
  rows = batch.items.map(item => {
    const element = document.createElement("li");
    element.className = "queue-item";
    const title = document.createElement("h2");
    title.className = "filename";
    title.textContent = item.filename;
    const status = document.createElement("p");
    status.className = "item-status";
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.setAttribute("aria-label", `Progress: ${item.filename}`);
    const save = document.createElement("a");
    save.textContent = "Save prepared video";
    save.hidden = true;
    element.append(title, status, progress, save);
    $("queue").append(element);
    const row = { item, element, title, status, progress, save, outputUrl: null };
    setRow(row, "queued", "Waiting…");
    return row;
  });
  void run();
} catch (error) {
  $("summary").textContent = error.message || "This download queue is invalid. Select videos again.";
  $("summary").className = "error";
}
