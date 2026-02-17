/**
 * interaction.js — Pointer / touch interaction
 *
 * Tracks pointer state on the simulation canvas and exposes
 * normalised UV coordinates + active flag for simulations to read.
 * Fixes missing pointercancel handler from original code.
 */

/** @type {[number, number]} Normalised UV position on canvas */
export let touchPos = [-1, -1];

/** Whether the user is currently touching / clicking the canvas */
export let touchActive = false;

let pointerDown = false;

/** @type {HTMLCanvasElement|null} */
let canvas = null;

/**
 * Convert a pointer/touch event to normalised [0,1] UV coordinates on the canvas.
 * @param {PointerEvent|TouchEvent} event
 * @returns {[number, number]}
 */
function getCanvasUV(event) {
    const rect = canvas.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    const x = (clientX - rect.left) / rect.width;
    const y = 1.0 - (clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
}

/**
 * Attach pointer event listeners to the simulation canvas.
 * @param {HTMLCanvasElement} canvasEl
 */
export function setupInteraction(canvasEl) {
    canvas = canvasEl;

    canvas.addEventListener("pointerdown", (e) => {
        pointerDown = true;
        touchPos = getCanvasUV(e);
        touchActive = true;
        e.preventDefault();
    });

    canvas.addEventListener("pointermove", (e) => {
        if (pointerDown) {
            touchPos = getCanvasUV(e);
            touchActive = true;
        }
        e.preventDefault();
    });

    const endPointer = () => {
        pointerDown = false;
        touchActive = false;
    };

    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointerleave", endPointer);
    canvas.addEventListener("pointercancel", endPointer); // fix: was missing

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

/**
 * Called each frame after step+render to reset touch if pointer is released.
 */
export function frameTick() {
    if (!pointerDown) touchActive = false;
}
