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
import { getGL, createTexture } from "../core/webgl.js";

// ─── GLSL Shaders ────────────────────────────────────────────────

const STEP_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform sampler2D u_mask;    // R = regionId/10 (0=dead, 0.1-0.5=region 1-5)
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
    // Dead cells (outside brain silhouette) do nothing
    float regionVal = texture2D(u_mask, v_uv).r;
    if (regionVal < 0.05) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

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
    // Constrained to stay inside the brain (dead cells rejected).
    float h1 = fract(sin(dot(v_uv, vec2(127.1, 311.7))) * 43758.5);
    float h2 = fract(sin(dot(v_uv, vec2(269.5, 183.3))) * 43758.5);
    vec2 longUV = fract(v_uv + vec2(h1, h2) * 0.6 + vec2(0.2));
    float longMask = texture2D(u_mask, longUV).r;
    float n_long = (longMask > 0.05) ? step(THRESHOLD, texture2D(u_state, longUV).r) : 0.0;

    float incoming = (n_up + n_down + n_left + n_right + n_long * 0.6) * u_spread;

    // Anatomical pathway: biased long-range connection toward the region this neuron projects to.
    // Regions: 1=visual, 2=prefrontal, 3=parietal, 4=motor, 5=temporal
    // Pathways: visual→parietal, parietal→motor, prefrontal→motor, temporal→prefrontal
    float rId = regionVal * 10.0;
    vec2 aTarget = v_uv;  // default: no strong anatomical target
    if (rId > 0.5 && rId < 1.5) {        // visual → parietal
        aTarget = vec2(0.60, 0.70);
    } else if (rId > 1.5 && rId < 2.5) { // prefrontal → motor
        aTarget = vec2(0.38, 0.66);
    } else if (rId > 2.5 && rId < 3.5) { // parietal → motor
        aTarget = vec2(0.38, 0.63);
    } else if (rId > 4.5 && rId < 5.5) { // temporal → prefrontal
        aTarget = vec2(0.20, 0.58);
    }
    // Hash jitter within target region so connections are distributed, not a single point
    float j1 = fract(sin(dot(v_uv, vec2(93.7,  217.3))) * 43758.5) - 0.5;
    float j2 = fract(sin(dot(v_uv, vec2(311.1, 127.9))) * 43758.5) - 0.5;
    vec2 aUV = clamp(aTarget + vec2(j1, j2) * 0.12, 0.0, 1.0);
    float aMask = texture2D(u_mask, aUV).r;
    float n_anat = (aMask > 0.05) ? step(THRESHOLD, texture2D(u_state, aUV).r) : 0.0;
    incoming += n_anat * u_spread * 0.5;

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
uniform sampler2D u_mask;    // R = regionId/10 (0=dead, 0.1-0.5=region 1-5)
uniform int       u_colourScheme;
uniform vec2      u_resolution;   // simulation texture size for bloom kernel

varying vec2 v_uv;

const float THRESHOLD = 1.0;

// Cell-based rendering: each sim pixel = one visual neuron at 8× canvas scale.
// Each pixel samples state SHARPLY at its cell centre (no averaging) so colour
// thresholds work correctly.  A Gaussian glow makes each cell a distinct circle.
// Simulation is 96×64; display canvas is 768×512 → scale factor = 8.
const float CELL      = 1.0;
const float GLOW_SIG2 = 0.32;  // sigma≈0.57 sim px → ~9 canvas px radius, crisp circle gaps

// ── Colour scheme helpers ──────────────────────────────────────────
// Each receives: t=charge/threshold, refr, trail — all in [0,1].
// Design principle: trail is the PRIMARY visual channel (wave history).
// Multi-stop trail ramps: trail drives a 3-stop hue gradient (old→mid→fresh).

