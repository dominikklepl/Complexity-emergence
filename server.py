"""
Veletrh vědy 2026 — Local server
=================================
This is a tiny web server that does two things:
  1. Serves the interactive simulator (the HTML/JS/WebGL app)
  2. Receives snapshot images and saves them as print-ready postcards

The server now produces **PDF postcards** with:
  - The simulation image embedded at 300 DPI (1800×1200 px)
  - Vector-sharp text, accent lines, and branding
  - Print-ready 6×4 inch (152×102 mm) format

To run:
    uv run server.py

Then open http://localhost:5000 in Chrome/Chromium.
For the fair, run Chrome in kiosk mode:
    chromium-browser --kiosk http://localhost:5000
"""

from flask import Flask, send_from_directory, request, jsonify
from datetime import datetime
from pathlib import Path
import base64
import json

# --- Load config.toml ---
try:
    import tomllib  # Python 3.11+
except ImportError:
    try:
        import tomli as tomllib  # pip install tomli (older Python)
    except ImportError:
        tomllib = None

_CONFIG_PATH = Path(__file__).parent / "config.toml"


def _load_config():
    """Load config.toml, returning a dict. Falls back to safe defaults."""
    defaults = {
        "simulations": [
            {"id": "rd", "enabled": True},
            {"id": "osc", "enabled": True},
            {"id": "boids", "enabled": True},
        ],
        "branding": {
            "title_cs": "Z jednoduchého složité",
            "title_en": "From Simple to Complex",
            "subtitle": "ÚI AV ČR — Veletrh vědy 2026",
            "default_lang": "cs",
        },
        "postcard": {
            "footer_institution": "Ústav informatiky AV ČR",
            "footer_tagline": "Jednoduchá pravidla, složité chování",
            "footer_event": "Veletrh vědy 2026",
            "qr_url": "https://www.cs.cas.cz",
            "logo_path": "static/logo.png",
            "logo_light_path": "",
            "output_dir": "postcards",
            "page_size": "6x4",
            "art_fraction": 0.82,
        },
        "content": {},
    }
    if tomllib is None or not _CONFIG_PATH.exists():
        if tomllib is None:
            print("⚠ tomllib/tomli not available — using built-in defaults")
        return defaults
    try:
        with open(_CONFIG_PATH, "rb") as f:
            cfg = tomllib.load(f)
        # Deep-merge so missing keys fall back to defaults
        for section, vals in defaults.items():
            if section not in cfg:
                cfg[section] = vals
            elif isinstance(vals, dict):
                for k, v in vals.items():
                    cfg[section].setdefault(k, v)
        return cfg
    except Exception as e:
        print(f"⚠ Could not parse config.toml: {e} — using defaults")
        return defaults


CFG = _load_config()

# --- Optional: image handling with PIL ---
try:
    from PIL import Image
    import io as pil_io

    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("⚠ Pillow not installed — raw PNGs only, no image processing")

# --- Optional: PDF postcard assembly with ReportLab ---
try:
    from reportlab.lib.pagesizes import inch
    from reportlab.lib.colors import Color
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import io as rl_io

    HAS_REPORTLAB = True

    # Register TrueType fonts for full Unicode / Czech diacritics support.
    # DejaVu ships on virtually every Linux distribution.
    def _find_dejavu(filename):
        for base in [
            "/usr/share/fonts/truetype/dejavu",  # Debian / Ubuntu
            "/usr/share/fonts/TTF",  # Arch Linux
            "/usr/share/fonts/dejavu",  # Fedora / RHEL
        ]:
            p = Path(base) / filename
            if p.exists():
                return str(p)
        return None

    for _name, _file in [
        ("DejaVuSerif-Bold", "DejaVuSerif-Bold.ttf"),
        ("DejaVuSerif-Italic", "DejaVuSerif-Italic.ttf"),
        ("DejaVuSans", "DejaVuSans.ttf"),
        ("DejaVuSans-Bold", "DejaVuSans-Bold.ttf"),
    ]:
        _p = _find_dejavu(_file)
        if _p:
            pdfmetrics.registerFont(TTFont(_name, _p))
        else:
            print(f"⚠ {_file} not found — Czech diacritics may not render in PDF")

except ImportError:
    HAS_REPORTLAB = False
    print("⚠ ReportLab not installed — PDF postcards disabled (pip install reportlab)")

