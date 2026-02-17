/**
 * reaction-diffusion.js — Gray-Scott reaction-diffusion simulation
 *
 * Implements Turing pattern formation: two chemicals (u, v) diffuse
 * and react, creating spots, stripes, labyrinths, and other patterns.
 *
 * To add this simulation to the app, import it and call registerSim():
 *   import rdSim from "./sims/reaction-diffusion.js";
 *   registerSim(rdSim);
 */

import { fieldSim } from "../core/fieldSim.js";
import { SIM_W, SIM_H } from "../core/webgl.js";

// ─── GLSL Shaders ───────────────────────────────────────────────

const STEP_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform vec2 u_resolution;
uniform float u_f;
uniform float u_k;
uniform float u_Du;
uniform float u_Dv;
uniform vec2 u_touch;
uniform float u_touchRadius;

varying vec2 v_uv;

void main() {
    vec2 dx = vec2(1.0 / u_resolution.x, 0.0);
    vec2 dy = vec2(0.0, 1.0 / u_resolution.y);

    vec4 here  = texture2D(u_state, v_uv);
    float u = here.r;
    float v = here.g;

    float u_up    = texture2D(u_state, v_uv + dy).r;
    float u_down  = texture2D(u_state, v_uv - dy).r;
    float u_left  = texture2D(u_state, v_uv - dx).r;
    float u_right = texture2D(u_state, v_uv + dx).r;
    float lap_u   = u_up + u_down + u_left + u_right - 4.0 * u;

    float v_up    = texture2D(u_state, v_uv + dy).g;
    float v_down  = texture2D(u_state, v_uv - dy).g;
    float v_left  = texture2D(u_state, v_uv - dx).g;
    float v_right = texture2D(u_state, v_uv + dx).g;
    float lap_v   = v_up + v_down + v_left + v_right - 4.0 * v;

    float uvv = u * v * v;
    float new_u = u + u_Du * lap_u - uvv + u_f * (1.0 - u);
    float new_v = v + u_Dv * lap_v + uvv - (u_f + u_k) * v;

    if (u_touch.x >= 0.0) {
        float dist = length(v_uv - u_touch);
        if (dist < u_touchRadius) {
            float strength = 1.0 - dist / u_touchRadius;
            new_u -= 0.1 * strength;
            new_v += 0.2 * strength;
        }
    }

    gl_FragColor = vec4(clamp(new_u, 0.0, 1.0), clamp(new_v, 0.0, 1.0), 0.0, 1.0);
}
`;

const DISPLAY_SHADER = `
precision highp float;

uniform sampler2D u_state;
uniform int u_colourScheme;
varying vec2 v_uv;

// Porcelain: cream -> soft blue -> deep indigo
vec3 porcelain(float t) {
    if (t < 0.3) {
        float p = t / 0.3;
        return vec3(245.0 - p*55.0, 240.0 - p*40.0, 230.0 - p*10.0) / 255.0;
    }
    if (t < 0.6) {
        float p = (t - 0.3) / 0.3;
        return vec3(190.0 - p*70.0, 200.0 - p*30.0, 220.0 - p*40.0) / 255.0;
    }
    float p = (t - 0.6) / 0.4;
    return vec3(120.0 - p*90.0, 170.0 - p*120.0, 180.0 - p*100.0) / 255.0;
}

// Forest: dark brown -> moss -> sage -> warm cream
vec3 forest(float t) {
    if (t < 0.25) {
        float p = t / 0.25;
        return vec3(30.0 + p*15.0, 25.0 + p*30.0, 20.0 + p*10.0) / 255.0;
    }
    if (t < 0.5) {
        float p = (t - 0.25) / 0.25;
        return vec3(45.0 + p*25.0, 55.0 + p*45.0, 30.0 + p*25.0) / 255.0;
    }
    if (t < 0.75) {
        float p = (t - 0.5) / 0.25;
        return vec3(70.0 + p*70.0, 100.0 + p*60.0, 55.0 + p*65.0) / 255.0;
    }
    float p = (t - 0.75) / 0.25;
    return vec3(140.0 + p*80.0, 160.0 + p*50.0, 120.0 + p*60.0) / 255.0;
}

// Sunset: deep plum -> rose -> amber -> pale gold
vec3 sunset(float t) {
    if (t < 0.25) {
        float p = t / 0.25;
        return vec3(40.0 + p*50.0, 15.0 + p*10.0, 30.0 + p*5.0) / 255.0;
    }
    if (t < 0.5) {
        float p = (t - 0.25) / 0.25;
        return vec3(90.0 + p*70.0, 25.0 + p*30.0, 35.0 + p*10.0) / 255.0;
    }
    if (t < 0.75) {
        float p = (t - 0.5) / 0.25;
        return vec3(160.0 + p*60.0, 55.0 + p*95.0, 45.0 + p*15.0) / 255.0;
    }
    float p = (t - 0.75) / 0.25;
    return vec3(220.0 + p*30.0, 150.0 + p*80.0, 60.0 + p*120.0) / 255.0;
}

