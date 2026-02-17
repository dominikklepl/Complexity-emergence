/**
 * controls.js — Data-driven sidebar control generation
 *
 * Reads a simulation's control declarations (sliders, selects, toggles)
 * and generates the sidebar DOM. Returns a function to read current param values.
 */

import { t } from "./i18n.js";

/**
 * Build the sidebar controls for a simulation.
 *
 * @param {Object} sim  The simulation module
 * @param {HTMLElement} container  The DOM element to populate
 * @param {Object} callbacks  { onParamChange, onPreset, onColourChange, onReset }
 * @returns {{ getParams: () => Object, getSpeed: () => number, getColourScheme: () => number }}
 */
export function buildControls(sim, container, callbacks) {
    container.innerHTML = "";

    let colourScheme = 0;

    // --- Description ---
    if (sim.translations.desc) {
        const desc = document.createElement("div");
        desc.className = "description";
        desc.dataset.i18n = "desc";
        desc.textContent = t("desc");
        container.appendChild(desc);
    }

    // --- Presets ---
    if (sim.presets && sim.presets.length > 0) {
        const title = document.createElement("div");
        title.className = "section-title";
        title.dataset.i18n = "presets";
        title.textContent = t("presets");
        container.appendChild(title);

        const presetsDiv = document.createElement("div");
        presetsDiv.className = "presets";

        for (const preset of sim.presets) {
            const btn = document.createElement("button");
            btn.className = "preset-btn";
            btn.dataset.i18n = preset.i18nLabel;
            btn.textContent = t(preset.i18nLabel);
            btn.addEventListener("click", () => {
                // Set all slider/control values from preset
                for (const [paramId, value] of Object.entries(preset.params)) {
                    const input = container.querySelector(`[data-param-id="${paramId}"]`);
                    if (input) {
                        input.value = value;
                        // Update displayed value
                        const valSpan = container.querySelector(`[data-val-id="${paramId}"]`);
                        if (valSpan) {
                            const ctrl = sim.controls.find(c => c.id === paramId);
                            valSpan.textContent = formatValue(value, ctrl ? ctrl.format : null);
                        }
                    }
                }
                if (callbacks.onPreset) callbacks.onPreset(preset);
            });
            presetsDiv.appendChild(btn);
        }
        container.appendChild(presetsDiv);
    }

    // --- Parameters ---
    const hasControls = sim.controls && sim.controls.length > 0;
    if (hasControls) {
        const title = document.createElement("div");
        title.className = "section-title";
        title.dataset.i18n = "parameters";
        title.textContent = t("parameters");
        container.appendChild(title);

        for (const ctrl of sim.controls) {
            if (ctrl.type === "slider") {
                container.appendChild(buildSlider(ctrl, callbacks));
            } else if (ctrl.type === "select") {
                container.appendChild(buildSelect(ctrl, callbacks));
            } else if (ctrl.type === "toggle") {
                container.appendChild(buildToggle(ctrl, callbacks));
            }
        }
    }

    // --- Speed slider ---
    if (sim.speedSlider) {
        const speedCtrl = {
            type: "slider",
            id: "_speed",
            min: sim.speedSlider.min,
            max: sim.speedSlider.max,
            step: 1,
            default: sim.speedSlider.default,
            i18nLabel: "speed",
            format: 0,
        };
        container.appendChild(buildSlider(speedCtrl, {}));
    }

    // --- Colour schemes ---
    if (sim.colours && sim.colours.length > 0) {
        const title = document.createElement("div");
        title.className = "section-title";
        title.dataset.i18n = "colour_scheme";
        title.textContent = t("colour_scheme");
        container.appendChild(title);

        const coloursDiv = document.createElement("div");
        coloursDiv.className = "colour-btns";

        sim.colours.forEach((colour, idx) => {
            const btn = document.createElement("button");
            btn.className = "colour-btn" + (idx === 0 ? " active" : "");
            btn.style.background = colour.gradient;
            btn.title = colour.i18nTitle || "";
            btn.addEventListener("click", () => {
                coloursDiv.querySelectorAll(".colour-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                colourScheme = idx;
                if (callbacks.onColourChange) callbacks.onColourChange(idx);
            });
            coloursDiv.appendChild(btn);
        });
        container.appendChild(coloursDiv);
    }

    // --- Return accessors ---
    return {
        getParams() {
            const params = {};
            if (!sim.controls) return params;
            for (const ctrl of sim.controls) {
                const el = container.querySelector(`[data-param-id="${ctrl.id}"]`);
                if (!el) continue;
                if (ctrl.type === "slider") {
                    params[ctrl.id] = parseFloat(el.value);
                } else if (ctrl.type === "select") {
                    params[ctrl.id] = el.value;
                } else if (ctrl.type === "toggle") {
                    params[ctrl.id] = el.checked;
                }
            }
            return params;
        },

        getSpeed() {
            const el = container.querySelector('[data-param-id="_speed"]');
            return el ? parseInt(el.value) : (sim.speedSlider ? sim.speedSlider.default : 1);
        },

        getColourScheme() {
            return colourScheme;
        },
    };
}

// ─── Control builders ───────────────────────────────────────────

function formatValue(value, format) {
    if (format === null || format === undefined) return String(value);
    if (typeof format === "number") return Number(value).toFixed(format);
    return String(value);
}

function buildSlider(ctrl, callbacks) {
    const group = document.createElement("div");
    group.className = "slider-group";

    const label = document.createElement("div");
    label.className = "slider-label";

    const nameSpan = document.createElement("span");
    nameSpan.dataset.i18n = ctrl.i18nLabel;
    nameSpan.textContent = t(ctrl.i18nLabel);

    const valSpan = document.createElement("span");
    valSpan.className = "val";
    valSpan.dataset.valId = ctrl.id;
    valSpan.textContent = formatValue(ctrl.default, ctrl.format);

    label.appendChild(nameSpan);
    label.appendChild(valSpan);

    const input = document.createElement("input");
    input.type = "range";
    input.dataset.paramId = ctrl.id;
    input.min = ctrl.min;
    input.max = ctrl.max;
    input.step = ctrl.step;
    input.value = ctrl.default;

    input.addEventListener("input", () => {
        valSpan.textContent = formatValue(input.value, ctrl.format);
        if (ctrl.resetsState && callbacks.onReset) {
            callbacks.onReset();
        } else if (callbacks.onParamChange) {
            callbacks.onParamChange(ctrl.id, parseFloat(input.value));
        }
    });

    group.appendChild(label);
    group.appendChild(input);
    return group;
}

function buildSelect(ctrl, callbacks) {
    const group = document.createElement("div");
    group.className = "slider-group";

    const label = document.createElement("div");
    label.className = "slider-label";

    const nameSpan = document.createElement("span");
    nameSpan.dataset.i18n = ctrl.i18nLabel;
    nameSpan.textContent = t(ctrl.i18nLabel);
    label.appendChild(nameSpan);

    const select = document.createElement("select");
    select.dataset.paramId = ctrl.id;
    select.style.cssText = "background:#2a2a44; color:#e0dcd4; border:1px solid #c8b88a44; border-radius:3px; padding:4px 8px; font-size:12px;";

    for (const opt of ctrl.options) {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = t(opt.i18nLabel);
        option.dataset.i18n = opt.i18nLabel;
        if (opt.value === ctrl.default) option.selected = true;
        select.appendChild(option);
    }

    select.addEventListener("change", () => {
        if (ctrl.resetsState && callbacks.onReset) {
            callbacks.onReset();
        } else if (callbacks.onParamChange) {
            callbacks.onParamChange(ctrl.id, select.value);
        }
    });

    group.appendChild(label);
    group.appendChild(select);
    return group;
}

function buildToggle(ctrl, callbacks) {
    const group = document.createElement("div");
    group.className = "slider-group";
    group.style.flexDirection = "row";
    group.style.alignItems = "center";
    group.style.gap = "8px";

    const label = document.createElement("span");
    label.style.fontSize = "12px";
    label.style.color = "#aaa";
    label.dataset.i18n = ctrl.i18nLabel;
    label.textContent = t(ctrl.i18nLabel);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.paramId = ctrl.id;
    input.checked = ctrl.default;
    input.style.accentColor = "#c8b88a";

    input.addEventListener("change", () => {
        if (ctrl.resetsState && callbacks.onReset) {
            callbacks.onReset();
        } else if (callbacks.onParamChange) {
            callbacks.onParamChange(ctrl.id, input.checked);
        }
    });

    group.appendChild(input);
    group.appendChild(label);
    return group;
}
