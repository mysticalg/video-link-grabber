"""Minimal installed RPM runtime check inside a clean Fedora container."""
import json
from pathlib import Path
import struct
import subprocess

root = Path("/opt/video-link-grabber-local/helper")
payload = b'{"cmd":"ping"}'
result = subprocess.run([str(root / "vlg-host")], input=struct.pack("=I", len(payload)) + payload,
                        capture_output=True, check=True, timeout=30)
size = struct.unpack("=I", result.stdout[:4])[0]
assert len(result.stdout) == size + 4
assert json.loads(result.stdout[4:])["event"] == "ready", result
subprocess.run([str(root / "vlg-host"), "--self-test"], check=True, timeout=30)
for program, argument in (("node", "--version"), ("ffmpeg", "-version"), ("ffprobe", "-version")):
    subprocess.run([str(root / "_internal/tools" / program), argument], capture_output=True, check=True, timeout=30)
print("Installed RPM and bundled executables in Fedora: PASS")
