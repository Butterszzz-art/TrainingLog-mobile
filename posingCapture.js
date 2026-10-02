(function (globalScope) {
  'use strict';

  // Hands-free posing photo check-in: the phone sits on a stand, counts the
  // lifter down with voice or beep cues and takes a photo every few seconds.
  // The camera runs through the WebView (getUserMedia), which Capacitor grants
  // on iOS and Android, so the same code works in the PWA.

  const SETTINGS_KEY = 'tl_posing_capture_settings_v1';

  const POSE_GUIDES = {
    free: { label: 'Free posing', poses: [] },
    quarter: {
      label: 'Quarter turns',
      poses: ['Front relaxed', 'Left side', 'Back relaxed', 'Right side']
    },
    mandatories: {
      label: 'Mandatories',
      poses: [
        'Front double biceps',
        'Front lat spread',
        'Side chest',
        'Back double biceps',
        'Back lat spread',
        'Side triceps',
        'Abdominals and thigh',
        'Most muscular'
      ]
    }
  };

  const LIMITS = {
    shots: { min: 1, max: 30, fallback: 10 },
    interval: { min: 3, max: 15, fallback: 5 }
  };
  const START_DELAYS = [3, 5, 10, 15];
  const CUE_MODES = ['voice', 'beep', 'off'];

  function clampInt(value, { min, max, fallback }) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeCaptureSettings(raw = {}) {
    const guide = Object.prototype.hasOwnProperty.call(POSE_GUIDES, raw.guide) ? raw.guide : 'free';
    const poses = POSE_GUIDES[guide].poses;
    return {
      guide,
      shots: poses.length ? poses.length : clampInt(raw.shots, LIMITS.shots),
      interval: clampInt(raw.interval, LIMITS.interval),
      startDelay: START_DELAYS.includes(Number(raw.startDelay)) ? Number(raw.startDelay) : 10,
      cues: CUE_MODES.includes(raw.cues) ? raw.cues : 'voice',
      facing: raw.facing === 'environment' ? 'environment' : 'user',
      // Free-posing shot count survives switching to a guide and back.
      freeShots: clampInt(raw.freeShots ?? raw.shots, LIMITS.shots)
    };
  }

  /**
   * Timeline of cues and shots, in ms from the moment the user hits start.
   * Steps: announce (spoken text), tick (3-2-1), shot, done.
   */
  function buildCaptureSchedule(rawSettings) {
    const settings = normalizeCaptureSettings(rawSettings);
    const poses = POSE_GUIDES[settings.guide].poses;
    const steps = [];
    let prevShotAt = 0;

    for (let i = 0; i < settings.shots; i += 1) {
      const shotAt = (settings.startDelay + i * settings.interval) * 1000;
      const pose = poses[i] || '';
      let quietUntil = i === 0 ? 0 : prevShotAt + 400;

      if (i === 0 || pose) {
        const text = pose ? `${i === 0 ? 'First pose' : 'Next'}: ${pose}` : 'Get in position';
        const at = i === 0 ? 0 : prevShotAt + 700;
        steps.push({ type: 'announce', at, index: i, text, pose });
        quietUntil = at + 1500;
      }

      for (let n = 3; n >= 1; n -= 1) {
        const at = shotAt - n * 1000;
        if (at >= quietUntil) steps.push({ type: 'tick', at, index: i, count: n });
      }

      steps.push({ type: 'shot', at: shotAt, index: i, pose });
      prevShotAt = shotAt;
    }

    steps.push({ type: 'done', at: prevShotAt + 600 });
    steps.sort((a, b) => a.at - b.at);
    return steps;
  }

  /** Fires schedule steps in order against a clock; onFrame drives the countdown UI. */
  function createScheduleRunner(schedule, options = {}) {
    const now = options.now || (() => Date.now());
    const setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimer || ((id) => clearTimeout(id));
    const onStep = options.onStep || (() => {});
    const onFrame = options.onFrame || (() => {});
    const tickMs = options.tickMs || 50;

    let startedAt = 0;
    let cursor = 0;
    let timer = null;
    let running = false;

    function loop() {
      if (!running) return;
      const elapsed = now() - startedAt;
      while (running && cursor < schedule.length && schedule[cursor].at <= elapsed) {
        const step = schedule[cursor];
        cursor += 1;
        onStep(step, elapsed);
        if (step.type === 'done') running = false;
      }
      if (!running) return;
      const nextShot = schedule.slice(cursor).find((s) => s.type === 'shot') || null;
      onFrame({ elapsed, nextShot });
      timer = setTimer(loop, tickMs);
    }

    return {
      start() {
        if (running) return;
        running = true;
        startedAt = now();
        cursor = 0;
        loop();
      },
      stop() {
        running = false;
        if (timer !== null) clearTimer(timer);
        timer = null;
      },
      isRunning: () => running,
      elapsed: () => (startedAt ? now() - startedAt : 0)
    };
  }

  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ── Browser-only helpers ────────────────────────────────────────────────

  function loadSettings() {
    try {
      return normalizeCaptureSettings(JSON.parse(globalScope.localStorage?.getItem(SETTINGS_KEY) || '{}'));
    } catch (_error) {
      return normalizeCaptureSettings({});
    }
  }

  function saveSettings(settings) {
    try {
      globalScope.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_error) {
      // storage may be full or blocked; settings are a convenience only
    }
  }

  function createCuePlayer(mode) {
    let audioCtx = null;
    const synth = globalScope.speechSynthesis;
    const canSpeak = mode === 'voice' && !!synth && typeof globalScope.SpeechSynthesisUtterance === 'function';

    function beep(freq, seconds, volume = 0.22) {
      if (mode === 'off' || !audioCtx) return;
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const t = audioCtx.currentTime;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + seconds + 0.02);
      } catch (_error) {
        // audio is best-effort
      }
    }

    function speak(text) {
      if (!canSpeak) return false;
      try {
        const u = new globalScope.SpeechSynthesisUtterance(text);
        u.rate = 1.05;
        synth.speak(u);
        return true;
      } catch (_error) {
        return false;
      }
    }

    return {
      // Must run inside the tap that starts the session: iOS only lets audio
      // and speech start from a user gesture.
      unlock() {
        if (mode === 'off') return;
        try {
          const Ctx = globalScope.AudioContext || globalScope.webkitAudioContext;
          if (Ctx && !audioCtx) audioCtx = new Ctx();
          audioCtx?.resume?.();
        } catch (_error) {
          audioCtx = null;
        }
        if (canSpeak) {
          try { synth.cancel(); synth.speak(new globalScope.SpeechSynthesisUtterance(' ')); } catch (_error) { /* noop */ }
        }
      },
      announce(text) { speak(text); },
      tick(count) {
        if (!speak(String(count))) beep(880, 0.09);
      },
      shot() { beep(1320, 0.16, 0.3); },
      stop() {
        try { if (canSpeak) synth.cancel(); } catch (_error) { /* noop */ }
        try { audioCtx?.close?.(); } catch (_error) { /* noop */ }
        audioCtx = null;
      }
    };
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve) => {
      if (canvas.toBlob) canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      else resolve(null);
    });
  }

  async function grabFrame(video) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);

    const thumbW = Math.min(360, width);
    const thumbH = Math.round((height / width) * thumbW);
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbW;
    thumbCanvas.height = thumbH;
    thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbW, thumbH);

    const [blob, thumbBlob] = await Promise.all([canvasToBlob(canvas, 0.9), canvasToBlob(thumbCanvas, 0.75)]);
    if (!blob) return null;
    return { blob, thumbBlob, width, height };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function cameraErrorMessage(error) {
    const name = error?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Camera access is turned off. Allow camera access for Pocket Coach in your phone settings, then try again.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'No camera was found on this device.';
    }
    if (name === 'NotReadableError') {
      return 'The camera is being used by another app. Close it and try again.';
    }
    return 'The camera could not be started on this device.';
  }

  // ── Overlay controller ──────────────────────────────────────────────────

  const ui = {
    root: null,
    video: null,
    stream: null,
    settings: null,
    state: 'closed',
    runner: null,
    cues: null,
    shots: [],
    shotUrls: [],
    startedAt: 0,
    endedAt: 0,
    userId: null,
    onSaved: null,
    wakeLock: null,
    pendingGrabs: []
  };

  function q(sel) { return ui.root?.querySelector(sel); }

  function setState(state) {
    ui.state = state;
    if (ui.root) ui.root.dataset.state = state;
  }

  async function startCamera() {
    stopCamera();
    const md = globalScope.navigator?.mediaDevices;
    if (!md?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
    ui.stream = await md.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: ui.settings.facing },
        width: { ideal: 1920 },
        height: { ideal: 1920 }
      }
    });
    ui.video.srcObject = ui.stream;
    ui.root.classList.toggle('pcap--mirror', ui.settings.facing === 'user');
    await ui.video.play().catch(() => {});
  }

  function stopCamera() {
    ui.stream?.getTracks().forEach((t) => t.stop());
    ui.stream = null;
    if (ui.video) ui.video.srcObject = null;
  }

  async function requestWakeLock() {
    try {
      ui.wakeLock = await globalScope.navigator?.wakeLock?.request('screen');
    } catch (_error) {
      ui.wakeLock = null;
    }
  }

  function releaseWakeLock() {
    try { ui.wakeLock?.release?.(); } catch (_error) { /* noop */ }
    ui.wakeLock = null;
  }

  function revokeShotUrls() {
    ui.shotUrls.forEach((u) => URL.revokeObjectURL(u));
    ui.shotUrls = [];
  }

  function buildOverlay() {
    const root = document.createElement('div');
    root.id = 'posingCaptureOverlay';
    root.className = 'pcap';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Posing photo check-in');
    root.innerHTML = `
      <video class="pcap-video" playsinline muted autoplay></video>
      <div class="pcap-flash" aria-hidden="true"></div>

      <header class="pcap-top">
        <button type="button" class="pcap-round" data-act="close" aria-label="Close">✕</button>
        <span class="pcap-title">Photo check-in</span>
        <button type="button" class="pcap-round pcap-only-setup" data-act="flip" aria-label="Switch camera">⟲</button>
      </header>

      <div class="pcap-stage pcap-only-running" aria-live="polite">
        <span class="pcap-stage-lbl" data-el="stageLbl">Get in position</span>
        <span class="pcap-count" data-el="count"></span>
        <span class="pcap-pose" data-el="pose"></span>
        <span class="pcap-progress" data-el="progress"></span>
      </div>

      <section class="pcap-panel pcap-only-setup" aria-label="Capture settings">
        <div class="pcap-field">
          <span class="pcap-lbl">Pose guide</span>
          <div class="pcap-chips" data-group="guide">
            ${Object.entries(POSE_GUIDES).map(([key, g]) => `<button type="button" class="pcap-chip" data-guide="${key}">${escapeHtml(g.label)}</button>`).join('')}
          </div>
        </div>
        <div class="pcap-grid">
          <div class="pcap-field">
            <span class="pcap-lbl">Photos</span>
            <div class="pcap-stepper">
              <button type="button" data-step="shots" data-delta="-1" aria-label="Fewer photos">−</button>
              <output data-el="shots"></output>
              <button type="button" data-step="shots" data-delta="1" aria-label="More photos">+</button>
            </div>
          </div>
          <div class="pcap-field">
            <span class="pcap-lbl">Every</span>
            <div class="pcap-stepper">
              <button type="button" data-step="interval" data-delta="-1" aria-label="Shorter interval">−</button>
              <output data-el="interval"></output>
              <button type="button" data-step="interval" data-delta="1" aria-label="Longer interval">+</button>
            </div>
          </div>
        </div>
        <div class="pcap-grid">
          <div class="pcap-field">
            <span class="pcap-lbl">Start after</span>
            <div class="pcap-chips pcap-chips--tight" data-group="startDelay">
              ${START_DELAYS.map((s) => `<button type="button" class="pcap-chip" data-delay="${s}">${s}s</button>`).join('')}
            </div>
          </div>
          <div class="pcap-field">
            <span class="pcap-lbl">Cues</span>
            <div class="pcap-chips pcap-chips--tight" data-group="cues">
              <button type="button" class="pcap-chip" data-cues="voice">Voice</button>
              <button type="button" class="pcap-chip" data-cues="beep">Beep</button>
              <button type="button" class="pcap-chip" data-cues="off">Off</button>
            </div>
          </div>
        </div>
      </section>

      <footer class="pcap-bottom">
        <div class="pcap-strip pcap-only-running" data-el="strip"></div>
        <button type="button" class="pcap-shutter pcap-only-setup" data-act="start" aria-label="Start photo check-in"><span></span></button>
        <button type="button" class="pcap-stop pcap-only-running" data-act="stop">Stop</button>
      </footer>

      <section class="pcap-review pcap-only-review" aria-label="Review photos">
        <div class="pcap-review-head">
          <h3>Review</h3>
          <span data-el="reviewCount"></span>
        </div>
        <p class="pcap-hint">Tap a photo to drop it from this check-in.</p>
        <div class="pcap-grid-photos" data-el="reviewGrid"></div>
        <div class="pcap-review-actions">
          <button type="button" class="mx-outline" data-act="retake">Retake</button>
          <button type="button" class="mx-cta" data-act="save"><span>Save check-in</span></button>
        </div>
      </section>

      <section class="pcap-error pcap-only-error" role="alert">
        <p data-el="errorMsg"></p>
        <button type="button" class="mx-outline" data-act="close">Close</button>
      </section>
    `;
    root.addEventListener('click', onClick);
    return root;
  }

  function renderSettings() {
    const s = ui.settings;
    const guided = POSE_GUIDES[s.guide].poses.length > 0;
    q('[data-el="shots"]').textContent = String(s.shots);
    q('[data-el="interval"]').textContent = `${s.interval}s`;
    ui.root.querySelectorAll('[data-step="shots"]').forEach((b) => { b.disabled = guided; });
    ui.root.querySelectorAll('[data-guide]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.guide === s.guide)));
    ui.root.querySelectorAll('[data-delay]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.delay) === s.startDelay)));
    ui.root.querySelectorAll('[data-cues]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cues === s.cues)));
  }

  function updateSettings(patch) {
    const next = { ...ui.settings, ...patch };
    if (patch.shots !== undefined) next.freeShots = patch.shots;
    if (patch.guide === 'free') next.shots = next.freeShots;
    ui.settings = normalizeCaptureSettings(next);
    saveSettings(ui.settings);
    renderSettings();
  }

  function renderStrip() {
    const strip = q('[data-el="strip"]');
    if (!strip) return;
    strip.innerHTML = ui.shotUrls.slice(-5).map((u) => `<img src="${u}" alt="">`).join('');
  }

  function onFrame({ elapsed, nextShot }) {
    if (!nextShot) return;
    const secs = Math.max(1, Math.ceil((nextShot.at - elapsed) / 1000));
    q('[data-el="count"]').textContent = String(secs);
    q('[data-el="stageLbl"]').textContent = nextShot.index === 0 ? 'First photo in' : 'Next photo in';
    q('[data-el="pose"]').textContent = nextShot.pose || '';
    q('[data-el="progress"]').textContent = `Photo ${nextShot.index + 1} of ${ui.settings.shots}`;
  }

  function flash() {
    const el = q('.pcap-flash');
    if (!el) return;
    el.classList.remove('is-on');
    void el.offsetWidth; // restart the animation
    el.classList.add('is-on');
  }

  function onStep(step) {
    if (step.type === 'announce') ui.cues?.announce(step.text);
    else if (step.type === 'tick') ui.cues?.tick(step.count);
    else if (step.type === 'shot') {
      ui.cues?.shot();
      flash();
      const grab = grabFrame(ui.video).then((frame) => {
        if (!frame) return;
        const shot = { ...frame, index: step.index, pose: step.pose, takenAt: new Date().toISOString() };
        ui.shots.push(shot);
        ui.shotUrls.push(URL.createObjectURL(frame.thumbBlob || frame.blob));
        renderStrip();
      }).catch((error) => console.warn('Posing capture failed', error));
      ui.pendingGrabs.push(grab);
    } else if (step.type === 'done') {
      finishRun();
    }
  }

  function startRun() {
    if (ui.state !== 'setup' || !ui.stream) return;
    revokeShotUrls();
    ui.shots = [];
    ui.pendingGrabs = [];
    ui.cues = createCuePlayer(ui.settings.cues);
    ui.cues.unlock();
    requestWakeLock();
    renderStrip();
    setState('running');
    ui.startedAt = Date.now();
    ui.runner = createScheduleRunner(buildCaptureSchedule(ui.settings), { onStep, onFrame });
    ui.runner.start();
  }

  async function finishRun() {
    if (ui.state !== 'running') return;
    setState('finishing');
    ui.runner?.stop();
    ui.runner = null;
    ui.endedAt = Date.now();
    ui.cues?.stop();
    ui.cues = null;
    releaseWakeLock();
    await Promise.all(ui.pendingGrabs);
    ui.pendingGrabs = [];
    if (!ui.root) return; // closed while the last frames were encoding
    stopCamera();
    if (!ui.shots.length) {
      await enterSetup();
      return;
    }
    ui.shots.sort((a, b) => a.index - b.index);
    renderReview();
    setState('review');
  }

  function renderReview() {
    const grid = q('[data-el="reviewGrid"]');
    // shotUrls were pushed in capture order, which can differ from index order
    // if two grabs resolve out of order, so rebuild them from the sorted shots.
    revokeShotUrls();
    ui.shotUrls = ui.shots.map((s) => URL.createObjectURL(s.thumbBlob || s.blob));
    grid.innerHTML = ui.shots.map((s, i) => `
      <button type="button" class="pcap-photo" data-photo="${i}" aria-pressed="true" aria-label="Photo ${i + 1}${s.pose ? `, ${escapeHtml(s.pose)}` : ''}">
        <img src="${ui.shotUrls[i]}" alt="">
        ${s.pose ? `<span>${escapeHtml(s.pose)}</span>` : ''}
      </button>`).join('');
    updateReviewCount();
  }

  function keptShots() {
    const dropped = new Set(Array.from(ui.root.querySelectorAll('.pcap-photo[aria-pressed="false"]')).map((b) => Number(b.dataset.photo)));
    return ui.shots.filter((_s, i) => !dropped.has(i));
  }

  function updateReviewCount() {
    const kept = keptShots().length;
    q('[data-el="reviewCount"]').textContent = `${kept} of ${ui.shots.length} kept`;
    q('[data-act="save"]').disabled = kept === 0;
  }

  async function saveCheckIn() {
    const kept = keptShots();
    if (!kept.length) return;
    const btn = q('[data-act="save"]');
    btn.disabled = true;
    const sessionId = `posing_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    try {
      await globalScope.posingMediaStore.savePhotos(ui.userId, sessionId, kept);
    } catch (error) {
      console.warn('Saving posing photos failed', error);
      btn.disabled = false;
      globalScope.alert?.('Your photos could not be saved on this device. Free up some storage and try again.');
      return;
    }
    const minutes = Math.max(1, Math.round((ui.endedAt - ui.startedAt) / 60000));
    const guide = ui.settings.guide !== 'free' ? ` · ${POSE_GUIDES[ui.settings.guide].label}` : '';
    const session = globalScope.posingEngine?.logPosingSession?.(ui.userId, {
      id: sessionId,
      date: localDateKey(),
      minutes,
      notes: `Photo check-in${guide}`,
      photoCount: kept.length
    });
    const onSaved = ui.onSaved;
    close({ force: true });
    try { onSaved?.(session); } catch (error) { console.warn(error); }
  }

  async function enterSetup() {
    revokeShotUrls();
    ui.shots = [];
    setState('setup');
    renderSettings();
    try {
      await startCamera();
    } catch (error) {
      console.warn('Posing camera failed', error);
      q('[data-el="errorMsg"]').textContent = cameraErrorMessage(error);
      setState('error');
    }
  }

  function onClick(event) {
    const target = event.target.closest('button');
    if (!target || !ui.root.contains(target) || target.disabled) return;
    const act = target.dataset.act;

    if (act === 'close') close();
    else if (act === 'flip') {
      updateSettings({ facing: ui.settings.facing === 'user' ? 'environment' : 'user' });
      enterSetup();
    } else if (act === 'start') startRun();
    else if (act === 'stop') finishRun();
    else if (act === 'retake') {
      if (globalScope.confirm?.('Discard these photos and start again?') === false) return;
      enterSetup();
    } else if (act === 'save') saveCheckIn();
    else if (target.dataset.guide) updateSettings({ guide: target.dataset.guide });
    else if (target.dataset.delay) updateSettings({ startDelay: Number(target.dataset.delay) });
    else if (target.dataset.cues) updateSettings({ cues: target.dataset.cues });
    else if (target.dataset.step) {
      const key = target.dataset.step;
      updateSettings({ [key]: ui.settings[key] + Number(target.dataset.delta) });
    } else if (target.dataset.photo !== undefined) {
      target.setAttribute('aria-pressed', String(target.getAttribute('aria-pressed') !== 'true'));
      updateReviewCount();
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') close();
  }

  function onVisibilityChange() {
    // The OS cuts the camera when the app is backgrounded; keep what was shot.
    if (document.hidden && ui.state === 'running') finishRun();
  }

  function open({ userId, onSaved } = {}) {
    if (ui.root) return;
    ui.userId = userId;
    ui.onSaved = onSaved || null;
    ui.settings = loadSettings();
    ui.root = buildOverlay();
    ui.video = q('.pcap-video');
    document.body.appendChild(ui.root);
    document.body.classList.add('pcap-open');
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (!globalScope.posingMediaStore?.isAvailable?.()) {
      q('[data-el="errorMsg"]').textContent = 'Photo storage is not available on this device.';
      setState('error');
      return;
    }
    enterSetup();
  }

  function close({ force = false } = {}) {
    if (!ui.root) return;
    const unsaved = ui.state === 'review' || ((ui.state === 'running' || ui.state === 'finishing') && ui.shots.length > 0);
    if (!force && unsaved && globalScope.confirm?.('Discard the photos from this check-in?') === false) return;
    ui.runner?.stop();
    ui.runner = null;
    ui.cues?.stop();
    ui.cues = null;
    releaseWakeLock();
    stopCamera();
    revokeShotUrls();
    ui.shots = [];
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.body.classList.remove('pcap-open');
    ui.root.remove();
    ui.root = null;
    ui.video = null;
    ui.state = 'closed';
  }

  // ── Thumbnails in the posing history ─────────────────────────────────────

  let historyUrls = [];

  async function hydrateHistoryThumbs(container, userId) {
    historyUrls.forEach((u) => URL.revokeObjectURL(u));
    historyUrls = [];
    const store = globalScope.posingMediaStore;
    if (!container || !store?.isAvailable?.()) return;
    const slots = Array.from(container.querySelectorAll('[data-posing-photos]'));
    await Promise.all(slots.map(async (slot) => {
      try {
        const photos = await store.listSessionPhotos(userId, slot.dataset.posingPhotos);
        if (!slot.isConnected || !photos.length) return;
        const shown = photos.slice(0, 5);
        slot.innerHTML = shown.map((p, i) => {
          const url = store.toObjectUrl(p, { thumb: true });
          historyUrls.push(url);
          return `<button type="button" class="posing-thumb" data-photo-index="${i}" aria-label="View photo ${i + 1}${p.pose ? `, ${escapeHtml(p.pose)}` : ''}"><img src="${url}" alt=""></button>`;
        }).join('') + (photos.length > shown.length ? `<span class="posing-thumb-more">+${photos.length - shown.length}</span>` : '');
        slot.onclick = (event) => {
          const btn = event.target.closest('[data-photo-index]');
          if (btn) openViewer(photos, Number(btn.dataset.photoIndex));
        };
      } catch (error) {
        console.warn('Loading posing thumbnails failed', error);
      }
    }));
  }

  function openViewer(photos, startIndex) {
    const store = globalScope.posingMediaStore;
    let index = startIndex;
    let url = '';
    const viewer = document.createElement('div');
    viewer.className = 'pcap-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.innerHTML = `
      <img alt="">
      <div class="pcap-viewer-bar">
        <button type="button" data-v="prev" aria-label="Previous photo">‹</button>
        <span data-v="label"></span>
        <button type="button" data-v="next" aria-label="Next photo">›</button>
      </div>
      <button type="button" class="pcap-round pcap-viewer-close" data-v="close" aria-label="Close">✕</button>`;

    function show() {
      if (url) URL.revokeObjectURL(url);
      const p = photos[index];
      url = store.toObjectUrl(p);
      viewer.querySelector('img').src = url;
      viewer.querySelector('[data-v="label"]').textContent = `${index + 1} / ${photos.length}${p.pose ? ` · ${p.pose}` : ''}`;
    }
    function shut() {
      if (url) URL.revokeObjectURL(url);
      document.removeEventListener('keydown', onKey);
      viewer.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') shut();
      if (e.key === 'ArrowLeft') { index = (index - 1 + photos.length) % photos.length; show(); }
      if (e.key === 'ArrowRight') { index = (index + 1) % photos.length; show(); }
    }
    viewer.addEventListener('click', (e) => {
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (v === 'prev') { index = (index - 1 + photos.length) % photos.length; show(); }
      else if (v === 'next') { index = (index + 1) % photos.length; show(); }
      else if (v === 'close' || e.target === viewer) shut();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(viewer);
    show();
  }

  const api = {
    POSE_GUIDES,
    normalizeCaptureSettings,
    buildCaptureSchedule,
    createScheduleRunner,
    localDateKey,
    open,
    close,
    hydrateHistoryThumbs
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.posingCapture = api;
})(typeof window !== 'undefined' ? window : globalThis);
