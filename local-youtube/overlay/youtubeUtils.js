export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const MAX_YOUTUBE_ITEMS = 100;

export function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password &&
      (/^(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com)$/.test(url.hostname) || url.hostname === "youtu.be");
  } catch { return false; }
}

export function youtubeIdFromUrl(value) {
  if (!isYouTubeUrl(value)) return "";
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = url.hostname === "youtu.be" ? parts[0] : parts[0] === "watch" ? url.searchParams.get("v") :
    ["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : "";
  return YOUTUBE_ID.test(id || "") ? id : "";
}

export function validateYouTubeItem(value) {
  if (!value || value.platform !== "youtube" || !YOUTUBE_ID.test(value.youtubeId || "")) {
    throw new Error("This YouTube video is invalid. Rescan its page.");
  }
  if (value.url && youtubeIdFromUrl(value.url) !== value.youtubeId) throw new Error("The YouTube source does not match its video ID.");
  const title = String(value.title || value.filename || "YouTube video").normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().slice(0, 240) || "YouTube video";
  return {
    platform: "youtube", kind: "youtube", youtubeId: value.youtubeId,
    url: `https://www.youtube.com/watch?v=${value.youtubeId}`,
    title, filename: title, poster: `https://i.ytimg.com/vi/${value.youtubeId}/hqdefault.jpg`,
    type: "youtube", from: "YouTube", canRecord: false, recording: false,
  };
}

export function prepareYouTubeQueue(values) {
  if (!Array.isArray(values) || !values.length || values.length > MAX_YOUTUBE_ITEMS) throw new Error("Select between 1 and 100 YouTube videos.");
  const seen = new Set();
  return values.map(validateYouTubeItem).filter(item => {
    if (seen.has(item.youtubeId)) return false;
    seen.add(item.youtubeId);
    return true;
  });
}
