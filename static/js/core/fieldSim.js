/**
 * fieldSim.js — Factory for GPU-based field simulations
 *
 * Takes a declarative config (shader strings, initState, uniform getters)
 * and returns an object implementing the standard simulation interface:
 *   { setup, teardown, step, render }
 *
 * Handles ping-pong texture management, shader compilation, and quad drawing.
 * This is the "easy path" for any simulation that fits the pattern:
 *   state-in-texture → fragment-shader-step → display-shader → repeat.
 */

import {
    SIM_W, SIM_H, VERTEX_SHADER_SRC,
    getGL, getCanvas,
    createProgram, deleteProgram, cacheUniformLocations, createTexture, createFramebuffer,
    drawQuad, setUniform,
} from "./webgl.js";

/**
 * Create a managed field simulation from a declarative config.
 *
 * @param {Object} config
 * @param {string} config.id                Unique sim identifier
 * @param {Object} config.shaders           { step: string, display: string } — GLSL fragment sources
 * @param {Function} config.initState       (width, height, params) => Float32Array
 * @param {Function} config.getStepUniforms (params, touch) => [{ name, type, values }]
 * @param {Function} config.getDisplayUniforms (colourScheme) => [{ name, type, values }]
 * @param {number} [config.touchRadius]     Touch interaction radius (default 0.03)
 * @param {Array}  config.controls          Control declarations
 * @param {Array}  config.presets           Preset declarations
 * @param {Array}  config.colours           Colour scheme declarations
 * @param {Object} config.speedSlider       { min, max, default }
 * @param {Object} config.translations      { key: { cs, en } }
 * @param {Object} config.equations         { render(container, lang) }
 * @param {Function} config.snapshotMeta    (lang) => { title, subtitle }
 *
 * @returns {Object} Simulation module with setup/teardown/step/render + metadata
 */
export function fieldSim(config) {
    // --- Internal state (populated by setup, cleaned by teardown) ---
    let stepProg = null;
    let displayProg = null;
    let textures = [null, null];
    let framebuffers = [null, null];
    // Double-buffering (ping-pong): the GPU can't read and write the same texture
    // in the same draw call. We keep two textures — one for reading (source),
    // one for writing (destination). After each step they swap roles.
    let readTex  = 0;   // index into textures[] / framebuffers[] — currently being read
    let writeTex = 1;   // currently being written
    const simW = config.simW || SIM_W;
    const simH = config.simH || SIM_H;

    return {
        // --- Metadata (passed through from config) ---
        id: config.id,
        controls: config.controls || [],
        presets: config.presets || [],
        colours: config.colours || [],
        speedSlider: config.speedSlider || { min: 1, max: 10, default: 5 },
        translations: config.translations || {},
        equations: config.equations || { render() { } },
        snapshotMeta: config.snapshotMeta || (() => ({ title: "", subtitle: "" })),
        applyContent: config.applyContent,

        /**
         * Compile shaders, create textures, initialise state.
         * @param {WebGLRenderingContext} gl
         * @param {HTMLCanvasElement} canvas
         * @param {Object} params  Current control values
         */
        setup(gl, canvas, params) {
            // Compile programs
            stepProg = createProgram(
                VERTEX_SHADER_SRC,
                config.shaders.step,
                config.id + "/step"
            );
            displayProg = createProgram(
                VERTEX_SHADER_SRC,
                config.shaders.display,
                config.id + "/display"
            );

            if (!stepProg || !displayProg) {
                console.error(`Failed to compile shaders for "${config.id}"`);
                return;
            }

            // Pre-cache all uniform locations to avoid per-frame driver roundtrips
            const stepUniforms = ["u_state", "u_resolution", "u_touch", "u_touchRadius",
                ...((config.getStepUniforms({}) || []).map(u => u.name))];
            cacheUniformLocations(stepProg, stepUniforms);
            cacheUniformLocations(displayProg, ["u_state", "u_colourScheme",
                ...((config.getDisplayUniforms ? (config.getDisplayUniforms(0) || []).map(u => u.name) : []))]);

            // Create initial state texture data
            const initData = config.initState(simW, simH, params);

            // Create ping-pong texture pair
            textures[0] = createTexture(simW, simH, initData);
            textures[1] = createTexture(simW, simH, initData);
            framebuffers[0] = createFramebuffer(textures[0]);
            framebuffers[1] = createFramebuffer(textures[1]);
            readTex  = 0;
            writeTex = 1;

            // Optional post-setup hook (e.g. for HTML overlay creation)
            if (config.onSetup) config.onSetup(gl, canvas, simW, simH, params);
        },

        /**
         * Clean up GL resources.
         * @param {WebGLRenderingContext} gl
         */
        teardown(gl) {
            if (textures[0]) gl.deleteTexture(textures[0]);
            if (textures[1]) gl.deleteTexture(textures[1]);
            if (framebuffers[0]) gl.deleteFramebuffer(framebuffers[0]);
            if (framebuffers[1]) gl.deleteFramebuffer(framebuffers[1]);
            if (stepProg) deleteProgram(stepProg);
            if (displayProg) deleteProgram(displayProg);

            textures = [null, null];
            framebuffers = [null, null];
            stepProg = null;
            displayProg = null;
            readTex  = 0;
            writeTex = 1;
        },

        /**
         * Advance simulation by one tick.
         * @param {Object} params       Current slider/control values
         * @param {{ pos: [number,number], active: boolean }} touch  Pointer state
         */
        step(params, touch) {
            const gl = getGL();
            if (!stepProg) return;

            gl.useProgram(stepProg);

            // Set standard resolution uniform
            setUniform(stepProg, "u_resolution", "2f", simW, simH);

            // Set touch uniforms
            const DEFAULT_TOUCH_RADIUS = 0.03;  // UV space (0–1); 0.03 ≈ 3% of sim width
            const touchRadius = config.touchRadius ?? DEFAULT_TOUCH_RADIUS;
            setUniform(stepProg, "u_touchRadius", "1f", touchRadius);
            if (touch.active) {
                setUniform(stepProg, "u_touch", "2f", touch.pos[0], touch.pos[1]);
            } else {
                setUniform(stepProg, "u_touch", "2f", -1, -1);
            }

            // Set simulation-specific uniforms
            const uniforms = config.getStepUniforms(params, touch);
            for (const u of uniforms) {
                setUniform(stepProg, u.name, u.type, ...u.values);
            }

            // Bind current state texture (read source)
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textures[readTex]);
            setUniform(stepProg, "u_state", "1i", 0);

            // Render into the write target's framebuffer
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[writeTex]);
            gl.viewport(0, 0, simW, simH);
            drawQuad(stepProg);

            // Swap read/write roles for next step.
            [readTex, writeTex] = [writeTex, readTex];
        },

        /**
         * Draw current state to the screen.
         * @param {WebGLRenderingContext} gl
         * @param {HTMLCanvasElement} canvas
         * @param {number} colourScheme  Active colour palette index
         */
        render(gl, canvas, colourScheme) {
            if (!displayProg) return;

            gl.useProgram(displayProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textures[readTex]);
            setUniform(displayProg, "u_state", "1i", 0);
            setUniform(displayProg, "u_colourScheme", "1i", colourScheme);

            // Set any additional display uniforms from config
            if (config.getDisplayUniforms) {
                const uniforms = config.getDisplayUniforms(colourScheme);
                for (const u of uniforms) {
                    setUniform(displayProg, u.name, u.type, ...u.values);
                }
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, canvas.width, canvas.height);
            drawQuad(displayProg);
        },
    };
}
