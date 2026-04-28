/**
 * engine.js — Main simulation engine / orchestrator
 *
 * Manages the simulation registry, animation loop, tab switching,
 * and wires up controls ↔ simulations ↔ rendering.
 * No simulation-specific code lives here.
 */

import { initWebGL, getGL, getCanvas, resizeDisplayCanvas } from "./webgl.js";
import { mergeTranslations, setLang, getLang, t } from "./i18n.js";
import { setupInteraction, touchPos, touchActive, touchButton, frameTick } from "./interaction.js";
import { buildControls } from "./controls.js";
import { renderEquations, toggleEquations } from "./equations.js";
import { takeSnapshot } from "./snapshot.js";

// Leave ~3ms margin before the 16.7ms frame budget expires.
// This prevents the simulation loop from starving the render pass.
const FRAME_DEADLINE_MS = 13;

// Cap render rate at 60fps to prevent GPU hammering on high-refresh displays.
const MIN_FRAME_MS = 1000 / 60;
let lastRenderTime = -Infinity; // -Infinity forces first frame to always render

// ─── State ──────────────────────────────────────────────────────

/** @type {Map<string, Object>} Registered simulation modules */
const registry = new Map();

/** @type {string[]} Ordered list of sim IDs (insertion order) */
const simOrder = [];

/** @type {Object|null} Currently active simulation module */
let activeSim = null;

let stepAccum = 0; // Accumulates fractional steps when speed < 1

/** @type {{ getParams: Function, getSpeed: Function, getColourScheme: Function }|null} */
let activeControls = null;

/** @type {number|null} requestAnimationFrame ID */
let rafId = null;

/** @type {boolean} Whether the animation is paused by the user */
let paused = false;
let activePresetParams = {}; // non-slider flags (seed_mode, auto_pause) for current preset

// ─── Public API ─────────────────────────────────────────────────

/**
 * Register a simulation module.
 * Call this before init() for each sim you want available.
 * @param {Object} sim  Simulation module (must have id, setup, teardown, step, render)
 */
export function registerSim(sim) {
    registry.set(sim.id, sim);
    simOrder.push(sim.id);

    // Merge the sim's translations into the global store
    if (sim.translations) {
        mergeTranslations(sim.translations);
    }
}

/**
 * Initialise the engine: set up WebGL, build tabs, start the first sim.
 */
export function init(defaultLang) {
    const canvasEl = document.getElementById("simCanvas");
    if (!canvasEl) {
        console.error("Canvas element #simCanvas not found");
        return;
    }

    const result = initWebGL(canvasEl);
    if (!result) return;

    // Keep draw buffer sharp when the container is resized (e.g. window resize,
    // devtools open/close, or the exhibit monitor changes resolution).
    const _resizeObserver = new ResizeObserver(() => {
        if (resizeDisplayCanvas(canvasEl) && activeSim) {
            activeSim.render(result.gl, canvasEl, activeControls?.getColourScheme?.() ?? 0);
        }
    });
    _resizeObserver.observe(canvasEl.parentElement);
    // Initial sizing — canvas may already be displayed at a non-default size.
    resizeDisplayCanvas(canvasEl);

    // Apply default language from config before building any UI
    if (defaultLang) {
        setLang(defaultLang);
    }

    setupInteraction(canvasEl);

    // Paused-drawing: fire after interaction.js has already updated touchPos
    canvasEl.addEventListener("pointerdown", handlePausedDraw);
    canvasEl.addEventListener("pointermove", handlePausedDraw);

    // Build tab buttons
    buildTabs();

    // Wire up action buttons
    document.getElementById("btn-reset").addEventListener("click", () => resetSim(activePresetParams));
    document.getElementById("btn-pause").addEventListener("click", togglePause);
    document.getElementById("btn-snapshot").addEventListener("click", doSnapshot);

    // Keyboard shortcuts: S = snapshot, P = pause/resume, R = reset
    document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
        if (e.key === "s" || e.key === "S") doSnapshot();
        else if (e.key === "p" || e.key === "P") togglePause();
        else if (e.key === "r" || e.key === "R") resetSim(activePresetParams);
    });

    // Wire up equation panel toggle
    document.getElementById("eq-header").addEventListener("click", toggleEquations);

    // Wire up language toggle
    document.querySelectorAll(".lang-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const lang = btn.dataset.lang;
            setLang(lang, () => onLangSwitch(lang));
        });
    });

    // Pause animation when tab/window is hidden (saves GPU during idle kiosk time)
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        } else if (rafId === null && !paused) {
            animate();
        }
    });

    // WebGL context loss recovery (GPU driver hiccup during long exhibition runs)
    canvasEl.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        console.warn("WebGL context lost — waiting for restore…");
    });

    canvasEl.addEventListener("webglcontextrestored", () => {
        console.log("WebGL context restored — reinitialising…");
        const result = initWebGL(canvasEl);
        if (!result) return;
        if (activeSim && activeControls) {
            const params = activeControls.getParams();
            activeSim.setup(result.gl, result.canvas, params);
        }
        if (!paused) animate();
    });

    // Wait for KaTeX then start
    waitForKaTeX(() => {
        // Activate the first registered sim
        if (simOrder.length > 0) {
            switchSim(simOrder[0]);
        }

        // Start the render loop
        animate();
        console.log("✓ Veletrh simulator ready");
    });
}

