# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Interactive web exhibit for Veletrh Vědy 2026 (Czech Science Fair) demonstrating emergent complexity through three real-time GPU simulations: Reaction-Diffusion (Gray-Scott), Kuramoto coupled oscillators, and Boids flocking. Visitors capture their patterns as print-ready postcards.

## Running the Project

```bash
uv run server.py
# Open http://localhost:5000
```

For kiosk/exhibition mode:
```bash
chromium-browser --kiosk http://localhost:5000
```

No build step — frontend is vanilla ES6 modules served directly by Flask.

## Architecture

### Backend (`server.py`)
Flask server with three responsibilities:
- Serve static files and `index.html`
- `GET /api/config` — returns `config.toml` content (enabled sims, branding, i18n text, parameter labels)
- `POST /api/snapshot` — receives base64 PNG + metadata, assembles a print-ready PDF postcard using ReportLab (with Pillow PNG fallback), saves to `postcards/`

### Frontend Data Flow
```
config.toml → /api/config → engine.js (registers sims, builds tabs/controls)
  → animation loop: sim.step(gl, params) → sim.render(gl, canvas, scheme)
  → snapshot.js: 1800×1200 capture → POST /api/snapshot → postcards/*.pdf
```

### Core JS Modules (`static/js/core/`)
| Module | Role |
|--------|------|
| `engine.js` | Main orchestrator: simulation registry, rAF loop, tab switching, event wiring |
| `webgl.js` | GL context init, shader compilation, texture/framebuffer helpers; exports `SIM_W=768`, `SIM_H=512`, `EXPORT_W=1800`, `EXPORT_H=1200` |
| `fieldSim.js` | Base class for field simulations (ping-pong texture pair, `step()`/`render()` lifecycle) |
| `controls.js` | Builds sidebar UI dynamically from sim control declarations; returns `getParams()`, `getSpeed()`, `getColourScheme()` |
| `i18n.js` | Czech/English translations; `setLang()` updates all `data-i18n` elements |
| `snapshot.js` | High-res canvas export, POSTs to `/api/snapshot` |
| `interaction.js` | Mouse/touch → position + button state for simulations |
| `equations.js` | KaTeX equation panel rendering |

### Simulation Modules (`static/js/sims/`)
Each sim exports a standard interface: `id`, `setup(gl, canvas)`, `teardown(gl)`, `step(gl, params)`, `render(gl, canvas, colourScheme)`, `controls`, `presets`, `translations`, optional `applyContent(overrides)`.

- **`reaction-diffusion.js`** — Gray-Scott model via GLSL (Laplacian diffusion + nonlinear reaction), 5 colour schemes, 5 presets. Extends `fieldSim.js`.
- **`kuramoto.js`** — Coupled phase oscillators; phase/frequency stored in texture; touch injects spiral waves. Extends `fieldSim.js`.
- **`boids.js`** — 1024 agents in a 32×32 texture; GPU N² neighbour scan; three modes (flocking/crowd/predator-prey); trail texture for motion blur. Does NOT extend `fieldSim.js`.
- **`neural-criticality.js`** — Beggs & Plenz (2003) SOC model. Runs on a **96×64 texture** (not 768×512) set via `simW`/`simH` in fieldSim config; each sim pixel = one visual neuron at 8× canvas scale. State: R=charge, G=refractory, B=trail. Long-range connections via deterministic hash (small-world topology). Cell-based display shader: sample state SHARPLY at cell centre → colour → Gaussian glow (never average raw state before colour-mapping or colour thresholds break). Extends `fieldSim.js`.

Use `static/js/sims/_template.js` when adding a new simulation.

## Configuration

All UI text, parameter labels/ranges, presets, and branding live in `config.toml`. Changes require a server restart. Content overrides flow from `config.toml` → `/api/config` → `applyContent()` in each sim module, enabling full localization without touching JS.

## Key Constraints
- WebGL must use `preserveDrawingBuffer: true` (needed for snapshot capture)
- Postcard output is 6×4" at 300 DPI (1800×1200 px); page size is configurable in `config.toml`
- Server binds to `0.0.0.0:5000` for network access from exhibition devices
- All UI text must support Czech (`_cs`) and English (`_en`) variants

## Display Shader Pattern (critical — easy to break)

When writing display shaders for field sims, always follow this order:
1. Sample state **sharply** at cell/pixel centre — no averaging
2. Compute colour from sharp state values (thresholds work correctly)
3. Multiply colour by Gaussian glow weight

**Never** average raw state channels over a kernel before colour-mapping. Bloom/blur must operate on *colours*, not state values. Averaging `refr=1.0` over an N×N kernel dilutes it below colour thresholds → black canvas.

GLSL functions must be declared before use — colour helpers before any function that calls them.

## Testing

Playwright is installed via uv. Use:
```bash
/home/dominikklepl/.local/share/uv/tools/playwright/bin/python script.py
```
Headless Chrome needs `--enable-webgl --use-gl=swiftshader`. Tabs are a `<select class="sim-select">` dropdown.
