/**
 * webgl.js — WebGL boilerplate utilities
 *
 * Provides low-level GL helpers: context init, shader compilation,
 * texture/framebuffer creation, and full-screen quad drawing.
 * No simulation knowledge lives here.
 */

/** Simulation texture dimensions (3:2 aspect) */
export const SIM_W = 1536;
export const SIM_H = 1024;

/** Export resolution for print-quality postcards (300 DPI @ 6×4 inches) */
export const EXPORT_W = 1800;
export const EXPORT_H = 1200;

/** Shared vertex shader source for all full-screen quad passes */
export const VERTEX_SHADER_SRC = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

let gl = null;
let canvas = null;
let quadBuffer = null;

// ── Location caches ──────────────────────────────────────────────
/** @type {Map<WebGLProgram, Map<string, WebGLUniformLocation>>} */
const _uniformCache = new Map();

/** @type {Map<WebGLProgram, number>} */
const _attribCache = new Map();

/**
 * Initialise WebGL on the given canvas element.
 * @param {HTMLCanvasElement} canvasEl
 * @returns {{ gl: WebGLRenderingContext, canvas: HTMLCanvasElement } | null}
 */
export function initWebGL(canvasEl) {
    canvas = canvasEl;

    // Scale canvas backing store by devicePixelRatio for sharp rendering
    // on HiDPI screens and large displays. CSS size stays the same.
    const dpr = Math.min(window.devicePixelRatio || 1, 3); // cap at 3×
    canvas.width = Math.round(SIM_W * dpr);
    canvas.height = Math.round(SIM_H * dpr);

    gl = canvas.getContext("webgl", {
        preserveDrawingBuffer: true,
        antialias: false,
    });

    if (!gl) {
        alert("WebGL not supported in this browser!");
        return null;
    }

    const ext = gl.getExtension("OES_texture_float");
    if (!ext) {
        alert("Float textures not supported — try Chrome or Firefox");
        return null;
    }

    // Full-screen quad (two triangles)
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]),
        gl.STATIC_DRAW
    );

    return { gl, canvas };
}

/** @returns {WebGLRenderingContext} */
export function getGL() {
    return gl;
}

/** @returns {HTMLCanvasElement} */
export function getCanvas() {
    return canvas;
}

/**
 * Update canvas draw buffer to match its CSS display size.
 * Call whenever the canvas container changes size.
 * Returns true if dimensions actually changed (caller should re-render).
 *
 * Separate from simulation texture size (SIM_W × SIM_H) — this controls
 * output sharpness, not simulation resolution.
 */
export function resizeDisplayCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
        return true;
    }
    return false;
}

/**
 * Compile a shader from source string.
 * @param {number} type  gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
 * @param {string} source  GLSL source code
 * @param {string} [label]  label for error messages
 * @returns {WebGLShader|null}
 */
export function compileShader(type, source, label = "shader") {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(`Shader "${label}" error:`, gl.getShaderInfoLog(shader));
        return null;
    }
    return shader;
}

/**
 * Link a vertex + fragment shader into a program.
 * @param {string} vsSrc  vertex shader source
 * @param {string} fsSrc  fragment shader source
 * @param {string} [label]
 * @returns {WebGLProgram|null}
 */
export function createProgram(vsSrc, fsSrc, label = "program") {
    const vs = compileShader(gl.VERTEX_SHADER, vsSrc, label + "/vs");
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc, label + "/fs");
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error(`Program "${label}" link error:`, gl.getProgramInfoLog(prog));
        return null;
    }
    return prog;
}

/**
 * Create a float RGBA texture.
 * @param {number} width
 * @param {number} height
 * @param {Float32Array|null} data
 * @returns {WebGLTexture}
 */
export function createTexture(width, height, data) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        width, height, 0,
        gl.RGBA, gl.FLOAT, data
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
}

/**
 * Create a framebuffer targeting a texture.
 * @param {WebGLTexture} tex
 * @returns {WebGLFramebuffer}
 */
export function createFramebuffer(tex) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, tex, 0
    );

    // Verify framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("Framebuffer incomplete:", status);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fb;
}

/**
 * Remove cached locations for a program (call before gl.deleteProgram).
 * @param {WebGLProgram} prog
 */
export function deleteProgram(prog) {
    _uniformCache.delete(prog);
    _attribCache.delete(prog);
    gl.deleteProgram(prog);
}

/**
 * Pre-fetch and cache uniform locations for a program.
 * Call once after createProgram() to avoid per-frame driver roundtrips.
 * @param {WebGLProgram} prog
 * @param {string[]} names  Uniform names to cache
 */
export function cacheUniformLocations(prog, names) {
    let map = _uniformCache.get(prog);
    if (!map) {
        map = new Map();
        _uniformCache.set(prog, map);
    }
    for (const name of names) {
        map.set(name, gl.getUniformLocation(prog, name));
    }
}

/**
 * Draw a full-screen quad using the given program.
 * The program must have an `a_position` attribute.
 * Assumes the program is already bound (gl.useProgram called by caller).
 * @param {WebGLProgram} program
 */
export function drawQuad(program) {
    let posLoc = _attribCache.get(program);
    if (posLoc === undefined) {
        posLoc = gl.getAttribLocation(program, "a_position");
        _attribCache.set(program, posLoc);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

/**
 * Set a uniform on a program (uses cached location if available).
 * @param {WebGLProgram} prog
 * @param {string} name
 * @param {"1f"|"2f"|"1i"} type
 * @param {...number} values
 */
export function setUniform(prog, name, type, ...values) {
    const map = _uniformCache.get(prog);
    const loc = map ? map.get(name) : gl.getUniformLocation(prog, name);
    if (loc === null || loc === undefined) return;
    if (type === "1f") gl.uniform1f(loc, values[0]);
    else if (type === "2f") gl.uniform2f(loc, values[0], values[1]);
    else if (type === "1i") gl.uniform1i(loc, values[0]);
}
