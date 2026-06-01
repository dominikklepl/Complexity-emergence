/**
 * interaction.js — Pointer / touch interaction
 *
 * Tracks all active pointers on the simulation canvas and exposes
 * normalised UV coordinates for simulations to read.
 * Supports multi-touch: `touches` contains all active pointers.
 * Single-pointer compat exports (touchPos, touchActive, touchButton) remain.
 */

/** @type {Array<{pos: [number,number], button: number}>} All active pointers */
export let touches = [];

/** Normalised UV position of first active pointer (compat) */
export let touchPos = [-1, -1];

/** Whether any pointer is currently active (compat) */
export let touchActive = false;

/** Button of first active pointer (compat) */
export let touchButton = 0;

/** @type {Map<number, {pos: [number,number], button: number}>} pointerId → state */
const activePointers = new Map();

/** @type {HTMLCanvasElement|null} */
let canvas = null;

function getCanvasUV(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = 1.0 - (event.clientY - rect.top) / rect.height;
    return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
}

function syncExports() {
    touches = [...activePointers.values()];
    if (touches.length > 0) {
        touchActive = true;
        touchPos = touches[0].pos;
        touchButton = touches[0].button;
    } else {
        touchActive = false;
        touchPos = [-1, -1];
        touchButton = 0;
    }
}

/**
 * Attach pointer event listeners to the simulation canvas.
 * @param {HTMLCanvasElement} canvasEl
 */
export function setupInteraction(canvasEl) {
    canvas = canvasEl;

    canvas.addEventListener("pointerdown", (e) => {
        activePointers.set(e.pointerId, { pos: getCanvasUV(e), button: e.button });
        syncExports();
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    canvas.addEventListener("pointermove", (e) => {
        const ptr = activePointers.get(e.pointerId);
        if (ptr) {
            ptr.pos = getCanvasUV(e);
            syncExports();
        }
        e.preventDefault();
    });

    const endPointer = (e) => {
        activePointers.delete(e.pointerId);
        syncExports();
    };

    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointerleave", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

/**
 * Called each frame — kept for API compatibility.
 */
export function frameTick() {}
