/**
 * engine.js — Main simulation engine / orchestrator
 *
 * Manages the simulation registry, animation loop, tab switching,
 * and wires up controls ↔ simulations ↔ rendering.
 * No simulation-specific code lives here.
 */

import { initWebGL, getGL, getCanvas } from "./webgl.js";
import { mergeTranslations, setLang, getLang, t } from "./i18n.js";
import { setupInteraction, touchPos, touchActive, touchButton, frameTick } from "./interaction.js";
import { buildControls } from "./controls.js";
import { renderEquations, toggleEquations } from "./equations.js";
import { takeSnapshot } from "./snapshot.js";

// ─── State ──────────────────────────────────────────────────────

/** @type {Map<string, Object>} Registered simulation modules */
const registry = new Map();

/** @type {string[]} Ordered list of sim IDs (insertion order) */
const simOrder = [];

/** @type {Object|null} Currently active simulation module */
let activeSim = null;

/** Fractional step accumulator — allows speed < 1 (e.g. 0.2 = 1 step every 5 frames) */
let _stepAccum = 0;

/** @type {{ getParams: Function, getSpeed: Function, getColourScheme: Function }|null} */
let activeControls = null;

/** @type {number|null} requestAnimationFrame ID */
let rafId = null;

/** @type {boolean} Whether the animation is paused by the user */
let paused = false;

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

    // Apply default language from config before building any UI
    if (defaultLang) {
        setLang(defaultLang);
    }

    setupInteraction(canvasEl);

    // Build tab buttons
    buildTabs();

    // Wire up action buttons
    document.getElementById("btn-reset").addEventListener("click", resetSim);
    document.getElementById("btn-pause").addEventListener("click", togglePause);
    document.getElementById("btn-snapshot").addEventListener("click", doSnapshot);

    // Keyboard shortcuts: S = snapshot, P = pause/resume, R = reset
    document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
        if (e.key === "s" || e.key === "S") doSnapshot();
        else if (e.key === "p" || e.key === "P") togglePause();
        else if (e.key === "r" || e.key === "R") resetSim();
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

    // Re-use existing <select> if already built, otherwise create it
    let sel = tabsContainer.querySelector("select.sim-select");
    if (!sel) {
        sel = document.createElement("select");
        sel.className = "sim-select";
        sel.addEventListener("change", () => switchSim(sel.value));
        tabsContainer.appendChild(sel);
    }

    // Rebuild options (called on lang switch too, so labels must update)
    sel.innerHTML = "";
    for (const id of simOrder) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.dataset.i18n = "tab_" + id;
        opt.textContent = t("tab_" + id);
        sel.appendChild(opt);
    }

    if (activeSim) sel.value = activeSim.id;
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
    _stepAccum = 0; // reset so a new sim starts cleanly

    // Re-merge translations so shared keys (e.g. 'desc') reflect the active sim
    if (sim.translations) {
        mergeTranslations(sim.translations);
    }

    // Update dropdown selection
    const sel = document.querySelector(".sim-select");
    if (sel) sel.value = id;

    // Build controls in sidebar
    const controlsContainer = document.getElementById("sim-controls");
    const callbacks = {
        onParamChange: () => { },  // live params — no action needed, read each frame
        onPreset: (preset) => resetSim(),
        onColourChange: () => { },  // live — read each frame
        onReset: () => resetSim(),
    };
    activeControls = buildControls(sim, controlsContainer, callbacks);

    // Setup the simulation with initial params
    const params = activeControls.getParams();
    sim.setup(gl, canvas, params);

    // Render equations
    renderEquations(sim, getLang());
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
}

function resetSim() {
    if (!activeSim || !activeControls) return;
    const gl = getGL();
    const canvas = getCanvas();

    activeSim.teardown(gl);
    const params = activeControls.getParams();
    activeSim.setup(gl, canvas, params);
}

function animate() {
    if (activeSim && activeControls) {
        const gl = getGL();
        const canvas = getCanvas();
        const params = activeControls.getParams();
        const speed = activeControls.getSpeed();
        const colourScheme = activeControls.getColourScheme();

        const touch = { pos: touchPos, active: touchActive, button: touchButton };

        // Fractional-speed accumulator: supports speed < 1 (e.g. 0.2 = 1 step/5 frames).
        // For speed >= 1 this behaves identically to the old integer loop.
        const frameDeadline = performance.now() + 13; // ~13ms leaves margin for render + browser overhead
        _stepAccum += speed;
        let didStep = false;
        while (_stepAccum >= 1.0) {
            activeSim.step(params, touch);
            _stepAccum -= 1.0;
            didStep = true;
            if (didStep && performance.now() > frameDeadline) { _stepAccum = 0; break; }
        }

        // Display
        activeSim.render(gl, canvas, colourScheme);
    }

    frameTick();
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

    // Rebuild dropdown (updates translated labels, keeps active selection)
    buildTabs();
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
