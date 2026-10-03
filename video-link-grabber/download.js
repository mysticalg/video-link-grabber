import { assembleStream, waitForDownload } from "./streamDownload.js";
import { filenameForMedia } from "./mediaUtils.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const source = params.get("url") || "";
const name = filenameForMedia({ filename: params.get("filename") || "video", outputExtension: "mp4" });
$("name").textContent = name;
$("source").textContent = source;
let controller;
let outputUrl;
let running = false;
const sizeText = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function run() {
  if (running) return;
  running = true;
  controller = new AbortController();
  $("retry").hidden = true;
  $("cancel").hidden = false;
  $("save").hidden = true;
  $("status").className = "";
  $("status").textContent = "Reading the video playlist…";
  $("progress").removeAttribute("value");
  $("detail").textContent = "";
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  try {
    const blob = await assembleStream(source, {
      signal: controller.signal,
      onProgress(info) {
        if (info.phase === "download") {
          $("status").textContent = `Downloading ${info.track === "audio" ? "audio" : "video"} chunks…`;
          $("progress").value = info.totalSegments ? info.completedSegments / info.totalSegments * 100 : 0;
          $("detail").textContent = `${info.completedSegments} of ${info.totalSegments} chunks · ${sizeText(info.downloadedBytes || 0)}`;
        } else if (info.phase === "assemble") {
          $("status").textContent = "Joining video and audio…";
          $("progress").removeAttribute("value");
          $("detail").textContent = `${sizeText(info.downloadedBytes)} downloaded. Preparing the MP4 file.`;
        }
      }
    });
    controller.signal.throwIfAborted();
    outputUrl = URL.createObjectURL(blob);
    $("save").href = outputUrl;
    $("save").download = name;
    $("save").hidden = false;
    $("progress").value = 100;
    $("detail").textContent = `${sizeText(blob.size)} · MP4 · original video and audio quality`;
    try {
      const downloadId = await chrome.downloads.download({ url: outputUrl, filename: name, conflictAction: "uniquify" });
      $("status").textContent = "File ready. Download started.";
      await waitForDownload(downloadId, { signal: controller.signal });
      $("status").textContent = "Video downloaded.";
    } catch (error) {
      $("status").textContent = controller.signal.aborted ? "Download cancelled. The prepared file can still be saved." : "File ready. Click Save video again to save it.";
      $("detail").textContent += ` · ${error.message}`;
    }
  } catch (error) {
    $("status").className = "error";
    $("status").textContent = controller.signal.aborted ? "Download cancelled." : "Could not download this stream.";
    $("detail").textContent = controller.signal.aborted ? "You can retry the download below." : error.message;
    $("progress").value = 0;
    $("retry").hidden = false;
  } finally {
    running = false;
    $("cancel").hidden = true;
  }
}
$("cancel").addEventListener("click", () => controller?.abort());
$("retry").addEventListener("click", run);
window.addEventListener("beforeunload", event => {
  if (running) { event.preventDefault(); event.returnValue = ""; }
});
void run();
