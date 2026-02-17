/**
 * snapshot.js — Postcard snapshot system
 *
 * Captures the current canvas, sends it to the server for postcard
 * assembly, or falls back to a direct download.
 */

import { t, getLang } from "./i18n.js";

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
 * Take a snapshot of the canvas and send it to the server.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} sim  The active simulation module (must have snapshotMeta)
 * @param {Function} renderFn  Called before capture to ensure latest frame is drawn
 */
export function takeSnapshot(canvas, sim, renderFn) {
    // Ensure the latest frame is rendered before capture
    if (renderFn) renderFn();

    const imageData = canvas.toDataURL("image/png");
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
                showToast(t("toast_saved") + ": " + data.filename);
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
