/**
 * boids.js — GPU-accelerated flocking / crowd / predator-prey simulation
 *
 * Three behaviour modes in one module:
 *   0  Classic boids   (separation + alignment + cohesion)
 *   1  Crowd dynamics  (strong separation, weak alignment, random jitter)
 *   2  Predator-prey   (touch = predator, boids flee and regroup)
 *
 * Architecture (particle-based, NOT a field sim):
 *   • State texture   32×32 RGBA float  (1024 agents)
 *     R = pos.x   G = pos.y   B = vel.x   A = vel.y
 *   • Trail texture   SIM_W×SIM_H  (persistent glow with fade)
 *   • Step shader runs full-screen quad at 32×32 → N² neighbour scan
 *   • Boid draw uses point-sprite rendering (vertex texture fetch)
 *   • Display shader colour-maps the trail to screen
 *
 * Implements the 4-method engine interface manually (as the template
 * recommends for non-field simulations).
 */

import {
    SIM_W, SIM_H, VERTEX_SHADER_SRC,
    getGL,
    createProgram, createTexture, createFramebuffer,
    drawQuad, setUniform,
} from "../core/webgl.js";

// ── Constants ───────────────────────────────────────────────────

const AGENT_RES = 32;                       // state texture width/height
const AGENT_COUNT = AGENT_RES * AGENT_RES;    // 1 024 boids

// ── GLSL Shaders ────────────────────────────────────────────────

// --- Step fragment shader: update boid positions & velocities ---
const STEP_FS = `
precision highp float;

#define ARES 32.0
#define PI   3.14159265

uniform sampler2D u_state;
uniform float u_separation;
uniform float u_alignment;
uniform float u_cohesion;
uniform float u_perception;
uniform float u_maxSpeed;
uniform float u_mode;          // 0 boids, 1 crowd, 2 predator
uniform vec2  u_touch;
uniform float u_touchActive;
uniform float u_touchButton;   // 0 left (attract), 1 right (repel)

varying vec2 v_uv;

/* Steering: desired direction → clamped acceleration */
vec2 steer(vec2 desired, vec2 vel, float maxSpd, float maxFrc) {
    float len = length(desired);
    if (len < 0.0001) return vec2(0.0);
    vec2 s = (desired / len) * maxSpd - vel;
    float sl = length(s);
    return sl > maxFrc ? s / sl * maxFrc : s;
}

void main() {
    vec4 self = texture2D(u_state, v_uv);
    vec2 pos  = self.rg;
    vec2 vel  = self.ba;

    /* Accumulate neighbour forces */
    vec2  sepSum   = vec2(0.0);
    vec2  aliSum   = vec2(0.0);
    vec2  cohSum   = vec2(0.0);
    float sepCount = 0.0;
    float nCount   = 0.0;

    float percSq  = u_perception * u_perception;
    float sepR    = u_perception * 0.45;
    float sepRSq  = sepR * sepR;

    /* N² brute-force neighbour scan */
    for (float gy = 0.0; gy < ARES; gy += 1.0) {
        for (float gx = 0.0; gx < ARES; gx += 1.0) {
            vec2 nuv  = (vec2(gx, gy) + 0.5) / ARES;
            vec4 other = texture2D(u_state, nuv);
            vec2 opos = other.rg;
            vec2 ovel = other.ba;

            vec2 diff = pos - opos;
            diff -= floor(diff + 0.5);           // toroidal shortest path
            float dSq = dot(diff, diff);

            if (dSq < 0.000001 || dSq > percSq) continue;

            float d = sqrt(dSq);

            // Separation (within tighter radius)
            if (dSq < sepRSq) {
                sepSum += diff / d;
                sepCount += 1.0;
            }

            // Alignment
            aliSum += ovel;

            // Cohesion (vector toward neighbour)
            cohSum -= diff;

            nCount += 1.0;
        }
    }

    float maxForce = u_maxSpeed * 0.2;
    vec2  accel    = vec2(0.0);

    /* Mode-specific weight tweaks */
    float wS = u_separation;
    float wA = u_alignment;
    float wC = u_cohesion;

    if (u_mode > 0.5 && u_mode < 1.5) {          // crowd
        wS *= 1.5;
        wA *= 0.25;
        wC *= 0.25;
    } else if (u_mode > 1.5 && u_touchActive > 0.5) { // predator active
        wC *= 2.0;
    }

    /* Apply Reynolds forces */
    if (sepCount > 0.0)
        accel += steer(sepSum / sepCount, vel, u_maxSpeed, maxForce) * wS;
    if (nCount > 0.0)
        accel += steer(aliSum / nCount, vel, u_maxSpeed, maxForce) * wA;
    if (nCount > 0.0)
        accel += steer(cohSum / nCount, vel, u_maxSpeed, maxForce) * wC;

    /* Crowd jitter */
    if (u_mode > 0.5 && u_mode < 1.5) {
        float h = fract(sin(dot(pos + vel * 137.0, vec2(12.9898, 78.233))) * 43758.5453);
        float a = h * 2.0 * PI;
        accel += vec2(cos(a), sin(a)) * maxForce * 0.35;
    }

    /* Touch interaction */
    if (u_touchActive > 0.5) {
        vec2 toT = u_touch - pos;
        toT -= floor(toT + 0.5);
        float tD = length(toT);

        if (u_mode > 1.5) {
            // Predator: flee from touch
            if (tD < u_perception * 3.0 && tD > 0.001)
                accel += steer(-toT, vel, u_maxSpeed, maxForce) * 3.5;
        } else {
            // Normal: left attract, right repel
            if (tD < u_perception * 2.5 && tD > 0.001) {
                vec2 dir = u_touchButton < 0.5 ? toT : -toT;
                accel += steer(dir, vel, u_maxSpeed, maxForce) * 2.5;
            }
        }
    }

    /* Integrate */
    vel += accel;
    float spd = length(vel);
    if (spd > u_maxSpeed) vel = vel / spd * u_maxSpeed;
    if (spd > 0.0 && spd < u_maxSpeed * 0.12)
        vel = vel / spd * u_maxSpeed * 0.12;

    pos += vel;
    pos  = fract(pos);

    gl_FragColor = vec4(pos, vel);
}
`;