// ─── Internal ───────────────────────────────────────────────────

function buildTabs() {
    const tabsContainer = document.getElementById("sim-tabs");
    if (!tabsContainer) return;

    // Rebuild pill buttons on each call (also triggered on lang switch)
    tabsContainer.innerHTML = "";
    simOrder.forEach((id, idx) => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (activeSim?.id === id ? " active" : "");
        btn.dataset.simId = id;
        const label = t("tab_" + id);
        btn.textContent = `${String(idx + 1).padStart(2, "0")}  ${label}`;
        btn.addEventListener("click", () => switchSim(id));
        tabsContainer.appendChild(btn);
    });
}

function updateHeadline() {
    if (!activeSim) return;

    const h1        = document.querySelector(".app-headline");
    const tag       = document.querySelector(".app-tagline");
    const kicker    = document.querySelector(".kicker");
    const simNameEl = document.getElementById("canvas-sim-name");

    const title = t("tab_" + activeSim.id);
    const idx   = simOrder.indexOf(activeSim.id) + 1;

    if (h1)        h1.textContent       = title;
    if (tag)       tag.textContent      = t("tagline");
    if (simNameEl) simNameEl.textContent = title;
    if (kicker)    kicker.textContent   = `${String(idx).padStart(2, "0")} · ${t("sim_label")}`;
}

function switchSim(id) {
    const sim = registry.get(id);
    if (!sim) return;

    const gl = getGL();
    const canvas = getCanvas();

    // Teardown previous sim
    if (activeSim) {
        activeSim.teardown(gl);
    }

    activeSim = sim;
    activePresetParams = {};
    stepAccum = 0; // reset so a new sim starts cleanly

    // Re-merge translations so shared keys (e.g. 'desc') reflect the active sim
    if (sim.translations) {
        mergeTranslations(sim.translations);
    }

    // Update active pill
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.simId === id);
    });

    // Sync headline/kicker/tagline to active sim
    updateHeadline();

    // Build controls in sidebar
    const controlsContainer = document.getElementById("sim-controls");
    const callbacks = {
        onParamChange: () => { },  // live params — no action needed, read each frame
        onPreset: (preset) => {
            // Pass full preset.params so non-slider flags (seed_mode, auto_pause)
            // reach initState — getParams() only returns slider values.
            activePresetParams = preset.params ?? {};
            resetSim(preset.params);
            const wantPaused = !!preset.params?.auto_pause;
            if (wantPaused !== paused) togglePause();
        },
        onColourChange: () => { },  // live — read each frame
        onReset: () => resetSim(activePresetParams),
    };
    activeControls = buildControls(sim, controlsContainer, callbacks);

    // Setup the simulation with initial params
    const params = activeControls.getParams();
    sim.setup(gl, canvas, params);

    // Render equations
    renderEquations(sim, getLang());

    // Sync draw mode cursor/hint for new sim
    updateDrawMode();
}

