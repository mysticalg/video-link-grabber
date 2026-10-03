import { prepareYouTubeQueue } from "./youtubeUtils.js";
import { YouTubeNativeClient } from "./youtubeNative.js";

const $ = id => document.getElementById(id);
const client = new YouTubeNativeClient();
let rows = [];
let running = false;
let controller;

function setRow(row, state, text) {
  row.state = state;
  row.element.dataset.state = state;
  row.status.textContent = text;
  row.progress.hidden = state !== "working";
}

function summarize() {
  const count = state => rows.filter(row => row.state === state).length;
  const parts = [`${count("complete")} saved`];
  if (count("error")) parts.push(`${count("error")} failed`);
  if (count("cancelled")) parts.push(`${count("cancelled")} cancelled`);
  if (count("queued")) parts.push(`${count("queued")} waiting`);
  $("summary").textContent = `${running ? "Downloading" : "Queue finished"} · ${parts.join(" · ")}`;
}

async function run() {
  if (running) return;
  running = true;
  controller = new AbortController();
  $("retry").hidden = true;
  $("cancel").hidden = false;
  $("cancel").disabled = false;
  $("cancel").textContent = "Cancel remaining";
  $("helperStatus").className = "";
  $("helperStatus").textContent = "Connecting to your local helper…";
  $("helperSetup").hidden = true;
  summarize();
  try {
    const helper = await client.connect();
    $("helperStatus").textContent = "Local helper connected. Videos will download one at a time.";
    $("outputDir").textContent = helper.outputDir ? `Save folder: ${helper.outputDir}` : "The helper will show each saved file’s path below.";
    $("outputDir").hidden = false;
    for (const row of rows) {
      if (row.state !== "queued") continue;
      if (controller.signal.aborted) { setRow(row, "cancelled", "Cancelled before starting."); continue; }
      setRow(row, "working", "Reading video details…");
      row.progress.removeAttribute("value");
      summarize();
      try {
        const saved = await client.download(row.item.youtubeId, { signal: controller.signal, onProgress(info) {
          const phase = { extracting: "Reading video details…", downloading: "Downloading video and audio…", merging: "Joining video and audio…" }[info.phase];
          row.status.textContent = `${phase}${info.percent === null ? "" : ` ${Math.round(info.percent)}%`}`;
          if (info.percent === null) row.progress.removeAttribute("value");
          else row.progress.value = info.percent;
          if (info.title) row.title.textContent = info.title;
        } });
        row.title.textContent = saved.filename;
        row.path.textContent = saved.path;
        row.path.hidden = false;
        setRow(row, "complete", "Saved to your computer.");
      } catch (error) {
        setRow(row, controller.signal.aborted || error?.name === "AbortError" ? "cancelled" : "error", error?.message || "Download failed.");
        if (!client.port && !controller.signal.aborted) $("helperSetup").hidden = false;
      }
      summarize();
    }
  } catch (error) {
    $("helperStatus").textContent = error?.message || "The local helper is unavailable. Download the helper below, extract it and run Install helper.cmd, then retry.";
    $("helperStatus").className = "error";
    $("helperSetup").hidden = controller.signal.aborted;
    for (const row of rows) {
      if (row.state === "queued") setRow(row, controller.signal.aborted ? "cancelled" : "error", controller.signal.aborted ? "Cancelled before starting." : "Waiting for the local helper. Retry after setup.");
    }
  } finally {
    running = false;
    $("cancel").hidden = true;
    $("retry").hidden = !rows.some(row => ["error", "cancelled"].includes(row.state));
    summarize();
  }
}

$("cancel").addEventListener("click", () => {
  controller?.abort();
  $("cancel").textContent = "Cancelling…";
  $("cancel").disabled = true;
  if (!client.pending) client.close();
});
$("retry").addEventListener("click", () => {
  for (const row of rows) if (["error", "cancelled"].includes(row.state)) setRow(row, "queued", "Waiting…");
  void run();
});
window.addEventListener("beforeunload", event => {
  if (running) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("pagehide", () => client.close());

try {
  const params = new URLSearchParams(location.hash.slice(1));
  const items = prepareYouTubeQueue(JSON.parse(params.get("items") || "null"));
  // A page refresh must not silently download the same selection a second time.
  history.replaceState(null, "", location.pathname);
  rows = items.map(item => {
    const element = document.createElement("li");
    element.className = "queue-item";
    const title = document.createElement("h2");
    title.className = "filename";
    title.textContent = item.title;
    const status = document.createElement("p");
    status.className = "item-status";
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.setAttribute("aria-label", `Progress: ${item.title}`);
    const path = document.createElement("p");
    path.className = "saved-path";
    path.hidden = true;
    element.append(title, status, progress, path);
    $("queue").append(element);
    const row = { item, element, title, status, progress, path };
    setRow(row, "queued", "Waiting…");
    return row;
  });
  void run();
} catch (error) {
  $("helperStatus").textContent = "Open the extension on YouTube and select the videos to download.";
  $("summary").textContent = error?.message || "This queue is invalid. Select the videos again.";
  $("summary").className = "error";
}
