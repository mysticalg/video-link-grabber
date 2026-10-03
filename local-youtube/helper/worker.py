"""One isolated yt-dlp job. Its parent owns process-tree cancellation."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (HelperError, MAX_DURATION_SECONDS, MAX_MEDIA_BYTES, MAX_OUTPUT_BYTES,
                    cleanup_workdir, load_config, validate_message)


def send(event):
    raw = json.dumps(event, ensure_ascii=True, separators=(",", ":")).encode("ascii")
    if len(raw) > MAX_OUTPUT_BYTES:
        raise HelperError("Worker response exceeded its size limit.", "protocol_error")
    sys.stdout.buffer.write(raw + b"\n")
    sys.stdout.buffer.flush()


def validate_info(info):
    if not isinstance(info, dict) or info.get("_type", "video") != "video":
        raise HelperError("Only one YouTube video can be downloaded at a time.", "unsupported_video")
    if info.get("availability") not in (None, "public", "unlisted") or (info.get("age_limit") or 0) > 0:
        raise HelperError("This video requires restricted or authenticated access.", "restricted_video")
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming", "post_live"):
        raise HelperError("Only completed videos are supported; this video is still live or processing.", "unsupported_live")
    duration = info.get("duration")
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not math.isfinite(duration) or duration <= 0:
        raise HelperError("The video does not have a known finite duration.", "unsupported_video")
    if duration > MAX_DURATION_SECONDS:
        raise HelperError("This video exceeds the two-hour download limit.", "size_limit")
    formats = info.get("requested_formats") or [info]
    if info.get("has_drm") or any(part.get("has_drm") for part in formats):
        raise HelperError("Protected video cannot be downloaded.", "protected_video")
    sizes = [part.get("filesize") or part.get("filesize_approx") or 0 for part in formats]
    if any(not isinstance(size, (int, float)) or not math.isfinite(size) or size < 0 for size in sizes):
        raise HelperError("The video reported an invalid size.", "unsupported_video")
    if sum(sizes) > MAX_MEDIA_BYTES:
        raise HelperError("This video exceeds the 2 GB download limit.", "size_limit")


class SilentLogger:
    def debug(self, _message): pass
    def warning(self, _message): pass
    def error(self, _message): pass


def verify_mp4(path, config):
    args = [config["ffprobePath"], "-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type", "-of", "json", str(path)]
    result = subprocess.run(args, capture_output=True, timeout=30, check=False,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode != 0 or len(result.stdout) > 65536:
        raise HelperError("The downloaded video could not be verified.", "invalid_output")
    try:
        data = json.loads(result.stdout)
        kinds = {stream.get("codec_type") for stream in data.get("streams", [])}
        formats = data.get("format", {}).get("format_name", "").split(",")
        duration = float(data.get("format", {}).get("duration", "nan"))
        if not {"video", "audio"}.issubset(kinds) or "mp4" not in formats or not 0 < duration <= MAX_DURATION_SECONDS + 5:
            raise ValueError("Expected a finite MP4 with video and audio")
    except (ValueError, TypeError, AttributeError) as error:
        raise HelperError("The result is not a complete MP4 with video and audio.", "invalid_output") from error


def run_job(request_id, video_id, config, workdir):
    sys.path.insert(0, config["runtimePath"])
    os.environ["YTDLP_NO_PLUGINS"] = "1"
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.globals import plugin_dirs
        plugin_dirs.value = []
    except ImportError as error:
        raise HelperError("The app-private yt-dlp installation is incomplete. Run the installer again.", "setup_required") from error
    output = Path(config["outputDir"])
    output.mkdir(parents=True, exist_ok=True)
    workdir = Path(workdir)
    if workdir.is_symlink() or workdir.parent.resolve() != output.resolve() or not workdir.name.startswith(".vlg-youtube-") or not workdir.is_dir():
        raise HelperError("The download temporary folder is invalid.", "unsafe_path")
    title = ""
    last_progress = 0.0
    last_percent = 0.0
    downloaded = {}
    expected = {}

    def emit_progress(phase, percent=None):
        event = {"event": "progress", "requestId": request_id, "phase": phase, "percent": percent}
        if title:
            event["title"] = str(title)[:300]
        send(event)

    def progress(hook):
        nonlocal last_progress, last_percent
        if hook.get("status") not in ("downloading", "finished"):
            return
        key = str(hook.get("info_dict", {}).get("format_id") or hook.get("filename", "media"))
        downloaded[key] = max(0, hook.get("downloaded_bytes") or 0)
        if sum(downloaded.values()) > MAX_MEDIA_BYTES:
            raise HelperError("This video exceeds the 2 GB download limit.", "size_limit")
        now = time.monotonic()
        if hook.get("status") == "downloading" and now - last_progress < 0.25:
            return
        last_progress = now
        total = hook.get("total_bytes") or hook.get("total_bytes_estimate")
        if total and total > 0:
            expected[key] = total
        percent = None
        if expected and all(value and value > 0 for value in expected.values()):
            percent = round(min(99.9, max(last_percent, sum(downloaded.values()) / sum(expected.values()) * 100)), 1)
            last_percent = percent
        emit_progress("downloading", percent)

    def postprocess(hook):
        if hook.get("status") in ("started", "processing"):
            emit_progress("merging")

    options = {
        "quiet": True, "no_warnings": True, "noprogress": True, "logger": SilentLogger(),
        "noplaylist": True, "playlist_items": "1", "cachedir": False, "plugin_dirs": [],
        "cookiefile": None, "cookiesfrombrowser": None, "usenetrc": False,
        "js_runtimes": {"node": {"path": config["nodePath"]}}, "remote_components": set(),
        "ffmpeg_location": config["ffmpegPath"], "outtmpl": str(workdir / "media.%(ext)s"),
        "format": "bv[height<=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/b[height<=1080][ext=mp4][vcodec^=avc1][acodec^=mp4a]/bv[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]",
        "merge_output_format": "mp4", "max_filesize": MAX_MEDIA_BYTES,
        "socket_timeout": 30, "retries": 3, "fragment_retries": 3, "concurrent_fragment_downloads": 1,
        "progress_hooks": [progress], "postprocessor_hooks": [postprocess],
        "overwrites": False, "continuedl": False, "writethumbnail": False, "writeinfojson": False,
        "writesubtitles": False, "writeautomaticsub": False, "allow_unplayable_formats": False,
    }
    try:
        emit_progress("extracting")
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            validate_info(info)
            title = str(info.get("title") or "Video")[:300]
            for part in info.get("requested_formats") or [info]:
                expected[str(part.get("format_id") or "media")] = part.get("filesize") or part.get("filesize_approx")
            emit_progress("downloading", 0)
            downloader.process_ie_result(info, download=True)
        result = workdir / "media.mp4"
        if not result.is_file() or result.stat().st_size == 0:
            raise HelperError("No complete MP4 was produced. This video's available formats may not be supported.", "missing_output")
        if result.stat().st_size > MAX_MEDIA_BYTES:
            raise HelperError("This video exceeds the 2 GB download limit.", "size_limit")
        emit_progress("merging")
        verify_mp4(result, config)
        # The host commits this verified file only after a successful worker exit.
        send({"event": "prepared", "requestId": request_id, "title": title, "path": str(result)})
    except BaseException:
        cleanup_workdir(workdir, output)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--workdir", required=True)
    args = parser.parse_args()
    request_id = args.request_id
    try:
        validate_message({"cmd": "download", "requestId": request_id, "videoId": args.video_id})
        config = load_config(Path(args.config))
        # The host attaches its process-tree job before allowing extraction to start.
        if sys.stdin.buffer.readline(16) != b"RUN\n":
            return 1
        run_job(request_id, args.video_id, config, args.workdir)
        return 0
    except BaseException as error:
        message = str(error).replace("\x00", " ")[:1600] or "The download failed."
        send({"event": "error", "requestId": request_id, "error": message,
              "code": error.code if isinstance(error, HelperError) else "download_failed"})
        return 1


if __name__ == "__main__":
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    raise SystemExit(main())
