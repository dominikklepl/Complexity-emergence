/**
 * engine.js — Main simulation engine / orchestrator
 *
 * Manages the simulation registry, animation loop, tab switching,
 * and wires up controls ↔ simulations ↔ rendering.
 * No simulation-specific code lives here.
 */

import { initWebGL, getGL, getCanvas } from "./webgl.js";
import { mergeTranslations, setLang, getLang, t } from "./i18n.js";
import { setupInteraction, touchPos, touchActive, frameTick } from "./interaction.js";
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

/** @type {{ getParams: Function, getSpeed: Function, getColourScheme: Function }|null} */
let activeControls = null;

/** @type {number|null} requestAnimationFrame ID */
let rafId = null;

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
export function init() {
    const canvasEl = document.getElementById("simCanvas");
    if (!canvasEl) {
        console.error("Canvas element #simCanvas not found");
        return;
    }

    const result = initWebGL(canvasEl);
    if (!result) return;

    setupInteraction(canvasEl);

    // Build tab buttons
    buildTabs();

    // Wire up action buttons
    document.getElementById("btn-reset").addEventListener("click", resetSim);
    document.getElementById("btn-snapshot").addEventListener("click", () => {
        if (!activeSim) return;
        const gl = getGL();
        const canvas = getCanvas();
        const cs = activeControls ? activeControls.getColourScheme() : 0;
        takeSnapshot(canvas, activeSim, () => activeSim.render(gl, canvas, cs));
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

    tabsContainer.innerHTML = "";

    for (const id of simOrder) {
        const sim = registry.get(id);
        const btn = document.createElement("button");
        btn.className = "tab-btn";
        btn.dataset.tab = id;
        btn.dataset.i18n = "tab_" + id;
        btn.textContent = t("tab_" + id);
        btn.addEventListener("click", () => switchSim(id));
        tabsContainer.appendChild(btn);
    }
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

    // Update tab buttons
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === id);
    });

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

        const touch = { pos: touchPos, active: touchActive };

        // Run multiple simulation steps per frame
        for (let i = 0; i < speed; i++) {
            activeSim.step(params, touch);
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

    // Rebuild tabs
    buildTabs();

    // Mark the active tab
    if (activeSim) {
        document.querySelectorAll(".tab-btn").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.tab === activeSim.id);
        });
    }
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