# --- Optional: QR code generation ---
try:
    import qrcode

    HAS_QRCODE = True
except ImportError:
    HAS_QRCODE = False
    print("⚠ qrcode not installed — postcards will skip QR code")


def _make_qr_image(url, box_size=10, border=0):
    """Generate a QR code as a PIL Image with dark navy modules on transparent bg."""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    return qr.make_image(fill_color=(26, 26, 46), back_color=(250, 248, 243)).convert(
        "RGB"
    )


# =============================================================
# FLASK BASICS
# =============================================================

app = Flask(__name__)

# Postcard output directory (from config)
POSTCARD_DIR = Path(CFG["postcard"]["output_dir"])
POSTCARD_DIR.mkdir(exist_ok=True)

# Logo path (from config)
LOGO_PATH = Path(CFG["postcard"]["logo_path"])


# --- Postcard dimensions (from config) ---
def _page_dimensions(size_str):
    """Return (width_inches, height_inches) for a named page size."""
    s = size_str.lower()
    if s == "a6":
        return (5.827, 4.134)
    if s == "a5":
        return (8.268, 5.827)
    return (6.0, 4.0)  # default: standard postcard


_pw_in, _ph_in = _page_dimensions(CFG["postcard"]["page_size"])
PAGE_W = _pw_in * inch
PAGE_H = _ph_in * inch

ART_FRAC = float(CFG["postcard"]["art_fraction"])
ART_H = PAGE_H * ART_FRAC
ACCENT_H = 2  # gold accent line height (points)


# --- Route 1: Serve the main page ---
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# --- Route 4: Expose config to the frontend ---
@app.route("/api/config")
def api_config():
    """Return the subset of config the frontend needs."""
    enabled_sims = [s["id"] for s in CFG["simulations"] if s.get("enabled", True)]

    # Build a content map: sim_id -> normalised overrides dict.
    # The [content.*] sections in config.toml are flat key=value pairs;
    # we pass them through as-is so the JS can merge them freely.
    raw_content = CFG.get("content", {})
    ALL_SIM_IDS = ["rd", "osc", "boids", "neural"]
    content = {
        sim_id: dict(raw_content.get(sim_id, {})) for sim_id in ALL_SIM_IDS
    }

    branding = dict(CFG["branding"])
    # Surface logo_light_path alongside branding so the frontend can choose
    # the right logo image without knowing about the [postcard] section.
    branding["logo_light_path"] = CFG.get("postcard", {}).get("logo_light_path", "")

    return jsonify(
        {
            "simulations": enabled_sims,
            "branding": branding,
            "content": content,
        }
    )


# --- Route 2: Serve any static file (JS, CSS, images) ---
@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory("static", filename)


# --- Route 3: Receive a snapshot and make a postcard ---
@app.route("/api/snapshot", methods=["POST"])
def snapshot():
    """
    Expects JSON: {
        "image": "data:image/png;base64,...",  # high-res canvas screenshot (1800×1200)
        "title": "Turing Patterns",
        "subtitle": "Your parameter choices created this pattern",
        "sim_type": "rd", "osc", or "boids",
        "lang": "cs" or "en"
    }

    Produces:
      - A PDF postcard (vector text + high-res raster) → postcards/postcard_*.pdf
      - A fallback PNG postcard if ReportLab is missing → postcards/postcard_*.png
    """
    data = request.get_json()
    if not data or "image" not in data:
        return jsonify({"error": "No image data"}), 400

    # Decode the base64 image from the browser
    header, b64data = data["image"].split(",", 1)
    img_bytes = base64.b64decode(b64data)

    # Generate a unique filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    sim_type = data.get("sim_type", "unknown")
    lang = data.get("lang", "cs")
    title = data.get("title", "Turingovy vzory" if lang == "cs" else "Pattern")
    subtitle = data.get("subtitle", "")

    result = {"ok": True}

    if HAS_REPORTLAB and HAS_PIL:
        # --- Best path: PDF with vector text + high-res raster ---
        pattern_img = Image.open(pil_io.BytesIO(img_bytes)).convert("RGB")

        pdf_path = POSTCARD_DIR / f"postcard_{sim_type}_{timestamp}.pdf"
        assemble_pdf_postcard(pattern_img, title, subtitle, pdf_path)

        # Also save the sharpened PNG for easy preview
        png_preview = POSTCARD_DIR / f"postcard_{sim_type}_{timestamp}.png"
        pattern_img.save(png_preview, "PNG", optimize=False)

        result["pdf_filename"] = pdf_path.name
        result["filename"] = pdf_path.name
        print(
            f"✓ Saved PDF: {pdf_path.name}  ({pattern_img.size[0]}×{pattern_img.size[1]} source)"
        )

    elif HAS_PIL:
        # --- Fallback: raster PNG postcard via Pillow ---
        from PIL import ImageDraw, ImageFont

        pattern_img = Image.open(pil_io.BytesIO(img_bytes)).convert("RGB")
        postcard = assemble_png_postcard(pattern_img, title, subtitle)
        png_path = POSTCARD_DIR / f"postcard_{sim_type}_{timestamp}.png"
        postcard.save(png_path, quality=95)
        result["filename"] = png_path.name
        print(f"✓ Saved PNG: {png_path.name}")

    else:
        # --- Bare fallback: raw screenshot ---
        raw_path = POSTCARD_DIR / f"snapshot_{sim_type}_{timestamp}.png"
        raw_path.write_bytes(img_bytes)
        result["filename"] = raw_path.name
        print(f"✓ Saved raw: {raw_path.name}")

    return jsonify(result)


