// popup.js
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function setStatus(text) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.style.display = text ? "block" : "none";
}

function humanType(mimeOrExt) {
  if (!mimeOrExt) return "";
  const map = { mp4: "MP4", webm: "WebM", ogg: "Ogg", ogv: "Ogg", mov: "QuickTime", m4v:"M4V", mkv:"Matroska", m3u8:"HLS", mpd:"MPEG-DASH" };
  return map[mimeOrExt.toLowerCase()] || mimeOrExt;
}

async function probe(url) {
  return await chrome.runtime.sendMessage({ cmd: "PROBE_HEADERS", url });
}

function renderItems(items) {
  const list = document.getElementById("results");
  list.innerHTML = "";
  const tpl = document.getElementById("itemTpl");
  if (!items.length) {
    setStatus("No obvious video links were found on this page.");
    return;
  }
  setStatus("");
  for (const it of items) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    const thumb = li.querySelector(".thumb");
    const title = li.querySelector(".title");
    const from = li.querySelector(".from");
    const type = li.querySelector(".type");
    const size = li.querySelector(".size");
    const aDownload = li.querySelector(".download");
    const aOpen = li.querySelector(".open");
    const btnCopy = li.querySelector(".copy");

    // thumbnail (fallback if cross-origin blocks loading)
    const fallbackSVG = `data:image/svg+xml;charset=utf-8,` + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='64'><rect width='100%' height='100%' fill='#e9e9e9'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-size='10' fill='#777'>No preview</text></svg>`
    );
    thumb.src = it.poster || fallbackSVG;

    title.textContent = it.filename;
    from.textContent = `from: ${it.from}${it.isBlob ? " (blob: not directly downloadable)" : it.isData ? " (data: URL)" : ""}`;
    type.textContent = humanType(it.type);

    aDownload.href = it.url;
    aDownload.download = it.filename; // may be ignored cross-origin, but helps when allowed
    aOpen.href = it.url;

    btnCopy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(it.url); btnCopy.textContent = "Copied!"; setTimeout(()=>btnCopy.textContent="Copy URL", 1000); }
      catch { btnCopy.textContent = "Failed"; setTimeout(()=>btnCopy.textContent="Copy URL", 1000); }
    });

    // Probe for size & better type
    probe(it.url).then(info => {
      if (info?.type && !/m3u8|mpd/i.test(it.type || "")) {
        type.textContent = info.type.split(";")[0] || type.textContent;
      }
      size.textContent = (info?.sizeHuman && info.sizeHuman !== "Unknown") ? `• ${info.sizeHuman}` : "";
    });

    list.appendChild(li);
  }
}

async function scan() {
  setStatus("Scanning…");
  const tabId = await getActiveTabId();
  if (!tabId) {
    setStatus("No active tab found.");
    return;
  }
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { cmd: "SCAN_FOR_VIDEOS" });
    if (!resp?.ok) throw new Error("Scan failed");
    renderItems(resp.items);
  } catch (e) {
    // Possibly the page is a restricted URL (chrome://, Chrome Web Store, PDF viewer, etc.)
    setStatus("Cannot scan this page (restricted or no access). Try another tab.");
  }
}

document.getElementById("scanBtn").addEventListener("click", scan);
scan();