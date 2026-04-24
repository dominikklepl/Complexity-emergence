/**
 * butterfly.js — Double-pendulum butterfly-effect simulator
 *
 * CPU physics (Float64 RK4) + GPU line rendering.
 *
 * Architecture:
 *   • JS Float64Array: N × [θ₁, ω₁, θ₂, ω₂]
 *   • Position history: N × MAX_HIST positions (newest last, shifted each step)
 *   • Each frame: clear scene FBO → draw N LINE_STRIPs → bloom pass → canvas
 *   • No additive accumulation (avoids whitewash with 150 overlapping lines)
 *   • Trail length controlled by trail mode: fade=400, persistent=1800 steps
 */

import {
    SIM_W, SIM_H, VERTEX_SHADER_SRC,
    getGL,
    createProgram, deleteProgram, cacheUniformLocations, createTexture, createFramebuffer,
    drawQuad, setUniform,
} from "../core/webgl.js";
import { t } from "../core/i18n.js";

// ── Constants ─────────────────────────────────────────────────────────────

const G        = 9.81;
const BASE_DT  = 0.016;
const HIST_FADE   = 400;   // history length for fade mode
const HIST_PERSIST = 1800; // history length for persistent mode

// ── GLSL ──────────────────────────────────────────────────────────────────

// Line vertex shader: compute colour per vertex from scheme + age
const LINE_VS = `
precision highp float;

attribute vec2  a_pos;
attribute float a_age;  // 0 = oldest, 1 = newest
attribute float a_hue;  // pendulum index / N, fixed per pendulum

uniform int u_colourScheme;

varying vec3 v_col;

vec3 hsv2rgb(float h, float s, float v) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(vec3(h) + K.xyz) * 6.0 - K.www);
    return v * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), s);
}

void main() {
    gl_Position = vec4(a_pos.x * 2.0 - 1.0, 1.0 - a_pos.y * 2.0, 0.0, 1.0);

    vec3 baseCol;
    if (u_colourScheme == 1) {
        // Aqua: cyan → teal → lime per pendulum
        baseCol = hsv2rgb(mix(0.50, 0.20, a_hue), 0.75, 1.0);
    } else if (u_colourScheme == 2) {
        // Neon: magenta → violet → sky per pendulum
        baseCol = hsv2rgb(mix(0.83, 0.58, a_hue), 0.80, 1.0);
    } else if (u_colourScheme == 3) {
        // Rainbow: full hue spectrum
        baseCol = hsv2rgb(a_hue, 0.85, 1.0);
    } else {
        // Golden (default): warm amber body, near-white tip
        vec3 tip  = vec3(1.00, 0.95, 0.70);
        vec3 body = vec3(1.00, 0.62, 0.06);
        baseCol = mix(body, tip, smoothstep(0.75, 1.0, a_age));
    }

    // Age-based brightness: oldest = dim, newest = full
    v_col = baseCol * (a_age * a_age);  // quadratic falloff for smoother trail
}
`;

const LINE_FS = `
precision highp float;
varying vec3 v_col;
void main() {
    gl_FragColor = vec4(v_col, 1.0);
}
`;

// Display: bloom (7-tap Gaussian) + composite + tone map
const DISPLAY_FS = `
precision highp float;
uniform sampler2D u_scene;
uniform float     u_brightness;
uniform vec2      u_texelSize;
varying vec2      v_uv;

void main() {
    vec2 tx = u_texelSize * 2.0;

    // 7-tap cross Gaussian for glow
    vec3 blur = texture2D(u_scene, v_uv).rgb * 0.383;
    blur += texture2D(u_scene, v_uv + vec2( tx.x, 0.0 )).rgb * 0.242;
    blur += texture2D(u_scene, v_uv - vec2( tx.x, 0.0 )).rgb * 0.242;
    blur += texture2D(u_scene, v_uv + vec2( 0.0,  tx.y)).rgb * 0.242;
    blur += texture2D(u_scene, v_uv - vec2( 0.0,  tx.y)).rgb * 0.242;
    blur += texture2D(u_scene, v_uv + vec2( tx.x,  tx.y)).rgb * 0.061;
    blur += texture2D(u_scene, v_uv - vec2( tx.x,  tx.y)).rgb * 0.061;

    vec3 sharp = texture2D(u_scene, v_uv).rgb;
    // Sharp core + soft bloom halo
    vec3 col = sharp + blur * 1.2;

    // Exponential tone map
    col = 1.0 - exp(-col * u_brightness);

    gl_FragColor = vec4(col, 1.0);
}
`;