# =============================================================
# PDF POSTCARD ASSEMBLY (ReportLab)
# =============================================================


def assemble_pdf_postcard(pattern_img, title, subtitle, output_path):
    """
    Creates a 6×4 inch PDF postcard:
      - Simulation image fills top portion
      - Gold accent line
      - Title row: sim name (bold serif) + ICS logo (right)
      - Separator
      - Branding row: institution name (left) + QR code (right)
      - Tagline + event year (bottom left, grey)

    Footer is laid out bottom-up to guarantee nothing clips below page edge.
    """
    pc = CFG["postcard"]
    margin = 12

    c = pdf_canvas.Canvas(str(output_path), pagesize=(PAGE_W, PAGE_H))

    # -- Background (cream) --
    c.setFillColor(Color(250 / 255, 248 / 255, 243 / 255))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    # ── Layout footer bottom-up ──
    # Row 3 (bottom): tagline + event — baseline at 6pt from page bottom
    tagline_y = 6
    # Row 2: institution name — baseline 12pt above tagline
    inst_y = tagline_y + 13
    # Separator line — above institution
    sep_y = inst_y + 12
    # Row 1: title baseline — above separator, with room for 40pt logo
    title_y = sep_y + 18
    # Gold accent line top = title baseline + ascender + logo headroom
    footer_top = title_y + 28
    # Accent line sits on top of footer
    accent_bottom = footer_top
    art_bottom = accent_bottom + ACCENT_H

    # -- Simulation image (top portion) --
    img_reader = ImageReader(pattern_img)
    c.drawImage(
        img_reader, 0, art_bottom, width=PAGE_W, height=PAGE_H - art_bottom,
        preserveAspectRatio=False,
    )

    # -- Gold accent line --
    c.setFillColor(Color(200 / 255, 184 / 255, 138 / 255))
    c.rect(0, accent_bottom, PAGE_W, ACCENT_H, fill=1, stroke=0)

    # -- Title row: sim name + ICS logo --
    c.setFont("DejaVuSerif-Bold", 14)
    c.setFillColor(Color(26 / 255, 26 / 255, 46 / 255))
    c.drawString(margin, title_y, title)

    # ICS logo — right side of title row, must not exceed accent line
    logo_size = min(40, accent_bottom - sep_y - 4)
    logo_x = PAGE_W - logo_size - margin
    logo_y = accent_bottom - logo_size - 2  # top edge 2pt below accent
    try:
        if LOGO_PATH.exists():
            logo_reader = ImageReader(str(LOGO_PATH))
            c.drawImage(
                logo_reader, logo_x, logo_y,
                width=logo_size, height=logo_size,
                preserveAspectRatio=True, mask="auto",
            )
        else:
            raise FileNotFoundError
    except Exception:
        c.setFont("DejaVuSans-Bold", 10)
        c.setFillColor(Color(200 / 255, 184 / 255, 138 / 255))
        c.drawString(logo_x + 4, logo_y + 10, "ICS")

    # -- Thin separator --
    c.setStrokeColor(Color(224 / 255, 220 / 255, 212 / 255))
    c.setLineWidth(0.5)
    sep_end = margin + (logo_x - 8 - margin) * 0.5
    c.line(margin, sep_y, sep_end, sep_y)

    # -- Institution name --
    c.setFont("DejaVuSans-Bold", 8)
    c.setFillColor(Color(26 / 255, 26 / 255, 46 / 255))
    c.drawString(margin, inst_y, pc["footer_institution"])


    # -- QR code (right side, spanning inst+tagline rows) --
    if HAS_QRCODE and HAS_PIL:
        qr_size = 28
        # Centre QR horizontally under the logo
        logo_centre_x = logo_x + logo_size / 2
        qr_x = logo_centre_x - qr_size / 2
        qr_y = tagline_y
        qr_img = _make_qr_image(pc["qr_url"], box_size=10, border=0)
        qr_reader = ImageReader(qr_img)
        c.drawImage(
            qr_reader, qr_x, qr_y,
            width=qr_size, height=qr_size,
            preserveAspectRatio=True,
        )

    c.save()


