// Serialized by chrome.scripting: all helpers must stay inside this function.
// Blob bytes and recording data stay in the owning document, never extension messages.
export async function pageAction(command, item = {}) {
  const key = Symbol.for("video-link-grabber.page.v2");
  const state = window[key] ||= { ids: new WeakMap(), nextId: 1, recording: null };
  const videoExt = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|m3u8|mpd)(?:[?#]|$)/i;
  const mimeExtensions = {
    "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
    "video/quicktime": "mov", "video/x-matroska": "mkv",
    "audio/webm": "webm", "application/vnd.apple.mpegurl": "m3u8",
    "application/x-mpegurl": "m3u8", "application/dash+xml": "mpd"
  };
  const roots = [document];
  for (let index = 0; index < roots.length; index++) {
    for (const element of roots[index].querySelectorAll("*")) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  const all = selector => roots.flatMap(root => [...root.querySelectorAll(selector)]);
  const videos = all("video");
  function idFor(video) {
    if (!state.ids.has(video)) state.ids.set(video, `video-${state.nextId++}`);
    return state.ids.get(video);
  }
  function absolute(value) {
    if (!value) return null;
    try {
      const url = new URL(value, document.baseURI);
      if (/^(https?:|blob:)$/.test(url.protocol) ||
          (url.protocol === "data:" && /^data:video\//i.test(url.href))) return url.href;
    } catch { /* Ignore malformed page URLs. */ }
    return null;
  }
  function filename(value, type = "") {
    let name = String(value || "video").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
      .replace(/[. ]+$/g, "").slice(0, 160) || "video";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    const ext = mimeExtensions[type.split(";")[0].trim().toLowerCase()];
    if (ext && !/\.[a-z0-9]{2,5}$/i.test(name)) name += `.${ext}`;
    return name;
  }
  function nameFor(url, videoId) {
    if (!url || /^(blob:|data:)/.test(url)) return videoId || "video";
    try { return filename(decodeURIComponent(new URL(url).pathname.split("/").pop())); }
    catch { return videoId || "video"; }
  }
  function canRecord(video) {
    return Boolean(video && !video.mediaKeys && typeof video.captureStream === "function" &&
      typeof MediaRecorder !== "undefined");
  }
  function isRecording(videoId) {
    return Boolean(state.recording?.videoId === videoId &&
      state.recording.recorder.state !== "inactive");
  }
  function sourceFor(media) {
    if (!media || !/(^|\.)(x|twitter)\.com$/.test(location.hostname)) return {};
    const assetId = value => String(value || "").match(/\/(?:ext_tw_video|amplify_video)(?:_thumb)?\/(\d+)\//)?.[1];
    const poster = media.poster || "";
    const asset = assetId(poster);
    if (!asset) return {};
    const sources = [...(window[Symbol.for("video-link-grabber.sources.v1")]?.sources || []),
      ...performance.getEntriesByType("resource").filter(entry => /\.m3u8(?:[?#]|$)/i.test(entry.name))
        .map(entry => ({ url: entry.name }))];
    const matching = sources.filter(source => {
      try {
        const url = new URL(source.url);
        return url.protocol === "https:" && url.hostname === "video.twimg.com" &&
          (assetId(source.url) === asset || assetId(source.poster) === asset);
      } catch { return false; }
    });
    // Only API variants establish that an MP4 is a complete file, not a media fragment.
    const direct = matching.filter(source => source.verified && source.type === "video/mp4")
      .sort((a, b) => b.bitrate - a.bitrate)[0];
    const streams = matching.filter(source => /\.m3u8(?:[?#]|$)/i.test(source.url) &&
      (source.verified || !/\/(?:avc1|mp4a|hev1|hvc1)\//.test(source.url)));
    streams.sort((a, b) => Number(Boolean(b.verified)) - Number(Boolean(a.verified)) ||
      Number(/\/(?:avc1|mp4a|hev1|hvc1)\//.test(a.url)) - Number(/\/(?:avc1|mp4a|hev1|hvc1)\//.test(b.url)));
    return { directUrl: direct?.url, streamUrl: streams[0]?.url };
  }
  function save(url, name) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = "none";
    (document.body || document.documentElement).append(anchor);
    anchor.click();
    anchor.remove();
  }
  const video = videos.find(candidate => idFor(candidate) === item.videoId);
  const ownsSource = candidate => candidate && (
    !item.url ? Boolean(candidate.srcObject) :
      candidate.currentSrc === item.url || candidate.src === item.url ||
      [...candidate.querySelectorAll("source")].some(source => source.src === item.url)
  );
  try {
    if (command === "SCAN") {
      const found = new Map();
      const pagePoster = absolute(document.querySelector('meta[property="og:image"]')?.content) ||
        absolute(document.querySelector('link[rel="image_src"]')?.href);
      function add(url, from, media = null, type = "", poster = null) {
        url = absolute(url);
        if (!url && !media?.srcObject) return;
        // X's codec-specific HLS children may contain only audio or only video.
        // Offer their parent master so separate tracks are downloaded together.
        if (url && !media) {
          const parsed = new URL(url);
          if (parsed.hostname === "video.twimg.com" && /\.m3u8$/i.test(parsed.pathname) &&
              /\/(?:avc1|mp4a|hev1|hvc1)\//.test(parsed.pathname)) return;
        }
        const videoId = media ? idFor(media) : null;
        const dedupeKey = url || videoId;
        if (found.has(dedupeKey)) return;
        found.set(dedupeKey, {
          url: url || "", videoId, from, type: type || url?.match(videoExt)?.[1] || "",
          poster: absolute(poster) || pagePoster, filename: nameFor(url, videoId),
          isBlob: Boolean(url?.startsWith("blob:")), isData: Boolean(url?.startsWith("data:")),
          isManifest: /\.(m3u8|mpd)(?:[?#]|$)/i.test(url || ""),
          canRecord: canRecord(media), recording: isRecording(videoId),
          ...sourceFor(media),
          ...(/\.m3u8(?:[?#]|$)/i.test(url || "") ? { streamUrl: url } : {}),
          kind: !url ? "stream" : undefined
        });
      }
      for (const media of videos) {
        const activeSource = [...media.querySelectorAll("source")].find(s => s.src === media.currentSrc);
        if (media.currentSrc) add(media.currentSrc, "video", media, activeSource?.type, media.poster);
        if (media.src) add(media.src, "video", media, "", media.poster);
        for (const source of media.querySelectorAll("source")) {
          if (source.src) add(source.src, "video/source", media, source.type, media.poster);
        }
        if (media.srcObject && !media.currentSrc) add(null, "live player", media, "", media.poster);
      }
      for (const anchor of all("a[href]")) {
        if (videoExt.test(anchor.href) || /^blob:/.test(anchor.href)) add(anchor.href, "link");
      }
      // Preserve metadata and preload discovery from the published 1.1 release.
      for (const meta of all('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"],meta[itemprop="contentUrl"]')) {
        add(meta.content, "metadata", null, meta.getAttribute("type") || "");
      }
      for (const link of all('link[as="video"][href]')) {
        if (videoExt.test(link.href) || /^video\//i.test(link.type)) add(link.href, "preload hint", null, link.type);
      }
      // Show observed requests separately; do not guess a clip URL from a blob UUID.
      for (const resource of performance.getEntriesByType("resource")) {
        if (videoExt.test(resource.name)) add(resource.name, "network (may be a segment)");
      }
      for (const match of (document.documentElement?.outerHTML || "").matchAll(/https?:\/\/[^\s"'<>]+/g)) {
        const url = match[0].replace(/&amp;/g, "&");
        if (videoExt.test(url)) add(url, "page HTML");
      }
      return { ok: true, items: [...found.values()].slice(0, 200) };
    }
    if (["STATUS", "INSPECT", "DOWNLOAD"].includes(command) && item.videoId && !ownsSource(video)) {
      return { ok: false, kind: "unavailable", recording: false, canRecord: false,
        error: "The player has changed. Rescan the page first." };
    }
    if (command === "STATUS") {
      return { ok: true, recording: isRecording(item.videoId), canRecord: canRecord(video), ...sourceFor(video) };
    }
    if (command === "INSPECT" || command === "DOWNLOAD") {
      if (command === "INSPECT" && (sourceFor(video).directUrl || sourceFor(video).streamUrl)) {
        return { ok: true, kind: "stream", ...sourceFor(video),
          canRecord: canRecord(video), recording: isRecording(item.videoId),
          message: "Underlying video source found." };
      }
      if (!item.url) return {
        ok: command === "INSPECT", kind: "stream", canRecord: canRecord(video), recording: isRecording(item.videoId),
        message: "Live player. Record while playing to save the part you watch."
      };
      const url = absolute(item.url);
      if (!url || !/^(blob:|data:)/.test(url)) throw new Error("Unsupported page download URL.");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let response;
      try {
        // Blob fetch supports GET, not HEAD. Only inspect metadata; do not read the body.
        response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Video is unavailable (${response.status}).`);
        const type = response.headers.get("content-type") || item.type || "";
        const length = response.headers.get("content-length");
        const size = length && /^\d+$/.test(length) ? Number(length) : null;
        const name = filename(item.filename || nameFor(url, item.videoId), type);
        if (command === "DOWNLOAD") save(url, name);
        return { ok: true, kind: "blob", type, size, filename: name,
          canRecord: canRecord(video), recording: isRecording(item.videoId),
          message: command === "DOWNLOAD" ? "Download requested. Check your browser downloads." : "Blob file · downloads from this page" };
      } catch {
        const recordable = canRecord(video) && ownsSource(video);
        return { ok: command === "INSPECT", kind: recordable ? "stream" : "unavailable",
          canRecord: recordable, recording: isRecording(item.videoId),
          error: recordable
            ? "This blob is a stream or has expired. Record while playing, or choose an underlying video link."
            : "This blob is no longer available. Play the video and rescan, or refresh the page." };
      } finally {
        if (response?.body) await response.body.cancel().catch(() => {});
        clearTimeout(timeout);
      }
    }
    if (command === "STOP_RECORDING") {
      const session = state.recording;
      if (!session || session.videoId !== item.videoId) return {
        ok: true, recording: false, message: "Recording has already stopped. Check the player page for the saved file."
      };
      session.stop("Recording saved.");
      await session.finished;
      return { ok: !session.error, recording: false, error: session.error, message: session.message };
    }
    if (command === "START_RECORDING") {
      if (!video || !ownsSource(video)) throw new Error("The player has changed. Rescan the page first.");
      if (video.mediaKeys) throw new Error("Protected video cannot be recorded.");
      if (!canRecord(video)) throw new Error("This browser or player does not support recording.");
      if (state.recording) throw new Error("Stop the current recording on this page first.");
      if (video.paused || video.ended || video.readyState < 2) {
        throw new Error("Start playing the video on the page, then click Record while playing.");
      }
      let stream;
      let recorder;
      try {
        stream = video.captureStream();
        if (!stream.getVideoTracks().length) throw new Error("No video track yet. Let it play, then try again.");
        const type = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
          .find(value => MediaRecorder.isTypeSupported(value));
        if (!type) throw new Error("No supported recording format is available.");
        recorder = new MediaRecorder(stream, { mimeType: type });
      } catch (error) {
        stream?.getTracks().forEach(track => track.stop());
        throw error;
      }
      const host = document.createElement("div");
      host.style.cssText = "position:fixed!important;bottom:16px!important;right:16px!important;z-index:2147483647!important;max-width:360px!important;";
      const shadow = host.attachShadow({ mode: "closed" });
      const panel = document.createElement("div");
      panel.style.cssText = "font:14px/1.5 system-ui;padding:16px;border-radius:12px;background:#172033;color:white;box-shadow:0 4px 24px #0006";
      const label = document.createElement("div");
      label.textContent = "Video Link Grabber · Recording playback";
      const note = document.createElement("div");
      note.style.cssText = "font-size:12px;margin:6px 0;color:#d1d9e6";
      note.textContent = "Keep this page open. Saves from the point you started recording.";
      const stopButton = document.createElement("button");
      stopButton.textContent = "Stop & save";
      stopButton.style.cssText = "font:inherit;padding:6px 12px;cursor:pointer;border:0;border-radius:6px;background:white;color:#172033";
      panel.append(label, note, stopButton);
      shadow.append(panel);
      document.documentElement.append(host);
      const chunks = [];
      let resolveFinished;
      const session = {
        videoId: item.videoId, recorder, size: 0, message: "Recording saved.",
        finished: new Promise(resolve => { resolveFinished = resolve; }),
        stop(message) {
          session.message = message;
          if (recorder.state !== "inactive") recorder.stop();
        }
      };
      state.recording = session;
      const stopEnded = () => session.stop("Playback ended. Recording saved.");
      const stopChanged = () => session.stop("The player source changed. Partial recording saved.");
      const stopProtected = () => { session.error = "Protected playback cannot be recorded."; session.stop(session.error); };
      const pause = () => {
        if (recorder.state === "recording") recorder.pause();
        label.textContent = "Recording paused · resume playback to continue";
      };
      const resume = () => {
        if (recorder.state === "paused") recorder.resume();
        label.textContent = "Video Link Grabber · Recording playback";
      };
      const events = { ended: stopEnded, emptied: stopChanged, encrypted: stopProtected, pause, playing: resume };
      for (const [event, handler] of Object.entries(events)) video.addEventListener(event, handler);
      stopButton.addEventListener("click", () => session.stop("Recording saved."));
      const timer = setTimeout(() => session.stop("30-minute limit reached. Partial recording saved."), 30 * 60 * 1000);
      recorder.addEventListener("dataavailable", event => {
        if (!event.data.size) return;
        chunks.push(event.data);
        session.size += event.data.size;
        if (session.size >= 512 * 1024 * 1024) session.stop("512 MB limit reached. Partial recording saved.");
      });
      recorder.addEventListener("error", event => {
        session.error = event.error?.message || "Recording failed.";
        session.stop(session.error);
      });
      recorder.addEventListener("stop", () => {
        clearTimeout(timer);
        for (const [event, handler] of Object.entries(events)) video.removeEventListener(event, handler);
        stream.getTracks().forEach(track => track.stop());
        state.recording = null;
        stopButton.remove();
        label.textContent = session.error || session.message;
        let downloadUrl;
        if (chunks.length && !session.error) {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          downloadUrl = URL.createObjectURL(blob);
          const name = filename(`${(item.filename || "video").replace(/\.[a-z0-9]{2,5}$/i, "")}-recording`, recorder.mimeType);
          const download = document.createElement("a");
          download.href = downloadUrl;
          download.download = name;
          download.textContent = "Save recording again";
          download.style.cssText = "color:#b6d7ff;display:block;margin:8px 0";
          panel.append(download);
          note.textContent = "Check browser downloads. If no file appeared, use Save recording again.";
          save(downloadUrl, name);
        } else if (!session.error) {
          session.error = "No video data was recorded. Play the video longer and try again.";
          label.textContent = session.error;
        }
        chunks.length = 0;
        const dismiss = document.createElement("button");
        dismiss.textContent = "Dismiss";
        dismiss.style.cssText = stopButton.style.cssText;
        const cleanup = () => {
          host.remove();
          if (downloadUrl) setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
        };
        dismiss.addEventListener("click", cleanup, { once: true });
        panel.append(dismiss);
        setTimeout(cleanup, 10 * 60 * 1000);
        resolveFinished();
      }, { once: true });
      try { recorder.start(1000); }
      catch (error) {
        clearTimeout(timer);
        for (const [event, handler] of Object.entries(events)) video.removeEventListener(event, handler);
        stream.getTracks().forEach(track => track.stop());
        state.recording = null;
        host.remove();
        throw error;
      }
      return { ok: true, recording: true,
        message: "Recording from the current position. Keep the page open; use Stop & save here or on the page." };
    }
    throw new Error("Unknown page action.");
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
