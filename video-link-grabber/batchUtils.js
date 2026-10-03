import { validateMediaItem, validateTabId } from "./mediaUtils.js";

export const MAX_BATCH_ITEMS = 100;

// Count players and their observed media URLs as one selection, even when the
// scan also exposes the underlying playlist as a separate network result.
export function prepareBatch(tabId, candidates) {
  validateTabId(tabId);
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > MAX_BATCH_ITEMS) {
    throw new Error(`Select between 1 and ${MAX_BATCH_ITEMS} videos.`);
  }
  const seen = new Set();
  const items = [];
  for (const candidate of candidates) {
    const item = validateMediaItem(candidate);
    if (item.recording) throw new Error("Stop recording before adding this video to a download queue.");
    if (!item.directUrl && !item.streamUrl && (!item.url || item.isManifest)) {
      throw new Error("This selection has no downloadable video source. Rescan and select available videos.");
    }
    const keys = [item.url, item.directUrl, item.streamUrl].filter(Boolean).map(url => `url:${url}`);
    if (item.videoId) keys.push(`player:${item.documentId}:${item.videoId}`);
    const duplicate = keys.some(key => seen.has(key));
    keys.forEach(key => seen.add(key));
    if (!duplicate) items.push(item);
  }
  const params = new URLSearchParams({ tabId: String(tabId), items: JSON.stringify(items) });
  if (params.toString().length > 1_500_000) throw new Error("These source links are too large for one queue. Select fewer videos.");
  return { tabId, items, fragment: params.toString() };
}
