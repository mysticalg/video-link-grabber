"""Chrome native messaging host for one bounded, cancellable local download."""

from __future__ import annotations

import ctypes
from collections import deque
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (HelperError, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, PROTOCOL, REQUEST_ID,
                    VERSION, cleanup_workdir, load_config, publish_file, validate_message)


def read_exact(stream, size):
    data = bytearray()
    while len(data) < size:
        part = stream.read(size - len(data))
        if not part:
            if not data:
                return None
            raise HelperError("The native message was truncated.", "protocol_error")
        data.extend(part)
    return bytes(data)


def read_message(stream):
    header = read_exact(stream, 4)
    if header is None:
        return None
    length = struct.unpack("<I", header)[0]
    if not 0 < length <= MAX_INPUT_BYTES:
        raise HelperError("The native message exceeds its size limit.", "protocol_error")
    body = read_exact(stream, length)
    if body is None:
        raise HelperError("The native message was truncated.", "protocol_error")
    try:
        return json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeError, RecursionError) as error:
        raise HelperError("The native message is not valid UTF-8 JSON.", "protocol_error") from error


def write_message(stream, event):
    body = json.dumps(event, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode("ascii")
    if len(body) > MAX_OUTPUT_BYTES:
        raise HelperError("The native response exceeds its size limit.", "protocol_error")
    stream.write(struct.pack("<I", len(body)) + body)
    stream.flush()


class ProcessTree:
    """Windows Job Objects terminate only this job and its descendants."""

    def __init__(self, process):
        self.process = process
        self.handle = None
        self.lock = threading.Lock()
        if os.name != "nt":
            return
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                                                            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
                        ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.SetInformationJobObject.restype = wintypes.BOOL
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        kernel.TerminateJobObject.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        self.kernel = kernel
        handle = kernel.CreateJobObjectW(None, None)
        if not handle:
            raise OSError(ctypes.get_last_error(), "Could not create the download process group")
        limits = ExtendedLimits()
        limits.BasicLimitInformation.LimitFlags = 0x00002000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(handle, int(process._handle)):
            error = ctypes.get_last_error()
            kernel.CloseHandle(handle)
            raise OSError(error, "Could not isolate the download process group")
        self.handle = handle

    def terminate(self):
        with self.lock:
            if os.name == "nt":
                if self.handle:
                    self.kernel.TerminateJobObject(self.handle, 1)
            else:
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def close(self):
        with self.lock:
            if self.handle:
                self.kernel.CloseHandle(self.handle)
                self.handle = None


@dataclass
class Job:
    request_id: str
    process: subprocess.Popen
    tree: ProcessTree
    workdir: Path
    outputdir: Path
    cancelled: threading.Event = field(default_factory=threading.Event)
    terminal: bool = False
    thread: threading.Thread | None = None
    timer: threading.Timer | None = None
    timed_out: bool = False


class NativeHost:
    def __init__(self, input_stream, output_stream, config_path=None, worker_path=None):
        self.input = input_stream
        self.output = output_stream
        self.config_path = Path(config_path or Path(__file__).with_name("config.json"))
        self.worker_path = Path(worker_path or Path(__file__).with_name("worker.py"))
        self.lock = threading.RLock()
        self.write_lock = threading.Lock()
        self.job = None
        self.finished_ids = deque(maxlen=32)
        self.disconnected = False

    def emit(self, event):
        with self.write_lock:
            if not self.disconnected:
                try:
                    write_message(self.output, event)
                except (BrokenPipeError, OSError):
                    self.disconnected = True
                    self.cancel_current()

    def error(self, error, request_id=None):
        event = {"event": "error", "error": str(error)[:1600], "code": getattr(error, "code", "download_failed")}
        if isinstance(request_id, str) and REQUEST_ID.fullmatch(request_id):
            event["requestId"] = request_id
        self.emit(event)

    def handle(self, message):
        try:
            validate_message(message)
            command = message["cmd"]
            if command == "ping":
                config = load_config(self.config_path)
                self.emit({"event": "ready", "protocol": PROTOCOL, "version": VERSION, "outputDir": config["outputDir"]})
            elif command == "cancel":
                with self.lock:
                    if message["requestId"] in self.finished_ids:
                        return
                    if not self.job or self.job.request_id != message["requestId"] or self.job.terminal:
                        raise HelperError("This download is not running on this connection.", "not_running")
                    self.job.cancelled.set()
                    self.job.tree.terminate()
            else:
                self.start(message)
        except (HelperError, OSError) as error:
            self.error(error, message.get("requestId") if isinstance(message, dict) else None)

    def start(self, message):
        with self.lock:
            if self.job:
                raise HelperError("A download is already running on this connection.", "busy")
            if message["requestId"] in self.finished_ids:
                self.finished_ids.remove(message["requestId"])
            config = load_config(self.config_path)
            output = Path(config["outputDir"])
            output.mkdir(parents=True, exist_ok=True)
            workdir = Path(tempfile.mkdtemp(prefix=".vlg-youtube-", dir=output))
            process = None
            tree = None
            try:
                worker_command = ([sys.executable, "--worker"] if getattr(sys, "frozen", False)
                                  else [config["pythonPath"], "-I", "-S", "-u", str(self.worker_path)])
                process = subprocess.Popen(
                    worker_command + ["--request-id", message["requestId"],
                     "--video-id", message["videoId"], "--config", str(self.config_path), "--workdir", str(workdir)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    cwd=str(self.worker_path.parent), shell=False,
                    env={key: value for key, value in os.environ.items() if key.upper() not in ("NODE_OPTIONS", "NODE_PATH")},
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                    start_new_session=os.name != "nt")
                tree = ProcessTree(process)
                job = Job(message["requestId"], process, tree, workdir, output)
                process.stdin.write(b"RUN\n")
                process.stdin.flush()
                process.stdin.close()
                self.job = job
                job.timer = threading.Timer(30 * 60, self.timeout_job, args=(job,))
                job.timer.daemon = True
                job.timer.start()
                job.thread = threading.Thread(target=self.monitor, args=(job,), daemon=True)
                job.thread.start()
            except BaseException:
                if tree:
                    tree.terminate()
                    tree.close()
                if process:
                    process.kill()
                    process.wait(timeout=10)
                cleanup_workdir(workdir, output)
                self.job = None
                raise

    def monitor(self, job):
        terminal_event = None
        try:
            while True:
                raw = job.process.stdout.readline(MAX_OUTPUT_BYTES + 2)
                if not raw:
                    break
                if len(raw) > MAX_OUTPUT_BYTES + 1 or not raw.endswith(b"\n"):
                    raise HelperError("The download worker sent an oversized response.", "protocol_error")
                try:
                    event = json.loads(raw)
                except (ValueError, UnicodeError) as error:
                    raise HelperError("The download worker sent an invalid response.", "protocol_error") from error
                if not isinstance(event, dict) or event.get("requestId") != job.request_id:
                    raise HelperError("The download worker returned a different request.", "protocol_error")
                kind = event.get("event")
                if kind == "progress":
                    percent = event.get("percent")
                    if event.get("phase") not in ("extracting", "downloading", "merging") or (percent is not None and
                        (not isinstance(percent, (int, float)) or isinstance(percent, bool) or not 0 <= percent <= 100)):
                        raise HelperError("The download worker sent invalid progress.", "protocol_error")
                    if not job.cancelled.is_set() and terminal_event is None:
                        self.emit({key: event[key] for key in ("event", "requestId", "phase", "percent", "title") if key in event})
                elif kind in ("prepared", "error") and terminal_event is None:
                    terminal_event = event
                else:
                    raise HelperError("The download worker sent an unexpected response.", "protocol_error")
            returncode = job.process.wait(timeout=10)
            if terminal_event is None:
                raise HelperError("The download worker stopped before completing the video.", "worker_failed")
            if terminal_event["event"] == "prepared":
                result = Path(terminal_event.get("path", ""))
                if returncode != 0 or not result.is_file() or result.is_symlink() or result.resolve() != (job.workdir / "media.mp4").resolve() or not isinstance(terminal_event.get("title"), str):
                    raise HelperError("The download worker did not produce a valid output file.", "invalid_output")
            elif not isinstance(terminal_event.get("error"), str):
                raise HelperError("The download worker returned an invalid error.", "protocol_error")
        except BaseException as error:
            job.tree.terminate()
            try:
                job.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                job.process.kill()
            terminal_event = {"event": "error", "requestId": job.request_id, "error": str(error)[:1600], "code": getattr(error, "code", "worker_failed")}
        finally:
            if job.timer:
                job.timer.cancel()
            job.tree.close()
            job.process.stdout.close()
            with self.lock:
                if job.cancelled.is_set():
                    terminal_event = {"event": "cancelled", "requestId": job.request_id}
                elif job.timed_out:
                    terminal_event = {"event": "error", "requestId": job.request_id, "error": "The download exceeded its 30-minute time limit.", "code": "timeout"}
                elif terminal_event and terminal_event.get("event") == "prepared":
                    try:
                        # This is the commit boundary: cancellation before it saves nothing;
                        # cancellation after it cannot turn a saved file into a failed job.
                        target = publish_file(Path(terminal_event["path"]), job.outputdir, terminal_event["title"])
                        terminal_event = {"event": "complete", "requestId": job.request_id, "filename": target.name, "path": str(target)}
                    except (OSError, HelperError) as error:
                        terminal_event = {"event": "error", "requestId": job.request_id, "error": f"Could not save the completed video: {error}"[:1600], "code": "save_failed"}
                job.terminal = True
                self.finished_ids.append(job.request_id)
                if self.job is job:
                    self.job = None
            try:
                cleanup_workdir(job.workdir, job.outputdir)
            except (OSError, HelperError) as error:
                if terminal_event is None or terminal_event.get("event") != "complete":
                    terminal_event = {"event": "error", "requestId": job.request_id, "error": f"Temporary download cleanup failed: {error}"[:1600], "code": "cleanup_failed"}
            if terminal_event:
                self.emit(terminal_event)

    def timeout_job(self, job):
        with self.lock:
            if self.job is job and not job.terminal:
                job.timed_out = True
                job.tree.terminate()

    def cancel_current(self):
        with self.lock:
            job = self.job
            if job and not job.terminal:
                job.cancelled.set()
                job.tree.terminate()
            return job

    def run(self):
        try:
            while not self.disconnected:
                try:
                    message = read_message(self.input)
                except HelperError as error:
                    self.error(error)
                    return 1
                if message is None:
                    return 0
                self.handle(message)
        finally:
            self.disconnected = True
            job = self.cancel_current()
            if job and job.thread:
                job.thread.join(timeout=15)


if __name__ == "__main__":
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    raise SystemExit(NativeHost(sys.stdin.buffer, sys.stdout.buffer).run())