// 0: Brain Regions — each region coloured distinctly; cross-region spread visible as hue change
//    Region IDs: 1=visual(orange), 2=prefrontal(blue), 3=parietal(teal), 4=motor(green), 5=temporal(purple)
vec3 regionNeuronColor(float regionVal, float t, float refr, float trail) {
    float rId = regionVal * 10.0;
    vec3 tOld, tMid, tNew, refrCol;
    if (rId > 0.5 && rId < 1.5) {         // visual: warm orange-red
        tOld    = vec3(0.15, 0.02, 0.0);
        tMid    = vec3(0.80, 0.28, 0.0);
        tNew    = vec3(1.00, 0.72, 0.15);
        refrCol = vec3(1.00, 0.92, 0.55);
    } else if (rId > 1.5 && rId < 2.5) {  // prefrontal: royal blue
        tOld    = vec3(0.02, 0.02, 0.22);
        tMid    = vec3(0.08, 0.22, 0.92);
        tNew    = vec3(0.50, 0.78, 1.00);
        refrCol = vec3(0.75, 0.92, 1.00);
    } else if (rId > 2.5 && rId < 3.5) {  // parietal: teal-cyan
        tOld    = vec3(0.0,  0.12, 0.12);
        tMid    = vec3(0.0,  0.65, 0.68);
        tNew    = vec3(0.35, 1.00, 0.92);
        refrCol = vec3(0.75, 1.00, 0.96);
    } else if (rId > 3.5 && rId < 4.5) {  // motor: lime-green
        tOld    = vec3(0.02, 0.12, 0.0);
        tMid    = vec3(0.12, 0.76, 0.06);
        tNew    = vec3(0.68, 1.00, 0.28);
        refrCol = vec3(0.85, 1.00, 0.60);
    } else {                                // temporal: violet-purple
        tOld    = vec3(0.10, 0.0,  0.16);
        tMid    = vec3(0.55, 0.05, 0.88);
        tNew    = vec3(0.88, 0.52, 1.00);
        refrCol = vec3(0.96, 0.82, 1.00);
    }
    vec3 tCol = trail < 0.4
        ? mix(tOld, tMid, trail / 0.4)
        : mix(tMid, tNew, (trail - 0.4) / 0.6);
    vec3 col = tOld * 0.12;
    col += tCol * trail * 1.3;
    col += tMid * 0.06 * clamp(t * 0.8, 0.0, 1.0);                          // charge glow in region hue
    col  = mix(col, refrCol, clamp((refr - 0.1) / 0.7, 0.0, 1.0));         // bright refractory
    col  = mix(col, vec3(1.0, 1.0, 0.96), clamp((refr - 0.75) / 0.25, 0.0, 1.0)); // white fire burst
    return col;
}

// 1: Plasma — fresh=cyan-white → electric blue → deep navy; orange charge; magenta refr
vec3 plasma(float t, float refr, float trail) {
    vec3 tOld = vec3(0.02, 0.05, 0.25);
    vec3 tMid = vec3(0.10, 0.40, 1.00);
    vec3 tNew = vec3(0.70, 0.95, 1.00);
    vec3 tCol = trail < 0.3
        ? mix(tOld, tMid, trail / 0.3)
        : mix(tMid, tNew, (trail - 0.3) / 0.7);
    vec3 col = tOld * 0.2;
    col += tCol * trail * 1.3;
    col += vec3(0.30, 0.10, 0.0) * clamp(t * 0.9, 0.0, 1.0);
    col  = mix(col, vec3(0.90, 0.05, 0.55), clamp((refr - 0.1) / 0.7, 0.0, 1.0));
    col  = mix(col, vec3(1.00, 0.95, 1.00), clamp((refr - 0.75) / 0.25, 0.0, 1.0));
    return col;
}

// 2: Ember — fresh=bright yellow → amber → dark maroon; teal charge; orange refr
vec3 ember(float t, float refr, float trail) {
    vec3 tOld = vec3(0.20, 0.02, 0.04);
    vec3 tMid = vec3(0.85, 0.32, 0.02);
    vec3 tNew = vec3(1.00, 0.95, 0.30);
    vec3 tCol = trail < 0.4
        ? mix(tOld, tMid, trail / 0.4)
        : mix(tMid, tNew, (trail - 0.4) / 0.6);
    vec3 col = tOld * 0.15;
    col += tCol * trail * 1.2;
    col += vec3(0.0, 0.08, 0.15) * clamp(t * 0.8, 0.0, 1.0);
    col  = mix(col, vec3(0.75, 0.15, 0.0), clamp((refr - 0.1) / 0.7, 0.0, 1.0));
    col  = mix(col, vec3(1.00, 0.97, 0.65), clamp((refr - 0.75) / 0.25, 0.0, 1.0));
    return col;
}