// ── Physics ───────────────────────────────────────────────────────────────

function derivs(th1, om1, th2, om2, L1, L2) {
    const d     = th1 - th2;
    const denom = 3.0 - Math.cos(2 * d);
    const a1 = (
        -3 * G * Math.sin(th1)
        - G * Math.sin(th1 - 2 * th2)
        - 2 * Math.sin(d) * (om2*om2*L2 + om1*om1*L1*Math.cos(d))
    ) / (L1 * denom);
    const a2 = (
        2 * Math.sin(d) * (2*om1*om1*L1 + 2*G*Math.cos(th1) + om2*om2*L2*Math.cos(d))
    ) / (L2 * denom);
    return [om1, a1, om2, a2];
}

function rk4(th1, om1, th2, om2, L1, L2, dt) {
    const [k1,l1,m1,n1] = derivs(th1,          om1,          th2,          om2,          L1, L2);
    const [k2,l2,m2,n2] = derivs(th1+.5*dt*k1, om1+.5*dt*l1, th2+.5*dt*m1, om2+.5*dt*n1, L1, L2);
    const [k3,l3,m3,n3] = derivs(th1+.5*dt*k2, om1+.5*dt*l2, th2+.5*dt*m2, om2+.5*dt*n2, L1, L2);
    const [k4,l4,m4,n4] = derivs(th1+   dt*k3, om1+   dt*l3, th2+   dt*m3, om2+   dt*n3, L1, L2);
    const s = dt / 6;
    return [
        th1 + s*(k1 + 2*k2 + 2*k3 + k4),
        om1 + s*(l1 + 2*l2 + 2*l3 + l4),
        th2 + s*(m1 + 2*m2 + 2*m3 + m4),
        om2 + s*(n1 + 2*n2 + 2*n3 + n4),
    ];
}

// ── Module-level GL/physics state ─────────────────────────────────────────

let lineProg    = null;
let displayProg = null;

let sceneTex = null;
let sceneFB  = null;

let posBuf_gl = null;
let ageBuf_gl = null;  // static per init
let hueBuf_gl = null;  // static per init

let state      = null;  // Float64Array N×4
let posHistory = null;  // Float32Array N×MAX_HIST×2
let MAX_HIST   = HIST_FADE;
let N          = 0;

let _colourScheme = 0;
let wasTouching   = false;
let prevTrailMode = "fade";

// ── Init helpers ──────────────────────────────────────────────────────────

function initPhysics(params, th0Override = null) {
    const gl = getGL();
    N        = Math.max(1, Math.round(params.numPendulums));
    MAX_HIST = params.trailMode === "persistent" ? HIST_PERSIST : HIST_FADE;

    const th0       = th0Override !== null ? th0Override : params.initialAngle * (Math.PI / 180);
    const spreadRad = params.spread       * (Math.PI / 180);
    const L1        = 1.0;
    const L2        = Math.max(0.1, params.armRatio ?? 1.0);
    const scale     = (L1 + L2) * 2.2;

    state      = new Float64Array(N * 4);
    posHistory = new Float32Array(N * MAX_HIST * 2);

    for (let i = 0; i < N; i++) {
        const offset = N > 1 ? (i / (N - 1) - 0.5) * spreadRad : 0;
        const th1    = th0 + offset;
        state[i*4]   = th1;
        state[i*4+1] = 0;
        state[i*4+2] = th1;
        state[i*4+3] = 0;

        // Pre-fill history with initial bob position
        const x0 = 0.5 + (L1*Math.sin(th1) + L2*Math.sin(th1)) / scale;
        const y0 = 0.5 + (L1*Math.cos(th1) + L2*Math.cos(th1)) / scale;
        for (let k = 0; k < MAX_HIST; k++) {
            posHistory[(i*MAX_HIST + k)*2]     = x0;
            posHistory[(i*MAX_HIST + k)*2 + 1] = y0;
        }
    }

    // Precompute static age & hue buffers
    const ageBuf = new Float32Array(N * MAX_HIST);
    const hueBuf = new Float32Array(N * MAX_HIST);
    for (let i = 0; i < N; i++) {
        for (let k = 0; k < MAX_HIST; k++) {
            ageBuf[i * MAX_HIST + k] = k / (MAX_HIST - 1);  // 0=oldest 1=newest
            hueBuf[i * MAX_HIST + k] = i / N;
        }
    }

    if (!ageBuf_gl) ageBuf_gl = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ageBuf_gl);
    gl.bufferData(gl.ARRAY_BUFFER, ageBuf, gl.STATIC_DRAW);

    if (!hueBuf_gl) hueBuf_gl = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, hueBuf_gl);
    gl.bufferData(gl.ARRAY_BUFFER, hueBuf, gl.STATIC_DRAW);
}

