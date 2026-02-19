/**
 * kuramoto.js — Kuramoto coupled oscillators simulation
 *
 * Implements synchronisation dynamics: each cell has a phase (θ) and
 * natural frequency (ω). Neighbours influence each other through
 * sinusoidal coupling, producing spirals, waves, chimeras, and sync.
 *
 * To add this simulation to the app, import it and call registerSim():
 *   import oscSim from "./sims/kuramoto.js";
 *   registerSim(oscSim);
 */

import { fieldSim } from "../core/fieldSim.js";
import { SIM_W, SIM_H } from "../core/webgl.js";

// ─── GLSL Shaders ───────────────────────────────────────────────

const STEP_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_K;
uniform float u_dt;
uniform vec2 u_touch;
uniform float u_touchRadius;

varying vec2 v_uv;

const float PI2 = 6.28318530718;

void main() {
    vec2 dx = vec2(1.0 / u_resolution.x, 0.0);
    vec2 dy = vec2(0.0, 1.0 / u_resolution.y);

    vec4 here = texture2D(u_state, v_uv);
    float theta = here.r;
    float omega = here.g;

    float t_up    = texture2D(u_state, v_uv + dy).r;
    float t_down  = texture2D(u_state, v_uv - dy).r;
    float t_left  = texture2D(u_state, v_uv - dx).r;
    float t_right = texture2D(u_state, v_uv + dx).r;

    float coupling = sin(t_up - theta) + sin(t_down - theta)
                   + sin(t_left - theta) + sin(t_right - theta);

    float new_theta = theta + u_dt * (omega + u_K / 4.0 * coupling);

    if (u_touch.x >= 0.0) {
        float dist = length(v_uv - u_touch);
        if (dist < u_touchRadius && dist > 0.001) {
            vec2 diff = v_uv - u_touch;
            float angle = atan(diff.y, diff.x);
            float spiral = angle + dist * 30.0;
            float strength = 1.0 - dist / u_touchRadius;
            new_theta = mix(new_theta, spiral, strength * 0.8);
        }
    }

    new_theta = mod(new_theta, PI2);
    if (new_theta < 0.0) new_theta += PI2;

    gl_FragColor = vec4(new_theta, omega, 0.0, 1.0);
}
`;

const DISPLAY_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform int u_colourScheme;
varying vec2 v_uv;

const float PI2 = 6.28318530718;

// Aurora: deep navy -> teal -> pale green -> lavender -> navy (wrapping)
vec3 aurora(float t) {
    if (t < 0.2) {
        float p = t / 0.2;
        return vec3(10.0 + p*10.0, 10.0 + p*60.0, 40.0 + p*30.0) / 255.0;
    }
    if (t < 0.4) {
        float p = (t - 0.2) / 0.2;
        return vec3(20.0 + p*10.0, 70.0 + p*60.0, 70.0 + p*30.0) / 255.0;
    }
    if (t < 0.6) {
        float p = (t - 0.4) / 0.2;
        return vec3(30.0 + p*110.0, 130.0 + p*90.0, 100.0 + p*60.0) / 255.0;
    }
    if (t < 0.8) {
        float p = (t - 0.6) / 0.2;
        return vec3(140.0 + p*40.0, 220.0 - p*80.0, 160.0 + p*40.0) / 255.0;
    }
    float p = (t - 0.8) / 0.2;
    return vec3(180.0 - p*170.0, 140.0 - p*130.0, 200.0 - p*160.0) / 255.0;
}

// Terracotta: rust -> ochre -> cream -> slate -> rust (wrapping)
vec3 terracotta(float t) {
    if (t < 0.25) {
        float p = t / 0.25;
        return vec3(160.0 + p*30.0, 60.0 + p*60.0, 40.0 + p*20.0) / 255.0;
    }
    if (t < 0.5) {
        float p = (t - 0.25) / 0.25;
        return vec3(190.0 + p*10.0, 120.0 + p*40.0, 60.0 + p*20.0) / 255.0;
    }
    if (t < 0.75) {
        float p = (t - 0.5) / 0.25;
        return vec3(200.0 + p*40.0, 160.0 + p*70.0, 80.0 + p*120.0) / 255.0;
    }
    float p = (t - 0.75) / 0.25;
    return vec3(240.0 - p*80.0, 230.0 - p*170.0, 200.0 - p*160.0) / 255.0;
}

// Twilight: deep violet -> magenta -> warm -> dark
vec3 twilight(float t) {
    if (t < 0.25) {
        float p = t / 0.25;
        return vec3(20.0 + p*40.0, 10.0 + p*15.0, 60.0 + p*80.0) / 255.0;
    }
    if (t < 0.50) {
        float p = (t - 0.25) / 0.25;
        return vec3(60.0 + p*120.0, 25.0 + p*30.0, 140.0 - p*20.0) / 255.0;
    }
    if (t < 0.75) {
        float p = (t - 0.5) / 0.25;
        return vec3(180.0 + p*50.0, 55.0 + p*120.0, 120.0 - p*60.0) / 255.0;
    }
    float p = (t - 0.75) / 0.25;
    return vec3(230.0 - p*210.0, 175.0 - p*165.0, 60.0) / 255.0;
}

// Ocean: deep navy -> teal -> aqua -> dark blue (wrapping)
vec3 ocean(float t) {
    if (t < 0.25) {
        float p = t / 0.25;
        return vec3(10.0 + p*5.0, 15.0 + p*35.0, 50.0 + p*30.0) / 255.0;
    }
    if (t < 0.5) {
        float p = (t - 0.25) / 0.25;
        return vec3(15.0 + p*5.0, 50.0 + p*40.0, 80.0 + p*40.0) / 255.0;
    }
    if (t < 0.75) {
        float p = (t - 0.5) / 0.25;
        return vec3(20.0 + p*40.0, 90.0 + p*90.0, 120.0 + p*50.0) / 255.0;
    }
    float p = (t - 0.75) / 0.25;
    return vec3(60.0 - p*50.0, 180.0 - p*165.0, 170.0 - p*120.0) / 255.0;
}

void main() {
    float theta = texture2D(u_state, v_uv).r;
    float t = mod(theta, PI2) / PI2;

    vec3 col;
    if (u_colourScheme == 0) col = aurora(t);
    else if (u_colourScheme == 1) col = terracotta(t);
    else if (u_colourScheme == 2) col = twilight(t);
    else col = ocean(t);

    gl_FragColor = vec4(col, 1.0);
}
`;

