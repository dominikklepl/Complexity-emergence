/**
 * i18n.js — Internationalisation system
 *
 * Manages translations with namespaced keys. Core (shared) translations
 * live here; each simulation registers its own fragment via mergeTranslations().
 */

/** @type {"cs"|"en"} */
let currentLang = "cs";

/**
 * Core translations shared across all simulations.
 * Sim-specific keys are merged in at registration time.
 */
const translations = {
    title: { cs: "Z jednoduchého složité", en: "From Simple to Complex" },
    presets: { cs: "Předvolby", en: "Presets" },
    parameters: { cs: "Parametry", en: "Parameters" },
    colour_scheme: { cs: "Barevné schéma", en: "Colour scheme" },
    speed: { cs: "Rychlost simulace", en: "Simulation speed" },
    reset: { cs: "⟲ Resetovat", en: "⟲ Reset" },
    pause: { cs: "⏸ Pauza", en: "⏸ Pause" },
    resume: { cs: "▶ Spustit", en: "▶ Resume" },
    snapshot: { cs: "📸 Pohlednice", en: "📸 Postcard" },
    sim_label: { cs: "SIMULACE", en: "SIMULATION" },
    tagline: { cs: "Čtyři simulace o tom, jak z malých pravidel vzniká velký vzor.", en: "Four simulations showing how big patterns arise from small rules." },
    touch_hint: { cs: "Klikni na plátno a přidej nové vzory", en: "Click on the canvas to add new patterns" },
    eq_title: { cs: "Rovnice za tím 🔍", en: "The equations behind this 🔍" },
    toast_saved: { cs: "Uloženo", en: "Saved" },
    toast_downloaded: { cs: "Pohlednice stažena", en: "Postcard downloaded" },
    ui_what_am_i_seeing: { cs: "Co vidím?", en: "What am I seeing?" },
};

/**
 * Merge a simulation's translations into the global store.
 * @param {Object} fragment  e.g. { cs: { feed_rate: "..." }, en: { feed_rate: "..." } }
 * @param {string} [prefix]  optional namespace prefix (unused for now, keys are flat)
 */
export function mergeTranslations(fragment) {
    for (const [key, langMap] of Object.entries(fragment)) {
        translations[key] = langMap;
    }
}

/**
 * Look up a translation key in the current language.
 * @param {string} key
 * @returns {string}
 */
export function t(key) {
    const entry = translations[key];
    if (!entry) return key;
    return entry[currentLang] || entry["cs"] || key;
}

/**
 * Get the current language code.
 * @returns {"cs"|"en"}
 */
export function getLang() {
    return currentLang;
}

/**
 * Switch language and update all data-i18n elements in the DOM.
 * @param {"cs"|"en"} lang
 * @param {Function} [onSwitch]  optional callback after DOM update (e.g. re-render equations)
 */
export function setLang(lang, onSwitch) {
    currentLang = lang;

    // Update toggle buttons
    document.querySelectorAll(".lang-btn").forEach(btn => {
        btn.classList.toggle("active", btn.textContent.trim() === (lang === "cs" ? "CZ" : "EN"));
    });

    // Update all data-i18n elements
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.dataset.i18n;
        const val = t(key);
        if (val !== key) el.textContent = val;
    });

    if (onSwitch) onSwitch(lang);
}
