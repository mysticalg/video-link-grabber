"""Connect the packaged extension to the OS-registered helper in real Chromium."""
import json
from pathlib import Path
import sys
import tempfile
from playwright.sync_api import sync_playwright

app = Path("/Library/Application Support/VideoLinkGrabberLocal" if sys.platform == "darwin"
           else "/opt/video-link-grabber-local")
extension = app / "extension"
with tempfile.TemporaryDirectory(prefix="vlg-browser-") as profile, sync_playwright() as p:
    context = p.chromium.launch_persistent_context(profile, channel="chromium", headless=True,
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}"])
    try:
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
        assert "okjbebimalnjjaladdnpnjpjfmbjeefl" in worker.url, worker.url
        page = context.new_page()
        page.goto("chrome-extension://okjbebimalnjjaladdnpnjpjfmbjeefl/popup.html")
        page.wait_for_function("typeof chrome.runtime?.sendNativeMessage === 'function'")
        result = page.evaluate('''() => new Promise(resolve => {
          chrome.runtime.sendNativeMessage('com.video_link_grabber.youtube', {cmd:'ping'}, reply => {
            resolve(chrome.runtime.lastError ? {error:chrome.runtime.lastError.message} : reply);
          });
        })''')
        assert result.get("event") == "ready", result
        print("Real Chromium extension -> installed native host: PASS", json.dumps(result))
    finally:
        context.close()
