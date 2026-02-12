# Video Link Grabber (Chrome Extension, MV3)

Finds video URLs on the current page and lists them with thumbnails (when available), sizes (when retrievable), and direct links.

**Important:** This does **not** bypass DRM, paywalls, or protected streams. Only download content you own or have permission to download, and respect site Terms of Service.

## Features
- Detects video sources from `<video>` / `<source>`, anchors, and raw HTML.
- Shows poster/OG thumbnails if available.
- Attempts to look up file size via `HEAD` or a 0-byte `Range` request.
- Marks `blob:` URLs as not directly downloadable.
- Flags streaming manifests (`.m3u8` / `.mpd`) as not single-file videos.

## Install (Unpacked)
1. Download and unzip this folder.
2. In Chrome, open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the unzipped folder.
5. Pin the extension (optional), then click it on any page with videos.

## Notes
- Some servers block cross-origin `HEAD` or `Range` requests; sizes may show as “Unknown.”
- Cross-origin thumbnails may fail to load; a placeholder is shown instead.
- The `download` attribute on links may be ignored for cross-origin URLs, in which case the link will simply open in a new tab.