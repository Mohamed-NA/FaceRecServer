document.addEventListener('DOMContentLoaded', () => {
    const host   = window.location.host;
    const socket = io(`wss://${host}`);

    const video        = document.getElementById('video');
    const serverCanvas = document.getElementById('server-frame');
    const serverCtx    = serverCanvas.getContext('2d');

    // UI refs
    const dot          = document.getElementById('status-dot');
    const statusText   = document.getElementById('status-text');
    const connBadge    = document.getElementById('conn-badge');
    const recBadge     = document.getElementById('rec-badge');
    const pauseBtn     = document.getElementById('pause-btn');
    const pauseIcon    = document.getElementById('pause-icon');
    const overlay      = document.getElementById('overlay');
    const overlayIcon  = document.getElementById('overlay-icon');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayDesc  = document.getElementById('overlay-desc');
    const frameCountEl = document.getElementById('frame-count');
    const fpsDisplay   = document.getElementById('fps-display');
    const stateDisplay = document.getElementById('state-display');
    const fpsSlider    = document.getElementById('fps-slider');
    const fpsLabel     = document.getElementById('fps-label');
    const qualitySlider= document.getElementById('quality-slider');
    const qualityLabel = document.getElementById('quality-label');
    const qualityDisp  = document.getElementById('quality-display');
    const resDisplay   = document.getElementById('res-display');
    const logEl        = document.getElementById('log');

    // Enroll refs
    const enrollBtn    = document.getElementById('enroll-btn');
    const enrollForm   = document.getElementById('enroll-form');
    const enrollSave   = document.getElementById('enroll-save');
    const enrollCancel = document.getElementById('enroll-cancel');
    const enrollStatus = document.getElementById('enroll-status');

    // Detection state — kept in sync with every `detections` event
    let currentDetections = [];   // [{name, distance, box:[top,right,bottom,left]}, …]
    let selectedLabel     = null; // label of the face clicked on canvas

    // Letterbox geometry, updated each time a server frame is rendered
    let lbScale = 1, lbDx = 0, lbDy = 0;

    // ── Canvas click → select a face ─────────────────────────────────────────

    serverCanvas.addEventListener('click', e => {
        if (!currentDetections.length) return;
        const rect = serverCanvas.getBoundingClientRect();
        // css px → canvas px
        const cx = (e.clientX - rect.left) * (serverCanvas.width  / rect.width);
        const cy = (e.clientY - rect.top)  * (serverCanvas.height / rect.height);
        // canvas px → frame px
        const fx = (cx - lbDx) / lbScale;
        const fy = (cy - lbDy) / lbScale;

        let best = null, bestDist = Infinity;
        for (const det of currentDetections) {
            const [top, right, bottom, left] = det.box;
            const fcx = (left + right) / 2;
            const fcy = (top + bottom) / 2;
            const d   = (fcx - fx) ** 2 + (fcy - fy) ** 2;
            if (d < bestDist) { bestDist = d; best = det; }
        }
        if (best) {
            selectedLabel = best.name;
            drawOverlays();
            // If it's unknown and form is open, focus that row's input
            if (best.name.startsWith('Unknown')) {
                const inp = document.getElementById('inp-' + CSS.escape(best.name));
                if (inp) inp.focus();
            }
        }
    });

    // State
    let frameCount = 0;
    let paused     = false;
    let fps        = 15;
    let quality    = 0.8;
    let canvasW    = 640;
    let canvasH    = 480;
    let fpsFrames  = 0;
    let fpsTimer   = Date.now();
    let waiting    = false;
    let canvas     = document.createElement('canvas');
    let ctx        = canvas.getContext('2d');

    // ── Logging ──────────────────────────────────────────────────────────────

    function log(msg, type = 'info') {
        const time = new Date().toTimeString().slice(0, 8);
        const el   = document.createElement('div');
        el.className = `log-entry ${type}`;
        el.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${msg}</span>`;
        logEl.prepend(el);
        while (logEl.children.length > 30) logEl.lastChild.remove();
    }

    // ── Canvas / resolution ───────────────────────────────────────────────────

    function setCanvasSize(w, h) {
        canvasW = canvas.width = w;
        canvasH = canvas.height = h;
        resDisplay.textContent = `${w} × ${h}`;
    }
    setCanvasSize(640, 480);

    // ── Frame loop ────────────────────────────────────────────────────────────

    function scheduleNext() {
        setTimeout(sendFrame, 1000 / fps);
    }

    function sendFrame() {
        if (paused || video.readyState < 2 || waiting) { scheduleNext(); return; }
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -canvasW, 0, canvasW, canvasH);
        ctx.restore();
        waiting = true;
        socket.emit('video_frame', canvas.toDataURL('image/jpeg', quality));
        frameCountEl.textContent = ++frameCount;
        fpsFrames++;
        const now = Date.now();
        if (now - fpsTimer >= 1000) {
            fpsDisplay.textContent = fpsFrames;
            fpsFrames = 0;
            fpsTimer  = now;
        }
    }

    // ── Camera ────────────────────────────────────────────────────────────────

    const camSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>`;
    const errSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>`;

    function showOverlay(icon, title, desc, isError = false) {
        overlayIcon.className = 'overlay-icon' + (isError ? ' error' : '');
        overlayIcon.innerHTML = icon;
        overlayTitle.textContent = title;
        overlayDesc.textContent  = desc;
        overlay.classList.remove('hidden');
        recBadge.classList.remove('visible');
        pauseBtn.classList.remove('visible');
        stateDisplay.textContent = isError ? 'Error' : '…';
    }

    function hideOverlay() {
        overlay.classList.add('hidden');
        recBadge.classList.add('visible');
        pauseBtn.classList.add('visible');
        stateDisplay.textContent = 'Waiting';
    }

    showOverlay(camSvg, 'Requesting camera', 'Please allow camera access to begin streaming.');

    navigator.mediaDevices.getUserMedia({ video: { width: canvasW, height: canvasH } })
        .then(stream => {
            video.srcObject = stream;
            video.play();
            video.addEventListener('playing', () => {
                hideOverlay();
                scheduleNext();
                log('Camera started', 'success');
            });
        })
        .catch(err => {
            showOverlay(errSvg, 'Camera unavailable', err.message || 'Could not access the camera.', true);
            log('Camera error: ' + err.message, 'error');
        });

    // ── Pause / resume ────────────────────────────────────────────────────────

    pauseBtn.addEventListener('click', () => {
        paused = !paused;
        pauseIcon.innerHTML = paused
            ? `<polygon points="5,3 19,12 5,21"/>`
            : `<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>`;
        recBadge.style.opacity = paused ? '0.3' : '';
        stateDisplay.textContent = paused ? 'Paused' : 'Live';
        log(paused ? 'Stream paused' : 'Stream resumed');
    });

    // ── Sliders ───────────────────────────────────────────────────────────────

    fpsSlider.addEventListener('input', () => {
        fps = parseInt(fpsSlider.value);
        fpsLabel.textContent = `${fps} fps`;
    });

    qualitySlider.addEventListener('input', () => {
        quality = parseInt(qualitySlider.value) / 100;
        qualityLabel.textContent = `${qualitySlider.value}%`;
        qualityDisp.textContent  = `${qualitySlider.value}%`;
    });

    document.getElementById('res-group').addEventListener('click', e => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setCanvasSize(parseInt(btn.dataset.w), parseInt(btn.dataset.h));
        log(`Resolution → ${btn.dataset.w}×${btn.dataset.h}`);
    });

    // ── Received frame ────────────────────────────────────────────────────────

    socket.on('server_frame', data => {
        const img = new Image();
        img.onload = () => {
            const cw = serverCanvas.clientWidth;
            const ch = serverCanvas.clientHeight;
            serverCanvas.width  = cw;
            serverCanvas.height = ch;
            lbScale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
            const dw = img.naturalWidth  * lbScale;
            const dh = img.naturalHeight * lbScale;
            lbDx = (cw - dw) / 2;
            lbDy = (ch - dh) / 2;
            serverCtx.clearRect(0, 0, cw, ch);
            serverCtx.drawImage(img, lbDx, lbDy, dw, dh);
            drawOverlays();
            if (serverCanvas.classList.contains('hidden')) {
                serverCanvas.classList.remove('hidden');
                stateDisplay.textContent = 'Live';
            }
        };
        img.src = data;
        waiting = false;
        scheduleNext();
    });

    // ── Yellow highlight overlay ──────────────────────────────────────────────

    function drawOverlays() {
        if (!selectedLabel) return;
        const det = currentDetections.find(d => d.name === selectedLabel);
        if (!det) return;
        const [top, right, bottom, left] = det.box;
        const cx = left   * lbScale + lbDx;
        const cy = top    * lbScale + lbDy;
        const cw = (right - left)   * lbScale;
        const ch = (bottom - top)   * lbScale;
        serverCtx.strokeStyle = '#facc15';   // yellow-400
        serverCtx.lineWidth   = 3;
        serverCtx.strokeRect(cx, cy, cw, ch);
    }

    // ── Detection results ─────────────────────────────────────────────────────

    socket.on('detections', results => {
        currentDetections = results;

        // Clear selected label if that face left the frame
        if (selectedLabel && !results.find(r => r.name === selectedLabel)) {
            selectedLabel = null;
        }

        const known   = results.filter(r => !r.name.startsWith('Unknown')).length;
        const unknown = results.filter(r =>  r.name.startsWith('Unknown')).length;

        document.getElementById('det-faces').textContent   = results.length;
        document.getElementById('det-known').textContent   = known;
        document.getElementById('det-unknown').textContent = unknown;

        document.getElementById('det-list').innerHTML =
            results.map(r => {
                const isKnown = !r.name.startsWith('Unknown');
                const conf    = isKnown ? (1 - r.distance).toFixed(2) : '—';
                const sel     = r.name === selectedLabel ? ' style="outline:2px solid #facc15"' : '';
                return `<div class="det-item ${isKnown ? 'known' : 'unknown'}"${sel}>
                    <span>${r.name}</span><span>${conf}</span>
                </div>`;
            }).join('') || '<div class="det-empty">No faces detected</div>';

        // Refresh the enroll form rows if it's open
        if (enrollForm.classList.contains('visible')) refreshEnrollRows();
    });

    // ── Enroll ────────────────────────────────────────────────────────────────

    enrollBtn.addEventListener('click', () => {
        enrollStatus.textContent = '';
        enrollStatus.className   = 'enroll-status';
        refreshEnrollRows();
        enrollForm.classList.add('visible');
        enrollBtn.style.display = 'none';
    });

    enrollCancel.addEventListener('click', closeEnroll);

    function closeEnroll() {
        enrollForm.classList.remove('visible');
        enrollBtn.style.display = '';
        enrollStatus.textContent = '';
    }

    function refreshEnrollRows() {
        const unknowns = currentDetections.filter(r => r.name.startsWith('Unknown'));
        const container = document.getElementById('enroll-rows');
        if (!unknowns.length) {
            container.innerHTML = '<p style="font-size:0.72rem;color:#64748b;">No unknown faces in frame.</p>';
            return;
        }
        container.innerHTML = unknowns.map(r => {
            const isSel = r.name === selectedLabel;
            return `<div class="enroll-row${isSel ? ' enroll-row-sel' : ''}">
                <span class="enroll-row-label">${r.name}</span>
                <input class="enroll-input" id="inp-${r.name.replace(' ', '-')}"
                       data-label="${r.name}" placeholder="Enter name…"
                       maxlength="64" autocomplete="off">
            </div>`;
        }).join('');
        // Focus selected label's input if present
        if (selectedLabel) {
            const inp = document.getElementById('inp-' + selectedLabel.replace(' ', '-'));
            if (inp) inp.focus();
        }
    }

    enrollSave.addEventListener('click', submitEnroll);

    function submitEnroll() {
        const inputs  = enrollForm.querySelectorAll('input[data-label]');
        const entries = [...inputs]
            .map(inp => ({ label: inp.dataset.label, name: inp.value.trim() }))
            .filter(e => e.name);

        if (!entries.length) {
            enrollStatus.textContent = 'Enter at least one name.';
            enrollStatus.className   = 'enroll-status err';
            return;
        }

        enrollSave.disabled      = true;
        enrollStatus.textContent = `Enrolling ${entries.length} person(s)…`;
        enrollStatus.className   = 'enroll-status info';

        // Fire off one request per entry; track completion with a counter
        let pending  = entries.length;
        let anyError = false;

        entries.forEach(e => socket.emit('enroll_request', { label: e.label, name: e.name }));

        // Responses are handled globally below; we use pending to know when all done
        window._enrollPending  = pending;
        window._enrollAnyError = false;
    }

    socket.on('enrolled', data => {
        log(`Enrolled: ${data.name} (was ${data.label})`, 'success');
        if (window._enrollPending !== undefined) {
            window._enrollPending--;
            if (window._enrollPending <= 0) {
                enrollSave.disabled      = false;
                enrollStatus.textContent = window._enrollAnyError
                    ? 'Some enrollments failed — check activity log.'
                    : '✓ All done!';
                enrollStatus.className = window._enrollAnyError
                    ? 'enroll-status err' : 'enroll-status ok';
                window._enrollPending = undefined;
                setTimeout(closeEnroll, 1600);
            }
        }
    });

    socket.on('enroll_failed', data => {
        log(`Enroll failed (${data.label}): ${data.reason}`, 'error');
        if (window._enrollPending !== undefined) {
            window._enrollAnyError = true;
            window._enrollPending--;
            enrollSave.disabled = false;
            if (window._enrollPending <= 0) {
                enrollStatus.textContent = 'Some enrollments failed — check activity log.';
                enrollStatus.className   = 'enroll-status err';
                window._enrollPending = undefined;
            }
        }
    });

    // ── Socket connection ─────────────────────────────────────────────────────

    socket.on('connect', () => {
        dot.className = 'dot connected';
        statusText.textContent = 'Connected';
        connBadge.classList.add('live');
        log('Connected', 'success');
    });

    socket.on('disconnect', () => {
        dot.className = 'dot disconnected';
        statusText.textContent = 'Disconnected';
        connBadge.classList.remove('live');
        log('Disconnected', 'error');
    });
});