# =============================================================
# PNG POSTCARD ASSEMBLY (Pillow fallback)
# =============================================================


def assemble_png_postcard(pattern_img, title="Turingovy vzory", subtitle=""):
    """
    Fallback: assembles a high-res raster postcard (same layout as PDF).
    """
    from PIL import ImageDraw, ImageFont

    pc = CFG["postcard"]
    src_w, src_h = pattern_img.size
    PW = max(src_w, 1800)
    PH = int(PW * 2 / 3)
    PATTERN_H = int(PH * ART_FRAC)

    card = Image.new("RGB", (PW, PH), (250, 248, 243))
    pat = pattern_img.resize((PW, PATTERN_H), Image.LANCZOS)
    card.paste(pat, (0, 0))

    draw = ImageDraw.Draw(card)
    scale = PW / 900

    def load_font(name, size):
        paths = [
            f"/usr/share/fonts/truetype/dejavu/{name}.ttf",
            f"/usr/share/fonts/TTF/{name}.ttf",
            f"C:/Windows/Fonts/{name}.ttf",
        ]
        for p in paths:
            try:
                return ImageFont.truetype(p, int(size * scale))
            except (OSError, IOError):
                continue
        return ImageFont.load_default()

    ft_title = load_font("DejaVuSerif-Bold", 28)
    ft_inst = load_font("DejaVuSans-Bold", 16)
    ft_sm = load_font("DejaVuSans", 13)
    margin = int(24 * scale)

    # Gold accent line
    accent_h = max(4, PH // 150)
    draw.rectangle([(0, PATTERN_H), (PW, PATTERN_H + accent_h)], fill=(200, 184, 138))
    footer_y = PATTERN_H + accent_h

    # Title row: sim name + ICS logo
    logo_dim = int(72 * scale)
    lx = PW - logo_dim - margin
    ly = footer_y + int(6 * scale)

    draw.text((margin, footer_y + int(14 * scale)), title, fill=(26, 26, 46), font=ft_title)

    try:
        if LOGO_PATH.exists():
            logo = Image.open(LOGO_PATH).convert("RGBA")
            logo.thumbnail((logo_dim, logo_dim), Image.LANCZOS)
            card.paste(logo, (lx, ly), logo if logo.mode == "RGBA" else None)
        else:
            raise FileNotFoundError
    except Exception:
        ft_logo = load_font("DejaVuSans-Bold", 16)
        draw.text((lx + int(10 * scale), ly + int(16 * scale)), "ICS", fill=(200, 184, 138), font=ft_logo)

    # Separator
    sep_y = footer_y + int(56 * scale)
    sep_end_png = margin + (lx - int(8 * scale) - margin) // 2
    draw.line([(margin, sep_y), (sep_end_png, sep_y)], fill=(224, 220, 212), width=max(1, int(scale)))

    # Branding row: institution + QR
    draw.text((margin, sep_y + int(8 * scale)), pc["footer_institution"], fill=(26, 26, 46), font=ft_inst)

    # QR code
    if HAS_QRCODE:
        qr_dim = int(60 * scale)
        qr_img = _make_qr_image(pc["qr_url"], box_size=10, border=0)
        qr_img = qr_img.resize((qr_dim, qr_dim), Image.NEAREST)
        card.paste(qr_img, (PW - qr_dim - margin, sep_y + int(4 * scale)))

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
