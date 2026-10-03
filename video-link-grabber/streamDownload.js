import { collectHls } from "./hls.js";
import { FFmpeg } from "./vendor/ffmpeg/index.js";

// Shared by single and batch downloads. One assembly runs at a time per queue,
// and its WASM worker is always terminated before the next video starts.
export async function assembleStream(source, { signal, onProgress = () => {} } = {}) {
  let ffmpeg;
  const stop = () => ffmpeg?.terminate();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    signal?.throwIfAborted();
    const parsed = new URL(source);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Invalid stream URL. Rescan the original page.");
    onProgress({ phase: "playlist" });
    const media = await collectHls(source, { signal, onProgress });
    signal?.throwIfAborted();
    onProgress({ phase: "assemble", downloadedBytes: media.totalBytes });
    ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: chrome.runtime.getURL("vendor/core/ffmpeg-core.js"),
      wasmURL: chrome.runtime.getURL("vendor/core/ffmpeg-core.wasm"),
    });
    signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    if (code !== 0) throw new Error("These chunks could not be joined into an MP4. Try another source or Record while playing.");
    const output = await ffmpeg.readFile("output.mp4");
    if (!output.length) throw new Error("The stream produced an empty file.");
    return new Blob([output], { type: "video/mp4" });
  } finally {
    signal?.removeEventListener("abort", stop);
    ffmpeg?.terminate();
  }
}

// Install the listener before querying: a small file may finish before the
// downloads.download promise resolves. Only inspect this job's download ID.
export function waitForDownload(downloadId, { signal, chromeApi = chrome } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      chromeApi.downloads.onChanged.removeListener(changed);
      signal?.removeEventListener("abort", cancel);
      error ? reject(error) : resolve();
    };
    const changed = change => {
      if (change.id !== downloadId) return;
      if (change.state?.current === "complete") finish();
      if (change.state?.current === "interrupted") finish(new Error(`Download interrupted${change.error?.current ? `: ${change.error.current}` : "."}`));
    };
    const cancel = async () => {
      try { await chromeApi.downloads.cancel(downloadId); } catch { /* It may have just completed. */ }
      try {
        const items = await chromeApi.downloads.search({ id: downloadId });
        if (items[0]?.state === "complete") { finish(); return; }
      } catch { /* Cancellation still completes if the item was removed. */ }
      finish(new DOMException("Download cancelled.", "AbortError"));
    };
    chromeApi.downloads.onChanged.addListener(changed);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    chromeApi.downloads.search({ id: downloadId }).then(items => {
      if (!items.length) { finish(new Error("The browser no longer has this download. Check Chrome's downloads.")); return; }
      changed({ id: downloadId, state: { current: items[0].state }, error: { current: items[0].error } });
    }, error => finish(error));
  });
}
