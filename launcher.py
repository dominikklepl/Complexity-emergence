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
    for term, flag in [("kitty", None), ("konsole", "-e"), ("gnome-terminal", "--"), ("xterm", "-e")]:
        if shutil.which(term):
            if flag:
                return [term, flag, python, str(script)]
            return [term, python, str(script)]
    # Fallback: run in background in same terminal
    return [python, str(script)]


def main():
    root = Path(__file__).parent
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
