const FALLBACK_THUMB_SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#f8f3e7" />
        <stop offset="100%" stop-color="#dceced" />
      </linearGradient>
    </defs>
    <rect width="96" height="64" rx="10" fill="url(#g)" />
    <circle cx="32" cy="32" r="18" fill="rgba(11,108,116,0.16)" />
    <path d="M42 32 28 24v16z" fill="#0b6c74" />
    <text x="68" y="35" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="9" fill="#425056">Preview</text>
  </svg>`
)}`;

function previewPoster(label, start, end) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" rx="18" fill="url(#g)" />
      <circle cx="118" cy="90" r="38" fill="rgba(255,255,255,0.22)" />
      <path d="M132 90 102 72v36z" fill="#ffffff" />
      <text x="214" y="96" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="22" fill="#ffffff">${label}</text>
    </svg>`
  )}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function setStatus(text, tone = "info") {
  const el = document.getElementById("status");
  el.textContent = text;
  el.dataset.tone = tone;
  el.hidden = !text;
}

function setSummary(text) {
  const el = document.getElementById("summary");
  el.textContent = text;
  el.hidden = !text;
}

function humanType(mimeOrExt) {
  if (!mimeOrExt) return "Unknown type";

  const normalized = mimeOrExt.toLowerCase();
  const aliases = {
    mp4: "MP4",
    webm: "WebM",
    ogg: "Ogg",
    ogv: "Ogg Video",
    mov: "QuickTime",
    m4v: "M4V",
    mkv: "Matroska",
    m3u8: "HLS",
    mpd: "MPEG-DASH",
    "video/mp4": "MP4",
    "video/webm": "WebM",
    "video/ogg": "Ogg Video",
    "application/vnd.apple.mpegurl": "HLS",
    "application/x-mpegurl": "HLS",
    "application/dash+xml": "MPEG-DASH"
  };

  return aliases[normalized] || mimeOrExt;
}

function describeKind(item) {
  if (item.isBlob) return "Blob URL";
  if (item.isData) return "Data URL";
  if (item.isStream) return "Stream manifest";
  return "Direct file";
}

function displayOrigin(url) {
  if (!url || url.startsWith("blob:")) return "Page-generated";
  if (url.startsWith("data:")) return "Inline data";

  try {
    return new URL(url).hostname;
  } catch {
    return "Unknown origin";
  }
}

function renderItems(items, pageTitle) {
  const list = document.getElementById("results");
  const tpl = document.getElementById("itemTpl");
  list.innerHTML = "";

  if (!items.length) {
    setSummary("");
    setStatus("No obvious video links were found on this page.", "error");
    return;
  }

  setStatus("", "info");
  setSummary(`${items.length} link${items.length === 1 ? "" : "s"} found on ${pageTitle || "this page"}.`);

  for (const item of items) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    const thumb = li.querySelector(".thumb");
    const title = li.querySelector(".title");
    const kind = li.querySelector(".kind");
    const type = li.querySelector(".type");
    const origin = li.querySelector(".origin");
    const from = li.querySelector(".from");
    const note = li.querySelector(".note");
    const open = li.querySelector(".open");
    const copy = li.querySelector(".copy");

    thumb.src = item.poster || FALLBACK_THUMB_SVG;
    title.textContent = item.filename || item.url;
    kind.textContent = describeKind(item);
    type.textContent = humanType(item.type);
    origin.textContent = displayOrigin(item.url);
    from.textContent = `Found in ${item.from}`;
    note.textContent = item.note || "";
    note.hidden = !item.note;
    open.href = item.url;

    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.url);
        copy.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy link";
        }, 1000);
      } catch {
        copy.textContent = "Copy failed";
        window.setTimeout(() => {
          copy.textContent = "Copy link";
        }, 1200);
      }
    });

    list.appendChild(li);
  }
}

function getPreviewItems() {
  return [
    {
      url: "https://cdn.example.com/video/trailer.mp4",
      from: "video element",
      type: "video/mp4",
      filename: "trailer.mp4",
      poster: previewPoster("MP4", "#0b6c74", "#7fb8bd"),
      isBlob: false,
      isData: false,
      isStream: false,
      note: ""
    },
    {
      url: "https://stream.example.com/master.m3u8",
      from: "metadata",
      type: "m3u8",
      filename: "master.m3u8",
      poster: previewPoster("HLS", "#8b5e34", "#d8b38e"),
      isBlob: false,
      isData: false,
      isStream: true,
      note: "This is a playlist or manifest, not a single downloadable video file."
    },
    {
      url: "blob:https://example.com/4eaf7607-3e6a-4dcc-99c9-3b59c2fc0fd9",
      from: "page HTML",
      type: "",
      filename: "page-generated-video.txt",
      poster: previewPoster("Blob", "#4f5d75", "#98a7c0"),
      isBlob: true,
      isData: false,
      isStream: false,
      note: "Generated by the page. It may stop working after the tab reloads."
    }
  ];
}

function scanPageForVideos() {
  const VIDEO_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|m3u8|mpd)(?:[?#]|$)/i;
  const STREAM_EXTENSIONS = new Set(["m3u8", "mpd"]);
  const META_VIDEO_SELECTORS = [
    'meta[property="og:video"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video:secure_url"]',
    'meta[name="twitter:player:stream"]',
    'meta[itemprop="contentUrl"]'
  ];

  function absoluteUrl(url, base = document.baseURI) {
    if (!url) return null;

    try {
      return String(new URL(url, base));
    } catch {
      return null;
    }
  }

  function extensionFromUrl(url) {
    if (!url || url.startsWith("blob:") || url.startsWith("data:")) return "";

    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-z0-9]+)$/i);
      return match?.[1]?.toLowerCase() || "";
    } catch {
      return "";
    }
  }

  function normalizeType(type) {
    return (type || "").split(";")[0].trim().toLowerCase();
  }

  function safeFilename(url, fallback = "video-link") {
    if (!url || url.startsWith("blob:") || url.startsWith("data:")) return fallback;

    try {
      const pathBits = new URL(url).pathname.split("/").filter(Boolean);
      return decodeURIComponent(pathBits[pathBits.length - 1] || fallback);
    } catch {
      return fallback;
    }
  }

  function gatherFromVideoTags() {
    const items = [];
    const posters = new Map();

    document.querySelectorAll("video").forEach((video) => {
      const poster = absoluteUrl(video.getAttribute("poster"));
      const sources = [];

      if (video.currentSrc || video.src) {
        sources.push({
          url: video.currentSrc || video.src,
          type: normalizeType(video.getAttribute("type"))
        });
      }

      video.querySelectorAll("source").forEach((source) => {
        if (!source.src) return;
        sources.push({
          url: source.src,
          type: normalizeType(source.getAttribute("type"))
        });
      });

      sources.forEach((source) => {
        const url = absoluteUrl(source.url);
        if (!url) return;

        items.push({
          url,
          from: "video element",
          type: source.type || extensionFromUrl(url)
        });

        if (poster) posters.set(url, poster);
      });
    });

    return { items, posters };
  }

  function gatherFromLinks() {
    const items = [];

    document.querySelectorAll('a[href], link[as="video"][href]').forEach((node) => {
      const url = absoluteUrl(node.getAttribute("href"));
      if (!url || !VIDEO_EXT_RE.test(url)) return;

      items.push({
        url,
        from: node.tagName.toLowerCase() === "a" ? "page link" : "preload hint",
        type: extensionFromUrl(url)
      });
    });

    return items;
  }

  function gatherFromMetadata() {
    const items = [];

    META_VIDEO_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((meta) => {
        const url = absoluteUrl(meta.getAttribute("content"));
        if (!url) return;

        items.push({
          url,
          from: "metadata",
          type: normalizeType(meta.getAttribute("type")) || extensionFromUrl(url)
        });
      });
    });

    return items;
  }

  function gatherFromHTML() {
    const items = [];
    const seen = new Set();
    const html = document.documentElement?.outerHTML || "";
    const urlRe = /https?:\/\/[^\s"'<>]+/g;
    let match;

    while ((match = urlRe.exec(html)) !== null) {
      const url = match[0];
      if (!VIDEO_EXT_RE.test(url) || seen.has(url)) continue;
      seen.add(url);

      items.push({
        url,
        from: "page HTML",
        type: extensionFromUrl(url)
      });
    }

    return items;
  }

  function pagePosterFallback() {
    const ogImage = absoluteUrl(document.querySelector('meta[property="og:image"]')?.getAttribute("content"));
    if (ogImage) return ogImage;

    const imageSrc = absoluteUrl(document.querySelector('link[rel="image_src"]')?.getAttribute("href"));
    if (imageSrc) return imageSrc;

    return null;
  }

  const { items: videoItems, posters } = gatherFromVideoTags();
  const deduped = new Map();
  const pagePoster = pagePosterFallback();
  const pageName = document.title?.trim() || location.hostname || "this page";

  [...videoItems, ...gatherFromLinks(), ...gatherFromMetadata(), ...gatherFromHTML()].forEach((item) => {
    if (!item.url || deduped.has(item.url)) return;

    const ext = extensionFromUrl(item.url);
    const isBlob = item.url.startsWith("blob:");
    const isData = item.url.startsWith("data:");
    const isStream = STREAM_EXTENSIONS.has(ext);

    let note = "";
    if (isBlob) {
      note = "Generated by the page. It may stop working after the tab reloads.";
    } else if (isData) {
      note = "Embedded directly in the page rather than hosted as a reusable file.";
    } else if (isStream) {
      note = "This is a playlist or manifest, not a single downloadable video file.";
    }

    deduped.set(item.url, {
      ...item,
      type: item.type || ext,
      poster: posters.get(item.url) || pagePoster || null,
      filename: safeFilename(
        item.url,
        `${pageName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "video-link"}.${ext || "txt"}`
      ),
      isBlob,
      isData,
      isStream,
      note
    });
  });

  const items = Array.from(deduped.values()).sort((a, b) => {
    const rank = (item) => {
      if (item.isBlob || item.isData) return 2;
      if (item.isStream) return 1;
      return 0;
    };

    return rank(a) - rank(b) || a.filename.localeCompare(b.filename);
  });

  return {
    ok: true,
    pageTitle: pageName,
    items
  };
}

async function scan() {
  setSummary("");
  setStatus("Scanning...", "info");

  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("No active tab was found.", "error");
    return;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanPageForVideos
    });

    if (!result?.ok) {
      throw new Error("Scan failed");
    }

    renderItems(result.items || [], result.pageTitle);
  } catch {
    setSummary("");
    setStatus("Chrome blocked access to this page. Try a normal website tab instead.", "error");
  }
}

const isPreview = new URLSearchParams(window.location.search).get("preview") === "1";
const scanButton = document.getElementById("scanBtn");

if (isPreview) {
  const renderPreview = () => {
    setStatus("", "info");
    renderItems(getPreviewItems(), "Preview showcase");
  };

  scanButton.addEventListener("click", renderPreview);
  renderPreview();
} else {
  scanButton.addEventListener("click", scan);
  scan();
}
