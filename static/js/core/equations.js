/**
 * equations.js — Collapsible equation panel
 *
 * Manages the expandable panel above the canvas that shows the
 * mathematical equations for the active simulation.
 */

let eqOpen = false;

/**
 * Toggle the equation panel open/closed.
 */
export function toggleEquations() {
    eqOpen = !eqOpen;
    document.getElementById("eq-body").classList.toggle("open", eqOpen);
    document.getElementById("eq-chevron").classList.toggle("open", eqOpen);
}

/**
 * Render equations for the active simulation.
 * Clears the equation body and calls the sim's render method.
 *
 * @param {Object} sim  The active simulation module (must have equations.render)
 * @param {string} lang  Current language code
 */
export function renderEquations(sim, lang) {
    const container = document.getElementById("eq-body-content");
    if (!container) return;

    container.innerHTML = "";

    if (sim && sim.equations && sim.equations.render) {
        sim.equations.render(container, lang);
    }
}