// 3: Monochrome — silver trail, mid-grey refractory, white fire
vec3 monochrome(float t, float refr, float trail) {
    float v = 0.0;
    v += trail * 0.75;
    v += clamp(t * 0.25, 0.0, 1.0);
    v  = mix(v, 0.30, clamp((refr - 0.1) / 0.7, 0.0, 1.0));
    v  = mix(v, 1.00, clamp((refr - 0.75) / 0.25, 0.0, 1.0));
    return vec3(v);
}

// Sample sharp state at uv and return its colour.
// Must be defined AFTER the colour functions it calls.
// Samples mask to get region ID for the region-aware scheme.
vec3 neuronColor(vec2 uv) {
    vec3  st    = texture2D(u_state, uv).rgb;
    float t     = clamp(st.r / THRESHOLD, 0.0, 1.0);
    float refr  = st.g;
    float trail = st.b;
    if (u_colourScheme == 0) return plasma(t, refr, trail);
    else if (u_colourScheme == 1) {
        float rVal = texture2D(u_mask, uv).r;
        return regionNeuronColor(rVal, t, refr, trail);
    }
    else if (u_colourScheme == 2) return ember(t, refr, trail);
    else                          return monochrome(t, refr, trail);
}

void main() {
    vec2 simPx     = v_uv * u_resolution;
    vec2 cellIdx   = floor(simPx / CELL);
    vec2 cellCtrPx = (cellIdx + 0.5) * CELL;
    vec2 cellCtrUV = cellCtrPx / u_resolution;

    // Gaussian glow weight for this pixel relative to its cell centre
    float d2   = dot(simPx - cellCtrPx, simPx - cellCtrPx);
    float glow = exp(-d2 / GLOW_SIG2);

    // Brain mask: dead cells render as a faint silhouette outline only
    float maskVal = texture2D(u_mask, cellCtrUV).r;
    if (maskVal < 0.05) {
        // Check cardinal neighbours to detect brain boundary for outline glow
        vec2 md = vec2(1.0 / u_resolution.x, 0.0);
        vec2 mu = vec2(0.0, 1.0 / u_resolution.y);
        float edge = 0.0;
        edge += step(0.05, texture2D(u_mask, cellCtrUV + md).r);
        edge += step(0.05, texture2D(u_mask, cellCtrUV - md).r);
        edge += step(0.05, texture2D(u_mask, cellCtrUV + mu).r);
        edge += step(0.05, texture2D(u_mask, cellCtrUV - mu).r);
        // Faint blue-grey glow at boundary, invisible deeper outside
        gl_FragColor = vec4(vec3(0.05, 0.07, 0.14) * clamp(edge / 4.0, 0.0, 1.0) * glow * 2.5, 1.0);
        return;
    }

    // Primary neuron: Gaussian glow centred on this cell
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

    // Very subtle region-based background tint — helps visitors orient without distracting
    float rId = maskVal * 10.0;
    vec3 regionTint = vec3(0.0);
    if      (rId > 0.5 && rId < 1.5) regionTint = vec3(0.06, 0.02, 0.0);   // visual: warm red
    else if (rId > 1.5 && rId < 2.5) regionTint = vec3(0.0,  0.01, 0.07);  // prefrontal: blue
    else if (rId > 2.5 && rId < 3.5) regionTint = vec3(0.0,  0.04, 0.05);  // parietal: teal
    else if (rId > 3.5 && rId < 4.5) regionTint = vec3(0.0,  0.05, 0.01);  // motor: green
    else if (rId > 4.5 && rId < 5.5) regionTint = vec3(0.04, 0.0,  0.06);  // temporal: purple
    col += regionTint;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

// ─── Frame counter for per-step noise seed ────────────────────────
let _stepCount = 0;

// ─── Brain mask ──────────────────────────────────────────────────
// Lateral view of left hemisphere (UV: x=0 front/prefrontal, x=1 back/occipital, y=0 bottom)
// Two-lobe analytic shape: main cortex ellipse + temporal lobe bump.
// Region IDs: 0=dead, 1=visual, 2=prefrontal, 3=parietal, 4=motor, 5=temporal
// Stored as R=regionId/10 in a Float32Array RGBA texture.

function _insideBrain(u, v) {
    if (v < 0.10) return false;
    // Main cortex dome — scaled to fill canvas, same ~2:1 physical aspect ratio.
    const dx1 = (u - 0.50) / 0.43, dy1 = (v - 0.63) / 0.32;
    if (dx1 * dx1 + dy1 * dy1 <= 1.0) return true;
    // Frontal pole — fills in the lower-front of the frontal lobe
    const dx2 = (u - 0.14) / 0.085, dy2 = (v - 0.52) / 0.24;
    if (dx2 * dx2 + dy2 * dy2 <= 1.0) return true;
    // Temporal lobe — hangs below the Sylvian fissure, forward-biased
    const dx3 = (u - 0.38) / 0.25, dy3 = (v - 0.23) / 0.18;
    return dx3 * dx3 + dy3 * dy3 <= 1.0 && v < 0.42;
}

function _getRegion(u, v) {
    if (!_insideBrain(u, v)) return 0;
    if (u > 0.74)                              return 1; // visual/occipital (back ~20%)
    if (v < 0.42 && u > 0.14 && u < 0.66)    return 5; // temporal (lower lobe)
    if (u > 0.50 && v > 0.60)                 return 3; // parietal (upper-back)
    if (u > 0.28 && u <= 0.50 && v > 0.56)   return 4; // motor (upper-centre)
    return 2;                                             // prefrontal (front)
}

function buildBrainMask(W, H) {
    const data = new Float32Array(W * H * 4);
    for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
            const u = (i + 0.5) / W;
            const v = (j + 0.5) / H;
            const region = _getRegion(u, v);
            const idx = (j * W + i) * 4;
            data[idx]     = region / 10.0;  // R: regionId/10
            data[idx + 3] = 1.0;
        }
    }
    return data;
}

