# Video Link Grabber

A Chrome Manifest V3 extension that finds video sources, downloads ordinary files and file-backed blobs, and downloads supported HLS streams by joining their media chunks into an MP4. Playback recording is an optional fallback.

## Install or update

1. Use Chrome 111 or later. Open `chrome://extensions` and turn on **Developer mode**.
2. For a new installation, click **Load unpacked** and select this `video-link-grabber` folder (the folder containing `manifest.json`).
3. If the extension is already installed from this folder, click its **Reload** button on `chrome://extensions`.
4. **Refresh the page containing the video** after installing or reloading the extension, then start playing the video.
5. Open Video Link Grabber and click **Rescan** when needed.

## Download videos on X

1. Open the post on `x.com` and play the video so the browser loads its media sources.
2. Open the extension and click **Rescan**. Newly loaded sources may appear after the video has played for a moment.
3. Use **Download** on a direct MP4 or other video file when one is found. The extension also checks resource timing entries for media requests.
4. A `blob:` address can represent either a complete file or an ongoing media stream. A file-backed blob is downloaded from its own page, where the address is accessible.
5. For a matched HLS source, use **Download stream**. A progress tab downloads the video and audio chunks and remuxes them into an MP4 without re-encoding. Keep that progress tab open until the file is ready; you can close the popup.
6. If a blob has no matched source, play the video and scan again. After an extension reload, refresh X first so the extension can observe the media requests.

### Optional playback recording

If recording is available, **Record while playing** captures playback from the video's **current position**, runs in real time, and saves a WebM file. To capture the whole video, seek to the start and start playback before recording. This fallback re-encodes the video and can change quality.

Keep the video page open and the video playing. Use **Stop & save** in the popup or the recording control on the page to save the captured portion. Recording also stops when playback ends. Closing the extension popup does not stop an active recording.

## Features

- Finds video elements, source elements, video links, media URLs in HTML, and loaded media requests.
- Supports direct downloads with the browser's downloads API.
- Reads and downloads file-backed `blob:` URLs inside the frame that created them.
- Matches X player blobs to discovered media sources and supports finite, unencrypted HLS video downloads, including byte ranges and separate audio tracks.
- Downloads stream chunks and remuxes them locally into MP4 using bundled FFmpeg, preserving the encoded audio and video quality.
- Offers playback recording for compatible streams, with explicit start and stop controls.
- Shows file types, available sizes, thumbnail previews, and per-source errors.
- Limits concurrent source checks and ignores old scan results when rescanning.

## Limits

- Playback recording is re-encoded and is **not an original-quality download**. It captures only what plays after recording starts, and can include stalls or missing audio if the player or browser cannot capture its tracks. A paused video does not provide continuing playback to record.
- Streaming or expired blobs cannot be fetched as complete files. Recording availability depends on the player and browser. If a source is unavailable, refresh the page, play the video, and scan again.
- Stream downloads support finite, unencrypted HLS videos up to 512 MB of source media. Live, encrypted, and discontinuous playlists are unsupported. Large downloads need enough memory for the media and the MP4 output.
- Playback recording automatically saves at the end of playback, after 30 minutes, or after about 512 MB. A looping video can be stopped manually with **Stop & save**.
- DASH (`.mpd`) stream assembly is not supported. **Save playlist** saves a manifest only, not the video it describes.
- Videos not yet loaded, expired URLs, browser settings pages, and other restricted pages may be unavailable. Some servers block size lookups or thumbnails.
- DRM and protected playback are not supported. Only save content you own or have permission to download.

## Why the old blob downloads failed

A `blob:` URL is a browser-local reference owned by the page that created it. Sending it through a normal link in an extension popup can produce a failed browser download. The extension now resolves ordinary blobs in their originating page. For stream-backed blobs, it discovers the underlying media URL and downloads supported HLS chunks instead. Playback recording remains a separate fallback when a downloadable source cannot be found.

## Development

Run `npm test` in this folder with Node.js 20 or later. No npm packages need to be installed to run the regression tests or load the extension.

The packaged FFmpeg core adds about 31 MB to the unpacked extension. It runs locally; media is not uploaded to a conversion service. Versions, licenses, source links, and hashes are in [vendor/NOTICE.md](vendor/NOTICE.md).
