"""Frozen POSIX native host. No global interpreter or user-installed modules needed."""
import json
import os
from pathlib import Path
import sys
import tempfile

from common import load_config
from host import NativeHost, write_message
import worker


def configuration():
    home = Path.home()
    base = (home / "Library/Application Support" if sys.platform == "darwin"
            else Path(os.environ.get("XDG_CONFIG_HOME") or home / ".config"))
    if not base.is_absolute():
        base = home / ".config"
    folder = base / "VideoLinkGrabberLocal"
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    bundle = Path(sys._MEIPASS)
    config = {"pythonPath": sys.executable, "nodePath": str(bundle / "tools/node"),
              "ffmpegPath": str(bundle / "tools/ffmpeg"),
              "runtimePath": str(bundle),
              "outputDir": str(home / "Downloads/Video Link Grabber")}
    destination = folder / "config.json"
    # Retain the user's chosen output folder when repairing/upgrading the helper.
    if destination.is_file():
        previous = json.loads(destination.read_text(encoding="utf-8"))
        output = previous.get("outputDir")
        if isinstance(output, str) and Path(output).is_absolute():
            config["outputDir"] = output
    descriptor, temporary = tempfile.mkstemp(prefix=".config-", dir=folder)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(config, stream)
        load_config(Path(temporary))
        os.replace(temporary, destination)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return destination


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        from yt_dlp.version import __version__
        import yt_dlp_ejs
        print(json.dumps({"yt_dlp": __version__, "ejs": str(yt_dlp_ejs.__file__)}))
        return 0
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        del sys.argv[1]
        return worker.main()
    try:
        config = configuration()
    except Exception as error:
        write_message(sys.stdout.buffer, {"event": "error", "code": "setup_required",
                      "error": f"Helper setup failed: {error}"[:1600]})
        return 1
    return NativeHost(sys.stdin.buffer, sys.stdout.buffer, config).run()


if __name__ == "__main__":
    raise SystemExit(main())