function doSnapshot() {
    if (!activeSim) return;
    const gl = getGL();
    const canvas = getCanvas();
    const cs = activeControls ? activeControls.getColourScheme() : 0;
    takeSnapshot(canvas, activeSim, () => activeSim.render(gl, canvas, cs));
}

function togglePause() {
    paused = !paused;
    const btn = document.getElementById("btn-pause");
    if (btn) {
        btn.dataset.i18n = paused ? "resume" : "pause";
        btn.textContent = t(btn.dataset.i18n);
        btn.classList.toggle("btn-paused", paused);
    }
    if (paused) {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    } else {
        animate();
    }
    updateDrawMode();
}

function updateDrawMode() {
    const canvasEl = getCanvas();
    if (!canvasEl) return;
    const inDrawMode = paused && !!activeSim?.canPaint;
    canvasEl.style.cursor = inDrawMode ? "crosshair" : "";
    const hint = document.querySelector(".touch-hint");
    if (hint) {
        hint.dataset.i18n = inDrawMode ? "draw_hint" : "touch_hint";
        hint.textContent = t(hint.dataset.i18n);
    }
}

function handlePausedDraw(e) {
    if (!paused) return;
    if (!activeSim?.canPaint) return;
    if (e.type === "pointermove" && e.buttons === 0) return;
    activeSim.paintStroke(touchPos, activeControls?.getInteractionRadius() ?? activeSim.paintRadius);
    const gl = getGL();
    const canvas = getCanvas();
    activeSim.render(gl, canvas, activeControls?.getColourScheme?.() ?? 0);
}

function resetSim(extraParams = {}) {
    if (!activeSim || !activeControls) return;
    const gl = getGL();
    const canvas = getCanvas();

    activeSim.teardown(gl);
    const params = { ...activeControls.getParams(), ...extraParams };
    activeSim.setup(gl, canvas, params);
    // Render once immediately so the new initial state is visible even when paused.
    activeSim.render(gl, canvas, activeControls.getColourScheme());
}

function animate() {
    const now = performance.now();

    if (now - lastRenderTime >= MIN_FRAME_MS) {
        lastRenderTime = now;

        if (activeSim && activeControls) {
            const gl = getGL();
            const canvas = getCanvas();
            const params = activeControls.getParams();
            const speed = activeControls.getSpeed();
            const colourScheme = activeControls.getColourScheme();

            const touch = { pos: touchPos, active: touchActive, button: touchButton, radius: activeControls.getInteractionRadius() };

            // Fractional-speed accumulator: supports speed < 1 (e.g. 0.2 = 1 step/5 frames).
            // For speed >= 1 this behaves identically to the old integer loop.
            const frameDeadline = now + FRAME_DEADLINE_MS;
            stepAccum += speed;
            let didStep = false;
            while (stepAccum >= 1.0) {
                activeSim.step(params, touch);
                stepAccum -= 1.0;
                didStep = true;
                if (didStep && performance.now() > frameDeadline) { stepAccum = 0; break; }
            }

            // Display
            activeSim.render(gl, canvas, colourScheme);
        }

        frameTick();
    }

    rafId = requestAnimationFrame(animate);
}

function onLangSwitch(lang) {
    // Re-render equations for the active sim
    if (activeSim) {
        renderEquations(activeSim, lang);
    }

    // Rebuild controls to update i18n labels
    if (activeSim && activeControls) {
        const controlsContainer = document.getElementById("sim-controls");
        const callbacks = {
            onParamChange: () => { },
            onPreset: () => resetSim(),
            onColourChange: () => { },
            onReset: () => resetSim(),
        };
        activeControls = buildControls(activeSim, controlsContainer, callbacks);
    }

    // Rebuild pill buttons (updates translated labels, keeps active selection)
    buildTabs();
    updateHeadline();
}

function waitForKaTeX(callback) {
    if (typeof katex !== "undefined") {
        callback();
        return;
    }
    // Poll for KaTeX (loaded with defer)
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        if (typeof katex !== "undefined") {
            clearInterval(interval);
            callback();
        } else if (attempts > 50) {
            // Give up after 5 seconds — proceed without KaTeX
            clearInterval(interval);
            console.warn("KaTeX not loaded — equations will use fallback HTML");
            callback();
        }
    }, 100);
}