// Ink: near-black -> warm grey -> off-white (sepia tint)
vec3 ink(float t) {
    if (t < 0.3) {
        float p = t / 0.3;
        return vec3(15.0 + p*35.0, 15.0 + p*32.0, 20.0 + p*25.0) / 255.0;
    }
    if (t < 0.7) {
        float p = (t - 0.3) / 0.4;
        return vec3(50.0 + p*60.0, 47.0 + p*55.0, 45.0 + p*50.0) / 255.0;
    }
    float p = (t - 0.7) / 0.3;
    return vec3(110.0 + p*135.0, 102.0 + p*138.0, 95.0 + p*140.0) / 255.0;
}

void main() {
    float v = texture2D(u_state, v_uv).g;
    float t = clamp(v * 3.5, 0.0, 1.0);

    vec3 col;
    if (u_colourScheme == 0) col = porcelain(t);
    else if (u_colourScheme == 1) col = forest(t);
    else if (u_colourScheme == 2) col = sunset(t);
    else col = ink(t);

    gl_FragColor = vec4(col, 1.0);
}
`;

// ─── Configuration ──────────────────────────────────────────────

export default fieldSim({
    id: "rd",

    shaders: {
        step: STEP_SHADER,
        display: DISPLAY_SHADER,
    },

    touchRadius: 0.03,

    /**
     * Create initial state: u=1 everywhere, v=0 everywhere,
     * with random seed patches of elevated v.
     */
    initState(width, height, _params) {
        const data = new Float32Array(width * height * 4);

        // Fill with u=1, v=0
        for (let i = 0; i < width * height; i++) {
            data[i * 4 + 0] = 1.0;
            data[i * 4 + 1] = 0.0;
            data[i * 4 + 2] = 0.0;
            data[i * 4 + 3] = 1.0;
        }

        // Seed random patches
        for (let s = 0; s < 40; s++) {
            const cx = Math.floor(20 + Math.random() * (width - 40));
            const cy = Math.floor(20 + Math.random() * (height - 40));
            const r = 3 + Math.floor(Math.random() * 5);

            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (dx * dx + dy * dy < r * r) {
                        const x = (cx + dx + width) % width;
                        const y = (cy + dy + height) % height;
                        const idx = (y * width + x) * 4;
                        data[idx + 0] = 0.5 + Math.random() * 0.1;
                        data[idx + 1] = 0.25 + Math.random() * 0.1;
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
            { name: "u_f", type: "1f", values: [params.f] },
            { name: "u_k", type: "1f", values: [params.k] },
            { name: "u_Du", type: "1f", values: [0.16] },
            { name: "u_Dv", type: "1f", values: [0.08] },
        ];
    },

    getDisplayUniforms() {
        return [];  // colourScheme is set by the engine
    },

    // ─── Controls ───────────────────────────────────────────────

    controls: [
        { type: "slider", id: "f", min: 0.01, max: 0.08, step: 0.001, default: 0.042, i18nLabel: "feed_rate", format: 3 },
        { type: "slider", id: "k", min: 0.04, max: 0.075, step: 0.001, default: 0.063, i18nLabel: "kill_rate", format: 3 },
    ],

    presets: [
        { i18nLabel: "preset_labyrinth", params: { f: 0.042, k: 0.063 } },
        { i18nLabel: "preset_spots", params: { f: 0.035, k: 0.065 } },
        { i18nLabel: "preset_waves", params: { f: 0.014, k: 0.054 } },
        { i18nLabel: "preset_worms", params: { f: 0.046, k: 0.063 } },
        { i18nLabel: "preset_coral", params: { f: 0.025, k: 0.060 } },
    ],

    colours: [
        { gradient: "linear-gradient(135deg, #f0ede6, #a0b4c8, #1e2850)", i18nTitle: "Porcelán" },
        { gradient: "linear-gradient(135deg, #1e1914, #3c5a32, #dcd2b4)", i18nTitle: "Les" },
        { gradient: "linear-gradient(135deg, #280f1e, #963c3c, #fae6b4)", i18nTitle: "Západ slunce" },
        { gradient: "linear-gradient(135deg, #0f0f14, #645f5a, #f5f0eb)", i18nTitle: "Inkoust" },
    ],

    speedSlider: { min: 1, max: 30, default: 10 },

    // ─── Equations ──────────────────────────────────────────────

    equations: {
        render(container, lang) {
            const content = document.createElement("div");
            content.className = "eq-content";

            const eq1 = document.createElement("div");
            eq1.className = "eq-math";
            const eq2 = document.createElement("div");
            eq2.className = "eq-math";

            if (typeof katex !== "undefined") {
                katex.render(
                    "\\frac{\\partial u}{\\partial t} = \\color{#887550}{D_u} \\nabla^2 u \\;-\\; uv^2 \\;+\\; \\color{#c8b88a}{f}\\,(1 - u)",
                    eq1, { displayMode: true, throwOnError: false }
                );
                katex.render(
                    "\\frac{\\partial v}{\\partial t} = \\color{#887550}{D_v} \\nabla^2 v \\;+\\; uv^2 \\;-\\; (\\color{#c8b88a}{f} + \\color{#c8b88a}{k})\\,v",
                    eq2, { displayMode: true, throwOnError: false }
                );
            } else {
                eq1.innerHTML = "∂u/∂t = D<sub>u</sub>∇²u − uv² + f(1−u)";
                eq2.innerHTML = "∂v/∂t = D<sub>v</sub>∇²v + uv² − (f+k)v";
            }

            content.appendChild(eq1);
            content.appendChild(eq2);

            // Parameter legend
            const params = document.createElement("div");
            params.className = "eq-params";

            const tipData = PARAM_TIPS[lang] || PARAM_TIPS.cs;
            params.innerHTML =
                paramBadge("f", "#c8b88a", tipData.f_name, tipData.f_tip) +
                paramBadge("k", "#c8b88a", tipData.k_name, tipData.k_tip) +
                paramBadge("D<sub>u</sub>", "#887550", "= 0.16 (" + tipData.Du_name + ")", tipData.Du_tip) +
                paramBadge("D<sub>v</sub>", "#887550", "= 0.08 (" + tipData.Dv_name + ")", tipData.Dv_tip);

            content.appendChild(params);
            container.appendChild(content);
        },
    },

    // ─── Translations ───────────────────────────────────────────

    translations: {
        tab_rd: { cs: "Turingovy vzory", en: "Turing Patterns" },
        desc: {
            cs: "Dvě jednoduché chemické pravidla stačí k vytvoření složitých vzorů — podobných skvrnám na kůži zvířat! Posuňte posuvníky a sledujte, co se stane.",
            en: "Two simple chemical rules are enough to create complex patterns — just like spots on animal skin! Move the sliders and watch what happens."
        },
        feed_rate: { cs: "Přidávání látky (f)", en: "Adding chemical (f)" },
        kill_rate: { cs: "Odbourávání látky (k)", en: "Removing chemical (k)" },
        preset_labyrinth: { cs: "Labyrint", en: "Labyrinth" },
        preset_spots: { cs: "Skvrny", en: "Spots" },
        preset_waves: { cs: "Vlny", en: "Waves" },
        preset_worms: { cs: "Červi", en: "Worms" },
        preset_coral: { cs: "Korál", en: "Coral" },
        snap_title_rd: { cs: "Turingovy vzory", en: "Turing Patterns" },
        snap_sub_rd: {
            cs: "Tvoje nastavení vytvořilo tento jedinečný vzor",
            en: "Your settings created this unique pattern"
        },
    },

    // ─── Snapshot metadata ──────────────────────────────────────

    snapshotMeta(lang) {
        const t = (key) => {
            const entry = this.translations[key];
            return entry ? (entry[lang] || entry.cs) : key;
        };
        return {
            title: t("snap_title_rd"),
            subtitle: t("snap_sub_rd"),
        };
    },
});

// ─── Helpers ────────────────────────────────────────────────────

const PARAM_TIPS = {
    cs: {
        f_name: "= přidávání",
        f_tip: "Kolik nové látky se neustále přilévá — jako když pouštíš vodu do vany",
        k_name: "= odbourávání",
        k_tip: "Jak rychle látka mizí — jako když voda odtéká odtokem",
        Du_name: "šíření látky 1",
        Du_tip: "Jak rychle se první látka rozlévá do okolí (tuto hodnotu nelze měnit)",
        Dv_name: "šíření látky 2",
        Dv_tip: "Jak rychle se druhá látka rozlévá — pomaleji než první, a právě to vytváří vzory! (nelze měnit)",
    },
    en: {
        f_name: "= feed",
        f_tip: "How much new stuff keeps flowing in — like running water into a bathtub",
        k_name: "= removal",
        k_tip: "How fast stuff disappears — like water draining out",
        Du_name: "spread of chem. 1",
        Du_tip: "How fast the first chemical spreads to its surroundings (this value is fixed)",
        Dv_name: "spread of chem. 2",
        Dv_tip: "How fast the second chemical spreads — slower than the first, and that's what creates patterns! (fixed)",
    },
};

function paramBadge(symbol, colour, name, tooltip) {
    return '<div class="eq-param">' +
        '<span class="eq-param-symbol" style="color:' + colour + ';">' + symbol + '</span>' +
        '<span class="eq-param-name">' + name + '</span>' +
        '<div class="eq-tooltip">' + tooltip + '</div>' +
        '</div>';
}
