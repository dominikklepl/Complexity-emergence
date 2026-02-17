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
    createProgram, createTexture, createFramebuffer,
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
    let currentTex = 0;

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

            // Create initial state texture data
            const initData = config.initState(SIM_W, SIM_H, params);

            // Create ping-pong texture pair
            textures[0] = createTexture(SIM_W, SIM_H, initData);
            textures[1] = createTexture(SIM_W, SIM_H, initData);
            framebuffers[0] = createFramebuffer(textures[0]);
            framebuffers[1] = createFramebuffer(textures[1]);
            currentTex = 0;
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
            if (stepProg) gl.deleteProgram(stepProg);
            if (displayProg) gl.deleteProgram(displayProg);

            textures = [null, null];
            framebuffers = [null, null];
            stepProg = null;
            displayProg = null;
            currentTex = 0;
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
            setUniform(stepProg, "u_resolution", "2f", SIM_W, SIM_H);

            // Set touch uniforms
            const touchRadius = config.touchRadius || 0.03;
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

            // Bind current state texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, textures[currentTex]);
            setUniform(stepProg, "u_state", "1i", 0);

            // Render to the other texture
            const target = 1 - currentTex;
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[target]);
            gl.viewport(0, 0, SIM_W, SIM_H);
            drawQuad(stepProg);

            currentTex = target;
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
            gl.bindTexture(gl.TEXTURE_2D, textures[currentTex]);
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