// ─── Configuration ──────────────────────────────────────────────

export default fieldSim({
    id: "osc",

    shaders: {
        step: STEP_SHADER,
        display: DISPLAY_SHADER,
    },

    touchRadius: 0.06,

    /**
     * Create initial state: random phases, frequencies based on
     * distance from centre + spread parameter.
     */
    initState(width, height, params) {
        const data = new Float32Array(width * height * 4);
        const cx = width / 2, cy = height / 2;
        const maxDist = Math.sqrt(cx * cx + cy * cy);

        const spread = params.spread !== undefined ? params.spread : 0.4;
        const baseOmega = params.omega !== undefined ? params.omega : 0.6;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / maxDist;

                data[idx + 0] = Math.random() * Math.PI * 2;       // theta
                data[idx + 1] = baseOmega + spread * dist           // omega
                    + (Math.random() - 0.5) * 0.2;
                data[idx + 2] = 0;
                data[idx + 3] = 1;
            }
        }

        // Inject spiral seeds
        for (let s = 0; s < 6; s++) {
            const sx = 40 + Math.random() * (width - 80);
            const sy = 40 + Math.random() * (height - 80);
            const sr = 20 + Math.random() * 10;

            for (let dy = -sr; dy <= sr; dy++) {
                for (let dx = -sr; dx <= sr; dx++) {
                    const r = Math.sqrt(dx * dx + dy * dy);
                    if (r > 0 && r < sr) {
                        const x = Math.floor((sx + dx + width) % width);
                        const y = Math.floor((sy + dy + height) % height);
                        data[(y * width + x) * 4] = Math.atan2(dy, dx) + r * 0.4;
                    }
                }
            }
        }

        return data;
    },

    /**
     * Map control values to shader uniforms for the step pass.
     */
    getStepUniforms(params) {
        return [
            { name: "u_K", type: "1f", values: [params.K] },
            { name: "u_dt", type: "1f", values: [0.12] },
        ];
    },

    getDisplayUniforms() {
        return [];
    },

    // ─── Controls ───────────────────────────────────────────────

    controls: [
        { type: "slider", id: "K", min: 0.0, max: 4.0, step: 0.05, default: 1.5, i18nLabel: "coupling", format: 2 },
        { type: "slider", id: "spread", min: 0.0, max: 1.0, step: 0.02, default: 0.4, i18nLabel: "freq_spread", format: 2, resetsState: true },
        { type: "slider", id: "omega", min: 0.1, max: 1.5, step: 0.02, default: 0.6, i18nLabel: "base_freq", format: 2, resetsState: true },
    ],

    presets: [
        { i18nLabel: "preset_spiral", params: { K: 1.5, spread: 0.4, omega: 0.6 } },
        { i18nLabel: "preset_chimera", params: { K: 0.5, spread: 0.8, omega: 0.6 } },
        { i18nLabel: "preset_sync", params: { K: 3.0, spread: 0.2, omega: 0.4 } },
        { i18nLabel: "preset_turbulence", params: { K: 0.2, spread: 0.6, omega: 0.8 } },
    ],

    colours: [
        { gradient: "conic-gradient(#0a0a28, #1e7864, #8cdca0, #b48cc8, #0a0a28)", i18nTitle: "Polární záře" },
        { gradient: "conic-gradient(#a03c28, #c8a050, #f0e6c8, #465a50, #a03c28)", i18nTitle: "Terakota" },
        { gradient: "conic-gradient(#141032, #a03090, #e8a060, #141032)", i18nTitle: "Soumrak" },
        { gradient: "conic-gradient(#0a0f32, #145078, #3cb4aa, #1e3c64, #0a0f32)", i18nTitle: "Oceán" },
    ],

    speedSlider: { min: 1, max: 15, default: 2 },

    // ─── Equations ──────────────────────────────────────────────

    equations: {
        render(container, lang) {
            const content = document.createElement("div");
            content.className = "eq-content";

            const eq1 = document.createElement("div");
            eq1.className = "eq-math";

            if (typeof katex !== "undefined") {
                katex.render(
                    "\\frac{d\\theta_i}{dt} = \\color{#c8b88a}{\\omega_i} \\;+\\; \\frac{\\color{#c8b88a}{K}}{4} \\sum_{j \\in \\mathcal{N}} \\sin(\\theta_j - \\theta_i)",
                    eq1, { displayMode: true, throwOnError: false }
                );
            } else {
                eq1.innerHTML = "dθ<sub>i</sub>/dt = ω<sub>i</sub> + (K/4) Σ sin(θ<sub>j</sub> − θ<sub>i</sub>)";
            }

            content.appendChild(eq1);

            // Parameter legend
            const params = document.createElement("div");
            params.className = "eq-params";

            const tipData = PARAM_TIPS[lang] || PARAM_TIPS.cs;
            params.innerHTML =
                paramBadge("K", "#c8b88a", tipData.K_name, tipData.K_tip) +
                paramBadge("ω", "#c8b88a", tipData.omega_name, tipData.omega_tip) +
                paramBadge("σ", "#887550", tipData.spread_name, tipData.spread_tip);

            content.appendChild(params);
            container.appendChild(content);
        },
    },

    // ─── Translations ───────────────────────────────────────────

    translations: {
        tab_osc: { cs: "Synchronizace", en: "Synchronisation" },
        desc: {
            cs: "Tisíce blikajících světýlek, každé s jednoduchým pravidlem: přizpůsob se sousedům. Z toho vznikají spirály, vlny i chaos! Zvyšte propojení a sledujte, jak se sladí.",
            en: "Thousands of blinking lights, each with one simple rule: match your neighbours. That creates spirals, waves, and chaos! Increase the connection and watch them sync up."
        },
        coupling: { cs: "Síla propojení (K)", en: "Connection strength (K)" },
        freq_spread: { cs: "Rozdíly v tempu", en: "Tempo differences" },
        base_freq: { cs: "Základní tempo (ω)", en: "Base tempo (ω)" },
        preset_spiral: { cs: "Spirálové vlny", en: "Spiral waves" },
        preset_chimera: { cs: "Chiméra", en: "Chimera" },
        preset_sync: { cs: "Plná synchronizace", en: "Full sync" },
        preset_turbulence: { cs: "Turbulence", en: "Turbulence" },
        snap_title_osc: { cs: "Synchronizace oscilátorů", en: "Synchronisation Dynamics" },
        snap_sub_osc: {
            cs: "Tvoje nastavení propojení vytvořilo tyto vlny",
            en: "Your connection settings shaped these waves"
        },
    },

    // ─── Snapshot metadata ──────────────────────────────────────

    snapshotMeta(lang) {
        const t = (key) => {
            const entry = this.translations[key];
            return entry ? (entry[lang] || entry.cs) : key;
        };
        return {
            title: t("snap_title_osc"),
            subtitle: t("snap_sub_osc"),
        };
    },

    // ─── Content overrides from config.toml ─────────────────────
    applyContent(cfg) {
        if (!cfg) return;
        const tr = this.translations;
        const tips = PARAM_TIPS;

        const setTr = (key, csVal, enVal) => {
            if (csVal || enVal) {
                if (!tr[key]) tr[key] = { cs: csVal || "", en: enVal || "" };
                else {
                    if (csVal) tr[key].cs = csVal;
                    if (enVal) tr[key].en = enVal;
                }
            }
        };

        setTr("tab_osc",           cfg.tab_cs,               cfg.tab_en);
        setTr("desc",              cfg.desc_cs,              cfg.desc_en);
        setTr("coupling",          cfg.lbl_coupling_cs,      cfg.lbl_coupling_en);
        setTr("freq_spread",       cfg.lbl_freq_spread_cs,   cfg.lbl_freq_spread_en);
        setTr("base_freq",         cfg.lbl_base_freq_cs,     cfg.lbl_base_freq_en);
        setTr("preset_spiral",     cfg.preset_spiral_cs,     cfg.preset_spiral_en);
        setTr("preset_chimera",    cfg.preset_chimera_cs,    cfg.preset_chimera_en);
        setTr("preset_sync",       cfg.preset_sync_cs,       cfg.preset_sync_en);
        setTr("preset_turbulence", cfg.preset_turbulence_cs, cfg.preset_turbulence_en);
        setTr("snap_title_osc",    cfg.snap_title_cs,        cfg.snap_title_en);
        setTr("snap_sub_osc",      cfg.snap_sub_cs,          cfg.snap_sub_en);

        // Parameter tooltips
        for (const [lang, suffix] of [["cs", "_cs"], ["en", "_en"]]) {
            if (cfg["tip_K_name"    + suffix]) tips[lang].K_name      = cfg["tip_K_name"    + suffix];
            if (cfg["tip_K"        + suffix]) tips[lang].K_tip        = cfg["tip_K"        + suffix];
            if (cfg["tip_omega_name" + suffix]) tips[lang].omega_name  = cfg["tip_omega_name" + suffix];
            if (cfg["tip_omega"     + suffix]) tips[lang].omega_tip    = cfg["tip_omega"     + suffix];
            if (cfg["tip_spread_name" + suffix]) tips[lang].spread_name = cfg["tip_spread_name" + suffix];
            if (cfg["tip_spread"    + suffix]) tips[lang].spread_tip   = cfg["tip_spread"    + suffix];
        }
    },
});

// ─── Helpers ────────────────────────────────────────────────────

const PARAM_TIPS = {
    cs: {
        K_name: "= propojení",
        K_tip: "Jak moc sousední světýlka ovlivňují jedno druhé — čím víc, tím spíš začnou blikat společně",
        omega_name: "= tempo",
        omega_tip: "Jak rychle světýlka blikají sama od sebe, bez vlivu sousedů",
        spread_name: "= rozdíly",
        spread_tip: "Jak moc se liší tempo jednotlivých světýlek — malý rozdíl = snáz se sladí",
    },
    en: {
        K_name: "= connection",
        K_tip: "How much neighbouring lights influence each other — the more, the sooner they blink together",
        omega_name: "= tempo",
        omega_tip: "How fast each light blinks on its own, without any neighbours",
        spread_name: "= differences",
        spread_tip: "How different the blinking speeds are — small difference = easier to synchronise",
    },
};

function paramBadge(symbol, colour, name, tooltip) {
    return '<div class="eq-param">' +
        '<span class="eq-param-symbol" style="color:' + colour + ';">' + symbol + '</span>' +
        '<span class="eq-param-name">' + name + '</span>' +
        '<div class="eq-tooltip">' + tooltip + '</div>' +
        '</div>';
}
