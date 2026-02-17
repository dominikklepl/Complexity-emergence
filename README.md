# Complexity Emergence – Interactive Demonstration

An interactive web application demonstrating how complex patterns emerge from simple rules. Designed for [Veletrh Vědy](https://www.veletrhvedy.cz/) 2026 (Science Fair) at the stand of the [Institute of Computer Science, Czech Academy of Sciences](https://www.cs.cas.cz/).

## What it does

Visitors can explore pattern formation through two interactive simulations:

- **Reaction-Diffusion Systems** – Create Turing patterns (spots, stripes, labyrinths) by adjusting chemical reaction parameters
- **Coupled Oscillators** – Observe synchronization phenomena in networks of connected oscillators

The application lets visitors experiment with parameters in real-time and save their created patterns as personalized postcards.

## How it works

The simulation runs entirely in the browser using WebGL for real-time computation. A local Flask server handles:
- Serving the web interface
- Receiving pattern snapshots
- Assembling print-ready postcards with educational information

## Running the application

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server
python server.py

# Open in browser
firefox --kiosk http://localhost:5000
```

The kiosk mode is recommended for exhibition use.

## Purpose

This exhibit demonstrates a key concept in complexity science: **simple local interactions can produce intricate global patterns**. It's an accessible introduction to emergent phenomena in natural and artificial systems.