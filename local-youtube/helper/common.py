"""Shared validation for the local, user-invoked YouTube companion."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import unicodedata

VERSION = "1.0.0"
PROTOCOL = 1
MAX_INPUT_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 16 * 1024
MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024
MAX_DURATION_SECONDS = 2 * 60 * 60
REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}\Z")
RESERVED = re.compile(r"^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)", re.I)


class HelperError(Exception):
    def __init__(self, message: str, code: str = "invalid_request"):
        super().__init__(message)
        self.code = code


def validate_message(message):
    if not isinstance(message, dict):
        raise HelperError("Expected a JSON object.")
    command = message.get("cmd")
    fields = {"ping": {"cmd"}, "download": {"cmd", "requestId", "videoId"},
              "cancel": {"cmd", "requestId"}}
    if not isinstance(command, str) or command not in fields or set(message) != fields[command]:
        raise HelperError("Unsupported command or message fields.")
    if command != "ping" and (not isinstance(message["requestId"], str) or not REQUEST_ID.fullmatch(message["requestId"])):
        raise HelperError("Invalid request identifier.")
    if command == "download" and (not isinstance(message["videoId"], str) or not VIDEO_ID.fullmatch(message["videoId"])):
        raise HelperError("Invalid YouTube video identifier.")
    return message


def load_config(path: Path):
    try:
        raw = path.read_bytes()
        if len(raw) > 16384:
            raise ValueError("Configuration is too large")
        config = json.loads(raw.decode("utf-8-sig"))
        required = {"pythonPath", "nodePath", "ffmpegPath", "outputDir", "runtimePath"}
        if not isinstance(config, dict) or set(config) != required:
            raise ValueError("Configuration fields are missing or unsupported")
        for key in required:
            value = config[key]
            if not isinstance(value, str) or not value or "\x00" in value or not Path(value).is_absolute():
                raise ValueError(f"{key} must be an absolute path")
            config[key] = str(Path(value).resolve())
        for key in ("pythonPath", "nodePath", "ffmpegPath"):
            if not Path(config[key]).is_file():
                raise ValueError(f"The configured {key} is not installed")
        runtime = Path(config["runtimePath"])
        for dependency in ("yt_dlp", "yt_dlp_ejs"):
            if not (runtime / dependency).is_dir():
                raise ValueError(f"The app-private {dependency} dependency is not installed")
        ffmpeg = Path(config["ffmpegPath"])
        config["ffprobePath"] = str(ffmpeg.with_name("ffprobe.exe" if ffmpeg.suffix.lower() == ".exe" else "ffprobe"))
        if not Path(config["ffprobePath"]).is_file():
            raise ValueError("ffprobe is missing from the FFmpeg folder")
        output = Path(config["outputDir"])
        if output == Path(output.anchor):
            raise ValueError("Choose a download folder, not a filesystem root")
        if output.exists() and not output.is_dir():
            raise ValueError("The download folder is not a directory")
        return config
    except (OSError, ValueError, TypeError, RecursionError) as error:
        raise HelperError(f"Local helper setup is incomplete: {error}", "setup_required") from error


def safe_title(value):
    title = unicodedata.normalize("NFC", str(value or "Video"))
    title = re.sub(r"https?://\S+", "", title, flags=re.I)
    title = re.sub(r"[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]", "", title)
    title = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f-\x9f\ud800-\udfff]', "_", title)
    title = re.sub(r"\s+", " ", title).strip(" .") or "Video"
    if RESERVED.match(title):
        title = "_" + title
    while len(title.encode("utf-16-le")) > 300:
        title = title[:-1]
    return title.rstrip(" .") or "Video"


def publish_file(source: Path, output: Path, title: str):
    """Publish without overwriting any existing download, including racing jobs."""
    stem = safe_title(title)
    for index in range(10000):
        target = output / f"{stem}{f' ({index})' if index else ''}.mp4"
        try:
            # Source and destination share a filesystem; linking is atomic and exclusive.
            os.link(source, target)
        except FileExistsError:
            continue
        except OSError:
            # Filesystems without hard links still get exclusive collision protection.
            try:
                with target.open("xb") as destination, source.open("rb") as original:
                    shutil.copyfileobj(original, destination, length=1024 * 1024)
                    destination.flush()
                    os.fsync(destination.fileno())
            except FileExistsError:
                continue
            except BaseException:
                target.unlink(missing_ok=True)
                raise
        source.unlink()
        return target
    raise HelperError("Too many files already use this video title.", "filename_collision")


def cleanup_workdir(workdir: Path, output: Path):
    """Only remove the exact temporary child created for this job."""
    if workdir.is_symlink() or workdir.parent.resolve() != output.resolve() or not workdir.name.startswith(".vlg-youtube-"):
        raise HelperError("Refusing to clean an unexpected temporary folder.", "unsafe_path")
    if workdir.exists():
        shutil.rmtree(workdir)
