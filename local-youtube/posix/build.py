"""Build native packages on their target OS; invoked by the release workflow."""
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / "local-youtube"
VERSION = "1.5.0"
HOST = "com.video_link_grabber.youtube"
MAC = sys.platform == "darwin"
ARCH = "arm64" if platform.machine() in ("arm64", "aarch64") else "x64"
BUILD = ROOT / "build-posix"
OUT = ROOT / "dist-posix"


def run(*args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def write(path, text, executable=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    if executable:
        path.chmod(0o755)


def fetch(url, path):
    urllib.request.urlretrieve(url, path)


def build_extension(target):
    target.mkdir(parents=True)
    files = ["background.js", "contentScript.js", "pageObserver.js", "mediaUtils.js", "hls.js",
             "popup.html", "popup.css", "popup.js", "download.html", "download.css", "download.js",
             "streamDownload.js", "batch.html", "batch.css", "batch.js", "batchUtils.js"]
    source = ROOT / "video-link-grabber"
    for name in files:
        shutil.copy2(source / name, target / name)
    for name in ("assets", "vendor"):
        shutil.copytree(source / name, target / name)
    shutil.copytree(LOCAL / "overlay", target, dirs_exist_ok=True)
    manifest = json.loads((source / "manifest.json").read_text())
    manifest.update(name="Video Link Grabber Local", version=VERSION,
                    description="Save videos from X and other pages, plus YouTube videos using the local helper.",
                    key=json.loads((LOCAL / "identity.json").read_text())["key"])
    manifest["permissions"] = list(dict.fromkeys(manifest["permissions"] + ["nativeMessaging"]))
    manifest["action"]["default_title"] = "Video Link Grabber Local - YouTube enabled"
    write(target / "manifest.json", json.dumps(manifest, indent=2))
    # Existing Windows release remains untouched; only this package has generic instructions.
    for name in ("popup.html", "youtube.html", "youtube.js", "youtubeNative.js"):
        path = target / name
        text = path.read_text(encoding="utf-8")
        text = text.replace("Windows installer", "installer for your operating system")
        text = text.replace("<strong>Setup.exe</strong>", "<strong>the installer for your operating system</strong>")
        text = text.replace("The wizard can install missing tools.", "Required tools are included on macOS and Linux.")
        text = text.replace("The wizard offers to install missing tools.", "Required tools are included on macOS and Linux.")
        write(path, text)


def main():
    BUILD.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    tools = BUILD / "tools"
    tools.mkdir(exist_ok=True)
    # Latest patched Node 22 LTS, verified against the official release digest.
    releases = json.load(urllib.request.urlopen("https://nodejs.org/dist/index.json"))
    node_version = next(item["version"] for item in releases if item["version"].startswith("v22."))
    node_file = f"node-{node_version}-{'darwin' if MAC else 'linux'}-{ARCH}.tar.gz"
    base_url = f"https://nodejs.org/dist/{node_version}/"
    checksums = urllib.request.urlopen(base_url + "SHASUMS256.txt").read().decode()
    expected = next(line.split()[0] for line in checksums.splitlines() if line.split()[-1] == node_file)
    node_archive = BUILD / node_file
    fetch(base_url + node_file, node_archive)
    assert hashlib.sha256(node_archive.read_bytes()).hexdigest() == expected, "Node digest mismatch"
    with tarfile.open(node_archive) as archive:
        archive.extractall(BUILD / "node", filter="data")
    node_root = next((BUILD / "node").iterdir())
    shutil.copy2(node_root / "bin/node", tools / "node")
    # FFmpeg is built with no third-party codec libraries and no network access.
    # It remuxes the files already downloaded by yt-dlp; source is a release asset.
    for program in ("ffmpeg", "ffprobe"):
        shutil.copy2(BUILD / "ffmpeg" / program, tools / program)
    command = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
               "--name", "vlg-host", "--distpath", str(BUILD / "frozen"),
               "--workpath", str(BUILD / "pyinstaller"), "--specpath", str(BUILD),
               "--paths", str(LOCAL / "helper"), "--collect-all", "yt_dlp",
               "--collect-all", "yt_dlp_ejs", "--collect-all", "certifi"]
    for program in ("node", "ffmpeg", "ffprobe"):
        command += ["--add-binary", f"{tools / program}{os.pathsep}tools"]
    command += [str(LOCAL / "posix/entry.py")]
    run(*command)
    payload = BUILD / "payload"
    prefix = Path("/Library/Application Support/VideoLinkGrabberLocal" if MAC else "/opt/video-link-grabber-local")
    app = payload / str(prefix).lstrip("/")
    shutil.copytree(BUILD / "frozen/vlg-host", app / "helper")
    build_extension(app / "extension")
    write(app / "VERSION", VERSION + "\n")
    licenses = app / "licenses"
    licenses.mkdir()
    shutil.copy2(node_root / "LICENSE", licenses / "Node-LICENSE.txt")
    shutil.copy2(BUILD / "ffmpeg/COPYING.LGPLv2.1", licenses / "FFmpeg-LGPL-2.1.txt")
    shutil.copy2(BUILD / "ffmpeg-config.txt", licenses / "FFmpeg-build.txt")
    write(licenses / "README.txt", "Bundled Python, yt-dlp and dependencies retain their package license files in helper/_internal.\n"
          "FFmpeg 8.0.1: LGPL 2.1 or later, unmodified source and build recipe in this release.\n"
          "https://github.com/mysticalg/video-link-grabber/releases/tag/local-v1.5.0\n"
          f"Node.js {node_version}: https://nodejs.org/dist/{node_version}/\n"
          "PyInstaller bootloader: GPL with exception permitting bundled applications.\n")
    import importlib.metadata
    for package in ("yt-dlp", "yt-dlp-ejs", "certifi", "pyinstaller"):
        distribution = importlib.metadata.distribution(package)
        for file in distribution.files or []:
            if any(word in str(file).lower() for word in ("license", "copying")) and distribution.locate_file(file).is_file():
                dest = licenses / package / str(file).replace("../", "")
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(distribution.locate_file(file), dest)
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
    if python_license.exists():
        shutil.copy2(python_license, licenses / "Python-LICENSE.txt")
    manifest = dict(name=HOST, description="Video Link Grabber Local helper", path=str(prefix / "helper/vlg-host"),
                    type="stdio", allowed_origins=["chrome-extension://" + json.loads((LOCAL / "identity.json").read_text())["extensionId"] + "/"])
    locations = (["Library/Google/Chrome/NativeMessagingHosts", "Library/Application Support/Chromium/NativeMessagingHosts"]
                 if MAC else ["etc/opt/chrome/native-messaging-hosts", "etc/chromium/native-messaging-hosts"])
    for location in locations:
        write(payload / location / (HOST + ".json"), json.dumps(manifest, indent=2))
    write(app / "Setup.html", f'<!doctype html><meta charset="utf-8"><title>Video Link Grabber setup</title>'
          f'<h1>Finish in Chrome</h1><p>Open chrome://extensions, enable Developer mode, choose Load unpacked and select:</p>'
          f'<pre>{prefix}/extension</pre><p>The helper and its tools are installed. Downloads go to your Downloads/Video Link Grabber folder.</p>'
          f'<p><a href="https://mysticalg.github.io/video-link-grabber/local/#finish">Full setup instructions</a></p>')
    if MAC:
        # Treat private Python frameworks as package files, never relocatable system bundles.
        components = BUILD / "components.plist"
        components.write_bytes(plistlib.dumps([]))
        run("pkgbuild", "--root", payload, "--identifier", "com.video-link-grabber.local",
            "--component-plist", components,
            "--version", VERSION, "--install-location", "/", "--ownership", "recommended",
            OUT / f"Video-Link-Grabber-Local-{VERSION}-macOS-{ARCH}.pkg")
    else:
        write(payload / "usr/share/applications/video-link-grabber-local.desktop",
              '[Desktop Entry]\nType=Application\nName=Video Link Grabber Setup\n'
              'Exec=xdg-open /opt/video-link-grabber-local/Setup.html\nIcon=video-link-grabber-local\nTerminal=false\nCategories=AudioVideo;\n')
        icon = payload / "usr/share/icons/hicolor/256x256/apps/video-link-grabber-local.png"
        icon.parent.mkdir(parents=True)
        shutil.copy2(ROOT / "docs/assets/brand-mark.png", icon)
        write(payload / "DEBIAN/control", f"Package: video-link-grabber-local\nVersion: {VERSION}\nArchitecture: amd64\n"
              "Maintainer: Video Link Grabber <noreply@github.com>\nSection: video\nPriority: optional\n"
              "Depends: libc6 (>= 2.35), libstdc++6, zlib1g, xdg-utils\n"
              "Homepage: https://mysticalg.github.io/video-link-grabber/local/\n"
              "Description: Local video helper and Chrome extension\n Includes private runtime and media tools.\n")
        run("dpkg-deb", "--root-owner-group", "--build", payload, OUT / f"video-link-grabber-local-{VERSION}-linux-x64.deb")
        rpmroot = BUILD / "rpm"
        spec = rpmroot / "SPECS/vlg.spec"
        write(spec, f"Name: video-link-grabber-local\nVersion: {VERSION}\nRelease: 1\nSummary: Local video helper and Chrome extension\n"
              "License: LicenseRef-Proprietary and LGPL-2.1-or-later and Python-2.0 and Unlicense\n"
              "URL: https://github.com/mysticalg/video-link-grabber\nRequires: glibc >= 2.35, libstdc++, zlib, xdg-utils\n"
              "AutoReqProv: no\n%global __os_install_post %{nil}\n%global debug_package %{nil}\n"
              "%description\nIncludes private runtime and media tools.\n%install\n"
              f"mkdir -p %{{buildroot}}\ncp -a '{payload}/opt' '{payload}/etc' '{payload}/usr' %{{buildroot}}/\n"
              "%files\n/opt/video-link-grabber-local\n/etc/opt/chrome/native-messaging-hosts/*.json\n"
              "/etc/chromium/native-messaging-hosts/*.json\n/usr/share/applications/*.desktop\n/usr/share/icons/hicolor/256x256/apps/*.png\n")
        run("rpmbuild", "-bb", "--define", f"_topdir {rpmroot}", spec)
        shutil.copy2(next((rpmroot / "RPMS").rglob("*.rpm")), OUT / f"video-link-grabber-local-{VERSION}-linux-x64.rpm")
    write(OUT / f"components-{'macOS' if MAC else 'linux'}-{ARCH}.json", json.dumps({
        "version": VERSION, "node": node_version, "nodeSha256": expected, "ffmpeg": "8.0.1",
        "platform": platform.platform(), "python": sys.version}, indent=2))


if __name__ == "__main__":
    main()
