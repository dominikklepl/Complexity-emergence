/**
 * neural-criticality.js — Neural avalanche / self-organised criticality simulation
 *
 * Models a 2D grid of neurons, each accumulating charge from neighbours.
 * When a neuron reaches threshold it fires: resets and spreads charge to 4 neighbours.
 * Random background noise drives spontaneous activity.
 *
 * State texture (2 channels):
 *   R = charge u ∈ [0, ∞)   (threshold = 1.0)
 *   G = refractory r ∈ [0,1] (1 = just fired, decays each step)
 *
 * Key insight: at spread ≈ 0.25 the system is critical — avalanches appear in
 * all sizes simultaneously (power-law distribution).  Below: silence.  Above: seizure.
 *
 * Science: Beggs & Plenz (2003) neural avalanches, self-organised criticality (Bak 1987).
 */

import { fieldSim } from "../core/fieldSim.js";
import { SIM_W, SIM_H } from "../core/webgl.js";

// ─── GLSL Shaders ────────────────────────────────────────────────

const STEP_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform vec2  u_resolution;
uniform float u_spread;      // charge per fired neighbour (≈0.25 = critical)
uniform float u_input;       // probability a resting cell gets a random spike
uniform float u_leak;        // fraction of charge lost each step
uniform float u_seed;        // changes each step for unique noise pattern
uniform vec2  u_touch;
uniform float u_touchRadius;
uniform float u_touchButton; // 0 = left (stimulate), 1 = right (silence)

varying vec2 v_uv;

const float THRESHOLD = 1.0;
const float REFRAC_DECAY = 0.75; // refractory signal halves per ~3 steps

