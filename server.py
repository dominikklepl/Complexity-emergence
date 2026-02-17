"""
Veletrh vědy 2026 — Local server
=================================
This is a tiny web server that does two things:
  1. Serves the interactive simulator (the HTML/JS/WebGL app)
  2. Receives snapshot images and saves them as print-ready postcards

Think of it like a local API: the browser runs the simulation,
and when a visitor clicks "Print", the browser sends the image
to this server, which assembles the postcard and saves it.

To run:
    pip install flask pillow
    python server.py

Then open http://localhost:5000 in Chrome/Chromium.
For the fair, run Chrome in kiosk mode:
    chromium-browser --kiosk http://localhost:5000

Requirements: flask, pillow (PIL)
"""

from flask import Flask, send_from_directory, request, jsonify
from datetime import datetime
from pathlib import Path
import base64
import json

# --- Optional: postcard assembly with PIL ---
try:
    from PIL import Image, ImageDraw, ImageFont
    import io

    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("⚠ Pillow not installed — snapshots saved as raw PNGs only")


# =============================================================
# FLASK BASICS
# =============================================================
# Flask is a web framework. This creates a web application.
# Each @app.route(...) defines a URL and what to do when
# someone visits it. That's basically all Flask is.

app = Flask(__name__)

# Where to save postcards
POSTCARD_DIR = Path("postcards")
POSTCARD_DIR.mkdir(exist_ok=True)


# --- Route 1: Serve the main page ---
# When someone visits http://localhost:5000/, serve index.html
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# --- Route 2: Serve any static file (JS, CSS, images) ---
# e.g. http://localhost:5000/static/style.css
@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory("static", filename)


# --- Route 3: Receive a snapshot and make a postcard ---
# The browser sends a POST request with the image data.
# We decode it, assemble a postcard, and save it.
@app.route("/api/snapshot", methods=["POST"])
def snapshot():
    """
    Expects JSON: {
        "image": "data:image/png;base64,...",  # the canvas screenshot
        "title": "Turing Patterns",
        "subtitle": "Your parameter choices created this pattern",
        "sim_type": "rd" or "osc"
    }
    """
    data = request.get_json()
    if not data or "image" not in data:
        return jsonify({"error": "No image data"}), 400

    # Decode the base64 image from the browser
    # The format is "data:image/png;base64,AAABBBCCC..."
    # We split off the header and decode the rest
    header, b64data = data["image"].split(",", 1)
    img_bytes = base64.b64decode(b64data)

    # Generate a unique filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    sim_type = data.get("sim_type", "unknown")

    if HAS_PIL:
        # Assemble a proper postcard
        pattern_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        lang = data.get("lang", "cs")
        postcard = assemble_postcard(
            pattern_img,
            title=data.get("title", "Turingovy vzory" if lang == "cs" else "Pattern"),
            subtitle=data.get("subtitle", ""),
        )
        filepath = POSTCARD_DIR / f"postcard_{sim_type}_{timestamp}.png"
        postcard.save(filepath, quality=95)
    else:
        # Just save the raw screenshot
        filepath = POSTCARD_DIR / f"snapshot_{sim_type}_{timestamp}.png"
        filepath.write_bytes(img_bytes)

    print(f"✓ Saved: {filepath.name}")
    return jsonify({"ok": True, "filename": filepath.name})


# Path to the ÚI logo image
LOGO_PATH = Path("static/logo.png")


def assemble_postcard(pattern_img, title="Turingovy vzory", subtitle=""):
    """
    Takes the pattern image and wraps it in the postcard layout.
    Output: 900×600 for screen/thermal printing.
    """
    PW, PH = 900, 600
    PATTERN_H = 460

    card = Image.new("RGB", (PW, PH), (250, 248, 243))

    # Resize pattern to fill the art area
    pat = pattern_img.resize((PW, PATTERN_H), Image.LANCZOS)
    card.paste(pat, (0, 0))

    draw = ImageDraw.Draw(card)

    # Gold accent line
    draw.rectangle([(0, PATTERN_H), (PW, PATTERN_H + 4)], fill=(200, 184, 138))
    footer_y = PATTERN_H + 4

    # Fonts — DejaVu is available on most Linux systems
    def load_font(name, size):
        paths = [
            f"/usr/share/fonts/truetype/dejavu/{name}.ttf",
            f"/usr/share/fonts/TTF/{name}.ttf",
            f"C:/Windows/Fonts/{name}.ttf",
        ]
        for p in paths:
            try:
                return ImageFont.truetype(p, size)
            except (OSError, IOError):
                continue
        return ImageFont.load_default()

    ft = load_font("DejaVuSerif-Bold", 28)
    ft_sub = load_font("DejaVuSerif-Italic", 16)
    ft_sm = load_font("DejaVuSans", 13)

    draw.text((24, footer_y + 16), title, fill=(26, 26, 46), font=ft)
    draw.text((24, footer_y + 52), subtitle, fill=(120, 120, 120), font=ft_sub)

    # ÚI logo (real image or fallback)
    lx, ly = PW - 100, footer_y + 10
    try:
        if LOGO_PATH.exists():
            logo = Image.open(LOGO_PATH).convert("RGBA")
            # Fit logo into 80x80 box, preserving aspect ratio
            logo.thumbnail((80, 80), Image.LANCZOS)
            # Paste with transparency support
            card.paste(logo, (lx, ly), logo if logo.mode == "RGBA" else None)
        else:
            raise FileNotFoundError
    except Exception:
        # Fallback: draw text placeholder
        ft_logo = load_font("DejaVuSans-Bold", 16)
        draw.rounded_rectangle(
            [(lx, ly), (lx + 70, ly + 70)], radius=6, fill=(26, 26, 46)
        )
        draw.text((lx + 16, ly + 12), "ÚI", fill=(200, 184, 138), font=ft_logo)
        draw.text((lx + 8, ly + 34), "AV ČR", fill=(200, 184, 138), font=ft_sm)

    # Footer
    line_y = footer_y + 96
    draw.line([(24, line_y), (PW - 24, line_y)], fill=(224, 220, 212), width=1)
    draw.text((24, line_y + 8), "Veletrh vědy 2026", fill=(160, 160, 160), font=ft_sm)
    draw.text((PW - 180, line_y + 8), "www.cs.cas.cz", fill=(160, 160, 160), font=ft_sm)

    return card


# =============================================================
# RUN
# =============================================================
if __name__ == "__main__":
    print("=" * 50)
    print("  Veletrh vědy 2026 — Pattern Generator")
    print("  Open http://localhost:5000 in Chrome")
    print("  Postcards saved to ./postcards/")
    print("=" * 50)

    # host="0.0.0.0" means accessible from any device on the network
    # (useful if you want to test from a tablet on the same WiFi)
    app.run(host="0.0.0.0", port=5000, debug=True)
