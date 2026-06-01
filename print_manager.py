#!/usr/bin/env python3
"""
Web-based postcard print manager — serves on port 5001.

Usage:
    uv run print_manager.py
    # then open http://localhost:5001
"""

import json
import subprocess
import time
from datetime import datetime
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_from_directory

POSTCARD_DIR = Path(__file__).parent / "postcards"
ARCHIVE_DIR  = POSTCARD_DIR / "archive"
PRINTER      = "Canon-SELPHY-CP1500"
LP_OPTS      = ["-o", "StpBorderless=True", "-o", "StpShrinkOutput=Expand", "-o", "PageSize=Postcard"]
PORT         = 5050

app = Flask(__name__)


# ---------------------------------------------------------------------------
# HTML page (self-contained)
# ---------------------------------------------------------------------------

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Print Manager</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: system-ui, sans-serif;
    background: #0f1117;
    color: #e2e8f0;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    background: #1a1f2e;
    border-bottom: 1px solid #2d3748;
    flex-shrink: 0;
  }
  header h1 { font-size: 1rem; font-weight: 600; letter-spacing: .05em; color: #a0aec0; }
  #status-dot {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: .8rem;
    color: #68d391;
  }
  #status-dot::before {
    content: '';
    width: 8px; height: 8px;
    border-radius: 50%;
    background: currentColor;
    display: inline-block;
  }
  #status-dot.disconnected { color: #fc8181; }

  main {
    flex: 1;
    display: grid;
    grid-template-columns: 320px 1fr;
    min-height: 0;
  }

  /* ── Left: inbox ── */
  #inbox {
    border-right: 1px solid #2d3748;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #inbox-header {
    padding: 10px 14px;
    font-size: .7rem;
    font-weight: 700;
    letter-spacing: .1em;
    color: #718096;
    text-transform: uppercase;
    border-bottom: 1px solid #2d3748;
    flex-shrink: 0;
  }
  #inbox-list {
    flex: 1;
    overflow-y: auto;
    list-style: none;
  }
  #inbox-empty {
    padding: 24px 14px;
    color: #4a5568;
    font-size: .85rem;
  }
  #inbox-empty span {
    display: inline-block;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: .4; } 50% { opacity: 1; }
  }

  .postcard-row {
    padding: 10px 14px;
    border-bottom: 1px solid #1e2533;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: background .15s;
  }
  .postcard-row:hover { background: #1a1f2e; }
  .postcard-row.selected { background: #1e3a5f; }
  .postcard-row.new {
    animation: flash 1.2s ease-out;
  }
  @keyframes flash {
    0%   { background: #2a4a2a; }
    100% { background: transparent; }
  }
  .postcard-row.removing {
    opacity: 0;
    transition: opacity .3s ease;
  }

  .row-meta {
    flex: 1;
    min-width: 0;
  }
  .row-time { font-size: .7rem; color: #718096; }
  .row-sim  { font-size: .85rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .row-btns { display: flex; gap: 4px; flex-shrink: 0; }
  .btn {
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: .75rem;
    cursor: pointer;
    font-weight: 600;
    transition: opacity .15s;
  }
  .btn:hover { opacity: .8; }
  .btn-preview { background: #2d3748; color: #a0aec0; }
  .btn-print   { background: #2b6cb0; color: #fff; }
  .btn-archive { background: #2d3748; color: #68d391; }

  /* ── Right: preview ── */
  #preview-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 20px;
    gap: 10px;
    min-height: 0;
  }
  #preview-placeholder {
    color: #4a5568;
    font-size: .9rem;
    text-align: center;
    margin: auto;
  }
  #preview-content {
    display: none;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
    flex: 1;
    min-height: 0;
  }

  #pdf-frame {
    flex: 1;
    width: 100%;
    min-height: 0;
    border: 1px solid #2d3748;
    border-radius: 4px;
    background: #fff;
    display: block;
  }

  #preview-filename {
    font-size: .75rem;
    color: #718096;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    flex-shrink: 0;
  }

  #preview-actions { display: flex; gap: 10px; }
  #preview-actions .btn { padding: 8px 20px; font-size: .85rem; }

  #print-feedback {
    font-size: .8rem;
    min-height: 1.2em;
  }
  .feedback-ok  { color: #68d391; }
  .feedback-err { color: #fc8181; }
</style>
</head>
<body>

<header>
  <h1>Print Manager &mdash; Science Fair 2026</h1>
  <span id="status-dot">live</span>
</header>

<main>
  <section id="inbox">
    <div id="inbox-header">Inbox</div>
    <ul id="inbox-list">
      <li id="inbox-empty"><span>Waiting for postcards&hellip;</span></li>
    </ul>
  </section>

  <section id="preview-panel">
    <p id="preview-placeholder">Select a postcard on the left to preview</p>
    <div id="preview-content">
      <object id="pdf-frame" type="application/pdf" data="">
        <p style="color:#718096;padding:16px">PDF could not be displayed — try another browser.</p>
      </object>
      <div id="preview-filename"></div>
      <div id="preview-actions">
        <button class="btn btn-print"   id="btn-print-preview">Print</button>
        <button class="btn btn-archive" id="btn-archive-preview">Archive</button>
      </div>
      <div id="print-feedback"></div>
    </div>
  </section>
</main>

<script>
'use strict';

let selectedFile = null;

// ── DOM refs ──────────────────────────────────────────────────────────────
const list        = document.getElementById('inbox-list');
const empty       = document.getElementById('inbox-empty');
const placeholder = document.getElementById('preview-placeholder');
const content     = document.getElementById('preview-content');
const pdfFrame    = document.getElementById('pdf-frame');
const fnLabel     = document.getElementById('preview-filename');
const statusDot   = document.getElementById('status-dot');
const feedback    = document.getElementById('print-feedback');

document.getElementById('btn-print-preview').addEventListener('click', () => {
  if (selectedFile) doAction(selectedFile, 'print');
});
document.getElementById('btn-archive-preview').addEventListener('click', () => {
  if (selectedFile) doAction(selectedFile, 'archive');
});

// ── Helpers ───────────────────────────────────────────────────────────────

function simLabel(filename) {
  const m = filename.match(/^postcard_([^_]+)_/);
  if (!m) return filename;
  const map = { rd: 'Turing', osc: 'Kuramoto', boids: 'Boids', neural: 'Neural', butterfly: 'Chaos' };
  return map[m[1]] || m[1];
}

function rowId(filename) {
  return 'row-' + filename.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function addRow(filename, mtime_fmt, isNew) {
  // Remove empty placeholder
  if (empty.parentNode === list) list.removeChild(empty);

  if (document.getElementById(rowId(filename))) return; // already present

  const li = document.createElement('li');
  li.className = 'postcard-row' + (isNew ? ' new' : '');
  li.id = rowId(filename);
  li.innerHTML = `
    <div class="row-meta">
      <div class="row-time">${mtime_fmt || ''}</div>
      <div class="row-sim">${simLabel(filename)}</div>
    </div>
    <div class="row-btns">
      <button class="btn btn-preview" data-file="${filename}">Preview</button>
      <button class="btn btn-print"   data-file="${filename}">Print</button>
      <button class="btn btn-archive" data-file="${filename}">Archive</button>
    </div>`;

  // Insert newest-first (at top of list)
  list.insertBefore(li, list.firstChild);

  li.querySelector('.btn-preview').addEventListener('click', (e) => {
    e.stopPropagation();
    showPreview(filename);
  });
  li.querySelector('.btn-print').addEventListener('click', (e) => {
    e.stopPropagation();
    doAction(filename, 'print');
  });
  li.querySelector('.btn-archive').addEventListener('click', (e) => {
    e.stopPropagation();
    doAction(filename, 'archive');
  });

  li.addEventListener('click', () => showPreview(filename));
}

function removeRow(filename) {
  const el = document.getElementById(rowId(filename));
  if (!el) return;
  el.classList.add('removing');
  setTimeout(() => {
    el.remove();
    if (list.children.length === 0) list.appendChild(empty);
    if (selectedFile === filename) clearPreview();
  }, 320);
}

function showPreview(filename) {
  selectedFile = filename;
  document.querySelectorAll('.postcard-row').forEach(r => r.classList.remove('selected'));
  const row = document.getElementById(rowId(filename));
  if (row) row.classList.add('selected');

  // Load PDF — set data attribute to trigger browser renderer
  pdfFrame.setAttribute('data', '/pdf/' + encodeURIComponent(filename));
  fnLabel.textContent = filename;
  feedback.textContent = '';
  placeholder.style.display = 'none';
  content.style.display = 'flex';
}

function clearPreview() {
  selectedFile = null;
  pdfFrame.setAttribute('data', '');
  content.style.display = 'none';
  placeholder.style.display = '';
}

async function doAction(filename, action) {
  feedback.textContent = '';
  feedback.className = '';
  try {
    const res = await fetch('/api/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      feedback.textContent = '✗ ' + (data.error || res.statusText);
      feedback.className = 'feedback-err';
    } else {
      feedback.textContent = action === 'print' ? '✓ Sent to printer' : '✓ Archived';
      feedback.className = 'feedback-ok';
    }
  } catch (err) {
    feedback.textContent = '✗ ' + err.message;
    feedback.className = 'feedback-err';
  }
}

// ── Initial load ──────────────────────────────────────────────────────────

async function loadInitial() {
  try {
    const res = await fetch('/api/postcards');
    const items = await res.json();
    for (const item of items) addRow(item.filename, item.mtime_fmt, false);
  } catch (_) { /* server not ready yet, SSE will catch up */ }
}

// ── SSE ───────────────────────────────────────────────────────────────────

function connectSSE() {
  const es = new EventSource('/api/stream');

  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === 'add')    addRow(msg.filename, msg.mtime_fmt, true);
    if (msg.event === 'remove') removeRow(msg.filename);
  };

  es.onopen = () => {
    statusDot.textContent = 'live';
    statusDot.classList.remove('disconnected');
  };

  es.onerror = () => {
    statusDot.textContent = 'offline';
    statusDot.classList.add('disconnected');
    // EventSource auto-reconnects; no manual retry needed
  };
}

loadInitial().then(connectSSE);
</script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return HTML, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/api/postcards")
def api_postcards():
    POSTCARD_DIR.mkdir(exist_ok=True)
    pdfs = sorted(POSTCARD_DIR.glob("postcard_*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
    return jsonify([
        {
            "filename": p.name,
            "mtime_fmt": datetime.fromtimestamp(p.stat().st_mtime).strftime("%H:%M"),
        }
        for p in pdfs
    ])


@app.route("/api/stream")
def api_stream():
    def generate():
        POSTCARD_DIR.mkdir(exist_ok=True)
        seen: dict[str, float] = {}
        while True:
            current = {
                p.name: p.stat().st_mtime
                for p in POSTCARD_DIR.glob("postcard_*.pdf")
            }
            for name in set(current) - set(seen):
                mtime_fmt = datetime.fromtimestamp(current[name]).strftime("%H:%M")
                yield f"data: {json.dumps({'event': 'add', 'filename': name, 'mtime_fmt': mtime_fmt})}\n\n"
            for name in set(seen) - set(current):
                yield f"data: {json.dumps({'event': 'remove', 'filename': name})}\n\n"
            seen = current
            time.sleep(2)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/pdf/<filename>")
def serve_pdf(filename):
    path = (POSTCARD_DIR / filename).resolve()
    if POSTCARD_DIR.resolve() not in path.parents:
        abort(400)
    return send_from_directory(POSTCARD_DIR, filename)


@app.route("/api/print", methods=["POST"])
def api_print():
    filename = (request.json or {}).get("filename", "")
    path = POSTCARD_DIR / filename
    if not filename.startswith("postcard_") or not path.exists():
        return jsonify({"error": "not found"}), 404

    cmd = ["lp", "-d", PRINTER] + LP_OPTS + [str(path)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        return jsonify({"error": result.stderr.strip() or "lp failed"}), 500

    ARCHIVE_DIR.mkdir(exist_ok=True)
    dest = ARCHIVE_DIR / filename
    if dest.exists():
        stem = filename.rsplit(".", 1)[0]
        dest = ARCHIVE_DIR / f"{stem}_dup.pdf"
    path.rename(dest)
    return jsonify({"ok": True, "archived": True})


@app.route("/api/archive", methods=["POST"])
def api_archive():
    filename = (request.json or {}).get("filename", "")
    path = POSTCARD_DIR / filename
    if not filename.startswith("postcard_") or not path.exists():
        return jsonify({"error": "not found"}), 404

    ARCHIVE_DIR.mkdir(exist_ok=True)
    dest = ARCHIVE_DIR / filename
    if dest.exists():
        stem = filename.rsplit(".", 1)[0]
        dest = ARCHIVE_DIR / f"{stem}_dup.pdf"
    path.rename(dest)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------

def main():
    POSTCARD_DIR.mkdir(exist_ok=True)
    print(f"Print manager running at http://localhost:{PORT}")
    app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False)


if __name__ == "__main__":
    main()
