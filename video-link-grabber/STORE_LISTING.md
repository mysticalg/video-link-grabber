# Chrome Web Store release: 1.3.3

Item: `icobonlmbimjbaecjfiopapjgemjpepf`

## Description

Video Link Grabber finds video sources on the page you choose and helps you save the videos you are allowed to download.

Open the extension to scan video players, page links, metadata, and loaded media requests. View available thumbnails, file types, and sizes, then download or copy the source URL.

New in 1.3.3:
- Select individual videos or Select all, then download up to 100 videos in one queue tab.
- Use readable filenames from the video's post text, or its title and caption. Usernames and post-ID suffixes are omitted, and names appear beneath the thumbnail in a wider 520-pixel popup for easier reading.
- Follow each download, cancel the remaining queue, and retry unfinished items. The queue continues when the popup closes; keep the queue and original video page open.

Also included:
- Download ordinary blob video files from the page where they were created.
- Match supported X/Twitter players to their underlying video files or HLS playlists.
- Download finite, unencrypted HLS streams in chunks, including separate audio tracks, and join them locally into an MP4 without re-encoding.
- Follow stream downloads in a separate progress tab with cancellation and clear error messages.
- Optionally record compatible video playback from the current position when a downloadable source cannot be found.

On X, refresh the page after installing or updating, play the video, then open the extension and click Rescan. Use Download for a complete file or Download stream for a supported HLS source. Keep the stream progress tab open until the file is ready.

Media processing and filename generation stay on your device. The extension requests selected videos from their original hosting sites; it does not upload them to a conversion or AI service and has no advertising or analytics. An X/Twitter page script observes video metadata and media requests to identify the selected player's source. See the privacy policy for details.

Limits: HLS downloads support complete, unencrypted streams up to 512 MB. Live and discontinuous HLS streams and DASH assembly are not supported. Playback recording runs in real time, saves only the portion played after recording starts, and may change quality. DRM, paywall, authentication, and access-control bypass are not supported. Only save media you own or have permission to download.

## Permission justifications

- activeTab: identifies the tab the user explicitly selects to inspect or download videos.
- scripting: scans that page and accessible frames, resolves page-owned blob files, and starts or stops requested playback capture. The X/Twitter page script matches player blobs to observed video metadata and media URLs.
- downloads: saves selected direct files and locally assembled MP4s through Chrome's download manager and reports download completion or interruption.
- Host access: video pages and their file/CDN/audio/playlist hosts can be different domains. Host access is used to scan the selected page and accessible frames, inspect file headers, and fetch user-selected media segments from their original hosts. Automatic media-matching observation is restricted to X/Twitter pages.

## Privacy declarations

Website content and user activity (video-related network metadata) are processed locally as described in PRIVACY.md. The developer receives neither. No remote executable code, ads, analytics, unrelated data use, sale of user data, or credit/lending use is included.

Policy URL: https://github.com/mysticalg/video-link-grabber/blob/master/video-link-grabber/PRIVACY.md

## Reviewer testing

1. Install 1.3.3 and refresh an ordinary page containing downloadable videos. Open the popup and click Download, or select several checkboxes and Download selected. Close the popup and keep the queue tab open; downloads continue sequentially. Cancel remaining stops active/waiting jobs; Retry unfinished does not repeat completed files.
2. For an ordinary Blob fixture, the original video bytes are downloaded in the owning document rather than through the extension popup's origin.
3. On X/Twitter, refresh the page, play a video, then open the popup and click Rescan. The extension chooses an exact media asset match, not an arbitrary request from another video.
4. Choose a finite unencrypted HLS source to test Download stream. A progress tab downloads the initialization/media segments and any separate audio rendition, then uses packaged WebAssembly to remux MP4 locally. No remote JavaScript or WebAssembly is loaded.
5. Source-not-found, changed-player, expired-link, encrypted/live playlist, size-limit, and timeout cases display errors without claiming a completed download.
6. Filenames shown before download use each video's nearby post text, accessible label, caption or page title. Chrome adds a counter only when filenames collide; MP4 assembly always uses an MP4 filename. Naming requires no remote service.
