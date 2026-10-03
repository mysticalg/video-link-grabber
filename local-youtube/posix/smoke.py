"""Exercise installed packages, real native framing, worker startup and AV remux."""
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

MAC = sys.platform == "darwin"
APP = Path("/Library/Application Support/VideoLinkGrabberLocal" if MAC else "/opt/video-link-grabber-local")
HOST = APP / "helper/vlg-host"
TOOLS = APP / "helper/_internal/tools"
data = json.dumps({"cmd": "ping"}).encode()
with tempfile.TemporaryDirectory(prefix="vlg installed test ") as temporary:
    env = dict(os.environ, HOME=temporary, XDG_CONFIG_HOME=str(Path(temporary) / ".config"))
    response = subprocess.run([str(HOST)], input=struct.pack("=I", len(data)) + data,
                              capture_output=True, env=env, timeout=30, check=True)
    length = struct.unpack("=I", response.stdout[:4])[0]
    assert len(response.stdout) == length + 4, response
    ready = json.loads(response.stdout[4:])
    assert ready["event"] == "ready" and ready["protocol"] == 1, ready
    assert Path(ready["outputDir"]).is_relative_to(Path(temporary).resolve()), ready
    print("Native framing and per-user configuration: PASS", ready)
    subprocess.run([str(HOST), "--self-test"], check=True, env=env, timeout=30)
    for name, flag in (("node", "--version"), ("ffmpeg", "-version"), ("ffprobe", "-version")):
        subprocess.run([str(TOOLS / name), flag], check=True, capture_output=True, timeout=30)
    worker = subprocess.run([str(HOST), "--worker", "--request-id", "fixture", "--video-id", "invalid",
                             "--config", "/unused", "--workdir", "/unused"],
                            capture_output=True, timeout=30, env=env)
    assert worker.returncode == 1 and json.loads(worker.stdout)["event"] == "error", worker
    source, output = Path(temporary) / "source.mp4", Path(temporary) / "result.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)], check=True)
    subprocess.run([str(TOOLS / "ffmpeg"), "-v", "error", "-i", str(source), "-c", "copy", str(output)], check=True)
    probe = subprocess.check_output([str(TOOLS / "ffprobe"), "-v", "error", "-show_streams", "-of", "json", str(output)])
    assert {s["codec_type"] for s in json.loads(probe)["streams"]} >= {"video", "audio"}
    print("Bundled Node, yt-dlp/EJS, frozen worker and video/audio remux: PASS")
    locations = ([Path("/Library/Google/Chrome/NativeMessagingHosts")] if MAC
                 else [Path("/etc/opt/chrome/native-messaging-hosts"), Path("/etc/chromium/native-messaging-hosts")])
    for location in locations:
        manifest = json.loads((location / "com.video_link_grabber.youtube.json").read_text())
        assert manifest["path"] == str(HOST)
        assert manifest["allowed_origins"] == ["chrome-extension://okjbebimalnjjaladdnpnjpjfmbjeefl/"]
    assert (APP / "extension/manifest.json").is_file()
    print("Installed extension and Chrome registration: PASS")
