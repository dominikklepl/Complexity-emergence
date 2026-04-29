"""
Launch the Flask server and the print utility in separate terminal windows.

Usage:
    uv run complexity-emergence
"""

import shutil
import subprocess
import sys
from pathlib import Path


def _terminal_cmd(python: str, script: Path) -> list[str]:
    if shutil.which("kitty"):
        return ["kitty", python, str(script)]
    if shutil.which("konsole"):
        return ["konsole", "--noclose", "-e", python, str(script)]
    if shutil.which("gnome-terminal"):
        return ["gnome-terminal", "--", python, str(script)]
    if shutil.which("xterm"):
        return ["xterm", "-e", python, str(script)]
    # Fallback: same terminal, background
    return [python, str(script)]


def main():
    # Resolve project root relative to this file (works both as script and entry point)
    root = Path(__file__).resolve().parent
    python = sys.executable

    server = subprocess.Popen([python, str(root / "server.py")])
    printer = subprocess.Popen(_terminal_cmd(python, root / "print_postcard.py"))

    try:
        server.wait()
    except KeyboardInterrupt:
        server.terminate()
        printer.terminate()


if __name__ == "__main__":
    main()
