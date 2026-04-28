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
    FONTS_DIR = Path(__file__).parent / "static" / "fonts"

    def _find_font(name, filename, fallback_dirs=None):
        p = FONTS_DIR / filename
        if p.exists():
            return str(p)
        for base in (fallback_dirs or []):
            q = Path(base) / filename
            if q.exists():
                return str(q)
        return None

    _dejavu_dirs = [
        "/usr/share/fonts/truetype/dejavu",
        "/usr/share/fonts/TTF",
        "/usr/share/fonts/dejavu",
    ]

    for _name, _file, _dirs in [
        ("DejaVuSerif-Bold",       "DejaVuSerif-Bold.ttf",       _dejavu_dirs),
        ("DejaVuSerif-Italic",     "DejaVuSerif-Italic.ttf",     _dejavu_dirs),
        ("DejaVuSans",             "DejaVuSans.ttf",              _dejavu_dirs),
        ("DejaVuSans-Bold",        "DejaVuSans-Bold.ttf",         _dejavu_dirs),
        ("PlayfairDisplay-Bold",   "PlayfairDisplay-Bold.ttf",   []),
        ("PlayfairDisplay-Italic", "PlayfairDisplay-Italic.ttf", []),
    ]:
        _p = _find_font(_name, _file, _dirs)
        if _p:
            pdfmetrics.registerFont(TTFont(_name, _p))
        else:
            print(f"⚠ {_file} not found — falling back for PDF text")

    def _font(name):
        _fallbacks = {
            "PlayfairDisplay-Bold":   "DejaVuSerif-Bold",
            "PlayfairDisplay-Italic": "DejaVuSerif-Italic",
        }
        try:
            pdfmetrics.getFont(name)
            return name
        except Exception:
            return _fallbacks.get(name, "Helvetica")

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


def _make_qr_image(url, box_size=10, border=1, dark_ink=False):
    """Generate a styled QR code: round dots on transparent background.

    dark_ink=False → white modules (for dark backgrounds)
    dark_ink=True  → dark navy modules (for light backgrounds)
    """
    from qrcode.image.styledpil import StyledPilImage
    from qrcode.image.styles.moduledrawers import RoundedModuleDrawer

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    # Generate black-on-white, then recolour and make background transparent
    img = qr.make_image(
        image_factory=StyledPilImage,
        module_drawer=RoundedModuleDrawer(),
    ).convert("RGBA")
    r, g, b, a = img.split()
    inv = r.point(lambda x: 255 - x)   # darkness of each pixel (255 = module, 0 = bg)
    module_r, module_g, module_b = (26, 26, 46) if dark_ink else (255, 255, 255)
    img = Image.merge("RGBA", (
        inv.point(lambda x: module_r),  # R
        inv.point(lambda x: module_g),  # G
        inv.point(lambda x: module_b),  # B
        inv,                             # A = original darkness (module opacity)
    ))
    return img


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
    """Full-bleed art postcard: gradient vignette, Playfair Display text, styled QR."""
    pc = CFG["postcard"]
    margin = 12   # pt from page edge
    pad    = 6    # extra pt between logo edge and page edge

    # -- Composite gradient vignette onto simulation image (PIL) --
    img_rgba = pattern_img.convert("RGBA")
    w, h = img_rgba.size
    vignette_h = int(h * 0.32)
    vignette = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    from PIL import ImageDraw as _IDraw
    vdraw = _IDraw.Draw(vignette)
    steps = 64
    for i in range(steps):
        alpha = int(230 * (i / (steps - 1)) ** 1.6)
        y_top    = h - vignette_h + int(vignette_h * i / steps)
        y_bottom = h - vignette_h + int(vignette_h * (i + 1) / steps)
        vdraw.rectangle([0, y_top, w, y_bottom], fill=(6, 10, 18, alpha))
    composited = Image.alpha_composite(img_rgba, vignette).convert("RGB")

    # -- Detect ink colour from the composited text zone --
    # Sample bottom-left region where text will sit; choose dark or light ink.
    sample_x2 = w // 3
    sample_y1 = h - int(h * 0.18)
    zone = composited.crop((0, sample_y1, sample_x2, h))
    pixels = list(zone.getdata())
    avg_lum = sum(0.299 * r + 0.587 * g + 0.114 * b for r, g, b in pixels) / len(pixels)
    dark_ink = avg_lum > 140   # light background → use dark ink

    if dark_ink:
        # Dark navy ink on light background
        ink       = Color(0.102, 0.118, 0.176, 1.0)   # (26,30,45)
        ink_mid   = Color(0.102, 0.118, 0.176, 0.55)
        ink_dim   = Color(0.102, 0.118, 0.176, 0.40)
    else:
        # White ink on dark background
        ink       = Color(1, 1, 1, 0.92)
        ink_mid   = Color(1, 1, 1, 0.50)
        ink_dim   = Color(1, 1, 1, 0.38)

    c = pdf_canvas.Canvas(str(output_path), pagesize=(PAGE_W, PAGE_H))

    # -- Full-bleed composited image --
    img_reader = ImageReader(composited)
    c.drawImage(img_reader, 0, 0, width=PAGE_W, height=PAGE_H,
                preserveAspectRatio=False)

    # -- Logo overlay: top-left --
    logo_w = PAGE_W * 0.28
    logo_h = logo_w * (189 / 768)
    logo_x = margin
    logo_y = PAGE_H - margin - logo_h
    WHITE_MASK = [220, 255, 220, 255, 220, 255]
    try:
        if LOGO_PATH.exists():
            c.drawImage(ImageReader(str(LOGO_PATH)), logo_x, logo_y,
                        width=logo_w, height=logo_h,
                        preserveAspectRatio=True, mask=WHITE_MASK)
    except Exception:
        pass

    # -- Text block: bottom-left in vignette zone --
    text_x = margin + pad
    text_y_base = margin + 4

    # Sub-line 2: event (dimmer, bottom-most)
    c.setFont(_font("PlayfairDisplay-Italic"), 9)
    c.setFillColor(ink_dim)
    c.drawString(text_x, text_y_base, pc.get("footer_event", "Veletrh Vědy 2026"))

    # Sub-line 1: institution (slightly brighter, above event)
    c.setFont(_font("PlayfairDisplay-Italic"), 9)
    c.setFillColor(ink_mid)
    c.drawString(text_x, text_y_base + 13, pc.get("footer_institution", "Ústav informatiky AV ČR"))

    # Sim title (bold, top of text block)
    c.setFont(_font("PlayfairDisplay-Bold"), 18)
    c.setFillColor(ink)
    c.drawString(text_x, text_y_base + 27, title)

    # -- Styled QR: bottom-right in vignette zone --
    if HAS_QRCODE and HAS_PIL:
        qr_size = PAGE_W * 0.10
        qr_x = PAGE_W - margin - qr_size
        qr_y = margin
        qr_img = _make_qr_image(pc["qr_url"], box_size=10, border=1, dark_ink=dark_ink)
        c.drawImage(ImageReader(qr_img), qr_x, qr_y,
                    width=qr_size, height=qr_size,
                    preserveAspectRatio=True, mask="auto")

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
        card.paste(qr_img, (PW - qr_dim - margin, sep_y + int(4 * scale)), mask=qr_img)

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
