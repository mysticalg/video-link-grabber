import { collectHls } from "./hls.js";
import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { sanitizeFilename } from "./mediaUtils.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const source = params.get("url") || "";
const name = sanitizeFilename((params.get("filename") || "video").replace(/\.[a-z0-9]{2,5}$/i, "") + ".mp4");
$("name").textContent = name;
$("source").textContent = source;
let controller;
let ffmpeg;
let outputUrl;
let running = false;
let downloadId;
const sizeText = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function run() {
  running = true;
  downloadId = undefined;
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
  const logs = [];
  try {
    const parsed = new URL(source);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Invalid stream URL. Rescan the original page.");
    const media = await collectHls(source, {
      signal: controller.signal,
      onProgress(info) {
        if (info.phase !== "download") return;
        $("status").textContent = `Downloading ${info.track === "audio" ? "audio" : "video"} chunks…`;
        $("progress").value = info.totalSegments ? info.completedSegments / info.totalSegments * 100 : 0;
        $("detail").textContent = `${info.completedSegments} of ${info.totalSegments} chunks · ${sizeText(info.downloadedBytes || 0)}`;
      }
    });
    controller.signal.throwIfAborted();
    $("status").textContent = "Joining video and audio…";
    $("progress").removeAttribute("value");
    $("detail").textContent = `${sizeText(media.totalBytes)} downloaded. Preparing the MP4 file.`;
    ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => { logs.push(message); if (logs.length > 12) logs.shift(); });
    // All executable assets are bundled locally; no CDN or remote code is loaded.
    await ffmpeg.load({
      coreURL: chrome.runtime.getURL("vendor/core/ffmpeg-core.js"),
      wasmURL: chrome.runtime.getURL("vendor/core/ffmpeg-core.wasm")
    });
    controller.signal.throwIfAborted();
    const videoName = `video.${media.video.extension}`;
    await ffmpeg.writeFile(videoName, media.video.bytes);
    const args = ["-i", videoName];
    if (media.audio) {
      const audioName = `audio.${media.audio.extension}`;
      await ffmpeg.writeFile(audioName, media.audio.bytes);
      args.push("-i", audioName, "-map", "0:v:0", "-map", "1:a:0");
    } else args.push("-map", "0:v:0", "-map", "0:a?");
    args.push("-c", "copy", "-movflags", "+faststart", "output.mp4");
    const code = await ffmpeg.exec(args, 120_000);
    controller.signal.throwIfAborted();
    if (code !== 0) {
      console.error("Stream assembly failed", logs.join("\n"));
      throw new Error("These chunks could not be joined into an MP4. Try another video variant or Record while playing.");
    }
    const output = await ffmpeg.readFile("output.mp4");
    if (!output.length) throw new Error("The stream produced an empty file.");
    outputUrl = URL.createObjectURL(new Blob([output], { type: "video/mp4" }));
    $("save").href = outputUrl;
    $("save").download = name;
    $("save").hidden = false;
    $("progress").value = 100;
    $("detail").textContent = `${sizeText(output.length)} · MP4 · original video and audio quality`;
    try {
      downloadId = await chrome.downloads.download({ url: outputUrl, filename: name, conflictAction: "uniquify" });
      $("status").textContent = "File ready. Download started.";
    } catch (error) {
      $("status").textContent = "File ready. Click Save video again to save it.";
      $("detail").textContent += ` · ${error.message}`;
    }
  } catch (error) {
    $("status").className = "error";
    $("status").textContent = controller.signal.aborted ? "Download cancelled." : "Could not download this stream.";
    $("detail").textContent = controller.signal.aborted ? "You can retry the download below." : error.message;
    $("progress").value = 0;
    $("retry").hidden = false;
  } finally {
    ffmpeg?.terminate();
    ffmpeg = null;
    running = false;
    $("cancel").hidden = true;
  }
}
$("cancel").addEventListener("click", () => { controller?.abort(); ffmpeg?.terminate(); });
$("retry").addEventListener("click", run);
chrome.downloads.onChanged.addListener(change => {
  if (change.id !== downloadId) return;
  if (change.state?.current === "complete") $("status").textContent = "Video downloaded.";
  if (change.state?.current === "interrupted") {
    $("status").textContent = "Browser download interrupted. Click Save video again to retry.";
  }
});
window.addEventListener("beforeunload", event => {
  if (running) { event.preventDefault(); event.returnValue = ""; }
});
run();