// --- Trail fade fragment shader ---
const TRAIL_FADE_FS = `
precision highp float;
uniform sampler2D u_trail;
uniform float u_persistence;
varying vec2 v_uv;
void main() {
    gl_FragColor = texture2D(u_trail, v_uv) * u_persistence;
}
`;

// --- Boid draw vertex shader (reads state texture) ---
const BOID_DRAW_VS = `
attribute float a_index;
uniform sampler2D u_state;
uniform float u_stateRes;
uniform float u_maxSpeed;
uniform float u_pointSize;

varying float v_angle;
varying float v_speed;

#define PI 3.14159265

void main() {
    float col = mod(a_index, u_stateRes);
    float row = floor(a_index / u_stateRes);
    vec2 uv   = (vec2(col, row) + 0.5) / u_stateRes;

    vec4 state = texture2D(u_state, uv);
    vec2 pos   = state.rg;
    vec2 vel   = state.ba;

    gl_Position  = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = u_pointSize;

    v_angle = atan(vel.y, vel.x) / (2.0 * PI) + 0.5;   // 0–1
    v_speed = clamp(length(vel) / u_maxSpeed, 0.0, 1.0); // 0–1
}
`;

// --- Boid draw fragment shader (soft glowing point) ---
const BOID_DRAW_FS = `
precision highp float;
varying float v_angle;
varying float v_speed;
void main() {
    vec2  pc = gl_PointCoord - 0.5;
    float d  = length(pc) * 2.0;           // 0 centre, 1 edge
    float a  = exp(-d * d * 3.5);          // gaussian glow

    // Encode: R=intensity  G=angle*intensity  B=speed*intensity
    gl_FragColor = vec4(a, v_angle * a, v_speed * a, 1.0);
}
`;

