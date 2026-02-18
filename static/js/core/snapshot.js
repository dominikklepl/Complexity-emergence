/**
 * snapshot.js — Postcard snapshot system
 *
 * Captures the current canvas at high resolution (300 DPI for 6×4″ print),
 * sends it to the server for PDF postcard assembly, or falls back to a
 * direct download.
 */

import { t, getLang } from "./i18n.js";
import { EXPORT_W, EXPORT_H, getGL } from "./webgl.js";

/**
 * Show a toast notification at the bottom of the screen.
 * @param {string} msg
 */
export function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2500);
}

/**
 * Take a high-resolution snapshot of the canvas and send it to the server.
 *
 * Temporarily resizes the canvas to EXPORT_W×EXPORT_H (1800×1200, 300 DPI
 * for a 6×4″ postcard), renders the display shader at that resolution,
 * captures the pixels, then restores the canvas to its original size.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} sim  The active simulation module (must have snapshotMeta)
 * @param {Function} renderFn  Called to render the current frame (uses canvas.width/height)
 */
export function takeSnapshot(canvas, sim, renderFn) {
    const gl = getGL();

    // Save current canvas dimensions
    const origW = canvas.width;
    const origH = canvas.height;

    // Resize canvas to high-res export dimensions
    canvas.width = EXPORT_W;
    canvas.height = EXPORT_H;

    // Render at high resolution (render functions use canvas.width/height for viewport)
    if (renderFn) renderFn();

    // Capture the high-res frame
    const imageData = canvas.toDataURL("image/png");

    // Restore canvas to original dimensions
    canvas.width = origW;
    canvas.height = origH;

    // Re-render at normal resolution so the display isn't blank
    if (renderFn) renderFn();

    const lang = getLang();
    const meta = sim.snapshotMeta(lang);

    fetch("/api/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            image: imageData,
            title: meta.title,
            subtitle: meta.subtitle,
            sim_type: sim.id,
            lang: lang,
        }),
    })
        .then(r => r.json())
        .then(data => {
            if (data.ok) {
                const msg = data.pdf_filename
                    ? t("toast_saved") + ": " + data.pdf_filename
                    : t("toast_saved") + ": " + data.filename;
                showToast(msg);
            }
        })
        .catch(err => {
            console.warn("Server not available, downloading directly:", err);
            const link = document.createElement("a");
            link.download = "pattern_" + sim.id + "_" + Date.now() + ".png";
            link.href = imageData;
            link.click();
            showToast(t("toast_downloaded"));
        });
}
