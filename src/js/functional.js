/* =============================================================
   HYBRID TRAINING TAB (#functionalTab) — CrossFit WODs, benchmarks
   & PRs, HYROX race prep + simulations, timed circuits, history.
   Pure logic lives in src/js/functional-core.js (FunctionalCore).

   Storage (per account; all cloud-synced, see cloud-sync.js):
     crossfitLog_<u>        WOD + circuit sessions
     hyroxLog_<u>           HYROX simulations / races (newest first)
     crossfitTemplates_<u>  saved workouts
     functionalCircuits_<u> saved circuits
     hyroxRace_<u>          race plan { date, goal, division, name }
   ============================================================= */
(function () {
  'use strict';

  const C = window.FunctionalCore;
  if (!C || typeof document === 'undefined') return;

  /* ── Small helpers ─────────────────────────────────────────── */

  const $ = id => document.getElementById(id);
  const user = () => window.currentUser || localStorage.getItem('fitnessAppUser') || '';
  const pad = n => String(n).padStart(2, '0');
  const todayKey = () => (globalThis.AppTime && globalThis.AppTime.today && globalThis.AppTime.today()) ||
    (d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)(new Date());
  const unit = () => (localStorage.getItem('defaultWeightUnit') === 'lbs' ? 'lbs' : 'kg');
  const esc = v => (typeof window.mxEsc === 'function' ? window.mxEsc(v)
    : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const icon = name => {
    try { if (typeof ICONS !== 'undefined' && ICONS[name]) return ICONS[name]; } catch (_) { /* not loaded */ } // eslint-disable-line no-undef
    return name === 'x' ? '×' : '';
  };
  const toast = (msg, type) => {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
    else if (typeof window.nativeToast === 'function') window.nativeToast(msg, type);
  };
  const haptic = () => { try { window.Capacitor?.Plugins?.Haptics?.impact?.({ style: 'MEDIUM' }); } catch (_) { /* web */ } };

  const KEYS = {
    log: u => `crossfitLog_${u}`,
    hyrox: u => `hyroxLog_${u}`,
    templates: u => `crossfitTemplates_${u}`,
    circuits: u => `functionalCircuits_${u}`,
    race: u => `hyroxRace_${u}`,
  };

  function read(kind, fallback) {
    const u = user();
    if (!u) return fallback;
    try {
      const v = JSON.parse(localStorage.getItem(KEYS[kind](u)) || 'null');
      if (Array.isArray(fallback)) return Array.isArray(v) ? v : fallback;
      return v && typeof v === 'object' ? v : fallback;
    } catch (_) { return fallback; }
  }

  function write(kind, value) {
    const u = user();
    if (!u) return false;
    try { localStorage.setItem(KEYS[kind](u), JSON.stringify(value)); return true; }
    catch (err) { console.warn('[Hybrid] save failed', err); toast('Could not save — storage is full', 'error'); return false; }
  }

  function fmtDate(key, opts) {
    const d = new Date(String(key) + 'T00:00:00');
    return isNaN(d) ? String(key || '') : d.toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function dateBlock(key) {
    const d = new Date(String(key) + 'T00:00:00');
    const ok = !isNaN(d);
    return `<div class="mx-date"><b>${ok ? d.getDate() : ''}</b><span>${ok ? d.toLocaleDateString(undefined, { month: 'short' }) : ''}</span></div>`;
  }

  function beep(freq, dur) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      beep._ctx = beep._ctx || new Ctx();
      const ctx = beep._ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = freq || 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (dur || 0.18));
      osc.connect(g); g.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + (dur || 0.18));
    } catch (_) { /* audio unavailable */ }
  }

  function playCue(kind) {
    if (kind === 'tick') beep(660, 0.1);
    else if (kind === 'start') { beep(880, 0.25); haptic(); }
    else if (kind === 'end') { beep(990, 0.5); haptic(); }
  }

  // Keeps the screen on while a timer runs, where supported.
  let _wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && navigator.wakeLock && !_wakeLock) _wakeLock = await navigator.wakeLock.request('screen');
      if (!on && _wakeLock) { await _wakeLock.release(); _wakeLock = null; }
    } catch (_) { _wakeLock = null; }
  }

  /* ══ Sub-tab navigation ═════════════════════════════════════ */

  function showSub(target) {
    const nav = $('funcSubNav');
    if (!nav) return;
    nav.querySelectorAll('.log-subtab').forEach(b => b.classList.toggle('active', b.dataset.fsub === target));
    document.querySelectorAll('#functionalTab .func-subview').forEach(p => p.classList.toggle('active', p.id === 'fSub_' + target));
    if (target === 'benchmarks') renderBenchmarks();
    if (target === 'hyrox') renderHyrox();
    if (target === 'circuits') renderCircuits();
    if (target === 'history') renderHistory();
  }

  /* ══ Week hero ══════════════════════════════════════════════ */

  function renderWeekHero() {
    const el = $('fxWeekHero');
    if (!el) return;
    const s = C.weekStats(read('log', []), read('hyrox', []), todayKey());
    const race = read('race', null);
    const days = race && race.date ? C.daysUntil(race.date, todayKey()) : null;
    const raceChip = days != null && days >= 0
      ? `<span class="mx-chip mx-chip--brass mx-chip--sm">${days === 0 ? 'Race day' : days + 'd to race'}</span>` : '';
    const parts = [s.wods && `${s.wods} WOD${s.wods === 1 ? '' : 's'}`, s.hyrox && `${s.hyrox} HYROX`, s.circuits && `${s.circuits} circuit${s.circuits === 1 ? '' : 's'}`].filter(Boolean);
    el.innerHTML = `
      <div class="pod-row">
        <span class="mx-kicker">This week</span>
        ${raceChip}
      </div>
      <div class="mx-tiles mx-tiles--4">
        <div class="mx-stat"><span class="mx-stat-l">Sessions</span><span class="mx-stat-v">${s.sessions}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">Minutes</span><span class="mx-stat-v">${s.minutes}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">PRs · 30d</span><span class="mx-stat-v">${s.prs30}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">Wk streak</span><span class="mx-stat-v">${s.streakWeeks}</span></div>
      </div>
      <div class="mx-sub fx-week-sub">${parts.length ? esc(parts.join(' · ')) : 'Nothing logged yet this week — pick a WOD below.'}</div>`;
  }

  /* ══ WOD timer (wall-clock, survives the phone sleeping) ════ */

  const timer = { format: 'amrap', running: false, startedAt: 0, banked: 0, raf: null, lastSec: -1, rounds: 0, result: null };

  function timerCfg() {
    const num = (id, d) => { const v = parseInt($(id)?.value, 10); return Number.isFinite(v) && v >= 0 ? v : d; };
    return {
      duration: num('wodDuration', 20) * 60,
      cap: num('wodCap', 0) * 60,
      rounds: num('wodRounds', 10),
      interval: num('wodInterval', 60),
      work: num('wodWork', 20),
      rest: num('wodRest', 10),
    };
  }

  function timerElapsed() {
    return timer.banked + (timer.running ? (Date.now() - timer.startedAt) / 1000 : 0);
  }

  function renderTimerConfig() {
    const show = {
      wodConfigDuration: ['amrap'],
      wodConfigCap: ['fortime'],
      wodConfigRounds: ['emom', 'tabata'],
      wodConfigInterval: ['emom'],
      wodConfigWork: ['tabata'],
      wodConfigRest: ['tabata'],
    };
    Object.keys(show).forEach(id => { const el = $(id); if (el) el.style.display = show[id].includes(timer.format) ? '' : 'none'; });
    if (timer.format === 'tabata' && $('wodRounds') && !$('wodRounds').dataset.touched) $('wodRounds').value = 8;
    const rc = $('wodRoundCounter');
    if (rc) rc.hidden = !(timer.format === 'amrap' || timer.format === 'fortime');
  }

  function paintTimer() {
    const st = C.timerState(timer.format, timerCfg(), timerElapsed());
    const clock = $('wodClock');
    const phase = $('wodPhase');
    if (clock) clock.textContent = C.fmtTime(st.clock);
    if (phase) phase.textContent = timer.running || timer.banked ? st.phase : 'Ready';
    const sec = Math.floor(timerElapsed());
    if (timer.running && sec !== timer.lastSec) {
      timer.lastSec = sec;
      if (st.beep) playCue(st.beep);
    }
    if (timer.running && st.done) finishTimer(st);
    return st;
  }

  function loop() {
    paintTimer();
    if (timer.running) timer.raf = setTimeout(loop, 200);
  }

  function setTimerButtons() {
    const start = $('wodStartBtn');
    const pause = $('wodPauseBtn');
    if (start) { start.style.display = timer.running ? 'none' : ''; start.textContent = timer.banked && !timer.running ? 'Resume' : 'Start'; }
    if (pause) pause.style.display = timer.running ? '' : 'none';
    const log = $('wodLogResultBtn');
    if (log) log.hidden = !(timer.result || (!timer.running && timer.banked > 0));
    const round = $('wodRoundCount');
    if (round) round.textContent = `${timer.rounds} round${timer.rounds === 1 ? '' : 's'}`;
  }

  function startTimer() {
    if (timer.running) return;
    if (timer.result) resetTimer();
    timer.running = true;
    timer.startedAt = Date.now();
    playCue('start');
    keepAwake(true);
    setTimerButtons();
    loop();
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.banked = timerElapsed();
    timer.running = false;
    clearTimeout(timer.raf);
    keepAwake(false);
    paintTimer();
    setTimerButtons();
  }

  function resetTimer() {
    timer.running = false;
    timer.banked = 0;
    timer.lastSec = -1;
    timer.rounds = 0;
    timer.result = null;
    clearTimeout(timer.raf);
    keepAwake(false);
    paintTimer();
    if ($('wodPhase')) $('wodPhase').textContent = C.FORMATS[timer.format]?.label || 'Ready';
    setTimerButtons();
  }

  function finishTimer() {
    timer.banked = timerElapsed();
    timer.running = false;
    clearTimeout(timer.raf);
    keepAwake(false);
    timer.result = { format: timer.format, elapsed: Math.round(timer.banked), cfg: timerCfg(), rounds: timer.rounds };
    setTimerButtons();
    toast('Time! Tap “Log this result” to save it.', 'success');
  }

  // Prefills the log form from what the timer just ran.
  function logTimerResult() {
    const res = timer.result || { format: timer.format, elapsed: Math.round(timerElapsed()), cfg: timerCfg(), rounds: timer.rounds };
    const fmt = res.format === 'tabata' ? 'other' : res.format;
    setFormat(fmt);
    if (fmt === 'fortime') {
      const capped = res.cfg.cap && res.elapsed >= res.cfg.cap;
      $('cfMinutes').value = Math.floor(res.elapsed / 60);
      $('cfSeconds').value = res.elapsed % 60;
      $('cfCapped').checked = !!capped;
    } else if (fmt === 'amrap') {
      $('cfRounds').value = res.rounds || '';
      $('cfDuration').value = Math.round(res.cfg.duration / 60);
    } else {
      $('cfDuration').value = Math.max(1, Math.round(res.elapsed / 60));
    }
    if (!$('cfWorkoutName').value.trim()) {
      const label = { amrap: `AMRAP ${Math.round(res.cfg.duration / 60)}`, emom: `EMOM ${res.cfg.rounds}`, tabata: `Tabata ×${res.cfg.rounds}`, fortime: 'For Time' }[res.format];
      $('cfWorkoutName').value = label || '';
    }
    updatePrevBest();
    $('fxLogPod')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function initTimer() {
    document.querySelectorAll('#functionalTab .wod-format-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        timer.format = btn.dataset.wodFormat;
        document.querySelectorAll('#functionalTab .wod-format-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderTimerConfig();
        resetTimer();
      });
    });
    $('wodRounds')?.addEventListener('input', e => { e.target.dataset.touched = '1'; });
    ['wodDuration', 'wodCap', 'wodRounds', 'wodInterval', 'wodWork', 'wodRest'].forEach(id => {
      $(id)?.addEventListener('input', () => { if (!timer.running && !timer.banked) paintTimer(); });
    });
    $('wodStartBtn')?.addEventListener('click', startTimer);
    $('wodPauseBtn')?.addEventListener('click', pauseTimer);
    $('wodResetBtn')?.addEventListener('click', resetTimer);
    $('wodLogResultBtn')?.addEventListener('click', logTimerResult);
    $('wodRoundBtn')?.addEventListener('click', () => { timer.rounds++; haptic(); setTimerButtons(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && timer.running) paintTimer(); });
    renderTimerConfig();
    resetTimer();
  }

  /* ══ WOD log form ═══════════════════════════════════════════ */

  const form = { format: 'fortime', rx: true, rpe: null, editing: null, movementSeq: 0 };

  function scoreTypeForForm() {
    const b = C.findBenchmark($('cfWorkoutName')?.value);
    if (b) return b.type;
    return (C.FORMATS[form.format] || C.FORMATS.other).scoreType;
  }

  function showScoreFields() {
    const type = scoreTypeForForm();
    document.querySelectorAll('#cfScore [data-score]').forEach(el => {
      el.hidden = el.dataset.score !== type && !(type === 'amrap' && el.dataset.score === 'none');
    });
    document.querySelectorAll('#functionalTab .fx-unit-lbl').forEach(el => { el.textContent = unit(); });
  }

  function setFormat(fmt) {
    form.format = C.FORMATS[fmt] ? fmt : 'other';
    document.querySelectorAll('#cfFormat .mx-preset').forEach(b => b.classList.toggle('active', b.dataset.format === form.format));
    showScoreFields();
  }

  function setRx(rx) {
    form.rx = !!rx;
    document.querySelectorAll('#cfRxSegs button').forEach(b => b.classList.toggle('active', (b.dataset.rx === '1') === form.rx));
    updatePrevBest();
  }

  function setRpe(v) {
    form.rpe = form.rpe === v ? null : v;
    document.querySelectorAll('#cfRpe .mx-preset').forEach(b => b.classList.toggle('active', Number(b.dataset.rpe) === form.rpe));
  }

  function renderRpe() {
    const el = $('cfRpe');
    if (!el || el.childElementCount) return;
    el.innerHTML = [5, 6, 7, 8, 9, 10].map(v => `<button type="button" class="mx-preset" data-rpe="${v}">${v}</button>`).join('');
    el.addEventListener('click', e => { const b = e.target.closest('[data-rpe]'); if (b) setRpe(Number(b.dataset.rpe)); });
  }

  function onNameChange() {
    const b = C.findBenchmark($('cfWorkoutName')?.value);
    const desc = $('fxBenchDesc');
    if (desc) {
      desc.hidden = !b;
      desc.innerHTML = b ? `<span class="mx-tag mx-tag--brass">Benchmark</span> ${esc(b.desc)}` : '';
    }
    if (b) setFormat(b.type === 'time' ? 'fortime' : b.type === 'amrap' ? 'amrap' : b.type === 'load' ? 'strength' : 'other');
    if (b && b.type === 'amrap' && b.capMin && $('cfDuration') && !$('cfDuration').value) $('cfDuration').value = b.capMin;
    showScoreFields();
    updatePrevBest();
  }

  // "Your best: 4:12 (12 Mar)" under the score fields.
  function updatePrevBest() {
    const el = $('cfPrevBest');
    if (!el) return;
    const name = $('cfWorkoutName')?.value.trim();
    if (!name) { el.hidden = true; return; }
    const probe = { name, rx: form.rx, id: form.editing?.id };
    const best = C.previousBest(read('log', []), probe);
    el.hidden = !best;
    if (best) el.innerHTML = `Your ${form.rx ? 'Rx' : 'scaled'} best: <b>${esc(C.formatScore(best, unit()))}</b> · ${esc(fmtDate(best.date, { day: 'numeric', month: 'short' }))}`;
  }

  function movementRow(m) {
    const i = form.movementSeq++;
    const v = m || {};
    const measure = v.measure || 'reps';
    return `
      <div class="cf-ex" data-mv="${i}">
        <div class="cf-ex-head">
          <div class="mx-well mx-well--text"><input type="text" class="cf-mv-name" list="fxMovementNames" autocomplete="off" placeholder="Movement" aria-label="Movement name" value="${esc(v.exerciseName || '')}"></div>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost cf-mv-remove" aria-label="Remove movement"><span class="ui-icon">${icon('x')}</span></button>
        </div>
        <div class="mx-grid3 cf-ex-grid">
          <div class="mx-field">
            <label class="mx-lbl">Sets/rds</label>
            <div class="mx-well mx-well--num cf-num"><input type="number" class="cf-mv-sets" placeholder="—" min="0" inputmode="numeric" value="${v.sets || ''}"></div>
          </div>
          <div class="mx-field">
            <label class="mx-lbl"><select class="cf-mv-measure" aria-label="Measure">
              ${['reps', 'm', 'cal', 'sec'].map(o => `<option value="${o}"${o === measure ? ' selected' : ''}>${o === 'reps' ? 'Reps' : o === 'm' ? 'Metres' : o === 'cal' ? 'Cals' : 'Secs'}</option>`).join('')}
            </select></label>
            <div class="mx-well mx-well--num cf-num"><input type="number" class="cf-mv-reps" placeholder="—" min="0" inputmode="numeric" value="${v.reps || ''}"></div>
          </div>
          <div class="mx-field">
            <label class="mx-lbl">Load <em class="fx-unit-lbl">${unit()}</em></label>
            <div class="mx-well mx-well--num cf-num"><input type="number" class="cf-mv-weight" placeholder="—" min="0" step="0.5" inputmode="decimal" value="${v.weight || ''}"></div>
          </div>
        </div>
      </div>`;
  }

  function addMovement(m) {
    const box = $('cfExercisesContainer');
    if (!box) return;
    box.insertAdjacentHTML('beforeend', movementRow(m));
    updateMovementCount();
  }

  function updateMovementCount() {
    const n = document.querySelectorAll('#cfExercisesContainer .cf-ex').length;
    if ($('cfExCount')) $('cfExCount').textContent = n ? `${n} movement${n === 1 ? '' : 's'}` : '';
  }

  function readMovements() {
    return Array.from(document.querySelectorAll('#cfExercisesContainer .cf-ex')).map(row => {
      const name = row.querySelector('.cf-mv-name').value.trim();
      if (!name) return null;
      const m = {
        exerciseName: name,
        sets: Number(row.querySelector('.cf-mv-sets').value) || 0,
        reps: Number(row.querySelector('.cf-mv-reps').value) || 0,
        weight: Number(row.querySelector('.cf-mv-weight').value) || 0,
      };
      const measure = row.querySelector('.cf-mv-measure').value;
      if (measure !== 'reps') m.measure = measure;
      if (m.weight) m.unit = unit();
      return m;
    }).filter(Boolean);
  }

  function fillMovements(list) {
    const box = $('cfExercisesContainer');
    if (!box) return;
    box.innerHTML = '';
    (list || []).forEach(m => addMovement({ ...m, exerciseName: m.exerciseName || m.exercise || m.name || '' }));
    updateMovementCount();
  }

  function clearForm() {
    ['cfWorkoutName', 'cfMinutes', 'cfSeconds', 'cfRounds', 'cfScoreReps', 'cfScoreLoad', 'cfScoreRepsOnly', 'cfDuration', 'cfNotes']
      .forEach(id => { if ($(id)) $(id).value = ''; });
    if ($('cfCapped')) $('cfCapped').checked = false;
    if ($('cfDate')) $('cfDate').value = todayKey();
    form.rpe = null;
    setRpe(null);
    setRx(true);
    setFormat('fortime');
    fillMovements([]);
    setEditing(null);
    onNameChange();
  }

  function setEditing(entry) {
    form.editing = entry;
    if ($('fxEditBanner')) $('fxEditBanner').hidden = !entry;
    if ($('cfSaveLabel')) $('cfSaveLabel').textContent = entry ? 'Update Workout' : 'Save Workout';
  }

  // Loads an entry (or template) into the form.
  function loadIntoForm(e, { asEdit } = {}) {
    clearForm();
    $('cfWorkoutName').value = e.name || '';
    if (asEdit && e.date) $('cfDate').value = e.date;
    setFormat(e.format || (C.inferScoreType(e) === 'amrap' ? 'amrap' : C.inferScoreType(e) === 'load' ? 'strength' : C.inferScoreType(e) === 'time' ? 'fortime' : 'other'));
    setRx(e.rx !== false);
    if (asEdit) {
      if (e.minutes) $('cfMinutes').value = e.minutes;
      if (e.seconds) $('cfSeconds').value = e.seconds;
      if (e.rounds) $('cfRounds').value = e.rounds;
      const type = C.inferScoreType(e);
      if (e.scoreReps) $(type === 'reps' ? 'cfScoreRepsOnly' : 'cfScoreReps').value = e.scoreReps;
      if (e.scoreLoad) $('cfScoreLoad').value = e.scoreLoad;
      if (e.durationMin) $('cfDuration').value = e.durationMin;
      $('cfCapped').checked = !!e.capped;
      if (e.rpe) setRpe(Number(e.rpe));
      $('cfNotes').value = e.notes || '';
    }
    fillMovements(e.exercises || []);
    if (asEdit) setEditing(e);
    onNameChange();
  }

  function buildEntryFromForm() {
    const name = $('cfWorkoutName').value.trim();
    if (!name) { toast('Give the workout a name', 'warn'); $('cfWorkoutName').focus(); return null; }
    const b = C.findBenchmark(name);
    const type = scoreTypeForForm();
    const minutes = Math.max(0, parseInt($('cfMinutes').value, 10) || 0);
    const seconds = Math.min(59, Math.max(0, parseInt($('cfSeconds').value, 10) || 0));
    const entry = {
      id: (form.editing && form.editing.id) || C.newId('w'),
      date: $('cfDate').value || todayKey(),
      name: b ? b.name : name,
      format: form.format,
      scoreType: type,
      minutes: type === 'time' ? minutes : 0,
      seconds: type === 'time' ? seconds : 0,
      rounds: type === 'amrap' ? (parseInt($('cfRounds').value, 10) || 0) : 0,
      notes: $('cfNotes').value.trim(),
      exercises: readMovements(),
      rx: form.rx,
      source: 'wod',
    };
    if (b) entry.benchmark = b.key;
    if (type === 'time' && $('cfCapped').checked) entry.capped = true;
    if (type === 'amrap') entry.scoreReps = parseInt($('cfScoreReps').value, 10) || 0;
    if (type === 'reps') entry.scoreReps = parseInt($('cfScoreRepsOnly').value, 10) || 0;
    if (type === 'load') { entry.scoreLoad = parseFloat($('cfScoreLoad').value) || 0; entry.unit = unit(); }
    const dur = parseInt($('cfDuration').value, 10) || 0;
    if (dur && (type === 'none' || type === 'amrap')) entry.durationMin = dur;
    if (form.rpe) entry.rpe = form.rpe;
    if (type !== 'none' && C.scoreValue(entry) == null && !entry.exercises.length) {
      toast('Add a score or at least one movement', 'warn');
      return null;
    }
    return entry;
  }

  function saveWorkout() {
    const entry = buildEntryFromForm();
    if (!entry) return;
    const log = read('log', []);
    const editing = form.editing;
    if (editing) {
      const idx = log.findIndex(e => e === editing || (editing.id && e.id === editing.id) ||
        (!editing.id && JSON.stringify(e) === JSON.stringify(editing)));
      if (idx >= 0) log.splice(idx, 1, entry); else log.push(entry);
    } else {
      log.push(entry);
    }
    log.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!write('log', log)) return;

    entry.exercises.forEach(m => { try { if (typeof window.saveUserExercise === 'function') window.saveUserExercise(m.exerciseName); } catch (_) { /* optional */ } });

    const prev = C.previousBest(log, entry);
    const pr = prev && C.scoreValue(entry) != null && C.scoreValue(entry) > C.scoreValue(prev);
    const first = !prev && C.scoreValue(entry) != null && C.workoutKey(entry);
    if (pr) { toast(`New PR on ${entry.name}: ${C.formatScore(entry, unit())} (was ${C.formatScore(prev, unit())})`, 'success'); haptic(); }
    else if (first && entry.benchmark) toast(`${entry.name} baseline set: ${C.formatScore(entry, unit())}`, 'success');
    else toast(editing ? 'Workout updated' : 'Workout saved', 'success');

    clearForm();
    refreshAll();
    if (typeof window.syncCrossfitToBackend === 'function') window.syncCrossfitToBackend(user()).catch(() => {});
  }

  function repeatLast() {
    const log = read('log', []).filter(e => e.source !== 'circuit');
    const last = log[log.length - 1];
    if (!last) { toast('No workouts logged yet', 'warn'); return; }
    loadIntoForm(last);
    toast(`Loaded ${last.name} — enter today's score`, 'success');
  }

  /* ── Templates ─────────────────────────────────────────────── */

  function loadTemplates() {
    let list = read('templates', []);
    // One-time move of the old shared `crossfitTemplates` key into this account.
    try {
      const legacy = JSON.parse(localStorage.getItem('crossfitTemplates') || '[]');
      if (Array.isArray(legacy) && legacy.length && user()) {
        list = C.migrateTemplates(legacy, list);
        write('templates', list);
        localStorage.removeItem('crossfitTemplates');
      }
    } catch (_) { /* ignore bad legacy data */ }
    return list;
  }

  function renderTemplateOptions() {
    const sel = $('crossfitTemplateSelect');
    if (!sel) return;
    const list = loadTemplates();
    const current = sel.value;
    sel.innerHTML = '<option value="">-- Saved workouts --</option>' +
      list.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    if (list.some(t => t.id === current)) sel.value = current;
    if ($('cfDeleteTemplate')) $('cfDeleteTemplate').hidden = !sel.value;
    renderNameSuggestions();
  }

  function saveTemplate() {
    const name = $('cfWorkoutName').value.trim();
    const exercises = readMovements();
    if (!name) { toast('Name the workout first', 'warn'); return; }
    if (!exercises.length) { toast('Add at least one movement', 'warn'); return; }
    const list = loadTemplates();
    const existing = list.find(t => C.norm(t.name) === C.norm(name));
    const tpl = { id: existing ? existing.id : C.newId('t'), name, format: form.format, rx: form.rx, exercises, notes: $('cfNotes').value.trim() };
    if (existing) list.splice(list.indexOf(existing), 1, tpl); else list.push(tpl);
    if (!write('templates', list)) return;
    renderTemplateOptions();
    $('crossfitTemplateSelect').value = tpl.id;
    if ($('cfDeleteTemplate')) $('cfDeleteTemplate').hidden = false;
    toast(existing ? 'Template updated' : 'Template saved', 'success');
  }

  function applyTemplate() {
    const id = $('crossfitTemplateSelect').value;
    if ($('cfDeleteTemplate')) $('cfDeleteTemplate').hidden = !id;
    if (!id) return;
    const tpl = loadTemplates().find(t => t.id === id);
    if (!tpl) return;
    loadIntoForm({ ...tpl, notes: '' });
    if (tpl.notes) $('cfNotes').value = tpl.notes;
  }

  function deleteTemplate() {
    const id = $('crossfitTemplateSelect').value;
    if (!id) return;
    const list = loadTemplates();
    const tpl = list.find(t => t.id === id);
    if (!tpl || !window.confirm(`Delete the “${tpl.name}” template?`)) return;
    write('templates', list.filter(t => t.id !== id));
    renderTemplateOptions();
    toast('Template deleted');
  }

  function renderNameSuggestions() {
    const dl = $('fxWorkoutNames');
    if (dl) {
      const names = new Set();
      C.BENCHMARKS.forEach(b => names.add(b.name));
      read('templates', []).forEach(t => names.add(t.name));
      read('log', []).forEach(e => { if (e.name && e.source !== 'circuit') names.add(e.name); });
      dl.innerHTML = Array.from(names).map(n => `<option value="${esc(n)}"></option>`).join('');
    }
    const mv = $('fxMovementNames');
    if (mv) {
      const names = new Set(C.MOVEMENTS);
      try { (JSON.parse(localStorage.getItem(`exercises_${user()}`) || '[]') || []).forEach(n => names.add(n)); } catch (_) { /* ignore */ }
      mv.innerHTML = Array.from(names).map(n => `<option value="${esc(n)}"></option>`).join('');
    }
  }

  /* ── Recent list on the WOD tab ─────────────────────────────── */

  function wodRowHtml(e, idx, log, opts) {
    const o = opts || {};
    const type = C.inferScoreType(e);
    const pr = C.isPR(log, e);
    const tags = (e.exercises || []).map(m => {
      const measure = m.measure && m.measure !== 'reps' ? ' ' + m.measure : '';
      const amount = m.sets && m.reps ? `${m.sets}×${m.reps}${measure}` : (m.reps ? `${m.reps}${measure}` : (m.sets ? `${m.sets} sets` : ''));
      const load = m.weight ? ` @ ${m.weight}${m.unit || unit()}` : '';
      return `<span class="mx-tag">${esc(m.exerciseName || m.exercise || '')}${amount ? ' · ' + esc(amount) : ''}${esc(load)}</span>`;
    }).join('');
    const chips = [
      pr ? '<span class="mx-chip mx-chip--green mx-chip--sm">PR</span>' : '',
      e.source === 'circuit' ? '<span class="mx-chip mx-chip--sm">Circuit</span>' : '',
      e.benchmark ? '<span class="mx-chip mx-chip--brass mx-chip--sm">Benchmark</span>' : '',
      e.rx === false ? '<span class="mx-chip mx-chip--sm">Scaled</span>' : '',
      e.rpe ? `<span class="mx-chip mx-chip--sm">RPE ${esc(e.rpe)}</span>` : '',
    ].join('');
    const fmtLabel = e.format && C.FORMATS[e.format] && type !== 'none' ? C.FORMATS[e.format].label : (e.source === 'circuit' ? '' : '');
    return `
      <article class="mx-row cf-wod" data-idx="${idx}">
        ${dateBlock(e.date)}
        <div class="mx-row-main">
          <div class="cf-wod-top">
            <span class="mx-row-title">${esc(e.name || 'Workout')}</span>
            <span class="mx-row-big">${esc(C.formatScore(e, e.unit || unit()))}</span>
          </div>
          ${chips || fmtLabel ? `<div class="fx-chips">${chips}${fmtLabel ? `<span class="mx-row-sm">${esc(fmtLabel)}</span>` : ''}</div>` : ''}
          ${tags && !o.compact ? `<div class="mx-tags">${tags}</div>` : ''}
          ${e.notes && !o.compact ? `<div class="cf-wod-notes">${esc(e.notes)}</div>` : ''}
        </div>
        <div class="fx-row-actions">
          ${e.source !== 'circuit' ? `<button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-act="edit-wod" data-idx="${idx}" aria-label="Edit ${esc(e.name)}"><span class="ui-icon">${icon('pencil')}</span></button>` : ''}
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-act="del-wod" data-idx="${idx}" aria-label="Delete ${esc(e.name)}"><span class="ui-icon">${icon('x')}</span></button>
        </div>
      </article>`;
  }

  function renderRecent() {
    const box = $('cfWorkoutsContainer');
    if (!box) return;
    const log = read('log', []);
    if (!log.length) { box.innerHTML = '<div class="mx-empty">No workouts logged yet. Try a benchmark like Fran or Cindy to set a baseline.</div>'; return; }
    const rows = log.map((e, i) => ({ e, i })).sort((a, b) => String(b.e.date).localeCompare(String(a.e.date)) || b.i - a.i).slice(0, 5);
    box.innerHTML = rows.map(({ e, i }) => wodRowHtml(e, i, log)).join('');
  }

  function editWod(idx) {
    const log = read('log', []);
    const e = log[idx];
    if (!e) return;
    showSub('wod');
    loadIntoForm(e, { asEdit: true });
    $('fxLogPod')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function deleteWod(idx) {
    const log = read('log', []);
    const e = log[idx];
    if (!e || !window.confirm(`Delete ${e.name || 'this workout'} from ${fmtDate(e.date)}?`)) return;
    log.splice(idx, 1);
    write('log', log);
    if (form.editing && (form.editing === e || form.editing.id === e.id)) clearForm();
    refreshAll();
    toast('Workout deleted');
  }

  /* ══ Benchmarks & PRs ═══════════════════════════════════════ */

  let benchFilter = '';
  let benchChart = null;

  function renderBenchmarks() {
    const list = $('fxBenchList');
    if (!list) return;
    const board = C.workoutBoard(read('log', []));
    const byKey = new Map(board.map(r => [r.key, r]));
    const rows = [];
    C.BENCHMARKS.forEach(b => rows.push(byKey.get(b.key) || { key: b.key, name: b.name, type: b.type, benchmark: b, count: 0, best: null, last: null, attempts: [] }));
    board.filter(r => !r.benchmark && r.count >= 1).forEach(r => rows.push(r));

    const filtered = rows.filter(r => {
      if (!benchFilter) return true;
      if (benchFilter === 'mine') return r.count > 0;
      return r.benchmark && r.benchmark.group === benchFilter;
    }).sort((a, b) => (b.count > 0) - (a.count > 0));

    if (!filtered.length) { list.innerHTML = '<div class="mx-empty">Nothing here yet — log a benchmark to set your first PR.</div>'; return; }
    const mineCustom = filtered.filter(r => !r.benchmark);
    const html = filtered.filter(r => r.benchmark).map(benchRow).join('') +
      (mineCustom.length ? `<div class="mx-kicker fx-sec">Your workouts</div>${mineCustom.map(benchRow).join('')}` : '');
    list.innerHTML = html;
  }

  function benchRow(r) {
    const best = r.best ? C.formatScore(r.best, r.best.unit || unit()) : '';
    const sub = r.benchmark ? r.benchmark.desc : `${r.count} attempt${r.count === 1 ? '' : 's'}`;
    return `
      <button type="button" class="mx-row fx-bench-row" data-bench="${esc(r.key)}">
        <div class="mx-row-main">
          <span class="mx-row-title">${esc(r.name)}</span>
          <span class="mx-row-sub">${esc(sub)}</span>
        </div>
        <div class="mx-row-right">
          ${best ? `<span class="mx-row-big">${esc(best)}</span><span class="mx-row-sm">${r.count}× · best</span>` : '<span class="mx-row-sm">Not done</span>'}
        </div>
      </button>`;
  }

  function openBenchmark(key) {
    const pod = $('fxBenchDetail');
    if (!pod) return;
    const log = read('log', []);
    const row = C.workoutBoard(log).find(r => r.key === key);
    const b = C.findBenchmark(key);
    const name = (row && row.name) || (b && b.name) || 'Workout';
    const attempts = row ? row.attempts : [];
    const best = row && row.best;
    const u = (best && best.unit) || unit();
    pod.hidden = false;
    pod.innerHTML = `
      <div class="pod-row">
        <h3 class="pod-title mx-h3">${esc(name)}</h3>
        <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-act="close-bench" aria-label="Close"><span class="ui-icon">${icon('x')}</span></button>
      </div>
      ${b ? `<p class="mx-sub">${esc(b.desc)}</p>` : ''}
      <div class="mx-tiles">
        <div class="mx-stat"><span class="mx-stat-l">Best</span><span class="mx-stat-v">${best ? esc(C.formatScore(best, u)) : '—'}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">Last</span><span class="mx-stat-v">${row && row.last ? esc(C.formatScore(row.last, u)) : '—'}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">Attempts</span><span class="mx-stat-v">${attempts.length}</span></div>
      </div>
      <div class="fx-chart-wrap"${attempts.length > 1 ? '' : ' hidden'}><canvas id="fxBenchChart" height="190"></canvas></div>
      <div class="fx-bench-attempts">${attempts.slice().reverse().map(a => {
        const isBest = a === best;
        return `<div class="mx-row"><div class="mx-row-main"><span class="mx-row-title">${esc(fmtDate(a.date))}</span>
          <span class="mx-row-sub">${a.rx === false ? 'Scaled' : 'Rx'}${a.rpe ? ' · RPE ' + esc(a.rpe) : ''}${a.notes ? ' · ' + esc(a.notes) : ''}</span></div>
          <div class="mx-row-right"><span class="mx-row-big">${esc(C.formatScore(a, a.unit || u))}</span>${isBest ? '<span class="mx-chip mx-chip--green mx-chip--sm">Best</span>' : ''}</div></div>`;
      }).join('') || '<div class="mx-empty">No attempts yet.</div>'}</div>
      <button type="button" class="mx-cta" data-act="log-bench" data-name="${esc(name)}">
        <span>Log ${esc(name)}</span>
        <span class="mx-cta-icon"><span class="ui-icon">${icon('plus')}</span></span>
      </button>`;
    drawBenchChart(attempts, (row && row.type) || (b && b.type));
    pod.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawBenchChart(attempts, type) {
    const canvas = $('fxBenchChart');
    if (benchChart) { try { benchChart.destroy(); } catch (_) { /* gone */ } benchChart = null; }
    if (!canvas || typeof window.Chart === 'undefined' || attempts.length < 2) return;
    let items = attempts.filter(a => C.scoreValue(a) != null && !a.capped);
    if (window.PlanLimits && typeof window.PlanLimits.clipHistory === 'function') {
      const clipped = window.PlanLimits.clipHistory(items, a => a.date);
      items = clipped.items;
      if (typeof window.PlanLimits.setHistoryNote === 'function') window.PlanLimits.setHistoryNote(canvas, 'fxBenchHistoryNote', clipped.hidden);
    }
    if (items.length < 2) { canvas.parentElement.hidden = true; return; }
    canvas.parentElement.hidden = false;
    const isTime = type === 'time';
    const data = items.map(a => (isTime ? C.entrySeconds(a) / 60 : type === 'amrap' ? (Number(a.rounds) || 0) + (Number(a.scoreReps) || 0) / 100 : C.scoreValue(a)));
    const P = window.CHART_PALETTE || {};
    benchChart = new window.Chart(canvas, {
      type: 'line',
      data: { labels: items.map(a => fmtDate(a.date, { day: 'numeric', month: 'short' })), datasets: [{
        data, borderColor: P.primary || '#3d9d73', backgroundColor: 'rgba(61,157,115,0.12)', pointBackgroundColor: P.primary || '#3d9d73', tension: 0.3, fill: true,
      }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => isTime ? C.fmtTime(ctx.parsed.y * 60) : String(ctx.parsed.y) } } },
        scales: {
          x: { ticks: { color: P.textMuted || '#8c9891' }, grid: { color: P.grid || 'rgba(132,157,144,0.15)' } },
          y: { reverse: isTime, ticks: { color: P.textMuted || '#8c9891', callback: v => (isTime ? C.fmtTime(v * 60) : v) }, grid: { color: P.grid || 'rgba(132,157,144,0.15)' } },
        },
      },
    });
  }

  /* ══ HYROX ══════════════════════════════════════════════════ */

  const hyrox = { editing: null };
  let hyroxChart = null;

  function renderStationInputs() {
    const box = $('hyroxStations');
    if (!box || box.childElementCount) return;
    const rows = C.HYROX_STATIONS.map((s, i) => `
      <div class="hyrox-station" data-kind="${s.kind}" data-field="${s.field}">
        <span class="hyrox-station-num">${i + 1}</span>
        <span class="hyrox-station-name">${esc(s.label)}<small class="hyrox-station-meta">${esc(s.detail || '')}</small></span>
        <span class="hyrox-delta" data-delta="${s.field}"></span>
        <div class="mx-tin"><input type="text" class="hyrox-time-input" placeholder="mm:ss" inputmode="numeric" autocomplete="off" aria-label="Time for ${i + 1}, ${esc(s.label)}" data-field="${s.field}"></div>
      </div>`).join('');
    box.innerHTML = rows + `
      <div class="hyrox-station" data-kind="rox" data-field="roxzone">
        <span class="hyrox-station-num">R</span>
        <span class="hyrox-station-name">Roxzone<small>Transitions, total · optional</small></span>
        <span class="hyrox-delta" data-delta="roxzone"></span>
        <div class="mx-tin"><input type="text" class="hyrox-time-input" placeholder="mm:ss" inputmode="numeric" autocomplete="off" aria-label="Roxzone total time" data-field="roxzone"></div>
      </div>`;
    box.addEventListener('input', calcHyroxTotal);
    box.addEventListener('focusout', e => {
      const inp = e.target.closest('.hyrox-time-input');
      if (!inp || !inp.value.trim()) return;
      const s = C.parseTime(inp.value);
      inp.value = s ? C.fmtTime(s) : '';
      calcHyroxTotal();
    });
  }

  function paintDivisionLoads() {
    const race = read('race', null);
    const div = C.HYROX_DIVISIONS[(race && race.division) || ''] || null;
    document.querySelectorAll('#hyroxStations .hyrox-station').forEach(row => {
      const s = C.HYROX_STATIONS.find(x => x.field === row.dataset.field);
      const meta = row.querySelector('.hyrox-station-meta');
      if (!s || !meta) return;
      const load = div && div[s.field];
      meta.textContent = [s.detail, load].filter(Boolean).join(' · ');
    });
  }

  function readSplits() {
    const st = {};
    document.querySelectorAll('#hyroxStations .hyrox-time-input').forEach(inp => {
      const v = C.parseTime(inp.value);
      if (v > 0) st[inp.dataset.field] = v;
    });
    return st;
  }

  function calcHyroxTotal() {
    const st = readSplits();
    const { splits: bests } = C.hyroxBests(read('hyrox', []).filter(s => !hyrox.editing || s.ts !== hyrox.editing.ts));
    let runSecs = 0, runCount = 0, stnSecs = 0, done = 0;
    C.HYROX_STATIONS.forEach(s => {
      const v = st[s.field];
      const row = document.querySelector(`#hyroxStations .hyrox-station[data-field="${s.field}"]`);
      if (row) row.classList.toggle('is-done', !!v);
      if (!v) return;
      done++;
      if (s.kind === 'run') { runSecs += v; runCount++; } else stnSecs += v;
    });
    document.querySelectorAll('#hyroxStations [data-delta]').forEach(el => {
      const f = el.dataset.delta;
      const v = st[f];
      const b = bests[f];
      if (!v || !b) { el.textContent = ''; el.className = 'hyrox-delta'; return; }
      const d = v - b;
      el.textContent = C.fmtDelta(d);
      el.className = 'hyrox-delta ' + (d < 0 ? 'is-faster' : d > 0 ? 'is-slower' : '');
    });
    const total = C.simTotal(st);
    const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
    set('hyroxTotal', total ? C.fmtTime(total) : '—');
    set('hyroxDone', `${done} of ${C.HYROX_STATIONS.length}`);
    set('hyroxRunTotal', runCount ? C.fmtTime(runSecs) : '—');
    set('hyroxStnTotal', stnSecs ? C.fmtTime(stnSecs) : '—');
    set('hyroxAvgRun', runCount ? C.fmtTime(Math.round(runSecs / runCount)) : '—');
    const fill = $('hyroxMeterFill');
    if (fill) fill.style.width = Math.round(done / C.HYROX_STATIONS.length * 100) + '%';
  }

  function clearHyroxForm() {
    document.querySelectorAll('#hyroxStations .hyrox-time-input').forEach(i => { i.value = ''; });
    if ($('hyroxNotes')) $('hyroxNotes').value = '';
    if ($('hyroxDate')) $('hyroxDate').value = todayKey();
    if ($('hyroxKind')) $('hyroxKind').value = 'sim';
    hyrox.editing = null;
    if ($('hyroxSaveLabel')) $('hyroxSaveLabel').textContent = 'Save Simulation';
    if ($('hyroxSimTitle')) $('hyroxSimTitle').textContent = 'Log a Simulation';
    if ($('hyroxCancelEdit')) $('hyroxCancelEdit').hidden = true;
    calcHyroxTotal();
  }

  function saveHyroxSimulation() {
    if (!user()) return;
    const stations = readSplits();
    const total = C.simTotal(stations);
    if (!total) { toast('Enter at least one split first', 'warn'); return; }
    const log = read('hyrox', []);
    const editing = hyrox.editing;
    const prevBest = C.hyroxBests(log.filter(s => !editing || s.ts !== editing.ts)).bestTotal;
    const entry = {
      date: $('hyroxDate')?.value || todayKey(),
      stations,
      total,
      ts: editing ? editing.ts : Date.now(),
      kind: $('hyroxKind')?.value || 'sim',
    };
    const race = read('race', null);
    if (race && race.division) entry.division = race.division;
    const notes = $('hyroxNotes')?.value.trim();
    if (notes) entry.notes = notes;

    const idx = editing ? log.findIndex(s => s.ts === editing.ts) : -1;
    if (idx >= 0) log.splice(idx, 1, entry); else log.unshift(entry);
    log.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.ts - a.ts));
    if (!write('hyrox', log)) return;

    if (C.isFullSim(entry) && prevBest && total < prevBest.total) {
      toast(`New HYROX PR: ${C.fmtTime(total)} (−${C.fmtTime(prevBest.total - total)})`, 'success'); haptic();
    } else {
      toast(editing ? 'Simulation updated' : 'HYROX simulation saved', 'success');
    }
    clearHyroxForm();
    refreshAll();
  }

  function editHyrox(ts) {
    const sim = read('hyrox', []).find(s => s.ts === ts);
    if (!sim) return;
    clearHyroxForm();
    hyrox.editing = sim;
    document.querySelectorAll('#hyroxStations .hyrox-time-input').forEach(inp => {
      const v = Number(sim.stations && sim.stations[inp.dataset.field]);
      inp.value = v > 0 ? C.fmtTime(v) : '';
    });
    if ($('hyroxDate')) $('hyroxDate').value = sim.date || todayKey();
    if ($('hyroxKind')) $('hyroxKind').value = sim.kind || 'sim';
    if ($('hyroxNotes')) $('hyroxNotes').value = sim.notes || '';
    if ($('hyroxSaveLabel')) $('hyroxSaveLabel').textContent = 'Update Simulation';
    if ($('hyroxSimTitle')) $('hyroxSimTitle').textContent = 'Edit Simulation';
    if ($('hyroxCancelEdit')) $('hyroxCancelEdit').hidden = false;
    calcHyroxTotal();
    $('hyroxStations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function deleteHyrox(tsOrIndex) {
    const log = read('hyrox', []);
    // Older builds passed the list index.
    let idx = log.findIndex(s => s.ts === tsOrIndex);
    if (idx < 0 && Number.isInteger(tsOrIndex) && tsOrIndex < log.length) idx = tsOrIndex;
    const sim = log[idx];
    if (!sim || !window.confirm(`Delete the simulation from ${fmtDate(sim.date)}?`)) return;
    log.splice(idx, 1);
    write('hyrox', log);
    if (hyrox.editing && hyrox.editing.ts === sim.ts) clearHyroxForm();
    refreshAll();
    toast('Simulation deleted');
  }

  function renderHyroxHistory() {
    const box = $('hyroxHistory');
    if (!box) return;
    const log = read('hyrox', []);
    if (!log.length) { box.innerHTML = '<div class="mx-empty">No simulations logged yet.</div>'; return; }
    const { bestTotal } = C.hyroxBests(log);
    const kinds = { sim: 'Simulation', race: 'Race', half: 'Half sim' };
    box.innerHTML = log.map(sim => {
      const st = sim.stations || {};
      const done = C.HYROX_STATIONS.filter(s => Number(st[s.field]) > 0).length;
      const runs = C.HYROX_STATIONS.filter(s => s.kind === 'run' && Number(st[s.field]) > 0).map(s => Number(st[s.field]));
      const avgRun = runs.length ? C.fmtTime(Math.round(runs.reduce((a, b) => a + b, 0) / runs.length)) : null;
      const total = Number(sim.total) || C.simTotal(st);
      const isBest = bestTotal && bestTotal.sim.ts === sim.ts;
      const gap = bestTotal && C.isFullSim(sim) && !isBest ? '+' + C.fmtTime(total - bestTotal.total) : '';
      return `
        <div class="mx-row hyrox-hist-row">
          ${dateBlock(sim.date)}
          <div class="mx-row-main">
            <span class="mx-row-title">${esc(kinds[sim.kind] || 'Simulation')}${sim.division && C.HYROX_DIVISIONS[sim.division] ? ' · ' + esc(C.HYROX_DIVISIONS[sim.division].label) : ''}</span>
            <span class="mx-row-sub">${done}/16 segments${avgRun ? ' · avg run ' + avgRun + ' /km' : ''}${sim.notes ? ' · ' + esc(sim.notes) : ''}</span>
          </div>
          <div class="mx-row-right"><span class="mx-row-big">${C.fmtTime(total)}</span>${isBest ? '<span class="mx-chip mx-chip--green mx-chip--sm">Best</span>' : (gap ? `<span class="mx-row-sm">${gap}</span>` : '')}</div>
          <div class="fx-row-actions">
            <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-act="edit-hyrox" data-ts="${sim.ts}" aria-label="Edit simulation from ${esc(sim.date)}"><span class="ui-icon">${icon('pencil')}</span></button>
            <button type="button" class="mx-iconbtn mx-iconbtn--ghost hyrox-hist-delete" data-act="del-hyrox" data-ts="${sim.ts}" aria-label="Delete simulation from ${esc(sim.date)}"><span class="ui-icon">${icon('x')}</span></button>
          </div>
        </div>`;
    }).join('');
  }

  function renderHyroxBests() {
    const box = $('hyroxBests');
    if (!box) return;
    const log = read('hyrox', []);
    const { splits, bestTotal } = C.hyroxBests(log);
    if ($('hyroxBestTotal')) $('hyroxBestTotal').textContent = bestTotal ? `Best full: ${C.fmtTime(bestTotal.total)}` : '';
    if (!Object.keys(splits).length) { box.innerHTML = '<div class="mx-empty">Your best split for every station shows up here.</div>'; return; }
    const runs = C.HYROX_STATIONS.filter(s => s.kind === 'run').map(s => splits[s.field]).filter(Boolean);
    const bestRun = runs.length ? Math.min(...runs) : 0;
    const stations = C.HYROX_STATIONS.filter(s => s.kind === 'station');
    const sumBest = C.HYROX_STATIONS.every(s => splits[s.field]) ? C.HYROX_STATIONS.reduce((a, s) => a + splits[s.field], 0) + (splits.roxzone || 0) : 0;
    box.innerHTML = `
      <div class="mx-tiles mx-tiles--2">
        <div class="mx-stat"><span class="mx-stat-l">Fastest 1 km</span><span class="mx-stat-v">${bestRun ? C.fmtTime(bestRun) : '—'}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">Sum of bests</span><span class="mx-stat-v">${sumBest ? C.fmtTime(sumBest) : '—'}</span></div>
      </div>
      <div class="fx-best-grid">${stations.map(s => `
        <div class="fx-best"><span class="mx-lbl">${esc(s.label)}</span><b>${splits[s.field] ? C.fmtTime(splits[s.field]) : '—'}</b></div>`).join('')}
        <div class="fx-best"><span class="mx-lbl">Roxzone</span><b>${splits.roxzone ? C.fmtTime(splits.roxzone) : '—'}</b></div>
      </div>`;
  }

  function renderHyroxChart() {
    const canvas = $('hyroxChart');
    const empty = $('hyroxChartEmpty');
    if (hyroxChart) { try { hyroxChart.destroy(); } catch (_) { /* gone */ } hyroxChart = null; }
    let full = read('hyrox', []).filter(C.isFullSim).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (window.PlanLimits && typeof window.PlanLimits.clipHistory === 'function' && canvas) {
      const clipped = window.PlanLimits.clipHistory(full, s => s.date);
      full = clipped.items;
      if (typeof window.PlanLimits.setHistoryNote === 'function') window.PlanLimits.setHistoryNote(canvas, 'hyroxHistoryNote', clipped.hidden);
    }
    const show = full.length >= 2 && canvas && typeof window.Chart !== 'undefined';
    if (canvas) canvas.parentElement.hidden = !show;
    if (empty) empty.hidden = !!show;
    if (!show) return;
    const P = window.CHART_PALETTE || {};
    const race = read('race', null);
    const goal = race && C.parseTime(race.goal);
    const datasets = [{
      label: 'Finish', data: full.map(s => (Number(s.total) || C.simTotal(s.stations)) / 60),
      borderColor: P.primary || '#3d9d73', backgroundColor: 'rgba(61,157,115,0.12)', pointBackgroundColor: P.primary || '#3d9d73', tension: 0.3, fill: true,
    }];
    if (goal) datasets.push({ label: 'Goal', data: full.map(() => goal / 60), borderColor: P.gold || '#c79a54', borderDash: [6, 4], pointRadius: 0, fill: false });
    hyroxChart = new window.Chart(canvas, {
      type: 'line',
      data: { labels: full.map(s => fmtDate(s.date, { day: 'numeric', month: 'short' })), datasets },
      options: {
        responsive: true,
        plugins: { legend: { display: !!goal, labels: { color: P.textMuted || '#8c9891' } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${C.fmtTime(ctx.parsed.y * 60)}` } } },
        scales: {
          x: { ticks: { color: P.textMuted || '#8c9891' }, grid: { color: P.grid || 'rgba(132,157,144,0.15)' } },
          y: { reverse: true, ticks: { color: P.textMuted || '#8c9891', callback: v => C.fmtTime(v * 60) }, grid: { color: P.grid || 'rgba(132,157,144,0.15)' } },
        },
      },
    });
  }

  function renderRaceForm() {
    const sel = $('hyroxDivision');
    if (sel && !sel.childElementCount) {
      sel.innerHTML = '<option value="">-- Select --</option>' +
        Object.keys(C.HYROX_DIVISIONS).map(k => `<option value="${k}">${esc(C.HYROX_DIVISIONS[k].label)}</option>`).join('');
    }
    const race = read('race', null) || {};
    if ($('hyroxRaceDate') && document.activeElement !== $('hyroxRaceDate')) $('hyroxRaceDate').value = race.date || '';
    if ($('hyroxGoal') && document.activeElement !== $('hyroxGoal')) $('hyroxGoal').value = race.goal ? C.fmtTime(C.parseTime(race.goal)) : '';
    if (sel) sel.value = race.division || '';
    if ($('hyroxRaceName')) $('hyroxRaceName').value = race.name || '';
  }

  function saveRacePlan() {
    const goalSec = C.parseTime($('hyroxGoal')?.value);
    const plan = {
      date: $('hyroxRaceDate')?.value || '',
      goal: goalSec ? C.fmtTime(goalSec) : '',
      division: $('hyroxDivision')?.value || '',
      name: $('hyroxRaceName')?.value.trim() || '',
    };
    if (!plan.date && !plan.goal && !plan.division) { toast('Add a race date, goal or division', 'warn'); return; }
    if (!write('race', plan)) return;
    toast('Race plan saved', 'success');
    refreshAll();
  }

  function renderRacePlan() {
    const box = $('hyroxRacePlan');
    const chip = $('hyroxRaceChip');
    if (!box) return;
    const race = read('race', null);
    if (!race) { box.innerHTML = ''; if (chip) chip.hidden = true; return; }
    const days = C.daysUntil(race.date, todayKey());
    const phase = C.racePhase(days);
    if (chip) {
      chip.hidden = days == null;
      chip.textContent = days == null ? '' : days < 0 ? 'Done' : days === 0 ? 'Race day' : `${Math.floor(days / 7)}w ${days % 7}d out`;
    }
    const goalSec = C.parseTime(race.goal);
    const plan = goalSec ? C.pacePlan(goalSec, read('hyrox', [])) : null;
    const { splits: bests } = C.hyroxBests(read('hyrox', []));
    let planHtml = '';
    if (plan) {
      const rows = [...C.HYROX_STATIONS, { field: 'roxzone', label: 'Roxzone', kind: 'rox' }].map((s, i) => {
        const tgt = plan.splits[s.field];
        const best = bests[s.field];
        const gap = best ? best - tgt : null;
        return `<tr class="fx-plan-${s.kind}"><td>${s.kind === 'rox' ? 'R' : i + 1}</td><td>${esc(s.label)}</td><td><b>${C.fmtTime(tgt)}</b></td>
          <td class="${gap == null ? '' : gap <= 0 ? 'is-faster' : 'is-slower'}">${best ? C.fmtTime(best) : '—'}</td></tr>`;
      }).join('');
      planHtml = `
        <div class="mx-tiles mx-tiles--2 fx-plan-tiles">
          <div class="mx-stat"><span class="mx-stat-l">Goal</span><span class="mx-stat-v">${C.fmtTime(goalSec)}</span></div>
          <div class="mx-stat"><span class="mx-stat-l">Run pace</span><span class="mx-stat-v">${C.fmtTime(plan.avgRun)}<small>/km</small></span></div>
        </div>
        <p class="mx-sub">Pacing ${plan.source === 'yours' ? 'follows the shape of your best full simulation' : 'uses a typical split shape — log a full sim to personalise it'}. Red = your best split is slower than the target.</p>
        <table class="fx-plan-table"><thead><tr><th>#</th><th>Segment</th><th>Target</th><th>Best</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    box.innerHTML = `
      ${phase ? `<div class="mx-note fx-phase"><span class="mx-kicker">${esc(phase.label)}${race.name ? ' · ' + esc(race.name) : ''}</span><span>${esc(phase.tip)}</span></div>` : ''}
      ${planHtml}`;
  }

  function renderHyrox() {
    renderStationInputs();
    renderRaceForm();
    paintDivisionLoads();
    renderRacePlan();
    calcHyroxTotal();
    renderHyroxBests();
    renderHyroxHistory();
    renderHyroxChart();
  }

  /* ══ Circuits ═══════════════════════════════════════════════ */

  const circuit = { steps: [], running: false, startedAt: 0, banked: 0, raf: null, lastI: -1, def: null, offset: 0 };

  function circuitExRow(value) {
    const n = document.querySelectorAll('#circuitExercises .circuit-ex-row').length + 1;
    return `<div class="circuit-ex-row">
      <div class="mx-well mx-well--text"><input type="text" class="circuit-ex-input" list="fxMovementNames" autocomplete="off" placeholder="Station ${n}" aria-label="Station ${n}" value="${esc(value || '')}"></div>
      <button type="button" class="mx-iconbtn mx-iconbtn--ghost circuit-ex-remove" aria-label="Remove station ${n}"><span class="ui-icon">${icon('x')}</span></button>
    </div>`;
  }

  function addCircuitExercise(value) {
    const box = $('circuitExercises');
    if (!box) return;
    box.insertAdjacentHTML('beforeend', circuitExRow(value));
    updateCircuitTotal();
  }

  function readCircuit() {
    return {
      name: $('circuitName')?.value.trim() || '',
      rounds: Math.max(1, parseInt($('circuitRounds')?.value, 10) || 3),
      work: Math.max(5, parseInt($('circuitWork')?.value, 10) || 40),
      rest: Math.max(0, parseInt($('circuitRest')?.value, 10) || 0),
      exercises: Array.from(document.querySelectorAll('#circuitExercises .circuit-ex-input')).map(i => i.value.trim()).filter(Boolean),
    };
  }

  function fillCircuit(c) {
    $('circuitName').value = c.name || '';
    $('circuitRounds').value = c.rounds || 3;
    $('circuitWork').value = c.work || 40;
    $('circuitRest').value = c.rest != null ? c.rest : 20;
    const box = $('circuitExercises');
    box.innerHTML = '';
    (c.exercises && c.exercises.length ? c.exercises : ['']).forEach(addCircuitExercise);
    updateCircuitTotal();
  }

  function updateCircuitTotal() {
    const el = $('circuitTotalTime');
    if (!el) return;
    const c = readCircuit();
    el.textContent = c.exercises.length ? `${C.fmtTime(C.circuitTotalSeconds(c))} total` : '';
  }

  function saveCircuit() {
    const c = readCircuit();
    if (!c.exercises.length) { toast('Add stations first', 'warn'); return; }
    if (!c.name) { toast('Name the circuit first', 'warn'); $('circuitName').focus(); return; }
    const list = read('circuits', []);
    const existing = list.find(x => C.norm(x.name) === C.norm(c.name));
    const def = { id: existing ? existing.id : C.newId('c'), ...c };
    if (existing) list.splice(list.indexOf(existing), 1, def); else list.push(def);
    if (!write('circuits', list)) return;
    toast(existing ? 'Circuit updated' : 'Circuit saved', 'success');
    renderSavedCircuits();
  }

  function renderSavedCircuits() {
    const box = $('circuitHistory');
    if (!box) return;
    const list = read('circuits', []);
    const log = read('log', []).filter(e => e.source === 'circuit');
    if (!list.length) { box.innerHTML = '<div class="mx-empty">No circuits saved yet.</div>'; return; }
    box.innerHTML = list.map(c => {
      const done = log.filter(e => C.norm(e.name) === C.norm(c.name));
      const last = done[done.length - 1];
      return `<div class="mx-row">
        <div class="mx-row-main">
          <span class="mx-row-title">${esc(c.name)}</span>
          <span class="mx-row-sub">${c.rounds} rds · ${c.work}s on / ${c.rest}s off · ${c.exercises.length} stations · ${C.fmtTime(C.circuitTotalSeconds(c))}</span>
          <span class="mx-row-sub">${done.length ? `Done ${done.length}× · last ${esc(fmtDate(last.date, { day: 'numeric', month: 'short' }))}` : 'Not done yet'}</span>
        </div>
        <div class="fx-row-actions">
          <button type="button" class="mx-outline fx-mini" data-act="start-circuit" data-id="${esc(c.id)}">Start</button>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-act="load-circuit" data-id="${esc(c.id)}" aria-label="Edit ${esc(c.name)}"><span class="ui-icon">${icon('pencil')}</span></button>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-act="del-circuit" data-id="${esc(c.id)}" aria-label="Delete ${esc(c.name)}"><span class="ui-icon">${icon('x')}</span></button>
        </div>
      </div>`;
    }).join('');
  }

  function circuitElapsed() {
    return circuit.banked + (circuit.running ? (Date.now() - circuit.startedAt) / 1000 : 0);
  }

  function paintCircuit() {
    const at = C.circuitAt(circuit.steps, circuitElapsed() + circuit.offset);
    if (at.done) { finishCircuit(true); return; }
    const step = at.step;
    const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
    set('circuitTimerClock', C.fmtTime(at.left));
    const phase = $('circuitTimerPhase');
    if (phase) { phase.textContent = step.phase === 'work' ? 'WORK' : 'REST'; phase.classList.toggle('is-rest', step.phase !== 'work'); }
    set('circuitTimerExercise', step.phase === 'work' ? step.exercise : `Next: ${step.exercise}`);
    const perRound = circuit.def.exercises.length;
    set('circuitTimerRound', `Round ${step.round}/${circuit.def.rounds} · Station ${step.index + 1}/${perRound}`);
    const total = C.circuitTotalSeconds(circuit.def);
    const fill = $('circuitTimerFill');
    if (fill) fill.style.width = Math.min(100, Math.round((circuitElapsed() + circuit.offset) / total * 100)) + '%';
    if (circuit.running) {
      if (at.i !== circuit.lastI) { if (circuit.lastI !== -1) playCue(step.phase === 'work' ? 'start' : 'end'); circuit.lastI = at.i; }
      else if (at.left <= 3 && at.left !== circuit._lastTick) { circuit._lastTick = at.left; playCue('tick'); }
    }
  }

  function circuitLoop() {
    paintCircuit();
    if (circuit.running) circuit.raf = setTimeout(circuitLoop, 200);
  }

  function startCircuitTimer(def) {
    const c = def || readCircuit();
    if (!c.exercises.length) { toast('Add stations first', 'warn'); return; }
    if (circuit.running) stopCircuitTimer();
    circuit.def = { ...c, name: c.name || 'Circuit' };
    circuit.steps = C.circuitSteps(circuit.def);
    circuit.banked = 0;
    circuit.offset = 0;
    circuit.lastI = -1;
    circuit.running = true;
    circuit.startedAt = Date.now();
    const card = $('circuitTimerCard');
    if (card) { card.style.display = ''; card.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if ($('circuitPauseBtn')) $('circuitPauseBtn').textContent = 'Pause';
    playCue('start');
    keepAwake(true);
    circuitLoop();
  }

  function toggleCircuitPause() {
    if (!circuit.def) return;
    if (circuit.running) {
      circuit.banked = circuitElapsed();
      circuit.running = false;
      clearTimeout(circuit.raf);
      keepAwake(false);
    } else {
      circuit.running = true;
      circuit.startedAt = Date.now();
      keepAwake(true);
      circuitLoop();
    }
    if ($('circuitPauseBtn')) $('circuitPauseBtn').textContent = circuit.running ? 'Pause' : 'Resume';
  }

  function skipCircuitStep() {
    if (!circuit.def) return;
    const at = C.circuitAt(circuit.steps, circuitElapsed() + circuit.offset);
    circuit.offset += at.left;
    paintCircuit();
  }

  function finishCircuit(completed) {
    const def = circuit.def;
    const elapsed = circuitElapsed() + circuit.offset;
    circuit.running = false;
    clearTimeout(circuit.raf);
    keepAwake(false);
    const card = $('circuitTimerCard');
    if (card) card.style.display = 'none';
    circuit.def = null;
    if (!def) return;
    if (completed) playCue('end');
    // Log anything over a minute (a full circuit, or a stopped one if confirmed).
    if (elapsed >= 60 && (completed || window.confirm('Log the part of the circuit you finished?'))) {
      const log = read('log', []);
      const at = C.circuitAt(C.circuitSteps(def), elapsed);
      const roundsDone = completed ? def.rounds : Math.max(0, (at.step ? at.step.round : 1) - 1);
      log.push({
        id: C.newId('w'),
        date: todayKey(),
        name: def.name,
        format: 'other',
        scoreType: 'none',
        minutes: 0, seconds: 0, rounds: roundsDone,
        durationMin: Math.max(1, Math.round(elapsed / 60)),
        notes: `${def.rounds} rds · ${def.work}s on / ${def.rest}s off${completed ? '' : ' · stopped early'}`,
        exercises: def.exercises.map(n => ({ exerciseName: n, sets: roundsDone || 1, reps: def.work, weight: 0, measure: 'sec' })),
        source: 'circuit',
      });
      log.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      write('log', log);
      toast(completed ? `${def.name} complete — logged` : 'Partial circuit logged', 'success');
      refreshAll();
    }
  }

  function stopCircuitTimer() { finishCircuit(false); }

  function renderCircuits() {
    if ($('circuitExercises') && !$('circuitExercises').childElementCount) addCircuitExercise('');
    updateCircuitTotal();
    renderSavedCircuits();
  }

  /* ══ History ════════════════════════════════════════════════ */

  let histFilter = '';

  function renderHistory() {
    const box = $('fxHistoryList');
    if (!box) return;
    const log = read('log', []);
    const sims = read('hyrox', []);
    const q = C.norm($('fxHistSearch')?.value);
    const items = [];
    log.forEach((e, i) => items.push({ kind: e.source === 'circuit' ? 'circuit' : 'wod', date: e.date, e, i }));
    sims.forEach(s => items.push({ kind: 'hyrox', date: s.date, s }));
    const filtered = items.filter(it => {
      if (histFilter === 'pr') { if (it.kind === 'hyrox' || !C.isPR(log, it.e)) return false; }
      else if (histFilter && it.kind !== histFilter) return false;
      if (!q) return true;
      if (it.kind === 'hyrox') return 'hyrox'.includes(q) || C.norm(it.s.notes).includes(q);
      return C.norm(it.e.name).includes(q) || C.norm(it.e.notes).includes(q) ||
        (it.e.exercises || []).some(m => C.norm(m.exerciseName || m.exercise).includes(q));
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || ((b.i || 0) - (a.i || 0)));

    if ($('fxHistCount')) $('fxHistCount').textContent = filtered.length ? `${filtered.length} session${filtered.length === 1 ? '' : 's'}` : '';
    if (!filtered.length) { box.innerHTML = `<div class="mx-empty">${items.length ? 'No sessions match.' : 'Nothing logged yet.'}</div>`; return; }

    let lastMonth = '';
    box.innerHTML = filtered.slice(0, 200).map(it => {
      const month = String(it.date).slice(0, 7);
      const head = month !== lastMonth ? `<div class="mx-kicker fx-sec">${esc(fmtDate(month + '-01', { month: 'long', year: 'numeric' }))}</div>` : '';
      lastMonth = month;
      if (it.kind !== 'hyrox') return head + wodRowHtml(it.e, it.i, log, { compact: false });
      const s = it.s;
      const total = Number(s.total) || C.simTotal(s.stations);
      const done = C.HYROX_STATIONS.filter(x => Number((s.stations || {})[x.field]) > 0).length;
      return head + `
        <article class="mx-row cf-wod">
          ${dateBlock(s.date)}
          <div class="mx-row-main">
            <div class="cf-wod-top"><span class="mx-row-title">HYROX ${esc({ race: 'Race', half: 'Half sim' }[s.kind] || 'Simulation')}</span><span class="mx-row-big">${C.fmtTime(total)}</span></div>
            <span class="mx-row-sub">${done}/16 segments${s.notes ? ' · ' + esc(s.notes) : ''}</span>
          </div>
          <div class="fx-row-actions">
            <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-act="edit-hyrox" data-ts="${s.ts}" aria-label="Edit simulation"><span class="ui-icon">${icon('pencil')}</span></button>
            <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-act="del-hyrox" data-ts="${s.ts}" aria-label="Delete simulation"><span class="ui-icon">${icon('x')}</span></button>
          </div>
        </article>`;
    }).join('');
  }

  /* ══ Wiring ═════════════════════════════════════════════════ */

  function refreshAll() {
    renderWeekHero();
    renderRecent();
    renderTemplateOptions();
    updatePrevBest();
    const active = document.querySelector('#functionalTab .func-subview.active');
    const id = active ? active.id.replace('fSub_', '') : 'wod';
    if (id === 'benchmarks') {
      renderBenchmarks();
      const open = $('fxBenchDetail');
      if (open && !open.hidden && open.dataset.key) openBenchmark(open.dataset.key);
    }
    if (id === 'hyrox') renderHyrox();
    if (id === 'circuits') renderCircuits();
    if (id === 'history') renderHistory();
  }

  function onClick(e) {
    const go = e.target.closest('[data-fsub-go]');
    if (go) { showSub(go.dataset.fsubGo); return; }
    const bench = e.target.closest('[data-bench]');
    if (bench) { const pod = $('fxBenchDetail'); if (pod) pod.dataset.key = bench.dataset.bench; openBenchmark(bench.dataset.bench); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'edit-wod') editWod(Number(btn.dataset.idx));
    else if (act === 'del-wod') deleteWod(Number(btn.dataset.idx));
    else if (act === 'edit-hyrox') { showSub('hyrox'); editHyrox(Number(btn.dataset.ts)); }
    else if (act === 'del-hyrox') deleteHyrox(Number(btn.dataset.ts));
    else if (act === 'close-bench') { const pod = $('fxBenchDetail'); if (pod) { pod.hidden = true; pod.dataset.key = ''; } }
    else if (act === 'log-bench') {
      clearForm();
      $('cfWorkoutName').value = btn.dataset.name;
      onNameChange();
      showSub('wod');
      $('fxLogPod')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    else if (act === 'start-circuit' || act === 'load-circuit') {
      const c = read('circuits', []).find(x => x.id === btn.dataset.id);
      if (!c) return;
      fillCircuit(c);
      if (act === 'start-circuit') startCircuitTimer(c);
      else $('circuitName')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    else if (act === 'del-circuit') {
      const list = read('circuits', []);
      const c = list.find(x => x.id === btn.dataset.id);
      if (!c || !window.confirm(`Delete the “${c.name}” circuit?`)) return;
      write('circuits', list.filter(x => x.id !== c.id));
      renderSavedCircuits();
    }
  }

  function bindSegs(id, attr, fn) {
    $(id)?.addEventListener('click', e => {
      const b = e.target.closest(`[data-${attr}]`);
      if (!b) return;
      $(id).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      fn(b.dataset[attr]);
    });
  }

  let _inited = false;
  function init() {
    if (_inited || !$('functionalTab')) return;
    _inited = true;
    const tab = $('functionalTab');
    tab.addEventListener('click', onClick);

    $('funcSubNav')?.addEventListener('click', e => {
      const b = e.target.closest('.log-subtab');
      if (b && b.dataset.fsub) showSub(b.dataset.fsub);
    });

    initTimer();
    renderRpe();

    $('cfDate') && ($('cfDate').value = todayKey());
    $('cfWorkoutName')?.addEventListener('input', onNameChange);
    $('cfFormat')?.addEventListener('click', e => { const b = e.target.closest('[data-format]'); if (b) { setFormat(b.dataset.format); updatePrevBest(); } });
    $('cfRxSegs')?.addEventListener('click', e => { const b = e.target.closest('[data-rx]'); if (b) setRx(b.dataset.rx === '1'); });
    $('cfAddExercise')?.addEventListener('click', () => { addMovement(); const rows = document.querySelectorAll('#cfExercisesContainer .cf-mv-name'); rows[rows.length - 1]?.focus(); });
    $('cfExercisesContainer')?.addEventListener('click', e => {
      const rm = e.target.closest('.cf-mv-remove');
      if (rm) { rm.closest('.cf-ex').remove(); updateMovementCount(); }
    });
    $('cfSaveWorkout')?.addEventListener('click', saveWorkout);
    $('cfSaveTemplate')?.addEventListener('click', saveTemplate);
    $('cfDeleteTemplate')?.addEventListener('click', deleteTemplate);
    $('crossfitTemplateSelect')?.addEventListener('change', applyTemplate);
    $('fxRepeatLast')?.addEventListener('click', repeatLast);
    $('fxCancelEdit')?.addEventListener('click', clearForm);

    bindSegs('fxBenchFilter', 'group', g => { benchFilter = g; renderBenchmarks(); });
    bindSegs('fxHistFilter', 'kind', k => { histFilter = k; renderHistory(); });
    $('fxHistSearch')?.addEventListener('input', renderHistory);

    $('hyroxSaveBtn')?.addEventListener('click', saveHyroxSimulation);
    $('hyroxCancelEdit')?.addEventListener('click', clearHyroxForm);
    $('hyroxSaveRace')?.addEventListener('click', saveRacePlan);
    $('hyroxGoal')?.addEventListener('blur', e => { const s = C.parseTime(e.target.value); e.target.value = s ? C.fmtTime(s) : ''; });
    if ($('hyroxDate') && !$('hyroxDate').value) $('hyroxDate').value = todayKey();

    $('circuitAddEx')?.addEventListener('click', () => addCircuitExercise(''));
    $('circuitExercises')?.addEventListener('click', e => {
      const rm = e.target.closest('.circuit-ex-remove');
      if (rm) { rm.closest('.circuit-ex-row').remove(); updateCircuitTotal(); }
    });
    ['circuitExercises', 'circuitRounds', 'circuitWork', 'circuitRest'].forEach(id => $(id)?.addEventListener('input', updateCircuitTotal));
    $('circuitSaveBtn')?.addEventListener('click', saveCircuit);
    $('circuitStartBtn')?.addEventListener('click', () => startCircuitTimer());
    $('circuitPauseBtn')?.addEventListener('click', toggleCircuitPause);
    $('circuitSkipBtn')?.addEventListener('click', skipCircuitStep);
    $('circuitStopBtn')?.addEventListener('click', stopCircuitTimer);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && circuit.running) paintCircuit(); });

    clearForm();
    renderNameSuggestions();
  }

  // Called by showTab('functionalTab'), login and cloud sync.
  function renderFunctionalTab() {
    init();
    if (!$('functionalTab')) return;
    refreshAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Names other modules already call (cloud-sync.js, showTab, login).
  window.renderFunctionalTab = renderFunctionalTab;
  window.renderCrossfitWorkouts = renderFunctionalTab;
  window.renderHyroxHistory = () => { if (_inited) { renderWeekHero(); renderHyrox(); } };
  window.renderTemplateOptions = renderTemplateOptions;
  window.saveCrossfitWorkout = saveWorkout;
  window.saveHyroxSimulation = saveHyroxSimulation;
  window.deleteHyrox = deleteHyrox;
  window.addCircuitExercise = addCircuitExercise;
  window.startCircuitTimer = startCircuitTimer;
  window.toggleCircuitPause = toggleCircuitPause;
  window.stopCircuitTimer = stopCircuitTimer;
  window.FunctionalUI = { showSub, refreshAll, openBenchmark };
})();