float rand(vec2 co) {
    return fract(sin(dot(co + u_seed, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec2 dx = vec2(1.0 / u_resolution.x, 0.0);
    vec2 dy = vec2(0.0,  1.0 / u_resolution.y);

    vec2 here = texture2D(u_state, v_uv).rg;
    float u    = here.r;
    float refr = here.g;

    // Neighbours: fire = 1 if charge was ≥ threshold last step
    float n_up    = step(THRESHOLD, texture2D(u_state, v_uv + dy).r);
    float n_down  = step(THRESHOLD, texture2D(u_state, v_uv - dy).r);
    float n_left  = step(THRESHOLD, texture2D(u_state, v_uv - dx).r);
    float n_right = step(THRESHOLD, texture2D(u_state, v_uv + dx).r);
    float incoming = (n_up + n_down + n_left + n_right) * u_spread;

    float new_u;
    float new_refr;

    if (refr > 0.5) {
        // Absolute refractory: cell cannot fire again yet, charge stays at 0
        new_u    = 0.0;
        new_refr = refr * REFRAC_DECAY;
    } else if (u >= THRESHOLD) {
        // Cell fires this step
        new_u    = 0.0;
        new_refr = 1.0;
    } else {
        // Normal accumulation: leak + incoming + random spark
        float noise = step(1.0 - u_input, rand(v_uv)) * 0.5;
        new_u    = clamp(u * (1.0 - u_leak) + incoming + noise, 0.0, 2.0);
        new_refr = refr * REFRAC_DECAY;
    }

    // Touch: stimulate (left) or silence (right)
    if (u_touch.x >= 0.0) {
        float dist = length(v_uv - u_touch);
        if (dist < u_touchRadius) {
            float str = 1.0 - dist / u_touchRadius;
            if (u_touchButton < 0.5) {
                new_u += str * 0.5;  // inject charge
            } else {
                new_u *= (1.0 - str * 0.9);  // drain charge
            }
        }
    }

    gl_FragColor = vec4(new_u, new_refr, 0.0, 1.0);
}
`;

const DISPLAY_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform int u_colourScheme;
varying vec2 v_uv;

const float THRESHOLD = 1.0;

// Scheme 0: Neural scan — purple glow, white fire flash
vec3 neural_scan(float t, float refr) {
    if (refr > 0.05) {
        // Recently fired: bright white-cyan flash decaying to purple
        vec3 flash = vec3(0.8, 0.95, 1.0);
        vec3 after = vec3(0.15, 0.02, 0.28);
        return mix(after, flash, refr * refr);
    }
    // Charging: dark purple → bright magenta at threshold
    vec3 dark = vec3(0.02, 0.0, 0.06);
    vec3 hot  = vec3(0.75, 0.1, 0.9);
    return mix(dark, hot, clamp(t * 1.2, 0.0, 1.0));
}

// Scheme 1: Heatmap — dark → red → orange → yellow
vec3 heatmap(float t, float refr) {
    float v = refr > 0.05 ? 1.0 : t;
    if (v < 0.33) return mix(vec3(0.02, 0.0, 0.0), vec3(0.7, 0.0, 0.05), v / 0.33);
    if (v < 0.66) return mix(vec3(0.7, 0.0, 0.05), vec3(1.0, 0.55, 0.0), (v - 0.33) / 0.33);
    return mix(vec3(1.0, 0.55, 0.0), vec3(1.0, 1.0, 0.7), (v - 0.66) / 0.34);
}

// Scheme 2: Bioluminescence — deep ocean blue, teal/cyan fire
vec3 bioluminescence(float t, float refr) {
    if (refr > 0.05) {
        vec3 flash = vec3(0.5, 1.0, 0.95);
        vec3 after = vec3(0.0, 0.25, 0.35);
        return mix(after, flash, refr * refr);
    }
    vec3 deep  = vec3(0.0, 0.02, 0.10);
    vec3 glow  = vec3(0.0, 0.65, 0.72);
    return mix(deep, glow, clamp(t * 1.1, 0.0, 1.0));
}

// Scheme 3: Monochrome — greyscale, very clean
vec3 monochrome(float t, float refr) {
    float v = refr > 0.05 ? mix(0.7, 1.0, refr * refr) : t * 0.9;
    return vec3(v);
}

void main() {
    vec2 state = texture2D(u_state, v_uv).rg;
    float u    = state.r;
    float refr = state.g;

    float t = clamp(u / THRESHOLD, 0.0, 1.0);

    vec3 col;
    if      (u_colourScheme == 0) col = neural_scan(t, refr);
    else if (u_colourScheme == 1) col = heatmap(t, refr);
    else if (u_colourScheme == 2) col = bioluminescence(t, refr);
    else                          col = monochrome(t, refr);

    gl_FragColor = vec4(col, 1.0);
}
`;

// ─── Frame counter for per-step noise seed ────────────────────────
let _stepCount = 0;

// ─── Simulation ─────────────────────────────────────────────────

export default fieldSim({
    id: "neural",

    shaders: { step: STEP_SHADER, display: DISPLAY_SHADER },

    touchRadius: 0.06,

    initState(width, height, _params) {
        const data = new Float32Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const r = Math.random();
            // Seed most cells at low charge; a few near threshold to kick off activity
            const charge = r < 0.15
                ? 0.5 + Math.random() * 0.45   // 15% near threshold
                : Math.random() * 0.25;          // 85% low charge
            data[i * 4 + 0] = charge;
            data[i * 4 + 1] = 0.0; // no refractory at start
            data[i * 4 + 2] = 0.0;
            data[i * 4 + 3] = 1.0;
        }
        return data;
    },

    getStepUniforms(params) {
        _stepCount++;
        return [
            { name: "u_spread",      type: "1f", values: [params.spread] },
            { name: "u_input",       type: "1f", values: [params.input] },
            { name: "u_leak",        type: "1f", values: [params.leak] },
            { name: "u_seed",        type: "1f", values: [_stepCount * 0.00137] },
        ];
    },

    getDisplayUniforms() {
        return [];
    },

    // ─── Controls ────────────────────────────────────────────────

    controls: [
        {
            type: "slider", id: "spread",
            min: 0.05, max: 0.45, step: 0.01, default: 0.25,
            i18nLabel: "lbl_spread", format: 2,
        },
        {
            type: "slider", id: "input",
            min: 0.001, max: 0.04, step: 0.001, default: 0.005,
            i18nLabel: "lbl_input", format: 3,
        },
        {
            type: "slider", id: "leak",
            min: 0.005, max: 0.15, step: 0.005, default: 0.02,
            i18nLabel: "lbl_leak", format: 3,
        },
    ],

    presets: [
        { i18nLabel: "preset_critical", params: { spread: 0.25, input: 0.005, leak: 0.020 } },
        { i18nLabel: "preset_seizure",  params: { spread: 0.40, input: 0.020, leak: 0.005 } },
        { i18nLabel: "preset_silence",  params: { spread: 0.10, input: 0.003, leak: 0.060 } },
        { i18nLabel: "preset_cascade",  params: { spread: 0.32, input: 0.002, leak: 0.010 } },
    ],

    colours: [
        { gradient: "linear-gradient(135deg, #060010, #7a10aa, #e0f0ff)", i18nTitle: "Neural scan" },
        { gradient: "linear-gradient(135deg, #050000, #c01010, #ffee80)", i18nTitle: "Heatmap" },
        { gradient: "linear-gradient(135deg, #000510, #007880, #80ffee)", i18nTitle: "Bioluminescence" },
        { gradient: "linear-gradient(135deg, #000, #666, #fff)", i18nTitle: "Monochrome" },
    ],

    speedSlider: { min: 1, max: 15, default: 4 },

    // ─── Equations ───────────────────────────────────────────────

    equations: {
        render(container, lang) {
            const div = document.createElement("div");
            div.className = "eq-content";

            const intro = document.createElement("p");
            intro.style.cssText = "margin:0 0 10px 0; font-size:13px; color:#bbb;";
            intro.textContent = lang === "cs"
                ? "Každý neuron hromadí náboj od sousedů. Při dosažení prahu vyšle impuls a musí si odpočinout."
                : "Each neuron accumulates charge from neighbours. When it reaches threshold, it fires and must rest.";
            div.appendChild(intro);

            // Accumulation rule
            const eq1 = document.createElement("div");
            eq1.className = "eq-math";
            // Firing rule
            const eq2 = document.createElement("div");
            eq2.className = "eq-math";

            if (typeof katex !== "undefined") {
                katex.render(
                    "u_i(t+1) = u_i(t)\\cdot(1-\\lambda) \\;+\\; \\color{#c8b88a}{\\sigma}\\!\\sum_{j\\in N_i} \\mathbf{1}[u_j \\geq \\theta] \\;+\\; \\varepsilon_i",
                    eq1, { displayMode: true, throwOnError: false }
                );
                katex.render(
                    "\\text{if }u_i \\geq \\color{#c8b88a}{\\theta}: \\quad u_i := 0 \\quad \\text{(fire, then rest)}",
                    eq2, { displayMode: true, throwOnError: false }
                );
            } else {
                eq1.innerHTML = "u(t+1) = u(t)·(1−λ) + σ·Σ<sub>firing neighbours</sub> + ε";
                eq2.innerHTML = "if u ≥ θ: fire → u := 0, spread σ to 4 neighbours";
            }

            div.appendChild(eq1);
            div.appendChild(eq2);

            // Parameter badges
            const params = document.createElement("div");
            params.className = "eq-params";

            const tips = PARAM_TIPS[lang] || PARAM_TIPS.en;
            params.innerHTML =
                badge("σ", "#c8b88a", tips.spread_name, tips.spread_tip) +
                badge("λ", "#c8b88a", tips.leak_name,   tips.leak_tip) +
                badge("θ", "#887550", "= 1.0 (" + tips.threshold_name + ")", tips.threshold_tip) +
                badge("ε", "#887550", tips.noise_name,  tips.noise_tip);
            div.appendChild(params);

            const note = document.createElement("p");
            note.style.cssText = "margin:12px 0 0 0; font-size:12px; color:#888;";
            note.textContent = lang === "cs"
                ? "Při σ ≈ 0,25 je systém kritický: laviny mají všechny velikosti najednou. Mozek pravděpodobně funguje přesně na tomto bodě."
                : "At σ ≈ 0.25 the system is critical: avalanches appear in all sizes at once. The brain is thought to operate at exactly this point.";
            div.appendChild(note);

            container.appendChild(div);
        },
    },

    // ─── Translations ─────────────────────────────────────────────

    translations: {
        tab_neural: { cs: "Mozková aktivita", en: "Neural Criticality" },
        desc: {
            cs: "Váš mozek žije na hraně. Příliš málo propojení: ticho. Příliš mnoho: záchvat. Přesně na kritickém bodě mezi nimi vznikají laviny aktivity ve všech velikostech — a právě tam mozek pracuje nejlépe. Posuňte propojení a sledujte přechod.",
            en: "Your brain lives on the edge. Too little connection: silence. Too much: seizure. At the critical point between them, cascades of activity appear in all sizes — and that's where the brain works best. Adjust connectivity and watch the transition.",
        },
        lbl_spread:  { cs: "Propojení (σ)",       en: "Connectivity (σ)" },
        lbl_input:   { cs: "Pozadí (ε)",           en: "Background noise (ε)" },
        lbl_leak:    { cs: "Paměť (1−λ)",          en: "Memory (1−λ)" },
        preset_critical: { cs: "Kritický bod",    en: "Critical point" },
        preset_seizure:  { cs: "Záchvat",          en: "Seizure" },
        preset_silence:  { cs: "Ticho",            en: "Silence" },
        preset_cascade:  { cs: "Vlna",             en: "Wave" },
        snap_title_neural: { cs: "Mozková aktivita", en: "Neural Criticality" },
        snap_sub_neural: {
            cs: "Váš mozek, na hraně mezi tichem a bouří.",
            en: "Your brain, on the edge between silence and storm.",
        },
    },

    // ─── Snapshot metadata ────────────────────────────────────────

    snapshotMeta(lang) {
        const tr = this.translations;
        const get = (key) => {
            const e = tr[key];
            return e ? (e[lang] || e.en) : key;
        };
        return {
            title: get("snap_title_neural"),
            subtitle: get("snap_sub_neural"),
        };
    },

    // ─── Config overrides ─────────────────────────────────────────

    applyContent(cfg) {
        if (!cfg) return;
        const tr = this.translations;
        const set = (key, cs, en) => {
            if (cs || en) {
                if (!tr[key]) tr[key] = { cs: cs || "", en: en || "" };
                else {
                    if (cs) tr[key].cs = cs;
                    if (en) tr[key].en = en;
                }
            }
        };
        set("tab_neural",        cfg.tab_cs,              cfg.tab_en);
        set("desc",              cfg.desc_cs,             cfg.desc_en);
        set("lbl_spread",        cfg.lbl_spread_cs,       cfg.lbl_spread_en);
        set("lbl_input",         cfg.lbl_input_cs,        cfg.lbl_input_en);
        set("lbl_leak",          cfg.lbl_leak_cs,         cfg.lbl_leak_en);
        set("preset_critical",   cfg.preset_critical_cs,  cfg.preset_critical_en);
        set("preset_seizure",    cfg.preset_seizure_cs,   cfg.preset_seizure_en);
        set("preset_silence",    cfg.preset_silence_cs,   cfg.preset_silence_en);
        set("preset_cascade",    cfg.preset_cascade_cs,   cfg.preset_cascade_en);
        set("snap_title_neural", cfg.snap_title_cs,       cfg.snap_title_en);
        set("snap_sub_neural",   cfg.snap_sub_cs,         cfg.snap_sub_en);
    },
});

// ─── Helpers ─────────────────────────────────────────────────────

const PARAM_TIPS = {
    cs: {
        spread_name:    "= propojení",
        spread_tip:     "Kolik náboje se přenese od každého souseda — klíčový parametr pro kritičnost",
        leak_name:      "= útlum",
        leak_tip:       "Jak rychle náboj samovolně mizí — vyšší = těžší dosáhnout prahu",
        threshold_name: "práh výboje",
        threshold_tip:  "Pevná hodnota: při dosažení 1.0 neuron vyšle impuls (nelze měnit)",
        noise_name:     "= pozadí",
        noise_tip:      "Pravděpodobnost spontánního výboje bez vnějšího podnětu",
    },
    en: {
        spread_name:    "= connectivity",
        spread_tip:     "How much charge passes to each neighbour per firing — key parameter for criticality",
        leak_name:      "= decay",
        leak_tip:       "How fast charge dissipates on its own — higher = harder to reach threshold",
        threshold_name: "firing threshold",
        threshold_tip:  "Fixed at 1.0: when charge reaches this level the neuron fires (not adjustable)",
        noise_name:     "= background",
        noise_tip:      "Probability of spontaneous firing without external input",
    },
};

function badge(symbol, colour, name, tooltip) {
    return '<div class="eq-param">' +
        '<span class="eq-param-symbol" style="color:' + colour + ';">' + symbol + '</span>' +
        '<span class="eq-param-name">' + name + '</span>' +
        '<div class="eq-tooltip">' + tooltip + '</div>' +
        '</div>';
}
