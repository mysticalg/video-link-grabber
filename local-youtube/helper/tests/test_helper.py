from __future__ import annotations

import ctypes
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import (HelperError, MAX_DURATION_SECONDS, MAX_INPUT_BYTES, cleanup_workdir,
                    load_config, publish_file, safe_title, validate_message)
from host import NativeHost, read_message, write_message
from worker import run_job, validate_info


def frame(message):
    stream = io.BytesIO()
    write_message(stream, message)
    return stream.getvalue()


class RecordingHost(NativeHost):
    def __init__(self, config, worker=None, data=b""):
        super().__init__(io.BytesIO(data), io.BytesIO(), config, worker)
        self.events = []
        self.started = None

    def emit(self, event):
        if not self.disconnected:
            self.events.append(event)

    def start(self, message):
        super().start(message)
        self.started = self.job


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="vlg-helper-tests-")
        self.root = Path(self.temporary.name)
        self.output = self.root / "downloads"
        self.output.mkdir()
        self.runtime = self.root / "runtime"
        (self.runtime / "yt_dlp").mkdir(parents=True)
        (self.runtime / "yt_dlp_ejs").mkdir()
        self.ffmpeg = self.root / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
        self.ffmpeg.write_bytes(b"test dependency marker")
        self.ffmpeg.with_name("ffprobe.exe" if os.name == "nt" else "ffprobe").write_bytes(b"test dependency marker")
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps({"pythonPath": sys.executable, "nodePath": sys.executable,
            "ffmpegPath": str(self.ffmpeg), "outputDir": str(self.output), "runtimePath": str(self.runtime)}), encoding="utf-8")
        self.hosts = []

    def tearDown(self):
        for host in self.hosts:
            job = host.cancel_current()
            if job and job.thread:
                job.thread.join(timeout=10)
        self.temporary.cleanup()

    def make_host(self, worker=None, data=b""):
        host = RecordingHost(self.config, worker, data)
        self.hosts.append(host)
        return host

    def wait_for(self, condition, timeout=8):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if condition():
                return
            time.sleep(0.02)
        self.fail("Timed out waiting for the isolated test worker")

    def fake_worker(self, body):
        script = self.root / "fake_worker.py"
        script.write_text("import sys,json,time,subprocess\nfrom pathlib import Path\n"
            "args=dict(zip(sys.argv[1::2],sys.argv[2::2]))\n"
            "request=args['--request-id']\nworkdir=Path(args['--workdir'])\n"
            "assert sys.stdin.buffer.readline(16)==b'RUN\\n'\n"
            "def emit(value):\n value['requestId']=request\n print(json.dumps(value),flush=True)\n" + body, encoding="utf-8")
        return script

    def test_message_contract_rejects_urls_flags_paths_unknown_fields_and_bad_ids(self):
        valid = {"cmd": "download", "requestId": "request_1", "videoId": "YE7VzlLtp-4"}
        self.assertEqual(validate_message(valid), valid)
        for invalid in [None, [], {"cmd": "shell"}, {**valid, "videoId": "https://youtube.com/watch?v=YE7VzlLtp-4"},
                        {**valid, "videoId": "YE7VzlLtp-4\n"}, {**valid, "requestId": "../escape"},
                        {**valid, "requestId": "x" * 65}, {**valid, "outputDir": "C:/"},
                        {**valid, "args": ["--exec", "anything"]}, {"cmd": "ping", "requestId": "unexpected"}]:
            with self.subTest(invalid=invalid), self.assertRaises(HelperError):
                validate_message(invalid)

    def test_native_framing_handles_unicode_and_partial_reads(self):
        data = frame({"event": "ready", "title": "星空 🌠"})
        class Chunked(io.BytesIO):
            def read(self, size=-1):
                return super().read(min(size, 2))
        self.assertEqual(read_message(Chunked(data)), {"event": "ready", "title": "星空 🌠"})
        self.assertIsNone(read_message(io.BytesIO()))

    def test_native_framing_rejects_oversize_truncation_and_invalid_json(self):
        for data in [struct.pack("<I", MAX_INPUT_BYTES + 1), struct.pack("<I", 0), b"\x02\x00", struct.pack("<I", 8) + b"{}",
                     struct.pack("<I", 1) + b"\xff", struct.pack("<I", 1) + b"{"]:
            with self.subTest(data=data), self.assertRaises(HelperError):
                read_message(io.BytesIO(data))
        with self.assertRaises(HelperError):
            write_message(io.BytesIO(), {"event": "error", "error": "x" * 20000})

    def test_ping_reports_exact_protocol_and_missing_dependency_is_actionable(self):
        host = self.make_host()
        host.handle({"cmd": "ping"})
        self.assertEqual(host.events[-1]["event"], "ready")
        self.assertEqual(host.events[-1]["protocol"], 1)
        self.assertEqual(host.events[-1]["outputDir"], str(self.output.resolve()))
        self.ffmpeg.unlink()
        host.handle({"cmd": "ping"})
        self.assertEqual(host.events[-1]["code"], "setup_required")
        self.assertIn("ffmpegPath", host.events[-1]["error"])

    def test_titles_are_safe_unicode_preserving_and_collision_files_never_overwrite(self):
        self.assertEqual(safe_title('../星空 🌠: "x"\u202e'), '_星空 🌠_ _x_')
        self.assertEqual(safe_title("CON"), "_CON")
        self.assertEqual(safe_title("   ..."), "Video")
        self.assertLessEqual(len(safe_title("🌠" * 200).encode("utf-16-le")), 300)
        original = self.output / "星空.mp4"
        original.write_bytes(b"original")
        for number in (1, 2):
            source = self.output / f"temporary{number}.mp4"
            source.write_bytes(f"new{number}".encode())
            target = publish_file(source, self.output, "星空")
            self.assertEqual(target.name, f"星空 ({number}).mp4")
            self.assertFalse(source.exists())
            self.assertEqual(target.read_bytes(), f"new{number}".encode())
        self.assertEqual(original.read_bytes(), b"original")

    def test_cleanup_refuses_download_root_and_unrelated_directories(self):
        keep = self.output / "user-video.mp4"
        keep.write_bytes(b"keep")
        with self.assertRaises(HelperError):
            cleanup_workdir(self.output, self.output)
        unrelated = self.root / ".vlg-youtube-unrelated"
        unrelated.mkdir()
        with self.assertRaises(HelperError):
            cleanup_workdir(unrelated, self.output)
        owned = self.output / ".vlg-youtube-owned"
        owned.mkdir()
        (owned / "partial").write_bytes(b"partial")
        cleanup_workdir(owned, self.output)
        self.assertFalse(owned.exists())
        self.assertEqual(keep.read_bytes(), b"keep")

    def test_restricted_drm_live_unknown_duration_and_oversize_metadata_are_rejected(self):
        base = {"duration": 30, "availability": "public", "title": "Fixture"}
        validate_info(base)
        for override in [{"availability": "needs_auth"}, {"availability": "private"}, {"age_limit": 18},
                         {"is_live": True}, {"live_status": "post_live"}, {"duration": None}, {"duration": float("inf")},
                         {"duration": MAX_DURATION_SECONDS + 1}, {"has_drm": True},
                         {"requested_formats": [{"has_drm": True}]}, {"filesize": 3 * 1024 ** 3}, {"_type": "playlist"}]:
            with self.subTest(override=override), self.assertRaises(HelperError):
                validate_info({**base, **override})

    def test_busy_wrong_cancel_and_matching_cancel_are_isolated(self):
        worker = self.fake_worker("emit({'event':'progress','phase':'extracting','percent':None})\ntime.sleep(60)\n")
        host = self.make_host(worker)
        host.handle({"cmd": "download", "requestId": "first", "videoId": "YE7VzlLtp-4"})
        job = host.job
        self.wait_for(lambda: any(event["event"] == "progress" for event in host.events))
        host.handle({"cmd": "download", "requestId": "second", "videoId": "YE7VzlLtp-4"})
        self.assertEqual(host.events[-1]["code"], "busy")
        host.handle({"cmd": "cancel", "requestId": "second"})
        self.assertEqual(host.events[-1]["code"], "not_running")
        self.assertIsNone(job.process.poll())
        host.handle({"cmd": "cancel", "requestId": "first"})
        job.thread.join(timeout=10)
        self.assertFalse(job.thread.is_alive())
        self.assertEqual(host.events[-1], {"event": "cancelled", "requestId": "first"})
        self.assertFalse(job.workdir.exists())
        self.assertIsNone(host.job)

    def test_eof_kills_worker_and_removes_partial_workdir(self):
        worker = self.fake_worker("(workdir/'partial').write_bytes(b'partial')\ntime.sleep(60)\n")
        host = self.make_host(worker, frame({"cmd": "download", "requestId": "first", "videoId": "YE7VzlLtp-4"}))
        self.assertEqual(host.run(), 0)
        self.assertIsNotNone(host.started.process.poll())
        self.assertFalse(host.started.workdir.exists())
        self.assertEqual(list(self.output.iterdir()), [])

    @unittest.skipUnless(os.name == "nt", "Windows Job Object regression")
    def test_cancellation_kills_grandchild_without_using_taskkill(self):
        worker = self.fake_worker("child=subprocess.Popen([sys.executable,'-I','-c','import time; time.sleep(60)'])\n"
            "(workdir/'child.pid').write_text(str(child.pid))\n"
            "emit({'event':'progress','phase':'downloading','percent':5})\ntime.sleep(60)\n")
        host = self.make_host(worker)
        host.handle({"cmd": "download", "requestId": "first", "videoId": "YE7VzlLtp-4"})
        job = host.job
        marker = job.workdir / "child.pid"
        self.wait_for(marker.exists)
        pid = int(marker.read_text())
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x00100000, False, pid)
        self.assertTrue(handle)
        try:
            host.handle({"cmd": "cancel", "requestId": "first"})
            job.thread.join(timeout=10)
            self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0)
            self.assertEqual(host.events[-1]["event"], "cancelled")
        finally:
            kernel.CloseHandle(handle)

    def test_worker_failure_and_timeout_have_clear_terminal_events(self):
        worker = self.fake_worker("emit({'event':'error','error':'Fixture unavailable','code':'download_failed'})\nsys.exit(1)\n")
        host = self.make_host(worker)
        host.handle({"cmd": "download", "requestId": "first", "videoId": "YE7VzlLtp-4"})
        host.started.thread.join(timeout=10)
        self.assertEqual(host.events[-1]["error"], "Fixture unavailable")
        worker = self.fake_worker("time.sleep(60)\n")
        host = self.make_host(worker)
        host.handle({"cmd": "download", "requestId": "timeout", "videoId": "YE7VzlLtp-4"})
        job = host.job
        host.timeout_job(job)
        job.thread.join(timeout=10)
        self.assertEqual(host.events[-1]["code"], "timeout")

    def test_cancel_after_preparation_before_worker_exit_publishes_nothing(self):
        worker = self.fake_worker("result=workdir/'media.mp4'\nresult.write_bytes(b'verified-fixture')\n"
            "emit({'event':'prepared','path':str(result),'title':'Fixture title'})\n"
            "(workdir/'prepared.marker').write_text('ready')\ntime.sleep(60)\n")
        host = self.make_host(worker)
        host.handle({"cmd": "download", "requestId": "first", "videoId": "YE7VzlLtp-4"})
        job = host.job
        self.wait_for((job.workdir / "prepared.marker").exists)
        host.handle({"cmd": "cancel", "requestId": "first"})
        job.thread.join(timeout=10)
        self.assertEqual(host.events[-1], {"event": "cancelled", "requestId": "first"})
        self.assertEqual(list(self.output.iterdir()), [])

    def test_successful_commit_wins_racing_cancel_and_preserves_one_file(self):
        worker = self.fake_worker("result=workdir/'media.mp4'\nresult.write_bytes(b'verified-fixture')\n"
            "emit({'event':'prepared','path':str(result),'title':'Fixture title'})\n")
        host = self.make_host(worker)
        committing = threading.Event()
        release_commit = threading.Event()
        original_publish = publish_file

        def blocked_publish(*args):
            committing.set()
            self.assertTrue(release_commit.wait(timeout=5))
            return original_publish(*args)

        with mock.patch("host.publish_file", blocked_publish):
            host.handle({"cmd": "download", "requestId": "first", "videoId": "YE7VzlLtp-4"})
            job = host.started
            self.assertTrue(committing.wait(timeout=5))
            cancellation = threading.Thread(target=host.handle, args=({"cmd": "cancel", "requestId": "first"},))
            cancellation.start()
            release_commit.set()
            cancellation.join(timeout=5)
            job.thread.join(timeout=5)
        self.assertEqual(host.events[-1]["event"], "complete")
        self.assertEqual(host.events[-1]["filename"], "Fixture title.mp4")
        self.assertEqual((self.output / "Fixture title.mp4").read_bytes(), b"verified-fixture")
        self.assertEqual(len(list(self.output.iterdir())), 1)
        host.handle({"cmd": "cancel", "requestId": "first"})
        self.assertEqual(len(host.events), 1)

    def test_worker_cannot_publish_an_existing_file_outside_its_temporary_folder(self):
        original = self.output / "existing.mp4"
        original.write_bytes(b"keep")
        worker = self.fake_worker("result=workdir.parent/'existing.mp4'\n"
            "emit({'event':'prepared','path':str(result),'title':'Changed name'})\n")
        host = self.make_host(worker)
        host.handle({"cmd": "download", "requestId": "first", "videoId": "YE7VzlLtp-4"})
        host.started.thread.join(timeout=10)
        self.assertEqual(host.events[-1]["code"], "invalid_output")
        self.assertEqual(original.read_bytes(), b"keep")
        self.assertEqual(len(list(self.output.iterdir())), 1)

    def test_worker_omits_unknown_title_and_reports_combined_track_progress(self):
        events = []
        workdir = self.output / ".vlg-youtube-fixture"
        workdir.mkdir()
        captured = {}
        class FakeDownloader:
            def __init__(self, options):
                self.options = options
                captured.update(options)
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def extract_info(self, url, download):
                assert url == "https://www.youtube.com/watch?v=YE7VzlLtp-4"
                assert download is False
                return {"title": "Actual video title", "duration": 30, "availability": "public",
                        "requested_formats": [{"format_id": "video", "filesize": 80}, {"format_id": "audio", "filesize": 20}]}
            def process_ie_result(self, _info, download):
                assert download is True
                hook = self.options["progress_hooks"][0]
                hook({"status": "finished", "info_dict": {"format_id": "video"}, "downloaded_bytes": 80, "total_bytes": 80})
                hook({"status": "finished", "info_dict": {"format_id": "audio"}, "downloaded_bytes": 20, "total_bytes": 20})
                (workdir / "media.mp4").write_bytes(b"generated fixture")
        modules = {"yt_dlp": types.SimpleNamespace(YoutubeDL=FakeDownloader),
                   "yt_dlp.globals": types.SimpleNamespace(plugin_dirs=types.SimpleNamespace(value=["default"]))}
        with mock.patch.dict(sys.modules, modules), mock.patch("worker.send", events.append), mock.patch("worker.verify_mp4"):
            run_job("first", "YE7VzlLtp-4", load_config(self.config), workdir)
        self.assertNotIn("title", events[0])
        percentages = [event["percent"] for event in events if event.get("phase") == "downloading"]
        self.assertEqual(percentages, [0, 80.0, 99.9])
        self.assertEqual(events[-1]["event"], "prepared")
        self.assertEqual(events[-1]["title"], "Actual video title")
        self.assertEqual(list(self.output.glob("*.mp4")), [])
        self.assertEqual(captured["remote_components"], set())
        self.assertIsNone(captured["cookiesfrombrowser"])
        self.assertEqual(modules["yt_dlp.globals"].plugin_dirs.value, [])


if __name__ == "__main__":
    unittest.main()