let maskTex = null;

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
        const mask = buildBrainMask(width, height);
        const data = new Float32Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            if (mask[i * 4] < 0.05) {
                data[i * 4 + 3] = 1.0;
                continue; // dead cell → zero charge
            }
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
        if (!maskTex) maskTex = createTexture(NEURAL_W, NEURAL_H, buildBrainMask(NEURAL_W, NEURAL_H));
        const gl = getGL();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        return [
            { name: "u_mask",   type: "1i", values: [1] },
            { name: "u_spread", type: "1f", values: [params.spread || 0.32] },
            { name: "u_input",  type: "1f", values: [params.input  || 0.008] },
            { name: "u_leak",   type: "1f", values: [params.leak   || 0.005] },
            { name: "u_seed",   type: "1f", values: [_stepCount * 0.00137] },
        ];
    },

    getDisplayUniforms() {
        if (maskTex) {
            const gl = getGL();
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, maskTex);
        }
        return [
            { name: "u_mask",       type: "1i", values: [1] },
            { name: "u_resolution", type: "2f", values: [NEURAL_W, NEURAL_H] },
        ];
    },

    onSetup() {
        // Remove any pre-existing region overlay from a previous sim switch
        const existing = document.getElementById("neural-region-overlay");
        if (existing) existing.remove();
    },

    // ─── Controls ────────────────────────────────────────────────

    controls: [
        {
            type: "slider", id: "spread",
            min: 0.05, max: 0.45, step: 0.01, default: 0.32,
            i18nLabel: "lbl_spread", format: 2,
        },
        {
            type: "slider", id: "input",
            min: 0.001, max: 0.04, step: 0.001, default: 0.008,
            i18nLabel: "lbl_input", format: 3,
        },
        {
            type: "slider", id: "leak",
            min: 0.005, max: 0.15, step: 0.005, default: 0.005,
            i18nLabel: "lbl_leak", format: 3,
        },
    ],

    presets: [
        { i18nLabel: "preset_critical", params: { spread: 0.28, input: 0.012, leak: 0.008 } },
        { i18nLabel: "preset_seizure",  params: { spread: 0.38, input: 0.015, leak: 0.005 } },
        { i18nLabel: "preset_silence",  params: { spread: 0.09, input: 0.002, leak: 0.050 } },
        { i18nLabel: "preset_cascade",  params: { spread: 0.32, input: 0.008, leak: 0.005 } },
        { i18nLabel: "preset_sleep",    params: { spread: 0.12, input: 0.003, leak: 0.020 } },
    ],

    colours: [
        { gradient: "linear-gradient(135deg, #040e28, #1a60ff, #b0f0ff)", i18nTitle: "Plasma" },
        { gradient: "linear-gradient(135deg, #100220, #8010d0, #20e890)", i18nTitle: "Brain Regions" },
        { gradient: "linear-gradient(135deg, #330508, #c05000, #fff080)", i18nTitle: "Ember" },
        { gradient: "linear-gradient(135deg, #000, #888, #fff)",          i18nTitle: "Monochrome" },
    ],

    speedSlider: { min: 0.05, max: 0.35, step: 0.05, default: 0.2 },

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
        tagline: {
            cs: "Mozek na hraně mezi tichem a bouří — právě tam pracuje nejlépe.",
            en: "The brain, on the edge of silence and storm — where it works best.",
        },
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
        preset_sleep:    { cs: "Spánek",           en: "Sleep" },
        region_visual:     { cs: "Zraková kůra",      en: "Visual cortex" },
        region_parietal:   { cs: "Temenní lalok",    en: "Parietal lobe" },
        region_motor:      { cs: "Motorická kůra",   en: "Motor cortex" },
        region_prefrontal: { cs: "Prefrontální kůra",en: "Prefrontal" },
        region_temporal:   { cs: "Spánkový lalok",   en: "Temporal lobe" },
        snap_title_neural: { cs: "Mozková aktivita", en: "Neural Criticality" },
        snap_sub_neural: {
            cs: "Váš mozek, na hraně mezi tichem a bouří.",
            en: "Your brain, on the edge between silence and storm.",
        },
        explain_a: {
            cs: "Tvůj mozek žije na hraně. Příliš málo propojení: ticho — žádná aktivita. Příliš mnoho: záchvat — aktivita se nekontrolovaně šíří. Přesně na kritickém bodě mezi nimi vznikají laviny aktivity ve všech velikostech: malé i velké. Tam mozek pracuje nejlépe. Posuň 'Propojení' a sleduj přechod ze záchvatu do ticha.",
            en: "Your brain lives on the edge. Too little connectivity: silence — nothing fires. Too much: seizure — activity spreads uncontrollably. At the critical point between them, avalanches of activity appear in all sizes: small and large. That is where the brain works best. Drag 'Connectivity' and watch the transition from seizure to silence.",
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
        if (cfg.tagline_cs) this.translations.tagline.cs = cfg.tagline_cs;
        if (cfg.tagline_en) this.translations.tagline.en = cfg.tagline_en;
        set("desc",              cfg.desc_cs,             cfg.desc_en);
        set("lbl_spread",        cfg.lbl_spread_cs,       cfg.lbl_spread_en);
        set("lbl_input",         cfg.lbl_input_cs,        cfg.lbl_input_en);
        set("lbl_leak",          cfg.lbl_leak_cs,         cfg.lbl_leak_en);
        set("preset_critical",   cfg.preset_critical_cs,  cfg.preset_critical_en);
        set("preset_seizure",    cfg.preset_seizure_cs,   cfg.preset_seizure_en);
        set("preset_silence",    cfg.preset_silence_cs,   cfg.preset_silence_en);
        set("preset_cascade",    cfg.preset_cascade_cs,   cfg.preset_cascade_en);
        set("preset_sleep",      cfg.preset_sleep_cs,     cfg.preset_sleep_en);
        set("snap_title_neural", cfg.snap_title_cs,       cfg.snap_title_en);
        set("snap_sub_neural",   cfg.snap_sub_cs,         cfg.snap_sub_en);
        set("explain_a",         cfg.explain_a_cs,        cfg.explain_a_en);

        // Merge preset parameter values from config.toml.
        // cfg.preset_params = { labyrinth: { f: 0.037, k: 0.060 }, ... }
        // i18nLabel e.g. "preset_labyrinth" → strip prefix → "labyrinth"
        if (cfg.preset_params) {
            for (const preset of this.presets) {
                const name = preset.i18nLabel.replace(/^preset_/, '');
                const overrides = cfg.preset_params[name];
                if (overrides) Object.assign(preset.params, overrides);
            }
        }
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