// --- Display fragment shader (colour-maps trail to screen) ---
const DISPLAY_FS = `
precision highp float;
uniform sampler2D u_trail;
uniform int u_colourScheme;
varying vec2 v_uv;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec4  t         = texture2D(u_trail, v_uv);
    float intensity = t.r;

    float glow = sqrt(clamp(intensity / 1.4, 0.0, 1.0));

    vec3 col;
    if (u_colourScheme == 0) {
        // Murmuration — silvery white on deep indigo
        col = vec3(0.82, 0.86, 0.94) * glow;
    } else if (u_colourScheme == 1) {
        // Spectrum — rainbow by velocity direction
        float angle = intensity > 0.01 ? t.g / t.r : 0.0;
        col = hsv2rgb(vec3(angle, 0.75, glow));
    } else if (u_colourScheme == 2) {
        // Ocean — teal-to-cyan
        col = vec3(0.06, 0.35, 0.55) * glow + vec3(0.0, 0.15, 0.25) * glow * glow;
    } else {
        // Firefly — warm amber
        col = vec3(1.0, 0.68, 0.12) * glow;
    }

    // Dark background
    vec3 bg = vec3(0.015, 0.015, 0.03);
    col += bg;

    gl_FragColor = vec4(col, 1.0);
}
`;

// ── Internal state ──────────────────────────────────────────────

let stepProg = null;
let trailFadeProg = null;
let boidDrawProg = null;
let displayProg = null;

let stateTex = [null, null];
let stateFB = [null, null];
let trailTex = [null, null];
let trailFB = [null, null];
let indexBuf = null;

let curState = 0;
let curTrail = 0;

// ── Export simulation ───────────────────────────────────────────

