// Runs before X's player starts. Only retain video variants, never API responses.
(() => {
  const key = Symbol.for("video-link-grabber.sources.v1");
  if (window[key]) return;
  const state = window[key] = { sources: [] };
  const mediaUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "video.twimg.com" ? url.href : null;
    } catch { return null; }
  };
  function add(entry) {
    const existing = state.sources.find(source => source.url === entry.url);
    if (existing) {
      if (entry.verified) Object.assign(existing, entry);
      return;
    }
    state.sources.push(entry);
    if (state.sources.length > 300) state.sources.shift();
  }
  function inspect(data) {
    const pending = [data];
    let visited = 0;
    while (pending.length && visited++ < 30000) {
      const node = pending.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node.video_info?.variants)) {
        for (const variant of node.video_info.variants) {
          const url = mediaUrl(variant.url);
          if (!url) continue;
          if (variant.content_type === "video/mp4" || /mpegurl/i.test(variant.content_type || "")) {
            add({ url, type: variant.content_type, bitrate: Number(variant.bitrate) || 0,
              poster: node.media_url_https || node.media_url || "", verified: true });
          }
        }
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") pending.push(value);
    }
  }
  const apiUrl = value => {
    try {
      const url = new URL(value, location.href);
      return /(^|\.)(x|twitter)\.com$/.test(url.hostname) &&
        /\/(?:i\/api|graphql|2\/timeline|1\.1)\//.test(url.pathname);
    } catch { return false; }
  };
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    const requestUrl = typeof args[0] === "string" || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    if (apiUrl(requestUrl)) promise.then(async response => {
      if (!response.ok || !/json/i.test(response.headers.get("content-type") || "")) return;
      const reader = response.clone().body?.getReader();
      if (!reader) return;
      try {
        let total = 0;
        const decoder = new TextDecoder();
        let json = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > 4 * 1024 * 1024) { await reader.cancel(); return; }
          json += decoder.decode(value, { stream: true });
        }
        inspect(JSON.parse(json + decoder.decode()));
      } finally { reader.releaseLock(); }
    }).catch(() => {});
    return promise;
  };
  const open = XMLHttpRequest.prototype.open;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    requests.set(this, apiUrl(url));
    return open.call(this, method, url, ...rest);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (requests.get(this)) this.addEventListener("load", () => {
      try {
        if (this.responseType === "json") inspect(this.response);
        else if ((!this.responseType || this.responseType === "text") && this.responseText.length < 4 * 1024 * 1024) {
          inspect(JSON.parse(this.responseText));
        }
      } catch { /* A non-JSON or changed API response should never affect the page. */ }
    }, { once: true });
    return send.apply(this, args);
  };
  // HLS is useful even if the API has changed or video metadata was already cached.
  const observe = entries => {
    for (const entry of entries) {
      const url = mediaUrl(entry.name);
      if (url && /\.m3u8(?:[?#]|$)/i.test(url)) add({ url, type: "application/x-mpegURL", verified: false });
    }
  };
  observe(performance.getEntriesByType("resource"));
  new PerformanceObserver(list => observe(list.getEntries())).observe({ type: "resource", buffered: true });
})();