// ── Engine interface ──────────────────────────────────────────────────────

const butterflySim = {
    id: "pendulum",

    setup(gl, canvas, params) {
        lineProg    = createProgram(LINE_VS, LINE_FS,                    "pendulum/line");
        displayProg = createProgram(VERTEX_SHADER_SRC, DISPLAY_FS,      "pendulum/display");

        cacheUniformLocations(lineProg,    ["u_colourScheme"]);
        cacheUniformLocations(displayProg, ["u_scene", "u_brightness", "u_texelSize"]);

        sceneTex = createTexture(SIM_W, SIM_H, null);
        sceneFB  = createFramebuffer(sceneTex);

        posBuf_gl = gl.createBuffer();
        ageBuf_gl = null;
        hueBuf_gl = null;

        wasTouching   = false;
        prevTrailMode = params.trailMode ?? "fade";
        _colourScheme = 0;

        initPhysics(params);
    },

    teardown(gl) {
        if (sceneTex)   { gl.deleteTexture(sceneTex);       sceneTex = null; }
        if (sceneFB)    { gl.deleteFramebuffer(sceneFB);    sceneFB  = null; }
        if (posBuf_gl)  { gl.deleteBuffer(posBuf_gl);       posBuf_gl = null; }
        if (ageBuf_gl)  { gl.deleteBuffer(ageBuf_gl);       ageBuf_gl = null; }
        if (hueBuf_gl)  { gl.deleteBuffer(hueBuf_gl);       hueBuf_gl = null; }
        if (lineProg)   { deleteProgram(lineProg);          lineProg    = null; }
        if (displayProg){ deleteProgram(displayProg);       displayProg = null; }

        state = posHistory = null;
        wasTouching = false;
    },

    step(params, touch) {
        const gl = getGL();
        if (!lineProg || !state) return;

        // Touch: rising edge → reset from clicked position
        if (touch?.active && !wasTouching) {
            // touch.pos = [x, y] in UV; interaction.js flips y (0=bottom, 1=top)
            // Un-flip y so +dy = downward in screen = pendulum pointing down at θ=0
            const dx = touch.pos[0] - 0.5;
            const dy = 0.5 - touch.pos[1];
            const clickAngle = (dx === 0 && dy === 0) ? params.initialAngle * (Math.PI / 180)
                                                       : Math.atan2(dx, dy);
            initPhysics(params, clickAngle);

            // Sync slider to reflect the new angle
            const angleDeg = Math.round(clickAngle * (180 / Math.PI));
            const clamped  = Math.max(-175, Math.min(175, angleDeg));
            const sliderEl = document.querySelector('[data-param-id="initialAngle"]');
            const valEl    = document.querySelector('[data-val-id="initialAngle"]');
            if (sliderEl) sliderEl.value = clamped;
            if (valEl)    valEl.textContent = clamped;
        }
        wasTouching = !!touch?.active;

        const L1    = 1.0;
        const L2    = Math.max(0.1, params.armRatio ?? 1.0);
        const scale = (L1 + L2) * 2.2;

        for (let i = 0; i < N; i++) {
            const b = i * 4;
            const [th1, om1, th2, om2] = rk4(
                state[b], state[b+1], state[b+2], state[b+3], L1, L2, BASE_DT
            );
            state[b]   = th1;
            state[b+1] = om1;
            state[b+2] = th2;
            state[b+3] = om2;

            // Shift history: drop oldest (slot 0), append newest at end
            const base = i * MAX_HIST * 2;
            posHistory.copyWithin(base, base + 2, base + MAX_HIST * 2);
            posHistory[base + (MAX_HIST-1)*2]     = 0.5 + (L1*Math.sin(th1) + L2*Math.sin(th2)) / scale;
            posHistory[base + (MAX_HIST-1)*2 + 1] = 0.5 + (L1*Math.cos(th1) + L2*Math.cos(th2)) / scale;
        }

        // ── Draw lines into scene FBO ───────────────────────────────────
        gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFB);
        gl.viewport(0, 0, SIM_W, SIM_H);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(lineProg);
        setUniform(lineProg, "u_colourScheme", "1i", _colourScheme);

        // Enable standard alpha blend so overlapping lines layer nicely
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);  // additive-ish but alpha-gated

        const posLoc = gl.getAttribLocation(lineProg, "a_pos");
        const ageLoc = gl.getAttribLocation(lineProg, "a_age");
        const hueLoc = gl.getAttribLocation(lineProg, "a_hue");

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf_gl);
        gl.bufferData(gl.ARRAY_BUFFER, posHistory, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, ageBuf_gl);
        gl.enableVertexAttribArray(ageLoc);
        gl.vertexAttribPointer(ageLoc, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, hueBuf_gl);
        gl.enableVertexAttribArray(hueLoc);
        gl.vertexAttribPointer(hueLoc, 1, gl.FLOAT, false, 0, 0);

        for (let i = 0; i < N; i++) {
            gl.drawArrays(gl.LINE_STRIP, i * MAX_HIST, MAX_HIST);
        }

        gl.disableVertexAttribArray(posLoc);
        gl.disableVertexAttribArray(ageLoc);
        gl.disableVertexAttribArray(hueLoc);
        gl.disable(gl.BLEND);
    },

    render(gl, canvas, colourScheme) {
        if (!displayProg) return;
        _colourScheme = colourScheme;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(displayProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sceneTex);
        setUniform(displayProg, "u_scene",      "1i", 0);
        setUniform(displayProg, "u_brightness", "1f", 2.5);
        setUniform(displayProg, "u_texelSize",  "2f", 1.0 / SIM_W, 1.0 / SIM_H);
        drawQuad(displayProg);
    },

    // ── Controls ────────────────────────────────────────────────────────────

    controls: [
        {
            type: "slider", id: "initialAngle",
            min: -175, max: 175, step: 1, default: 120,
            i18nLabel: "initialAngle_label", format: 0, resetsState: true,
        },
        {
            type: "slider", id: "spread",
            min: 0.0001, max: 1.0, step: 0.0001, default: 0.0003,
            i18nLabel: "spread_label", format: 4, resetsState: true,
        },
        {
            type: "slider", id: "numPendulums",
            min: 10, max: 300, step: 10, default: 150,
            i18nLabel: "numPendulums_label", format: 0, resetsState: true,
        },
        {
            type: "select", id: "trailMode",
            options: [
                { value: "fade",       i18nLabel: "trailFade"       },
                { value: "persistent", i18nLabel: "trailPersistent" },
            ],
            default: "fade",
            i18nLabel: "trailMode_label",
            resetsState: true,
        },
        {
            type: "slider", id: "armRatio",
            min: 0.5, max: 2.0, step: 0.1, default: 1.0,
            i18nLabel: "armRatio_label", format: 1, resetsState: true,
        },
    ],

    presets: [],

    colours: [
        { gradient: "linear-gradient(135deg, #f5a623, #fff4c2, #f5a623)", i18nTitle: "Golden"  },
        { gradient: "linear-gradient(135deg, #00c6ff, #a0f0a0, #fff176)", i18nTitle: "Aqua"    },
        { gradient: "linear-gradient(135deg, #ff6ec7, #bf80ff, #80c8ff)", i18nTitle: "Neon"    },
        { gradient: "linear-gradient(135deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f)", i18nTitle: "Rainbow" },
    ],

    defaultColourScheme: 0,
    speedSlider: { min: 1, max: 8, default: 3 },

    // ── Translations ─────────────────────────────────────────────────────────

    translations: {
        tab_pendulum:       { cs: "Dvojité kyvadlo",        en: "Double Pendulum"         },
        desc:               { cs: "Kyvadla začínají na skoro stejném místě. Sleduj, jak se jejich dráhy rozchází — i nepatrný rozdíl na začátku vede ke zcela odlišnému pohybu. To je chaotické chování.",
                              en: "The pendulums start at nearly the same position. Watch their paths diverge — even a tiny difference at the start leads to completely different motion. This is chaotic behaviour." },
        initialAngle_label: { cs: "Počáteční úhel",        en: "Starting angle"          },
        spread_label:       { cs: "Rozdíl podmínek",       en: "Condition spread"         },
        numPendulums_label: { cs: "Počet kyvadel",         en: "Pendulums"                },
        trailMode_label:    { cs: "Délka stop",            en: "Trail length"             },
        trailFade:          { cs: "Krátké",                en: "Short"                    },
        trailPersistent:    { cs: "Dlouhé",                en: "Long"                     },
        armRatio_label:     { cs: "Poměr ramen",           en: "Arm ratio"                },
        snap_title:         { cs: "Dvojité kyvadlo",        en: "Double Pendulum"          },
        snap_sub:           { cs: "Deterministický chaos", en: "Deterministic Chaos"      },
        eq_para1:           { cs: "Dvě kyvadla spojená v sérii. Každé rameno ovlivňuje pohyb toho druhého — systém má dva vzájemně provázané stupně volnosti (úhly θ₁ a θ₂).",
                              en: "Two pendulums linked in series. Each arm drives the other — the system has two coupled degrees of freedom (angles θ₁ and θ₂)." },
        eq_para2:           { cs: "Klíčová vlastnost: <strong>sensitivní závislost na počátečních podmínkách</strong>. Kyvadla lišící se o zlomek stupně se zpočátku pohybují shodně, pak se jejich dráhy exponenciálně rozcházejí. Deterministický systém — žádná náhoda — přesto nepředvídatelný.",
                              en: "<strong>Sensitive dependence on initial conditions</strong>: pendulums differing by a fraction of a degree start in sync, then diverge exponentially. Fully deterministic — no randomness — yet impossible to forecast." },
    },

    snapshotMeta(lang) {
        const e = this.translations;
        const p = (k) => (e[k] ? (e[k][lang] || e[k].cs) : k);
        return { title: p("snap_title"), subtitle: p("snap_sub") };
    },

    applyContent(cfg) {
        if (!cfg) return;
        const tr = this.translations;
        const set = (key, cs, en) => {
            if (!cs && !en) return;
            if (!tr[key]) tr[key] = { cs: cs || "", en: en || "" };
            else { if (cs) tr[key].cs = cs; if (en) tr[key].en = en; }
        };
        set("tab_pendulum",       cfg.tab_cs,           cfg.tab_en);
        set("desc",               cfg.desc_cs,          cfg.desc_en);
        set("snap_title",         cfg.snap_title_cs,    cfg.snap_title_en);
        set("snap_sub",           cfg.snap_sub_cs,      cfg.snap_sub_en);
        set("initialAngle_label", cfg.lbl_initialAngle_cs, cfg.lbl_initialAngle_en);
        set("spread_label",       cfg.lbl_spread_cs,    cfg.lbl_spread_en);
        set("numPendulums_label", cfg.lbl_numPendulums_cs, cfg.lbl_numPendulums_en);
        set("trailMode_label",    cfg.lbl_trailMode_cs, cfg.lbl_trailMode_en);
        set("trailFade",          cfg.lbl_trailFade_cs, cfg.lbl_trailFade_en);
        set("trailPersistent",    cfg.lbl_trailPersistent_cs, cfg.lbl_trailPersistent_en);
        set("armRatio_label",     cfg.lbl_armRatio_cs,  cfg.lbl_armRatio_en);
        set("eq_para1",           cfg.eq_para1_cs,      cfg.eq_para1_en);
        set("eq_para2",           cfg.eq_para2_cs,      cfg.eq_para2_en);
    },

    equations: {
        render(container, lang) {
            const cs = lang === "cs";

            // ── SVG illustration ──────────────────────────────────────────
            const svgNS = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(svgNS, "svg");
            svg.setAttribute("viewBox", "0 0 160 130");
            svg.setAttribute("width", "100%");
            svg.style.maxWidth = "180px";
            svg.style.display  = "block";
            svg.style.margin   = "0 auto 12px";

            const S = (tag, attrs, txt) => {
                const el = document.createElementNS(svgNS, tag);
                for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
                if (txt !== undefined) el.textContent = txt;
                return el;
            };

            // Ceiling
            svg.appendChild(S("line", { x1:55, y1:10, x2:105, y2:10, stroke:"#444", "stroke-width":3, "stroke-linecap":"round" }));
            for (let x = 60; x <= 100; x += 10)
                svg.appendChild(S("line", { x1:x, y1:10, x2:x-5, y2:5, stroke:"#444", "stroke-width":1.2 }));

            // Pivot
            const px = 80, py = 13;
            svg.appendChild(S("circle", { cx:px, cy:py, r:3, fill:"#555" }));

            // Arm 1 (θ₁ ≈ 30°)
            const a1 = 30 * Math.PI / 180, L1 = 52;
            const b1x = px + L1*Math.sin(a1), b1y = py + L1*Math.cos(a1);
            svg.appendChild(S("line", { x1:px, y1:py+1, x2:b1x, y2:b1y, stroke:"#555", "stroke-width":2, "stroke-linecap":"round" }));

            // θ₁ arc + label
            svg.appendChild(S("line", { x1:px, y1:py, x2:px, y2:py+20, stroke:"#888", "stroke-width":1, "stroke-dasharray":"3 2" }));
            svg.appendChild(S("path", { d:`M ${px} ${py+16} A 16 16 0 0 1 ${px+16*Math.sin(a1)} ${py+16*Math.cos(a1)}`, fill:"none", stroke:"#333", "stroke-width":1 }));
            svg.appendChild(S("text", { x:px+5, y:py+26, fill:"#222", "font-size":10, "font-style":"italic" }, "θ₁"));
            // L₁ label
            svg.appendChild(S("text", { x:(px+b1x)/2-14, y:(py+b1y)/2+2, fill:"#444", "font-size":9, "font-style":"italic" }, "L₁"));

            // Bob 1
            svg.appendChild(S("circle", { cx:b1x, cy:b1y, r:7, fill:"#888", stroke:"#555", "stroke-width":1 }));
            svg.appendChild(S("text", { x:b1x+9, y:b1y+4, fill:"#333", "font-size":9, "font-style":"italic" }, "m₁"));

            // Arm 2 (θ₂ ≈ 65° absolute)
            const a2 = 65 * Math.PI / 180, L2 = 44;
            const b2x = b1x + L2*Math.sin(a2), b2y = b1y + L2*Math.cos(a2);
            svg.appendChild(S("line", { x1:b1x, y1:b1y, x2:b2x, y2:b2y, stroke:"#555", "stroke-width":2, "stroke-linecap":"round" }));

            // θ₂ arc + label
            svg.appendChild(S("line", { x1:b1x, y1:b1y, x2:b1x, y2:b1y+18, stroke:"#888", "stroke-width":1, "stroke-dasharray":"3 2" }));
            svg.appendChild(S("path", { d:`M ${b1x} ${b1y+14} A 14 14 0 0 1 ${b1x+14*Math.sin(a2)} ${b1y+14*Math.cos(a2)}`, fill:"none", stroke:"#333", "stroke-width":1 }));
            svg.appendChild(S("text", { x:b1x+6, y:b1y+24, fill:"#222", "font-size":10, "font-style":"italic" }, "θ₂"));
            // L₂ label
            svg.appendChild(S("text", { x:(b1x+b2x)/2+3, y:(b1y+b2y)/2-2, fill:"#444", "font-size":9, "font-style":"italic" }, "L₂"));

            // Bob 2
            svg.appendChild(S("circle", { cx:b2x, cy:b2y, r:7, fill:"#888", stroke:"#555", "stroke-width":1 }));
            svg.appendChild(S("text", { x:b2x+9, y:b2y+4, fill:"#333", "font-size":9, "font-style":"italic" }, "m₂"));

            container.appendChild(svg);

            // ── Explanation ───────────────────────────────────────────────
            const div = document.createElement("div");
            div.className = "eq-content";

            const paras = [t("eq_para1"), t("eq_para2")];

            for (const text of paras) {
                const p = document.createElement("p");
                p.style.marginBottom = "0.5em";
                p.innerHTML = text;
                div.appendChild(p);
            }
            container.appendChild(div);
        },
    },
};

export default butterflySim;
