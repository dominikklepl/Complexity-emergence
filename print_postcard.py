#!/usr/bin/env python3
"""
Admin print script — pick postcards to print on the SELPHY.

Usage:
    uv run print_postcard.py
"""

import subprocess
import sys
from pathlib import Path

POSTCARD_DIR = Path(__file__).parent / "postcards"
PRINTER      = "Canon-SELPHY-CP1500"
LP_OPTS      = ["-o", "StpBorderless=True", "-o", "StpShrinkOutput=Expand", "-o", "PageSize=Postcard"]


def list_pdfs():
    pdfs = sorted(POSTCARD_DIR.glob("postcard_*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not pdfs:
        print("No postcards found in", POSTCARD_DIR)
        sys.exit(0)
    return pdfs


def print_file(path: Path):
    cmd = ["lp", "-d", PRINTER] + LP_OPTS + [str(path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        print(f"  ✓ Sent: {path.name}")
    else:
        print(f"  ✗ Failed: {result.stderr.strip()}")


def main():
    pdfs = list_pdfs()

    print(f"\nPostcards in {POSTCARD_DIR}  (printer: {PRINTER})\n")
    for i, p in enumerate(pdfs):
        from datetime import datetime
        mtime = datetime.fromtimestamp(p.stat().st_mtime).strftime("%H:%M:%S")
        print(f"  {i+1:>3}.  [{mtime}]  {p.name}")

    print("\nEnter number(s) to print (e.g. 1  or  1 3 5), 'a' for all, or 'q' to quit:")

    while True:
        try:
            raw = input("> ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nAborted.")
            sys.exit(0)

        if raw == "q":
            sys.exit(0)
        elif raw == "a":
            targets = pdfs
        else:
            try:
                indices = [int(x) - 1 for x in raw.split()]
                targets = [pdfs[i] for i in indices if 0 <= i < len(pdfs)]
            except ValueError:
                print("  Invalid input.")
                continue

        if not targets:
            print("  No matching files.")
            continue

        print(f"\nPrinting {len(targets)} postcard(s)…")
        for p in targets:
            print_file(p)

        print("\nDone. Enter more numbers, 'a', or 'q':")


if __name__ == "__main__":
    main()
