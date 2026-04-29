# Complexity Emergence – Interactive Demonstration

An interactive web application demonstrating how complex patterns emerge from simple rules. Designed for [Veletrh Vědy](https://www.veletrhvedy.cz/) 2026 (Science Fair) at the stand of the [Institute of Computer Science, Czech Academy of Sciences](https://www.cs.cas.cz/).

## What it does

Visitors explore five GPU-accelerated simulations in real time, adjust parameters through a live sidebar, and save their creations as print-ready postcards.

| Simulation | Phenomenon |
|---|---|
| **Reaction-Diffusion** (Gray-Scott) | Turing patterns — spots, stripes, labyrinths |
| **Coupled Oscillators** (Kuramoto) | Synchronisation; touch injects spiral waves |
| **Boids** | Flocking, crowd dynamics, predator-prey |
| **Neural Criticality** | Brain avalanches at the edge of chaos (Beggs & Plenz SOC model) |
| **Double Pendulum** | Deterministic chaos and the butterfly effect |

The UI is fully bilingual (Czech / English), switchable at runtime.

## Postcards

Pressing **S** (or the Pohlednice button) captures the current pattern at 1800 × 1200 px and sends it to the server, which assembles a print-ready 6 × 4″ PDF with a branding ribbon and the institute logo. PDFs are saved to `postcards/`.

## Setup & Running

**Prerequisites:** [uv](https://docs.astral.sh/uv/getting-started/installation/) and a modern browser (Chrome/Chromium recommended).

```bash
git clone <repo-url>
cd "Complexity emergence postcard"
uv sync
uv run complexity-emergence
```

`uv sync` installs all dependencies and entry points. `complexity-emergence` starts the Flask server and opens the print utility in a separate terminal window. Then open `http://localhost:5000`.

**Print utility only:**
```bash
uv run print-postcards
```

**Exhibition kiosk mode** (hides browser UI):
```bash
chromium-browser --kiosk http://localhost:5000
```

The server binds to `0.0.0.0:5000` — accessible from any device on the same network.

## Configuration

All simulations, UI text, parameter labels, presets, and branding are controlled by `config.toml`. No JS changes needed for content tweaks. Requires a server restart after edits.

## Architecture

- **Backend** — Flask (`server.py`): serves static files, exposes `/api/config` and `/api/snapshot`, assembles PDFs with ReportLab.
- **Frontend** — Vanilla ES6 modules, no build step. WebGL runs all simulations; `engine.js` drives the render loop and tab switching.
- **Simulations** — Each sim in `static/js/sims/` exports a standard interface (`setup`, `step`, `render`, `teardown`, `controls`, `presets`). Add new ones via `_template.js`.

## Purpose

This exhibit demonstrates a key concept in complexity science: **simple local interactions can produce intricate global patterns** — from chemistry and neuroscience to physics and ecology.