"""
Launch the Flask server, print utility, and Chromium kiosk in one command.

Usage:
    uv run complexity-emergence
"""

import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
import shutil

SERVER_URL  = "http://localhost:5000"
MANAGER_URL = "http://localhost:5050"
CHROMIUM_CMDS = ["chromium-browser", "chromium", "google-chrome", "google-chrome-stable"]
CHROMIUM_FLAGS = [
    "--kiosk",
    "--disable-features=ExitFullscreenBubble",
    "--touch-events=enabled",
    "--disable-pinch",
    "--noerrdialogs",
    "--disable-infobars",
    "--disable-session-crashed-bubble",
]


def _wait_for_server(url: str = SERVER_URL, timeout: float = 15.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.2)
    return False


def _find_chromium() -> str | None:
    for cmd in CHROMIUM_CMDS:
        if shutil.which(cmd):
            return cmd
    return None


def main():
    root = Path(__file__).resolve().parent
    python = sys.executable

    server  = subprocess.Popen([python, str(root / "server.py")])
    manager = subprocess.Popen([python, str(root / "print_manager.py")])

    print("Waiting for server…", end=" ", flush=True)
    if not _wait_for_server(SERVER_URL):
        print("timed out — open browser manually.")
        browser = manager_browser = None
    else:
        print("ready.")
        chromium = _find_chromium()
        if chromium:
            browser = subprocess.Popen([chromium, *CHROMIUM_FLAGS, SERVER_URL])
            _wait_for_server(MANAGER_URL, timeout=10.0)
            manager_browser = subprocess.Popen([chromium, "--new-window", MANAGER_URL])
        else:
            print("Chromium not found — open browser manually at", SERVER_URL)
            print("Print manager at", MANAGER_URL)
            browser = manager_browser = None

    try:
        server.wait()
    except KeyboardInterrupt:
        pass
    finally:
        for proc in [server, manager, browser, manager_browser]:
            if proc and proc.poll() is None:
                proc.terminate()


if __name__ == "__main__":
    main()
