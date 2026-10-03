# Video Link Grabber Local 1.4.2

[Download the Windows installer and read setup instructions](https://mysticalg.github.io/video-link-grabber/local/).

This separate Local edition adds YouTube downloads using a native Windows helper. It also supports X, ordinary videos, page-owned blobs, supported HLS streams, multiple selections and readable filenames. The Chrome Web Store edition is separate and does not use this helper.

## Install once

1. Download **Video-Link-Grabber-Local-1.4.2-Setup.exe** from the linked page and run it. Close active download queues first.
2. Follow the wizard. It installs the helper and extension files in your account. It can install missing Python 3.10+, Node.js 22+ and FFmpeg/FFprobe through Windows Package Manager (WinGet), with your selection in the wizard. Windows may request administrator approval for a dependency. Internet access is required.
3. If you already use **Video Link Grabber Local**, reload it in Chrome. For a new installation, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and enter `%LOCALAPPDATA%\VideoLinkGrabberLocal\extension`. Chrome requires you to perform this step yourself. The Store edition cannot be turned into the Local edition by installing the helper alone.
4. Open a video, click the Local extension, then **Download**. Use **Download selected** for multiple videos. Keep the queue tab open until it finishes.

If updating an older unpacked Local extension loaded from a different folder, replace its files with the new ZIP's `extension` contents and reload it, or remove that Local entry and load the folder installed by Setup. The public manifest key preserves extension ID `okjbebimalnjjaladdnpnjpjfmbjeefl`.

The popup should say **Video Link Grabber Local**, **v1.4.2**, and **YouTube helper ready**. Missing-helper messages include a download/setup link. The installer is currently unsigned; no verified publisher or automatic browser installation is claimed. Do not disable Windows security protections to install it.

## What setup installs

The helper and private Python packages are stored in `%LOCALAPPDATA%\VideoLinkGrabberLocal`. Only the fixed Local extension ID is allowed to connect. A registry entry under your current Windows account registers the native helper. No browser profile files are edited.

The optional dependency step obtains Python (`Python.Python.3.14`), Node.js (`OpenJS.NodeJS.LTS`) and FFmpeg (`Gyan.FFmpeg`) from WinGet. Choosing this option accepts the package/source agreements listed in the wizard. Compatible existing tools are reused. These separate tools remain installed after removing the helper. The helper downloads pinned yt-dlp Python dependencies from PyPI. The setup scripts use an execution-policy override only for their own process; they do not change the computer's PowerShell policy.

If WinGet is unavailable, install Microsoft's [App Installer](https://learn.microsoft.com/windows/package-manager/winget/), or install [Python](https://www.python.org/downloads/windows/), [Node.js](https://nodejs.org/en/download/) and [FFmpeg/FFprobe](https://www.gyan.dev/ffmpeg/builds/) manually. Then rerun Setup. Advanced users can run the ZIP's `Install helper.ps1` with explicit `-PythonPath`, `-NodePath` and `-FfmpegPath` arguments. FFprobe must be beside FFmpeg. The ZIP's `Install helper.cmd` provides a repair/setup launcher.

## Downloads and troubleshooting

Videos are saved in **Downloads\Video Link Grabber**, respecting the Windows Downloads folder location. The queue shows the exact saved path. Helper downloads do not appear in Chrome's download history. Names use the title without adding a username or video ID; collisions get `(1)`, `(2)`, etc.

- Select up to 100 visible videos; the queue runs one at a time. Closing the queue cancels active work. Retry unfinished does not repeat successful items.
- Video and audio are joined locally into MP4. Limits are 1080p, two hours, 2 GB and a 30-minute job timeout.
- Only finite public/unlisted videos with supported ordinary formats are accepted. Login-required, private, membership-only, live and DRM-protected videos are unsupported. No browser cookies or account tokens are imported.
- For a temporary HTTP 403, try **Retry unfinished**. If it persists, the media may be unavailable or the downloader may need an update; success is not guaranteed.
- Use **Repair helper** from the Start menu after a dependency is moved or removed. If setup fails, it reports failure rather than claiming the helper is ready.

## Remove

Use **Windows Settings → Apps → Video Link Grabber Local → Uninstall**. Remove the Local extension separately at `chrome://extensions`. Downloaded videos and separately installed Python, Node.js and FFmpeg are kept. ZIP users can run `Uninstall helper.ps1` to remove only the helper registration.

## Privacy and licenses

Selected YouTube IDs go to the helper on this PC. It contacts YouTube and media hosts and saves files locally. No telemetry, ads, intermediary download service, cookie import or AI naming service is included. Clicking setup links opens GitHub; the links contain no video IDs or download history. Only save content you own or have permission to download.

This edition is distributed outside the Chrome Web Store. Chrome's [review guidance](https://developer.chrome.com/docs/webstore/troubleshooting#prohibited-products) lists facilitating YouTube downloads as a rejection reason.

yt-dlp uses the [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE); dependencies keep their own notices. The browser's bundled FFmpeg notices and corresponding-source link are in `extension/vendor/NOTICE.md`. Native FFmpeg is obtained separately through WinGet or the user and is not bundled in Setup.

## Build from source

Run `Build local.ps1` to generate `extension` from the base source and local overlays. `Package local.ps1` produces the ZIP. `Build installer.ps1` requires Inno Setup 6 and produces Setup.exe. Packages exclude tests, downloaded Python dependencies, configuration, credentials and development logs. Run `node --test local-youtube/tests/extension.test.mjs` and `python -m unittest discover -s local-youtube/helper/tests` from the repository root.