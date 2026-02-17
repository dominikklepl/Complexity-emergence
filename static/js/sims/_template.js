/**
 * _template.js — Simulation template
 *
 * Copy this file and fill in each section to create a new simulation.
 * Then register it in your entry-point script (inside index.html):
 *
 *   import mySim from "./sims/my-sim.js";
 *   registerSim(mySim);
 *
 * That's it — the engine, controls, tabs, and equations are all
 * handled for you.
 *
 * For GPU field simulations (lattice of values evolved via shaders),
 * use the fieldSim() factory as shown below. For non-GPU sims you
 * can implement the 4-method interface manually instead.
 */

import { fieldSim } from "../core/fieldSim.js";
import { SIM_W, SIM_H } from "../core/webgl.js";

// ─── GLSL Shaders ───────────────────────────────────────────────

/**
 * Step shader: runs each simulation tick.
 * Receives uniforms: u_state (previous state texture), u_resolution,
 * u_touch (pointer position, -1 if inactive), u_touchRadius,
 * plus any sim-specific uniforms returned by getStepUniforms().
 * Must write to gl_FragColor — rgba becomes the new cell state.
 */
const STEP_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform vec2 u_touch;
uniform float u_touchRadius;

// Add your custom uniforms here, e.g.:
// uniform float u_myParam;

varying vec2 v_uv;

void main() {
    vec4 here = texture2D(u_state, v_uv);

    // Your simulation logic goes here.
    // Read neighbours, compute next state, handle touch…

    gl_FragColor = here;
}
`;

/**
 * Display shader: maps simulation state to visible colours.
 * Receives uniforms: u_state (current texture), u_colourScheme (int).
 * Must write to gl_FragColor with the pixel colour.
 */
const DISPLAY_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform int u_colourScheme;
varying vec2 v_uv;

void main() {
    vec4 state = texture2D(u_state, v_uv);
    float value = state.r;  // choose which channel(s) to visualise

    vec3 col;
    if (u_colourScheme == 0)      col = vec3(value);          // greyscale
    else if (u_colourScheme == 1) col = vec3(value, 0.5, 1.0 - value);
    else                          col = vec3(0.0);

    gl_FragColor = vec4(col, 1.0);
}
`;

// ─── Export simulation ──────────────────────────────────────────

export default fieldSim({
    /**
     * Unique identifier. Used internally and in CSS classes.
     * Keep it short, lowercase, no spaces.
     */
    id: "my_sim",

    shaders: {
        step: STEP_SHADER,
        display: DISPLAY_SHADER,
    },

    /**
     * Radius of the touch/pointer influence area (in UV space, 0-1).
     * Typical values: 0.03 (small brush) to 0.08 (big brush).
     */
    touchRadius: 0.04,

    /**
     * Create initial state data.
     * Returns a Float32Array of width × height × 4 (RGBA floats).
     * @param {number} width   – texture width  (SIM_W)
     * @param {number} height  – texture height  (SIM_H)
     * @param {object} params  – current slider values { paramId: value }
     */
    initState(width, height, params) {
        const data = new Float32Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            data[i * 4 + 0] = Math.random(); // r
            data[i * 4 + 1] = 0;             // g
            data[i * 4 + 2] = 0;             // b
            data[i * 4 + 3] = 1;             // a
        }
        return data;
    },

    /**
     * Return sim-specific uniforms for the step shader.
     * Each entry: { name: "u_xxx", type: "1f"|"2f"|…, values: [...] }
     */
    getStepUniforms(params) {
        return [
            // { name: "u_myParam", type: "1f", values: [params.myParam] },
        ];
    },

    /**
     * (Optional) Extra uniforms for the display shader beyond
     * u_colourScheme which is always set automatically.
     */
    getDisplayUniforms(params) {
        return [];
    },

    // ─── Controls ───────────────────────────────────────────

    /**
     * Array of control descriptors. Supported types:
     *   slider  – { id, min, max, step, default, i18nLabel, format }
     *   select  – { id, options: [{value, i18nLabel}], default, i18nLabel }
     *   toggle  – { id, default: true|false, i18nLabel }
     *
     * Add `resetsState: true` if changing this param should
     * reinitialise the simulation (e.g. baked-in initial values).
     */
    controls: [
        // { type: "slider", id: "myParam", min: 0, max: 1, step: 0.01,
        //   default: 0.5, i18nLabel: "my_param_label", format: 2 },
    ],

    /**
     * Pre-configured parameter combos. The engine builds preset
     * buttons automatically.
     */
    presets: [
        // { i18nLabel: "preset_default", params: { myParam: 0.5 } },
    ],

    /**
     * Colour scheme swatches.  `gradient` creates the swatch button.
     * The index of the selected scheme is passed to the display
     * shader as u_colourScheme.
     */
    colours: [
        { gradient: "linear-gradient(135deg, #222, #888)", i18nTitle: "Grayscale" },
    ],

    /**
     * Speed slider configuration.
     * `default` is the number of simulation steps per animation frame.
     */
    speedSlider: { min: 1, max: 20, default: 5 },

    // ─── Equations ──────────────────────────────────────────

    equations: {
        /**
         * Render the math / explanation into `container`.
         * Use KaTeX if available, with an HTML fallback.
         * @param {HTMLElement} container
         * @param {string}     lang – "cs" | "en"
         */
        render(container, lang) {
            const div = document.createElement("div");
            div.className = "eq-content";
            div.textContent = "(governing equations go here)";
            container.appendChild(div);
        },
    },

    // ─── Translations ───────────────────────────────────────

    /**
     * Flat key→{cs, en} map.  These are merged into the global
     * i18n store when the sim is registered.
     *
     * At minimum you need:
     *   tab_<id>  – tab button label
     *   desc      – sidebar description text
     */
    translations: {
        tab_my_sim: { cs: "Můj model", en: "My model" },
        desc: { cs: "Popis modelu.", en: "Model description." },
        // my_param_label: { cs: "Můj parametr", en: "My parameter" },
        // preset_default: { cs: "Výchozí", en: "Default" },
    },

    // ─── Snapshot ───────────────────────────────────────────

    /**
     * Postcard metadata. Return { title, subtitle } for the
     * current language.
     */
    snapshotMeta(lang) {
        const t = (key) => {
            const entry = this.translations[key];
            return entry ? (entry[lang] || entry.cs) : key;
        };
        return {
            title: t("snap_title"),
            subtitle: t("snap_sub"),
        };
    },
});
