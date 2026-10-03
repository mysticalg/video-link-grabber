export const HOST_NAME = "com.video_link_grabber.youtube";
export const SETUP_HELP = "Use Download helper to run the Windows installer, then retry.";

export class YouTubeNativeClient {
  constructor({ runtime = globalThis.chrome?.runtime, handshakeMs = 10_000, cancelMs = 10_000 } = {}) {
    this.runtime = runtime;
    this.handshakeMs = handshakeMs;
    this.cancelMs = cancelMs;
    this.port = null;
    this.ready = null;
    this.pending = null;
    this.serial = 0;
  }

  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    const promise = this.ready;
    try {
      this.port = this.runtime.connectNative(HOST_NAME);
      this.onMessage = message => this.receive(message);
      this.onDisconnect = () => {
        const reason = this.runtime.lastError?.message;
        this.fail(new Error(`The YouTube helper disconnected${reason ? `: ${reason}` : "."} ${SETUP_HELP}`));
      };
      this.port.onMessage.addListener(this.onMessage);
      this.port.onDisconnect.addListener(this.onDisconnect);
      this.handshakeTimer = setTimeout(() => this.fail(new Error(`The YouTube helper did not respond. ${SETUP_HELP}`)), this.handshakeMs);
      this.port.postMessage({ cmd: "ping" });
    } catch (error) {
      this.fail(new Error(`Cannot start the YouTube helper. ${SETUP_HELP} ${error?.message || ""}`));
    }
    return promise;
  }

  receive(message) {
    if (!message || typeof message !== "object") return;
    if (message.event === "ready") {
      if (!this.resolveReady) return;
      if (message.protocol !== 1) { this.fail(new Error(`The helper version is incompatible. ${SETUP_HELP}`)); return; }
      clearTimeout(this.handshakeTimer);
      this.resolveReady({ version: String(message.version || ""), outputDir: String(message.outputDir || "") });
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (message.event === "error" && !message.requestId) {
      this.fail(new Error(`${String(message.error || "The helper is not ready.")} ${SETUP_HELP}`));
      return;
    }
    const pending = this.pending;
    if (!pending || message.requestId !== pending.requestId) return;
    if (message.event === "progress") {
      if (!["extracting", "downloading", "merging"].includes(message.phase)) return;
      const percent = typeof message.percent === "number" && Number.isFinite(message.percent) ? Math.min(100, Math.max(0, message.percent)) : null;
      pending.onProgress({ phase: message.phase, percent, title: typeof message.title === "string" ? message.title.slice(0, 500) : "" });
    } else if (message.event === "complete") {
      if (typeof message.filename !== "string" || !message.filename || typeof message.path !== "string" || !message.path) {
        this.finish(new Error("The helper reported a completed job without a saved filename. Check the output folder."));
      } else this.finish(null, { filename: message.filename, path: message.path });
    } else if (message.event === "cancelled") {
      this.finish(new DOMException("Download cancelled.", "AbortError"));
    } else if (message.event === "error") {
      this.finish(new Error(String(message.error || "The YouTube download failed.")));
    }
  }

  async download(videoId, { signal, onProgress = () => {} } = {}) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("Invalid YouTube video ID.");
    signal?.throwIfAborted();
    await this.connect();
    signal?.throwIfAborted();
    if (this.pending) throw new Error("Another video is already downloading.");
    const requestId = `video_${Date.now()}_${++this.serial}`;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        if (this.pending?.requestId !== requestId) return;
        try {
          this.cancelTimer = setTimeout(() => this.fail(new DOMException("The helper did not confirm cancellation. Its connection was closed.", "AbortError")), this.cancelMs);
          this.port.postMessage({ cmd: "cancel", requestId });
        } catch { this.fail(new DOMException("Download cancelled.", "AbortError")); }
      };
      this.pending = { requestId, resolve, reject, onProgress, signal, cancel };
      signal?.addEventListener("abort", cancel, { once: true });
      try { this.port.postMessage({ cmd: "download", requestId, videoId }); }
      catch (error) { this.fail(new Error(`Cannot contact the helper: ${error?.message || error}. ${SETUP_HELP}`)); }
    });
  }

  finish(error, result) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(this.cancelTimer);
    pending.signal?.removeEventListener("abort", pending.cancel);
    error ? pending.reject(error) : pending.resolve(result);
  }

  fail(error) {
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.cancelTimer);
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.ready = null;
    this.finish(error);
    const port = this.port;
    this.port = null;
    if (port) {
      port.onMessage.removeListener(this.onMessage);
      port.onDisconnect.removeListener(this.onDisconnect);
      try { port.disconnect(); } catch { /* already closed */ }
    }
  }

  close() { this.fail(new DOMException("The download queue was closed.", "AbortError")); }
}
