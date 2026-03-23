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

const float THRESHOLD  = 1.0;
const float REFRAC_DECAY = 0.75;  // refractory halves per ~3 steps
const float TRAIL_DECAY  = 0.95;  // trail visible for ~20 steps

float rand(vec2 co) {
    return fract(sin(dot(co + u_seed, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec2 dx = vec2(1.0 / u_resolution.x, 0.0);
    vec2 dy = vec2(0.0,  1.0 / u_resolution.y);

    vec3 here = texture2D(u_state, v_uv).rgb;
    float u     = here.r;
    float refr  = here.g;
    float trail = here.b;

    // Neighbours: fire = 1 if charge was ≥ threshold last step
    float n_up    = step(THRESHOLD, texture2D(u_state, v_uv + dy).r);
    float n_down  = step(THRESHOLD, texture2D(u_state, v_uv - dy).r);
    float n_left  = step(THRESHOLD, texture2D(u_state, v_uv - dx).r);
    float n_right = step(THRESHOLD, texture2D(u_state, v_uv + dx).r);

    // Long-range connection: each neuron has a fixed pseudo-random distant partner.
    // Creates hub nodes and spatial clustering (small-world topology) without extra textures.
    float h1 = fract(sin(dot(v_uv, vec2(127.1, 311.7))) * 43758.5);
    float h2 = fract(sin(dot(v_uv, vec2(269.5, 183.3))) * 43758.5);
    vec2 longUV = fract(v_uv + vec2(h1, h2) * 0.6 + vec2(0.2));
    float n_long = step(THRESHOLD, texture2D(u_state, longUV).r);

    float incoming = (n_up + n_down + n_left + n_right + n_long * 0.6) * u_spread;

    float new_u;
    float new_refr;
    bool  fired = false;

    if (refr > 0.5) {
        // Absolute refractory: cell cannot fire again, charge stays at 0
        new_u    = 0.0;
        new_refr = refr * REFRAC_DECAY;
    } else if (u >= THRESHOLD) {
        // Cell fires this step
        new_u    = 0.0;
        new_refr = 1.0;
        fired    = true;
    } else {
        // Normal accumulation: leak + incoming + random spark
        float noise = step(1.0 - u_input, rand(v_uv)) * 0.5;
        new_u    = clamp(u * (1.0 - u_leak) + incoming + noise, 0.0, 2.0);
        new_refr = refr * REFRAC_DECAY;
    }

    // Trail accumulator: decays every step, injected when cell fires
    float new_trail = trail * TRAIL_DECAY + (fired ? 1.0 : 0.0);

    // Touch: stimulate (left) or silence (right)
    if (u_touch.x >= 0.0) {
        float dist = length(v_uv - u_touch);
        if (dist < u_touchRadius) {
            float str = 1.0 - dist / u_touchRadius;
            if (u_touchButton < 0.5) {
                new_u += str * 0.5;  // inject charge
            } else {
                new_u    *= (1.0 - str * 0.9);  // drain charge
                new_trail *= (1.0 - str * 0.5);
            }
        }
    }

    gl_FragColor = vec4(new_u, new_refr, new_trail, 1.0);
}
`;

const DISPLAY_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform int       u_colourScheme;
uniform vec2      u_resolution;   // simulation texture size for bloom kernel

varying vec2 v_uv;

const float THRESHOLD = 1.0;

// Cell-based rendering: 12×12 simulation-pixel cells → 64×43 visible "neurons".
// Each pixel samples state SHARPLY at its cell centre (no averaging) so colour
// thresholds work correctly.  A Gaussian glow makes each cell a distinct ~10px circle.
// Simulation is 96×64; display canvas is 768×512 → scale factor = 8.
// CELL=1 means each sim pixel = one visual "neuron".
// GLOW_SIG2 in sim-pixel units: sigma²=0.55 → sigma≈0.74 sim px → ~12 canvas px glow radius.
const float CELL      = 1.0;
const float GLOW_SIG2 = 0.32;  // sigma≈0.57 sim px → ~9 canvas px radius, crisp circle gaps

// ── Colour scheme helpers ──────────────────────────────────────────
// Each receives: t=charge/threshold, refr, trail — all in [0,1].
// Design principle: trail is the PRIMARY visual channel (wave history).
// Background is near-black; active sites have intense HDR contrast.

// 0: Neural Glow — violet-magenta trail, icy-blue refractory, white fire
vec3 neural_glow(float t, float refr, float trail) {
    vec3 col = vec3(0.01, 0.0, 0.03);                                       // near-black purple
    col += vec3(0.55, 0.08, 0.70) * trail * 1.2;                            // violet-magenta trail glow
    col += vec3(0.20, 0.01, 0.05) * clamp(t * 0.8, 0.0, 1.0);             // dim red ember (charging)
    col  = mix(col, vec3(0.15, 0.50, 1.00), clamp((refr - 0.1) / 0.7, 0.0, 1.0));   // icy-blue refractory
    col  = mix(col, vec3(1.00, 0.95, 1.00), clamp((refr - 0.75) / 0.25, 0.0, 1.0)); // white fire burst
    return col;
}

// 1: Ember — amber-orange trail, maroon refractory, yellow-white fire
vec3 ember(float t, float refr, float trail) {
    vec3 col = vec3(0.02, 0.01, 0.0);                                        // near-black warm
    col += vec3(0.85, 0.30, 0.02) * trail * 1.1;                             // amber-orange trail glow
    col += vec3(0.15, 0.02, 0.0) * clamp(t * 0.7, 0.0, 1.0);               // dim red ember
    col  = mix(col, vec3(0.55, 0.08, 0.02), clamp((refr - 0.1) / 0.7, 0.0, 1.0));   // dark maroon
    col  = mix(col, vec3(1.00, 0.97, 0.65), clamp((refr - 0.75) / 0.25, 0.0, 1.0)); // yellow-white burst
    return col;
}

// 2: Bioluminescence — teal-aqua trail, deep ocean background, aqua fire
vec3 bioluminescence(float t, float refr, float trail) {
    vec3 col = vec3(0.0, 0.01, 0.06);                                        // deep ocean black
    col += vec3(0.0, 0.65, 0.60) * trail * 1.2;                              // teal trail glow
    col += vec3(0.0, 0.08, 0.10) * clamp(t * 0.7, 0.0, 1.0);               // dim teal ember
    col  = mix(col, vec3(0.02, 0.08, 0.50), clamp((refr - 0.1) / 0.7, 0.0, 1.0));   // deep royal blue
    col  = mix(col, vec3(0.65, 1.00, 0.96), clamp((refr - 0.75) / 0.25, 0.0, 1.0)); // aqua-white burst
    return col;
}

// 3: Monochrome — silver trail, mid-grey refractory, white fire
vec3 monochrome(float t, float refr, float trail) {
    float v = 0.0;
    v += trail * 0.75;                                                        // trail: bright silver
    v += clamp(t * 0.25, 0.0, 1.0);                                         // charge: dim ember
    v  = mix(v, 0.30, clamp((refr - 0.1) / 0.7, 0.0, 1.0));                // refractory: mid grey
    v  = mix(v, 1.00, clamp((refr - 0.75) / 0.25, 0.0, 1.0));              // fire: white
    return vec3(v);
}

// Sample sharp state at uv and return its colour.
// Must be defined AFTER the colour functions it calls.
vec3 neuronColor(vec2 uv) {
    vec3  st    = texture2D(u_state, uv).rgb;
    float t     = clamp(st.r / THRESHOLD, 0.0, 1.0);
    float refr  = st.g;
    float trail = st.b;
    if      (u_colourScheme == 0) return neural_glow(t, refr, trail);
    else if (u_colourScheme == 1) return ember(t, refr, trail);
    else if (u_colourScheme == 2) return bioluminescence(t, refr, trail);
    else                          return monochrome(t, refr, trail);
}

void main() {
    vec2 simPx     = v_uv * u_resolution;
    vec2 cellIdx   = floor(simPx / CELL);
    vec2 cellCtrPx = (cellIdx + 0.5) * CELL;
    vec2 cellCtrUV = cellCtrPx / u_resolution;

    // Primary neuron: Gaussian glow centred on this cell
    float d2   = dot(simPx - cellCtrPx, simPx - cellCtrPx);
    float glow = exp(-d2 / GLOW_SIG2);
    vec3  col  = neuronColor(cellCtrUV) * glow;

    // Soft ambient from 8 neighbouring cells — active neighbours bleed into
    // the gap, creating organic connection-like bridges between co-active neurons.
    for (int ni = -1; ni <= 1; ni++) {
        for (int nj = -1; nj <= 1; nj++) {
            if (ni == 0 && nj == 0) continue;
            vec2 nCtrPx = (cellIdx + vec2(float(ni), float(nj)) + 0.5) * CELL;
            vec2 nUV    = nCtrPx / u_resolution;
            vec3 nSt    = texture2D(u_state, nUV).rgb;
            if (nSt.b < 0.05 && nSt.g < 0.05) continue;   // skip silent neighbours
            float nd2      = dot(simPx - nCtrPx, simPx - nCtrPx);
            float nAmbient = exp(-nd2 / (GLOW_SIG2 * 2.0)) * 0.18;
            col += neuronColor(nUV) * nAmbient;
        }
    }

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// ─── Frame counter for per-step noise seed ────────────────────────
let _stepCount = 0;

// ─── Simulation ─────────────────────────────────────────────────

// Neural simulation runs on a coarser 96×64 grid (6144 neurons).
// Each sim pixel IS one visual neuron — no sampling artefacts.
const NEURAL_W = 96;
const NEURAL_H = 64;

export default fieldSim({
    id: "neural",

    shaders: { step: STEP_SHADER, display: DISPLAY_SHADER },

    simW: NEURAL_W,
    simH: NEURAL_H,

    touchRadius: 0.06,

    initState(width, height, _params) {
        const data = new Float32Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const r = Math.random();
            // 50% near threshold for fast activity ramp-up (no simultaneous burst = no cold reset)
            const charge = r < 0.50
                ? 0.55 + Math.random() * 0.43   // near threshold, staggered → natural cascade ramp
                : Math.random() * 0.20;          // rest low
            data[i * 4 + 0] = charge;
            data[i * 4 + 1] = 0.0;
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
        return [
            { name: "u_resolution", type: "2f", values: [NEURAL_W, NEURAL_H] },
        ];
    },

    // ─── Controls ────────────────────────────────────────────────

    controls: [
        {
            type: "slider", id: "spread",
            min: 0.05, max: 0.45, step: 0.01, default: 0.35,
            i18nLabel: "lbl_spread", format: 2,
        },
        {
            type: "slider", id: "input",
            min: 0.001, max: 0.04, step: 0.001, default: 0.004,
            i18nLabel: "lbl_input", format: 3,
        },
        {
            type: "slider", id: "leak",
            min: 0.005, max: 0.15, step: 0.005, default: 0.012,
            i18nLabel: "lbl_leak", format: 3,
        },
    ],

    presets: [
        { i18nLabel: "preset_critical", params: { spread: 0.26, input: 0.004, leak: 0.015 } },
        { i18nLabel: "preset_seizure",  params: { spread: 0.38, input: 0.015, leak: 0.005 } },
        { i18nLabel: "preset_silence",  params: { spread: 0.09, input: 0.002, leak: 0.050 } },
        { i18nLabel: "preset_cascade",  params: { spread: 0.32, input: 0.008, leak: 0.005 } },
    ],

    colours: [
        { gradient: "linear-gradient(135deg, #030008, #7010b0, #f0f5ff)", i18nTitle: "Neural Glow" },
        { gradient: "linear-gradient(135deg, #050200, #c05000, #fff5a0)", i18nTitle: "Ember" },
        { gradient: "linear-gradient(135deg, #000210, #00a090, #a0ffee)", i18nTitle: "Bioluminescence" },
        { gradient: "linear-gradient(135deg, #000, #888, #fff)", i18nTitle: "Monochrome" },
    ],

    speedSlider: { min: 0.2, max: 1.5, step: 0.1, default: 0.5 },

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