export default {
    id: "boids",

    // ── 4-method interface ──────────────────────────────────────

    setup(gl, canvas, params) {
        // Check vertex texture fetch support (needed for point-sprite rendering)
        const maxVTU = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
        if (maxVTU < 1) {
            console.error("Boids: vertex texture fetch not supported");
            return;
        }

        // Compile four programs
        stepProg = createProgram(VERTEX_SHADER_SRC, STEP_FS, "boids/step");
        trailFadeProg = createProgram(VERTEX_SHADER_SRC, TRAIL_FADE_FS, "boids/trailFade");
        boidDrawProg = createProgram(BOID_DRAW_VS, BOID_DRAW_FS, "boids/boidDraw");
        displayProg = createProgram(VERTEX_SHADER_SRC, DISPLAY_FS, "boids/display");

        if (!stepProg || !trailFadeProg || !boidDrawProg || !displayProg) {
            console.error("Boids: shader compilation failed");
            return;
        }

        // Initialise boid state: random positions + small random velocities
        const stateData = new Float32Array(AGENT_COUNT * 4);
        for (let i = 0; i < AGENT_COUNT; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.001 + Math.random() * 0.002;
            stateData[i * 4 + 0] = Math.random();            // pos.x
            stateData[i * 4 + 1] = Math.random();            // pos.y
            stateData[i * 4 + 2] = Math.cos(angle) * speed;  // vel.x
            stateData[i * 4 + 3] = Math.sin(angle) * speed;  // vel.y
        }

        // State ping-pong textures (32×32)
        stateTex[0] = createTexture(AGENT_RES, AGENT_RES, stateData);
        stateTex[1] = createTexture(AGENT_RES, AGENT_RES, stateData);
        stateFB[0] = createFramebuffer(stateTex[0]);
        stateFB[1] = createFramebuffer(stateTex[1]);

        // Trail ping-pong textures (full canvas resolution)
        const trailData = new Float32Array(SIM_W * SIM_H * 4);  // zeroed
        trailTex[0] = createTexture(SIM_W, SIM_H, trailData);
        trailTex[1] = createTexture(SIM_W, SIM_H, trailData);
        trailFB[0] = createFramebuffer(trailTex[0]);
        trailFB[1] = createFramebuffer(trailTex[1]);

        // Index buffer for point-sprite rendering (one float per vertex)
        const indices = new Float32Array(AGENT_COUNT);
        for (let i = 0; i < AGENT_COUNT; i++) indices[i] = i;
        indexBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, indexBuf);
        gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        curState = 0;
        curTrail = 0;
    },

    teardown(gl) {
        for (let i = 0; i < 2; i++) {
            if (stateTex[i]) gl.deleteTexture(stateTex[i]);
            if (stateFB[i]) gl.deleteFramebuffer(stateFB[i]);
            if (trailTex[i]) gl.deleteTexture(trailTex[i]);
            if (trailFB[i]) gl.deleteFramebuffer(trailFB[i]);
        }
        if (indexBuf) gl.deleteBuffer(indexBuf);
        if (stepProg) gl.deleteProgram(stepProg);
        if (trailFadeProg) gl.deleteProgram(trailFadeProg);
        if (boidDrawProg) gl.deleteProgram(boidDrawProg);
        if (displayProg) gl.deleteProgram(displayProg);

        stateTex = [null, null];
        stateFB = [null, null];
        trailTex = [null, null];
        trailFB = [null, null];
        indexBuf = null;
        stepProg = trailFadeProg = boidDrawProg = displayProg = null;
        curState = curTrail = 0;
    },

    step(params, touch) {
        const gl = getGL();
        if (!stepProg) return;

        const modeMap = { boids: 0, crowd: 1, predator: 2 };

        // ── 1. Update boid state (32×32 quad) ───────────────────
        const nextState = 1 - curState;

        gl.useProgram(stepProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, stateTex[curState]);
        setUniform(stepProg, "u_state", "1i", 0);
        setUniform(stepProg, "u_separation", "1f", params.separation);
        setUniform(stepProg, "u_alignment", "1f", params.alignment);
        setUniform(stepProg, "u_cohesion", "1f", params.cohesion);
        setUniform(stepProg, "u_perception", "1f", params.perception);
        setUniform(stepProg, "u_maxSpeed", "1f", params.maxSpeed);
        setUniform(stepProg, "u_mode", "1f", modeMap[params.mode] || 0);

        if (touch.active) {
            setUniform(stepProg, "u_touch", "2f", touch.pos[0], touch.pos[1]);
            setUniform(stepProg, "u_touchActive", "1f", 1.0);
            setUniform(stepProg, "u_touchButton", "1f", touch.button === 2 ? 1.0 : 0.0);
        } else {
            setUniform(stepProg, "u_touch", "2f", -1, -1);
            setUniform(stepProg, "u_touchActive", "1f", 0.0);
            setUniform(stepProg, "u_touchButton", "1f", 0.0);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, stateFB[nextState]);
        gl.viewport(0, 0, AGENT_RES, AGENT_RES);
        drawQuad(stepProg);

        curState = nextState;

        // ── 2. Fade trail (SIM_W × SIM_H quad) ─────────────────
        const nextTrail = 1 - curTrail;

        gl.useProgram(trailFadeProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, trailTex[curTrail]);
        setUniform(trailFadeProg, "u_trail", "1i", 0);
        setUniform(trailFadeProg, "u_persistence", "1f", params.trailPersistence);

        gl.bindFramebuffer(gl.FRAMEBUFFER, trailFB[nextTrail]);
        gl.viewport(0, 0, SIM_W, SIM_H);
        drawQuad(trailFadeProg);

        // ── 3. Draw boid points onto faded trail (additive) ────
        gl.useProgram(boidDrawProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, stateTex[curState]);
        setUniform(boidDrawProg, "u_state", "1i", 0);
        setUniform(boidDrawProg, "u_stateRes", "1f", AGENT_RES);
        setUniform(boidDrawProg, "u_maxSpeed", "1f", params.maxSpeed);
        setUniform(boidDrawProg, "u_pointSize", "1f", 5.0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);   // additive

        const idxLoc = gl.getAttribLocation(boidDrawProg, "a_index");
        gl.bindBuffer(gl.ARRAY_BUFFER, indexBuf);
        gl.enableVertexAttribArray(idxLoc);
        gl.vertexAttribPointer(idxLoc, 1, gl.FLOAT, false, 0, 0);

        // still bound to trailFB[nextTrail] at SIM_W×SIM_H
        gl.drawArrays(gl.POINTS, 0, AGENT_COUNT);

        gl.disable(gl.BLEND);

        curTrail = nextTrail;
    },

    render(gl, canvas, colourScheme) {
        if (!displayProg) return;

        gl.useProgram(displayProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, trailTex[curTrail]);
        setUniform(displayProg, "u_trail", "1i", 0);
        setUniform(displayProg, "u_colourScheme", "1i", colourScheme);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        drawQuad(displayProg);
    },

    // ── Metadata ────────────────────────────────────────────────

    controls: [
        {
            type: "select", id: "mode",
            options: [
                { value: "boids", i18nLabel: "mode_boids" },
                { value: "crowd", i18nLabel: "mode_crowd" },
                { value: "predator", i18nLabel: "mode_predator" },
            ],
            default: "boids",
            i18nLabel: "mode_label",
        },
        { type: "slider", id: "separation", min: 0, max: 3, step: 0.1, default: 1.5, i18nLabel: "lbl_separation", format: 1 },
        { type: "slider", id: "alignment", min: 0, max: 3, step: 0.1, default: 1.0, i18nLabel: "lbl_alignment", format: 1 },
        { type: "slider", id: "cohesion", min: 0, max: 3, step: 0.1, default: 1.0, i18nLabel: "lbl_cohesion", format: 1 },
        { type: "slider", id: "perception", min: 0.02, max: 0.2, step: 0.01, default: 0.08, i18nLabel: "lbl_perception", format: 2 },
        { type: "slider", id: "maxSpeed", min: 0.001, max: 0.008, step: 0.001, default: 0.004, i18nLabel: "lbl_max_speed", format: 3 },
        { type: "slider", id: "trailPersistence", min: 0.80, max: 0.99, step: 0.01, default: 0.96, i18nLabel: "lbl_trail", format: 2 },
    ],

    presets: [
        {
            i18nLabel: "preset_murmuration",
            params: { mode: "boids", separation: 1.2, alignment: 1.8, cohesion: 1.0, perception: 0.10, maxSpeed: 0.005, trailPersistence: 0.96 },
        },
        {
            i18nLabel: "preset_school",
            params: { mode: "boids", separation: 1.8, alignment: 1.2, cohesion: 0.8, perception: 0.06, maxSpeed: 0.003, trailPersistence: 0.93 },
        },
        {
            i18nLabel: "preset_predator",
            params: { mode: "predator", separation: 2.0, alignment: 0.8, cohesion: 1.5, perception: 0.12, maxSpeed: 0.006, trailPersistence: 0.94 },
        },
        {
            i18nLabel: "preset_crowd",
            params: { mode: "crowd", separation: 2.5, alignment: 0.3, cohesion: 0.2, perception: 0.05, maxSpeed: 0.003, trailPersistence: 0.90 },
        },
        {
            i18nLabel: "preset_chaos",
            params: { mode: "boids", separation: 0.3, alignment: 0.2, cohesion: 0.1, perception: 0.15, maxSpeed: 0.008, trailPersistence: 0.85 },
        },
    ],

    colours: [
        { gradient: "linear-gradient(135deg, #1a1a2e, #ccc)", i18nTitle: "Murmuration" },
        { gradient: "linear-gradient(135deg, #e53, #3b3, #33e)", i18nTitle: "Spectrum" },
        { gradient: "linear-gradient(135deg, #0a1628, #4fc3f7)", i18nTitle: "Ocean" },
        { gradient: "linear-gradient(135deg, #1a0a00, #ffab40)", i18nTitle: "Firefly" },
    ],

    speedSlider: { min: 1, max: 5, default: 1 },

    // ── Equations ───────────────────────────────────────────────

    equations: {
        render(container, lang) {
            // Pull config-supplied text overrides (set by applyContent via parent sim object)
            const _eq = this._eqContent || {};

            const div = document.createElement("div");
            div.className = "eq-content";

            const intro = document.createElement("p");
            intro.style.cssText = "margin:0 0 12px 0; font-size:13px; color:#bbb;";
            intro.textContent = lang === "cs"
                ? (_eq.intro_cs || "Každý agent reaguje pouze na své blízké sousedy pomocí tří sil:")
                : (_eq.intro_en || "Each agent reacts only to nearby neighbours via three forces:");
            div.appendChild(intro);

            const eqItems = [
                {
                    label: lang === "cs" ? (_eq.sep_label_cs || "Separace") : (_eq.sep_label_en || "Separation"),
                    desc:  lang === "cs" ? (_eq.sep_desc_cs  || "nesrážej se") : (_eq.sep_desc_en  || "avoid collisions"),
                    tex: "\\vec{F}_{\\text{sep}} = w_s \\cdot \\operatorname{steer}\\!\\left(\\frac{1}{|N_s|}\\sum_{j \\in N_s} \\frac{\\vec{r}_i - \\vec{r}_j}{\\|\\vec{r}_i - \\vec{r}_j\\|}\\right)",
                },
                {
                    label: lang === "cs" ? (_eq.ali_label_cs || "Zarovnání") : (_eq.ali_label_en || "Alignment"),
                    desc:  lang === "cs" ? (_eq.ali_desc_cs  || "leť stejným směrem") : (_eq.ali_desc_en  || "match heading"),
                    tex: "\\vec{F}_{\\text{ali}} = w_a \\cdot \\operatorname{steer}\\!\\left(\\bar{\\vec{v}}_{N} - \\vec{v}_i\\right)",
                },
                {
                    label: lang === "cs" ? (_eq.coh_label_cs || "Soudržnost") : (_eq.coh_label_en || "Cohesion"),
                    desc:  lang === "cs" ? (_eq.coh_desc_cs  || "drž se blízko skupiny") : (_eq.coh_desc_en  || "stay near the group"),
                    tex: "\\vec{F}_{\\text{coh}} = w_c \\cdot \\operatorname{steer}\\!\\left(\\bar{\\vec{r}}_{N} - \\vec{r}_i\\right)",
                },
            ];

            for (const item of eqItems) {
                const row = document.createElement("div");
                row.style.cssText = "margin: 8px 0;";

                const lbl = document.createElement("div");
                lbl.style.cssText = "color:#c8b88a; font-size:12px; font-weight:700; margin-bottom:2px;";
                lbl.textContent = item.label + " — " + item.desc;
                row.appendChild(lbl);

                const math = document.createElement("span");
                try {
                    katex.render(item.tex, math, { throwOnError: false, displayMode: false });
                } catch (_) {
                    math.textContent = item.tex;
                }
                row.appendChild(math);
                div.appendChild(row);
            }

            const note = document.createElement("p");
            note.style.cssText = "margin:12px 0 0 0; font-size:12px; color:#888;";
            note.textContent = lang === "cs"
                ? (_eq.note_cs || "steer(d) = normalize(d) · v_max − v_i, omezeno na maximální sílu.")
                : (_eq.note_en || "steer(d) = normalize(d) · v_max − v_i, clamped to max force.");
            div.appendChild(note);

            container.appendChild(div);
        },
    },

    // ── Translations ────────────────────────────────────────────

    translations: {
        tab_boids: {
            cs: "Hejna",
            en: "Flocking",
        },
        desc: {
            cs: "Tři jednoduchá pravidla — separace, zarovnání a soudržnost — stačí k tomu, aby vzniklo složité hejnové chování, jako u ptáků nebo ryb. Klikněte levým tlačítkem pro přitahování, pravým pro odpuzování.",
            en: "Three simple rules — separation, alignment, and cohesion — are enough to produce complex flocking behaviour, like in birds or fish. Left-click to attract, right-click to repel.",
        },
        mode_label: { cs: "Režim", en: "Mode" },
        mode_boids: { cs: "Hejno", en: "Flocking" },
        mode_crowd: { cs: "Dav", en: "Crowd" },
        mode_predator: { cs: "Predátor", en: "Predator" },
        lbl_separation: { cs: "Separace", en: "Separation" },
        lbl_alignment: { cs: "Zarovnání", en: "Alignment" },
        lbl_cohesion: { cs: "Soudržnost", en: "Cohesion" },
        lbl_perception: { cs: "Vnímání", en: "Perception" },
        lbl_max_speed: { cs: "Max. rychlost", en: "Max speed" },
        lbl_trail: { cs: "Stopa", en: "Trail" },
        preset_murmuration: { cs: "Ptačí hejno", en: "Murmuration" },
        preset_school: { cs: "Hejno ryb", en: "Fish school" },
        preset_predator: { cs: "Útěk před predátorem", en: "Predator panic" },
        preset_crowd: { cs: "Proudění davu", en: "Crowd flow" },
        preset_chaos: { cs: "Chaos", en: "Chaos" },
        snap_title_boids: { cs: "Hejna", en: "Flocking" },
        snap_sub_boids: {
            cs: "Emergentní kolektivní pohyb",
            en: "Emergent collective motion",
        },
    },

    // ── Snapshot metadata ───────────────────────────────────────

    snapshotMeta(lang) {
        const tr = this.translations;
        const pick = (key) => {
            const e = tr[key];
            return e ? (e[lang] || e.cs) : key;
        };
        return {
            title: pick("snap_title_boids"),
            subtitle: pick("snap_sub_boids"),
        };
    },

    // ── Content overrides from config.toml ─────────────────────
    applyContent(cfg) {
        if (!cfg) return;
        const tr = this.translations;

        const setTr = (key, csVal, enVal) => {
            if (csVal || enVal) {
                if (!tr[key]) tr[key] = { cs: csVal || "", en: enVal || "" };
                else {
                    if (csVal) tr[key].cs = csVal;
                    if (enVal) tr[key].en = enVal;
                }
            }
        };

        setTr("tab_boids",          cfg.tab_cs,               cfg.tab_en);
        setTr("desc",               cfg.desc_cs,              cfg.desc_en);
        setTr("mode_label",         cfg.lbl_mode_cs,          cfg.lbl_mode_en);
        setTr("mode_boids",         cfg.lbl_mode_boids_cs,    cfg.lbl_mode_boids_en);
        setTr("mode_crowd",         cfg.lbl_mode_crowd_cs,    cfg.lbl_mode_crowd_en);
        setTr("mode_predator",      cfg.lbl_mode_predator_cs, cfg.lbl_mode_predator_en);
        setTr("lbl_separation",     cfg.lbl_separation_cs,    cfg.lbl_separation_en);
        setTr("lbl_alignment",      cfg.lbl_alignment_cs,     cfg.lbl_alignment_en);
        setTr("lbl_cohesion",       cfg.lbl_cohesion_cs,      cfg.lbl_cohesion_en);
        setTr("lbl_perception",     cfg.lbl_perception_cs,    cfg.lbl_perception_en);
        setTr("lbl_max_speed",      cfg.lbl_max_speed_cs,     cfg.lbl_max_speed_en);
        setTr("lbl_trail",          cfg.lbl_trail_cs,         cfg.lbl_trail_en);
        setTr("preset_murmuration", cfg.preset_murmuration_cs,cfg.preset_murmuration_en);
        setTr("preset_school",      cfg.preset_school_cs,     cfg.preset_school_en);
        setTr("preset_predator",    cfg.preset_predator_cs,   cfg.preset_predator_en);
        setTr("preset_crowd",       cfg.preset_crowd_cs,      cfg.preset_crowd_en);
        setTr("preset_chaos",       cfg.preset_chaos_cs,      cfg.preset_chaos_en);
        setTr("snap_title_boids",   cfg.snap_title_cs,        cfg.snap_title_en);
        setTr("snap_sub_boids",     cfg.snap_sub_cs,          cfg.snap_sub_en);

        // Equation text overrides (stored on both sim and equations sub-object so
        // equations.render can access them via `this._eqContent` where `this = equations`)
        const eq = this._eqContent || (this._eqContent = {});
        if (cfg.eq_intro_cs)    eq.intro_cs    = cfg.eq_intro_cs;
        if (cfg.eq_intro_en)    eq.intro_en    = cfg.eq_intro_en;
        if (cfg.eq_sep_label_cs) eq.sep_label_cs = cfg.eq_sep_label_cs;
        if (cfg.eq_sep_label_en) eq.sep_label_en = cfg.eq_sep_label_en;
        if (cfg.eq_sep_desc_cs) eq.sep_desc_cs  = cfg.eq_sep_desc_cs;
        if (cfg.eq_sep_desc_en) eq.sep_desc_en  = cfg.eq_sep_desc_en;
        if (cfg.eq_ali_label_cs) eq.ali_label_cs = cfg.eq_ali_label_cs;
        if (cfg.eq_ali_label_en) eq.ali_label_en = cfg.eq_ali_label_en;
        if (cfg.eq_ali_desc_cs) eq.ali_desc_cs  = cfg.eq_ali_desc_cs;
        if (cfg.eq_ali_desc_en) eq.ali_desc_en  = cfg.eq_ali_desc_en;
        if (cfg.eq_coh_label_cs) eq.coh_label_cs = cfg.eq_coh_label_cs;
        if (cfg.eq_coh_label_en) eq.coh_label_en = cfg.eq_coh_label_en;
        if (cfg.eq_coh_desc_cs) eq.coh_desc_cs  = cfg.eq_coh_desc_cs;
        if (cfg.eq_coh_desc_en) eq.coh_desc_en  = cfg.eq_coh_desc_en;
        if (cfg.eq_note_cs)     eq.note_cs      = cfg.eq_note_cs;
        if (cfg.eq_note_en)     eq.note_en      = cfg.eq_note_en;
        // Mirror onto equations sub-object (render uses `this` which == equations)
        this.equations._eqContent = eq;
    },
};
