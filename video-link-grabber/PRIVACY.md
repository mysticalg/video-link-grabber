# Privacy Policy for Video Link Grabber

Last updated: September 20, 2026

Video Link Grabber identifies video sources on web pages and lets you save supported files, page-owned blobs, and finite HLS streams. Compatible player playback can also be recorded when you explicitly start recording.

## Information processed on your device

When you open the popup or rescan, the extension reads video elements, source links, relevant page metadata and HTML, loaded media request URLs, and poster images in the selected page and accessible frames. It uses this information to display sources and match them to the correct player.

On X and Twitter pages, a page script starts when the page loads. It observes media request URLs and relevant video metadata from the site's existing responses so that page-generated blob players can be matched to their underlying video files or playlists. Responses are inspected transiently; only a bounded list of media URLs, poster URLs, content types, and bitrates is retained in that page's memory. Full API responses are not retained. This observer is not installed on other sites.

If you choose a download, the extension requests the selected media and, for supported HLS streams, its playlists, initialization data, video chunks, and audio chunks from the original hosting sites. Requests may include the browser's existing cookies where the browser permits them. Websites and CDNs receive ordinary network request information such as your IP address and the resource requested, as they do during playback. The extension does not extract or store your passwords or authentication cookies.

If you choose recording, the extension captures the selected video's rendered audio/video from the point recording starts. It does not request camera or microphone access. A visible page control lets you stop and save. Recording stops at playback end or the documented size/time limits.

## Sharing and remote services

The developer does not receive page contents, browsing history, media URLs, recordings, or downloaded files. The extension does not upload media to a conversion service. Media assembly uses locally packaged JavaScript and WebAssembly. There are no ads, analytics, tracking servers, or remotely loaded executable code.

The extension does not sell user data or use it for advertising, creditworthiness, lending, or purposes unrelated to finding and saving the media you select.

## Storage and retention

Scan metadata, source matches, and in-progress recordings are held temporarily in memory. Page metadata is cleared when the page closes or reloads; stream assembly data is released when its progress tab closes. Completed recording links expire after about ten minutes or can be dismissed sooner.

Downloaded files are saved where you or Chrome choose. They remain until you delete them. Chrome manages its normal download history. The extension does not maintain a separate persistent database of your browsing or downloads and does not synchronize results to cloud storage.

## Permissions

- `activeTab`: identifies the page you explicitly choose to scan.
- `scripting`: inspects that page and accessible frames, resolves blob URLs inside their owning document, and starts playback capture only when you request it.
- `downloads`: saves selected direct files and locally assembled media through Chrome's download manager and reports completion or interruption.
- Host access: scans the pages you select and fetches media from their hosting sites and CDNs, which may be on different domains. The automatic media-matching observer runs only on X/Twitter pages as described above.

The extension does not bypass DRM, paywalls, authentication, or access controls.

## Contact

Project: https://github.com/mysticalg/video-link-grabber

Support: https://github.com/mysticalg/video-link-grabber/issues
