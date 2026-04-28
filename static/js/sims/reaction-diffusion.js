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

    vec2 here  = texture2D(u_state, v_uv).rg;
    float u = here.r;
    float v = here.g;

    // Sample each neighbour once; read both channels (u,v) from the same fetch.
    vec2 nb_up    = texture2D(u_state, v_uv + dy).rg;
    vec2 nb_down  = texture2D(u_state, v_uv - dy).rg;
    vec2 nb_left  = texture2D(u_state, v_uv - dx).rg;
    vec2 nb_right = texture2D(u_state, v_uv + dx).rg;
    float lap_u = nb_up.r + nb_down.r + nb_left.r + nb_right.r - 4.0 * u;
    float lap_v = nb_up.g + nb_down.g + nb_left.g + nb_right.g - 4.0 * v;

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

// Branchless piecewise-linear ramps using mix()+step(). No per-pixel branches.
// Stop colours verified against original formulas at each breakpoint.

// Porcelain: cream(0) -> soft blue(0.3) -> indigo(0.6) -> deep navy(1)
vec3 porcelain(float t) {
    vec3 c0 = vec3(245.0, 240.0, 230.0) / 255.0;
    vec3 c1 = vec3(190.0, 200.0, 220.0) / 255.0;
    vec3 c2 = vec3(120.0, 170.0, 180.0) / 255.0;
    vec3 c3 = vec3( 30.0,  50.0,  80.0) / 255.0;
    vec3 s0 = mix(c0, c1, clamp(t / 0.3, 0.0, 1.0));
    vec3 s1 = mix(c1, c2, clamp((t - 0.3) / 0.3, 0.0, 1.0));
    vec3 s2 = mix(c2, c3, clamp((t - 0.6) / 0.4, 0.0, 1.0));
    return mix(mix(s0, s1, step(0.3, t)), s2, step(0.6, t));
}

// Forest: dark brown(0) -> moss(0.25) -> sage(0.5) -> olive(0.75) -> warm cream(1)
vec3 forest(float t) {
    vec3 c0 = vec3( 30.0,  25.0,  20.0) / 255.0;
    vec3 c1 = vec3( 45.0,  55.0,  30.0) / 255.0;
    vec3 c2 = vec3( 70.0, 100.0,  55.0) / 255.0;
    vec3 c3 = vec3(140.0, 160.0, 120.0) / 255.0;
    vec3 c4 = vec3(220.0, 210.0, 180.0) / 255.0;
    vec3 s0 = mix(c0, c1, clamp(t / 0.25, 0.0, 1.0));
    vec3 s1 = mix(c1, c2, clamp((t - 0.25) / 0.25, 0.0, 1.0));
    vec3 s2 = mix(c2, c3, clamp((t - 0.5)  / 0.25, 0.0, 1.0));
    vec3 s3 = mix(c3, c4, clamp((t - 0.75) / 0.25, 0.0, 1.0));
    return mix(mix(mix(s0, s1, step(0.25, t)), s2, step(0.5, t)), s3, step(0.75, t));
}

// Sunset: deep plum(0) -> rose(0.25) -> amber(0.5) -> gold(0.75) -> pale gold(1)
vec3 sunset(float t) {
    vec3 c0 = vec3( 40.0,  15.0,  30.0) / 255.0;
    vec3 c1 = vec3( 90.0,  25.0,  35.0) / 255.0;
    vec3 c2 = vec3(160.0,  55.0,  45.0) / 255.0;
    vec3 c3 = vec3(220.0, 150.0,  60.0) / 255.0;
    vec3 c4 = vec3(250.0, 230.0, 180.0) / 255.0;
    vec3 s0 = mix(c0, c1, clamp(t / 0.25, 0.0, 1.0));
    vec3 s1 = mix(c1, c2, clamp((t - 0.25) / 0.25, 0.0, 1.0));
    vec3 s2 = mix(c2, c3, clamp((t - 0.5)  / 0.25, 0.0, 1.0));
    vec3 s3 = mix(c3, c4, clamp((t - 0.75) / 0.25, 0.0, 1.0));
    return mix(mix(mix(s0, s1, step(0.25, t)), s2, step(0.5, t)), s3, step(0.75, t));
}

