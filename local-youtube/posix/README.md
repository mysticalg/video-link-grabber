# macOS and Linux packages (Local 1.5.0)

The PKG, DEB and RPM installers contain the extension, a PyInstaller-bundled
Python helper, Node 22 LTS, pinned yt-dlp/EJS and an LGPL-only FFmpeg/FFprobe
build. No user Python, Node, pip, Homebrew or shell setup is needed.

Mac packages target macOS 14+ on Apple Silicon and macOS 15+ on Intel. They are
unsigned and not notarized. Linux packages target x86-64 with glibc 2.35+;
Snap/Flatpak browsers and Linux ARM are not supported by these packages.
Administrator approval installs the files and system-wide Chrome/Chromium
native-host manifests. Chrome runs the helper as the current user; it does
not run as root or provide a background network service.

## Install and use

Download the correct native installer from
https://mysticalg.github.io/video-link-grabber/local/ and open it in the OS
package installer. Then load the unpacked extension in Chrome:

- Mac: `/Library/Application Support/VideoLinkGrabberLocal/extension`
- Linux: `/opt/video-link-grabber-local/extension`

The fixed extension ID is `okjbebimalnjjaladdnpnjpjfmbjeefl`. It is the only
allowed native-messaging origin. A package upgrade keeps that identity; reload
the extension afterward. Close active queues before upgrading.

Downloads are per-user under `~/Downloads/Video Link Grabber`. Mac configuration
lives under `~/Library/Application Support/VideoLinkGrabberLocal`; Linux uses
`$XDG_CONFIG_HOME/VideoLinkGrabberLocal` (normally `~/.config`). Reinstallation
preserves a configured output folder. Installed tools are private and do not
replace system Python, Node or FFmpeg.

Linux removal uses the system package manager (`video-link-grabber-local`).
Mac package files reside in `/Library/Application Support/VideoLinkGrabberLocal`;
remove that folder and `com.video_link_grabber.youtube.json` from the Chrome and
Chromium system native-host directories to uninstall. Remove the Local entry
in Chrome on either OS. Saved downloads are deliberately retained.

## Build and verification

Run the `Build macOS and Linux installers` GitHub Actions workflow. It builds
on native Ubuntu, Apple Silicon and Intel Mac runners. Builds do not publish
releases automatically. Artifacts are uploaded only after regression tests,
actual package installation, framed native ping, frozen worker startup,
bundled-tool execution, MP4 video/audio remux, and a real Chromium native
messaging handshake pass.

FFmpeg's download is SHA-256 pinned. Node is obtained from the official Node
22 release listing and checked against its published SHA-256 manifest; the
resolved version/digest is recorded in each component manifest. The Node
binary, minimal FFmpeg executables, and Python runtime are collected by
PyInstaller for the runner's architecture. Mac PKG bundle relocation is disabled
so private Python frameworks cannot replace a system framework.

The bundled FFmpeg has networking and external codec libraries disabled. It
supports local MP4 remuxing/probing; yt-dlp handles media transfer. The release
must include the exact FFmpeg source tarball, build script/configuration and
SHA256SUMS alongside installers. License notices are installed with the app.
The extension's existing WebAssembly media tools retain their own notices.

These checks do not promise that every YouTube video will download. YouTube
availability and temporary HTTP errors remain subject to the same limitations
as the Windows helper. Windows 1.4.2 remains a separate, unchanged installer.