// Ink: near-black(0) -> warm grey(0.3) -> mid grey(0.7) -> off-white(1)
vec3 ink(float t) {
    vec3 c0 = vec3( 15.0,  15.0,  20.0) / 255.0;
    vec3 c1 = vec3( 50.0,  47.0,  45.0) / 255.0;
    vec3 c2 = vec3(110.0, 102.0,  95.0) / 255.0;
    vec3 c3 = vec3(245.0, 240.0, 235.0) / 255.0;
    vec3 s0 = mix(c0, c1, clamp(t / 0.3, 0.0, 1.0));
    vec3 s1 = mix(c1, c2, clamp((t - 0.3) / 0.4, 0.0, 1.0));
    vec3 s2 = mix(c2, c3, clamp((t - 0.7) / 0.3, 0.0, 1.0));
    return mix(mix(s0, s1, step(0.3, t)), s2, step(0.7, t));
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

    // Run simulation at 768×512 (4× fewer pixels than 1536×1024) for performance.
    // Display shader upscales with LINEAR filtering so output looks smooth at full canvas size.
    simW: 768,
    simH: 512,
    displayLinear: true,

    touchRadius: 0.03,
    // Values injected when user draws while paused: u=0 (fuel depleted), v=0.9 (activator peak)
    // Creates active pattern seeds that grow into structure when simulation resumes.
    paintColor: [0.0, 0.9, 0.0, 1.0],
    paintRadius: 0.010,

    /**
     * Create initial state.
     * seed_mode 'noise' (labyrinth): tiny uniform v perturbations everywhere so
     * the Turing instability amplifies them into connected maze-like stripes.
     * Default (sparse): 40 small random seed patches — patterns grow from local seeds.
     */
    initState(width, height, params) {
        const data = new Float32Array(width * height * 4);

        if (params?.seed_mode === 'noise') {
            for (let i = 0; i < width * height; i++) {
                const v = 0.01 + Math.random() * 0.02;
                data[i * 4 + 0] = 1.0 - v;
                data[i * 4 + 1] = v;
                data[i * 4 + 2] = 0.0;
                data[i * 4 + 3] = 1.0;
            }
            return data;
        }

        // Fill with u=1, v=0 (same for both 'blank' mode and sparse-seed mode)
        for (let i = 0; i < width * height; i++) {
            data[i * 4 + 0] = 1.0;
            data[i * 4 + 1] = 0.0;
            data[i * 4 + 2] = 0.0;
            data[i * 4 + 3] = 1.0;
        }

        // 'blank' mode: pure resting state — user draws seeds while paused
        if (params?.seed_mode === 'blank') return data;

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
        // Blank canvas, auto-paused: user draws seeds with touch/mouse, then unpauses.
        { i18nLabel: "preset_explore", params: { f: 0.037, k: 0.060, seed_mode: 'blank', auto_pause: true } },
        // Noise seeding: Turing instability amplifies tiny perturbations into connected stripe maze.
        { i18nLabel: "preset_labyrinth", params: { f: 0.037, k: 0.060, seed_mode: 'noise' } },
        // Sparse seeds: isolated spots — classic leopard-pattern regime.
        { i18nLabel: "preset_spots", params: { f: 0.035, k: 0.065 } },
        // Large organic blob/holes regime — rename before exhibition
        { i18nLabel: "preset_blobs", params: { f: 0.025, k: 0.051, seed_mode: 'noise' } },
    ],

    colours: [
        { gradient: "linear-gradient(135deg, #f0ede6, #a0b4c8, #1e2850)", i18nTitle: "Porcelán" },
        { gradient: "linear-gradient(135deg, #1e1914, #3c5a32, #dcd2b4)", i18nTitle: "Les" },
        { gradient: "linear-gradient(135deg, #280f1e, #963c3c, #fae6b4)", i18nTitle: "Západ slunce" },
        { gradient: "linear-gradient(135deg, #0f0f14, #645f5a, #f5f0eb)", i18nTitle: "Inkoust" },
    ],

    speedSlider: { min: 0, max: 60, step: 1, default: 30 },
    interactionSlider: { min: 0.005, max: 0.12, step: 0.005, default: 0.03 },

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
        tagline: {
            cs: "Dvě látky, jedna reakce, nekonečné vzory. Stejná matematika jako na kůži leoparda.",
            en: "Two chemicals, one reaction, endless patterns. The same math as a leopard's coat.",
        },
        desc: {
            cs: "Dvě jednoduchá chemická pravidla stačí k vytvoření složitých vzorů — podobných skvrnám na kůži zvířat! Posuň posuvníky a sleduj, co se stane.",
            en: "Two simple chemical rules are enough to create complex patterns — just like spots on animal skin! Move the sliders and watch what happens."
        },
        feed_rate: { cs: "Přidávání látky (f)", en: "Adding chemical (f)" },
        kill_rate: { cs: "Odbourávání látky (k)", en: "Removing chemical (k)" },
        preset_explore:   { cs: "Kresli sám",  en: "Draw your own" },
        preset_labyrinth: { cs: "Labyrint",    en: "Labyrinth" },
        preset_spots:     { cs: "Skvrny",      en: "Spots" },
        snap_title_rd: { cs: "Turingovy vzory", en: "Turing Patterns" },
        snap_sub_rd: {
            cs: "Tvoje nastavení vytvořilo tento jedinečný vzor",
            en: "Your settings created this unique pattern"
        },
        explain_a: {
            cs: "Dvě neviditelné chemikálie zápolí o prostor — jedna se šíří rychle, druhá pomalu. Tenhle rozdíl v rychlosti vytesává vzor. Přidej poruchu kliknutím: tvá stopa se neroztratí — rozroste se do nového vzoru, někdy do vlny, někdy do spirály. Stejný typ chemického souboje tvoří pruhy na kůži zebry a tečky na kůži jaguára.",
            en: "Two invisible chemicals are fighting over territory — one spreads fast, one spreads slow. That speed difference carves the pattern. Click to add a disturbance: your trace doesn't fade — it grows into a new pattern, sometimes a wave, sometimes a spiral. This same type of competition makes zebra stripes and jaguar spots.",
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

    // ─── Content overrides from config.toml ─────────────────────
    // Called by index.html after /api/config is loaded.
    // `cfg` is the flat object from config.toml [content.rd].
    applyContent(cfg) {
        if (!cfg) return;
        const tr = this.translations;
        const tips = PARAM_TIPS;

        // Helper: set both cs and en in a translations entry
        const setTr = (key, csVal, enVal) => {
            if (csVal || enVal) {
                if (!tr[key]) tr[key] = { cs: csVal || "", en: enVal || "" };
                else {
                    if (csVal) tr[key].cs = csVal;
                    if (enVal) tr[key].en = enVal;
                }
            }
        };

        setTr("tab_rd", cfg.tab_cs, cfg.tab_en);
        if (cfg.tagline_cs) this.translations.tagline.cs = cfg.tagline_cs;
        if (cfg.tagline_en) this.translations.tagline.en = cfg.tagline_en;
        setTr("desc", cfg.desc_cs, cfg.desc_en);
        setTr("feed_rate", cfg.lbl_feed_rate_cs, cfg.lbl_feed_rate_en);
        setTr("kill_rate", cfg.lbl_kill_rate_cs, cfg.lbl_kill_rate_en);
        setTr("preset_explore",   cfg.preset_explore_cs,   cfg.preset_explore_en);
        setTr("preset_labyrinth", cfg.preset_labyrinth_cs, cfg.preset_labyrinth_en);
        setTr("preset_spots",     cfg.preset_spots_cs,     cfg.preset_spots_en);
        setTr("preset_blobs",     cfg.preset_blobs_cs,     cfg.preset_blobs_en);
        setTr("snap_title_rd", cfg.snap_title_cs, cfg.snap_title_en);
        setTr("snap_sub_rd", cfg.snap_sub_cs, cfg.snap_sub_en);
        setTr("explain_a", cfg.explain_a_cs, cfg.explain_a_en);

        // Parameter tooltips
        const overrideTip = (lang, key, nameProp, tipProp) => {
            if (cfg[nameProp]) tips[lang][key + "_name"] = cfg[nameProp];
            if (cfg[tipProp]) tips[lang][key + "_tip"] = cfg[tipProp];
        };
        for (const [lang, suffix] of [["cs", "_cs"], ["en", "_en"]]) {
            overrideTip(lang, "f", "tip_f_name" + suffix, "tip_f" + suffix);
            overrideTip(lang, "k", "tip_k_name" + suffix, "tip_k" + suffix);
            overrideTip(lang, "Du", "tip_Du_name" + suffix, "tip_Du" + suffix);
            overrideTip(lang, "Dv", "tip_Dv_name" + suffix, "tip_Dv" + suffix);
        }

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
