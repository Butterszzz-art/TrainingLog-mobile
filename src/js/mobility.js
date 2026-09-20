/* mobility.js — Flexibility & Mobility tab for Pocket Coach */
(function () {
  'use strict';

  // ─── Utilities ────────────────────────────────────────────────
  function genId() {
    return 'mob_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getUser() {
    return (typeof getActiveUsername === 'function' && getActiveUsername())
      || window.currentUser
      || localStorage.getItem('fitnessAppUser')
      || '';
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type) { window.showToast?.(msg, type || 'success'); }

  // ─── Storage ──────────────────────────────────────────────────
  function getRoutines() {
    const u = getUser(); if (!u) return [];
    return JSON.parse(localStorage.getItem(`mobilityRoutines_${u}`) || '[]');
  }
  function saveRoutines(list) {
    const u = getUser(); if (!u) return;
    localStorage.setItem(`mobilityRoutines_${u}`, JSON.stringify(list));
  }
  function getSessions() {
    const u = getUser(); if (!u) return [];
    return JSON.parse(localStorage.getItem(`mobilitySessions_${u}`) || '[]');
  }
  function saveSessions(list) {
    const u = getUser(); if (!u) return;
    localStorage.setItem(`mobilitySessions_${u}`, JSON.stringify(list));
  }

  // ─── Starter Library ──────────────────────────────────────────
  const LIBRARY = [
    {
      id: 'lib_stretch_fullbody', name: 'Full Body Cool-Down',
      type: 'stretching', targetArea: 'Full body', frequencyPerWeek: 5,
      exercises: [
        { id: 'e1', name: 'Hip Flexor Stretch',  detail: 'Kneel on one knee, drive hips forward, and keep your torso upright.',                                              durationSeconds: 45, reps: null, sets: null },
        { id: 'e2', name: 'Hamstring Stretch',   detail: 'Sit with legs straight and reach toward your toes, keeping your back flat.',                                       durationSeconds: 45, reps: null, sets: null },
        { id: 'e3', name: 'Chest Opener',        detail: 'Clasp hands behind your back, squeeze shoulder blades together, and lift arms slightly.',                          durationSeconds: 30, reps: null, sets: null },
        { id: 'e4', name: 'Seated Twist',        detail: 'Sit tall, cross one foot over the opposite thigh, and rotate your torso toward the raised knee.',                  durationSeconds: 30, reps: null, sets: null },
        { id: 'e5', name: "Child's Pose",        detail: "Kneel, sit back on your heels, and reach your arms forward with your forehead resting on the floor.",             durationSeconds: 60, reps: null, sets: null }
      ]
    },
    {
      id: 'lib_stretch_upper', name: 'Upper Body Stretch',
      type: 'stretching', targetArea: 'Upper body', frequencyPerWeek: 4,
      exercises: [
        { id: 'e1', name: 'Doorway Chest Stretch',       detail: 'Place forearms on a door frame and lean through to open the chest and anterior shoulders.',            durationSeconds: 45, reps: null, sets: null },
        { id: 'e2', name: 'Overhead Tricep Stretch',     detail: 'Raise one arm, bend elbow behind your head, and gently pull the elbow with the opposite hand.',        durationSeconds: 30, reps: null, sets: null },
        { id: 'e3', name: 'Cross-Body Shoulder Stretch', detail: 'Pull one arm across your chest with the opposite hand, keeping the shoulder down and relaxed.',        durationSeconds: 30, reps: null, sets: null },
        { id: 'e4', name: 'Neck Side Stretch',           detail: 'Tilt your ear toward your shoulder and hold; avoid shrugging or rotating the head.',                   durationSeconds: 30, reps: null, sets: null }
      ]
    },
    {
      id: 'lib_mob_hip', name: 'Hip Mobility Circuit',
      type: 'mobility', targetArea: 'Hips', frequencyPerWeek: 3,
      exercises: [
        { id: 'e1', name: '90/90 Hip Switch',   detail: 'Sit with both legs at 90° and smoothly rotate hips from side to side, keeping the spine tall.',              durationSeconds: null, reps: 10, sets: 2 },
        { id: 'e2', name: 'Deep Squat Hold',    detail: 'Feet shoulder-width apart, sink into a full squat and use elbows to press knees outward.',                   durationSeconds: 60,   reps: null, sets: null },
        { id: 'e3', name: 'Lateral Lunge',      detail: 'Step wide to one side, shift your weight over that leg, and push your knee out over your toes.',            durationSeconds: null, reps: 10, sets: 2 },
        { id: 'e4', name: 'Hip Circle',         detail: 'On all fours, make large slow circles with one knee, keeping the lower back stable.',                        durationSeconds: null, reps:  8, sets: 2 },
        { id: 'e5', name: 'Pigeon Pose',        detail: 'Front shin is parallel to the mat, hips square, and fold forward to deepen the stretch.',                   durationSeconds: 60,   reps: null, sets: null }
      ]
    },
    {
      id: 'lib_mob_thoracic', name: 'Thoracic Spine Routine',
      type: 'mobility', targetArea: 'Upper back', frequencyPerWeek: 3,
      exercises: [
        { id: 'e1', name: 'Cat-Cow',                   detail: 'On all fours, alternate between arching your back to the ceiling and dropping your belly.',            durationSeconds: null, reps: 10, sets: 2 },
        { id: 'e2', name: 'Thread the Needle',         detail: 'From all fours, slide one arm under your torso and rotate until your shoulder touches the floor.',     durationSeconds: 30,   reps: null, sets: null },
        { id: 'e3', name: 'Foam Roller T-Spine',      detail: 'Place a foam roller perpendicular to your spine and extend over it segment by segment.',               durationSeconds: 60,   reps: null, sets: null },
        { id: 'e4', name: 'Seated T-Spine Rotation', detail: 'Sit tall with arms crossed and rotate your upper body to each side while keeping your hips still.',    durationSeconds: null, reps: 10, sets: 2 }
      ]
    },
    {
      id: 'lib_prehab_shoulder', name: 'Shoulder Prehab',
      type: 'prehab', targetArea: 'Shoulders', frequencyPerWeek: 4,
      exercises: [
        { id: 'e1', name: 'Band Pull-Apart',   detail: 'Hold a resistance band with arms straight in front and pull it apart horizontally to shoulder height.',       durationSeconds: null, reps: 15, sets: 3 },
        { id: 'e2', name: 'Face Pull',         detail: 'Pull a band or cable toward your face with elbows high, ending in an external rotation position.',            durationSeconds: null, reps: 15, sets: 3 },
        { id: 'e3', name: 'Y-T-W Raises',     detail: 'Lying face-down, raise arms into Y, T, and W positions to activate the lower and middle traps.',              durationSeconds: null, reps: 10, sets: 2 },
        { id: 'e4', name: 'External Rotation', detail: 'Elbow at 90° and pinned to your side, rotate your forearm outward against band resistance.',                 durationSeconds: null, reps: 15, sets: 3 }
      ]
    },
    {
      id: 'lib_prehab_knee', name: 'Knee Prehab',
      type: 'prehab', targetArea: 'Knees', frequencyPerWeek: 3,
      exercises: [
        { id: 'e1', name: 'Terminal Knee Extension',   detail: 'With a band looped behind the knee, fully straighten the leg from slight flexion to activate the VMO.', durationSeconds: null, reps: 15, sets: 3 },
        { id: 'e2', name: 'Clamshell',                 detail: 'Lie on your side with knees bent and open the top knee like a clamshell while keeping feet together.',  durationSeconds: null, reps: 20, sets: 3 },
        { id: 'e3', name: 'Single-Leg Glute Bridge',   detail: 'Lie on your back, extend one leg, and drive hips up using the grounded foot, squeezing the glute.',     durationSeconds: null, reps: 12, sets: 3 },
        { id: 'e4', name: 'VMO Squat',                 detail: 'Stand with heels elevated on a plate, squat slowly with emphasis on pushing knees forward and out.',     durationSeconds: null, reps: 10, sets: 3 }
      ]
    }
  ];

  // ─── Type badge ───────────────────────────────────────────────
  const TYPE = {
    stretching: { cls: '',               label: 'Stretching' },
    mobility:   { cls: 'mx-chip--green', label: 'Mobility'   },
    prehab:     { cls: 'mx-chip--brass', label: 'Prehab'     }
  };

  function badge(type) {
    const s = TYPE[type] || TYPE.mobility;
    return `<span class="mx-chip mx-chip--sm ${s.cls}">${s.label}</span>`;
  }

  // Shared SVG icon set (ICONS is defined in index.html)
  function icon(name) {
    return (typeof ICONS !== 'undefined' && ICONS[name]) || '';
  }

  // ─── Week / date helpers ──────────────────────────────────────
  function weekStart() {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay()); return d;
  }
  function sessionsThisWeek(routineId) {
    const ws = weekStart();
    return getSessions().filter(s => s.routineId === routineId && new Date(s.completedAt) >= ws);
  }
  function lastSessionDate(routineId) {
    const all = getSessions().filter(s => s.routineId === routineId);
    if (!all.length) return null;
    return all.sort((a,b) => new Date(b.completedAt)-new Date(a.completedAt))[0].completedAt;
  }
  function loggedToday(routineId) {
    const today = new Date().toISOString().slice(0,10);
    return getSessions().some(s => s.routineId === routineId && s.completedAt.startsWith(today));
  }

  // ─── Airtable sync ────────────────────────────────────────────
  async function atSyncRoutine(routine) {
    const baseId = window.airtableBaseId, token = window.airtableToken;
    if (!baseId || !token) return;
    try {
      const fields = {
        Username: routine.username, RoutineId: routine.id, Name: routine.name,
        Type: routine.type, TargetArea: routine.targetArea,
        FrequencyPerWeek: routine.frequencyPerWeek,
        Exercises: JSON.stringify(routine.exercises),
        AssignedByCoach: !!routine.assignedByCoach,
        CoachNotes: routine.coachNotes || '', CreatedAt: routine.createdAt
      };
      const method = routine._airtableId ? 'PATCH' : 'POST';
      const url = routine._airtableId
        ? `/airtable/${baseId}/MobilityRoutines/${routine._airtableId}`
        : `/airtable/${baseId}/MobilityRoutines`;
      const body = method === 'POST'
        ? JSON.stringify({ records: [{ fields }] })
        : JSON.stringify({ records: [{ id: routine._airtableId, fields }] });
      const res = await fetch(url, { method, credentials:'include', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body });
      if (res.ok && !routine._airtableId) {
        const data = await res.json();
        const recId = data.records?.[0]?.id;
        if (recId) {
          const list = getRoutines();
          const idx = list.findIndex(r => r.id === routine.id);
          if (idx !== -1) { list[idx]._airtableId = recId; saveRoutines(list); }
        }
      }
    } catch(e) { console.warn('[Mobility] Airtable routine sync failed:', e.message); }
  }

  async function atSyncSession(session) {
    const baseId = window.airtableBaseId, token = window.airtableToken;
    if (!baseId || !token) return;
    try {
      await fetch(`/airtable/${baseId}/MobilitySessions`, {
        method: 'POST', credentials:'include',
        headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ records: [{ fields:{ Username:session.username, SessionId:session.id, RoutineId:session.routineId, CompletedAt:session.completedAt, Notes:session.notes||'' } }] })
      });
    } catch(e) { console.warn('[Mobility] Airtable session sync failed:', e.message); }
  }

  async function atFetchRoutines() {
    const baseId = window.airtableBaseId, token = window.airtableToken, u = getUser();
    if (!baseId || !token || !u) return;
    try {
      const res = await fetch(`/airtable/${baseId}/MobilityRoutines?filterByFormula={Username}='${encodeURIComponent(u)}'`, { credentials:'include', headers:{ Authorization:`Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.records?.length) return;
      const local = getRoutines();
      const localIds = new Set(local.map(r => r.id));
      data.records.forEach(rec => {
        const f = rec.fields;
        if (!localIds.has(f.RoutineId)) {
          local.push({ id:f.RoutineId, username:f.Username, name:f.Name, type:f.Type, targetArea:f.TargetArea, frequencyPerWeek:f.FrequencyPerWeek, exercises:JSON.parse(f.Exercises||'[]'), assignedByCoach:!!f.AssignedByCoach, coachNotes:f.CoachNotes||'', createdAt:f.CreatedAt, _airtableId:rec.id });
        }
      });
      saveRoutines(local);
    } catch(e) { console.warn('[Mobility] Airtable fetch failed:', e.message); }
  }

  // ─── State ────────────────────────────────────────────────────
  let _tab = 'myRoutines';
  let _editing = null;
  let _libFilter = 'all';

  // Timer state: { [exId]: { remaining, total, interval, done } }
  const _timers = {};

  // ─── Main render ─────────────────────────────────────────────
  function render() {
    const wrap = document.getElementById('mobilityTabContent');
    if (!wrap) return;

    const activeInjuries = typeof window.getActiveInjuries === 'function' ? window.getActiveInjuries().length : 0;
    const rehabLabel = activeInjuries > 0 ? `Rehab (${activeInjuries})` : 'Rehab';
    const pill = (id, label) =>
      `<button type="button" class="pill${_tab === id ? ' active' : ''}" data-mob="${id}"${_tab === id ? ' aria-current="page"' : ''}>${label}</button>`;

    wrap.innerHTML = `
      <div class="mx-head"><h2 class="pod-title">Flexibility &amp; Mobility</h2></div>
      <nav class="pill-nav" aria-label="Mobility sections">
        ${pill('myRoutines', 'My Routines')}
        ${pill('logSession', 'Log Session')}
        ${pill('library', 'Browse Library')}
        ${pill('rehab', rehabLabel)}
      </nav>
      <div id="mobSub"></div>
    `;

    wrap.querySelectorAll('[data-mob]').forEach(btn => {
      btn.addEventListener('click', () => { _tab = btn.dataset.mob; render(); });
    });

    const sub = wrap.querySelector('#mobSub');
    if (_tab === 'myRoutines')  renderMyRoutines(sub);
    else if (_tab === 'logSession') renderLogSession(sub);
    else if (_tab === 'rehab' && typeof window.renderRehabTab === 'function') window.renderRehabTab(sub);
    else if (_tab !== 'rehab') renderLibrary(sub);
  }

  // ─── My Routines ──────────────────────────────────────────────
  function renderMyRoutines(sub) {
    const routines = getRoutines();
    const weekTotal = routines.reduce((s, r) => s + sessionsThisWeek(r.id).length, 0);
    const weekGoal = routines.reduce((s, r) => s + (Number(r.frequencyPerWeek) || 0), 0);
    const routinesDone = routines.filter(r => sessionsThisWeek(r.id).length >= (Number(r.frequencyPerWeek) || 1)).length;
    const pct = weekGoal ? Math.min(100, Math.round((weekTotal / weekGoal) * 100)) : 0;

    sub.innerHTML = `
      <div class="mob-toolbar">
        <span class="mx-meta">${routines.length} routine${routines.length === 1 ? '' : 's'}</span>
        <button type="button" id="mobAddBtn" class="mx-outline"><span class="ui-icon">${icon('plus')}</span> Add Routine</button>
      </div>
      ${routines.length ? `
        <section class="pod pod--hero mx-pod" aria-label="Mobility this week">
          <div class="pod-row">
            <span class="mx-kicker">This week</span>
            <span class="mx-chip mx-chip--green">${routinesDone} of ${routines.length} routine${routines.length === 1 ? '' : 's'}</span>
          </div>
          <div class="mob-hero-big"><span class="mx-num">${weekTotal}</span><span class="mob-hero-of">/ ${weekGoal} sessions</span></div>
          <div class="mx-meter" role="img" aria-label="${weekTotal} of ${weekGoal} sessions"><i style="width:${pct}%"></i></div>
        </section>` : `<div class="mx-empty">No routines yet.<br>Add one above or copy from the library.</div>`}
      <div id="mobCards"></div>
    `;
    sub.querySelector('#mobAddBtn').addEventListener('click', () => openBuilder(null));

    const cards = sub.querySelector('#mobCards');
    routines.forEach(r => {
      const wk = sessionsThisWeek(r.id).length;
      const last = lastSessionDate(r.id);
      const done = loggedToday(r.id);
      const freq = Number(r.frequencyPerWeek) || 0;
      const dots = Array.from({ length: Math.max(freq, 1) }, (_, i) => `<i class="${i < wk ? 'on' : ''}"></i>`).join('');
      const name = esc(r.name);
      const el = document.createElement('article');
      el.className = 'pod mx-pod mob-card';
      el.setAttribute('aria-label', r.name || 'Routine');
      el.innerHTML = `
        <div class="mob-card-top">
          <div class="mob-card-title">
            <div class="mob-card-name">
              <span class="mx-row-title mob-name">${name}</span>
              ${badge(r.type)}
            </div>
            <span class="mx-row-sub">${esc(r.targetArea)}${r.targetArea ? ' · ' : ''}Last ${last ? new Date(last).toLocaleDateString() : 'never'}${(r.longestStreak || 0) >= 2 ? ` · Best ${r.longestStreak}` : ''}</span>
          </div>
          <div class="mob-card-actions">
            <button type="button" class="mob-edit mx-iconbtn" data-id="${r.id}" aria-label="Edit ${name}"><span class="ui-icon">${icon('pencil')}</span></button>
            <button type="button" class="mob-del mx-iconbtn mx-iconbtn--ghost" data-id="${r.id}" aria-label="Delete ${name}"><span class="ui-icon">${icon('x')}</span></button>
          </div>
        </div>
        <div class="mob-card-week">
          <div class="mob-dots" role="img" aria-label="${wk} of ${freq} sessions this week">${dots}</div>
          <div class="mx-tags">
            ${(r.streakCount || 0) >= 2 ? `<span class="mx-chip mx-chip--brass mx-chip--sm"><span class="ui-icon">${icon('flame')}</span> ${r.streakCount}</span>` : ''}
            ${r.assignedByCoach ? '<span class="mx-chip mx-chip--sm">Coach</span>' : ''}
          </div>
        </div>
        ${r.assignedByCoach && r.coachNotes ? `<p class="mx-quote"><b>From your coach</b>${esc(r.coachNotes)}</p>` : ''}
        <button type="button" class="mob-log mx-outline mx-outline--block${done ? ' is-done' : ''}" data-id="${r.id}" aria-pressed="${done ? 'true' : 'false'}">
          <span class="ui-icon">${icon(done ? 'check' : 'zap')}</span> ${done ? 'Logged today' : 'Log session'}
        </button>
      `;
      el.querySelector('.mob-log').addEventListener('click',  () => quickLog(r.id));
      el.querySelector('.mob-edit').addEventListener('click', () => openBuilder(r));
      el.querySelector('.mob-del').addEventListener('click',  () => deleteRoutine(r.id));
      cards.appendChild(el);
    });
  }

  // ─── Log Session ──────────────────────────────────────────────
  function fmtMmSs(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function renderExerciseTimers(container, routine) {
    if (!routine || !routine.exercises?.length) { container.innerHTML = ''; return; }
    container.innerHTML = routine.exercises.map(ex => {
      const hasDur = ex.durationSeconds != null && ex.durationSeconds > 0;
      const exId = ex.id;
      if (hasDur) {
        return `
          <div class="mob-ex-row mob-ex-row--timed" data-ex-id="${exId}">
            <div class="mob-ex-top">
              <div class="mob-ex-main">
                <strong class="mob-ex-name">${esc(ex.name)}</strong>
                <span class="mob-ex-detail">${esc(ex.detail)}</span>
              </div>
              <span class="mob-done-label mx-chip mx-chip--green mx-chip--sm" style="display:none;">Done</span>
            </div>
            <div class="mob-ex-timer">
              <span class="mob-timer-display mx-num">${fmtMmSs(ex.durationSeconds)}</span>
              <button type="button" class="mob-timer-start mx-outline" data-ex-id="${exId}" data-dur="${ex.durationSeconds}">Start</button>
              <button type="button" class="mob-timer-reset mx-outline" data-ex-id="${exId}" data-dur="${ex.durationSeconds}">Reset</button>
            </div>
          </div>`;
      } else {
        const repStr = (ex.reps && ex.sets) ? `${ex.sets} × ${ex.reps} reps` : (ex.reps ? `${ex.reps} reps` : '');
        return `
          <div class="mob-ex-row">
            <div class="mob-ex-top">
              <div class="mob-ex-main">
                <strong class="mob-ex-name">${esc(ex.name)}</strong>
                <span class="mob-ex-detail">${esc(ex.detail)}</span>
              </div>
              ${repStr ? `<span class="mx-tag mx-tag--hi">${repStr}</span>` : ''}
            </div>
          </div>`;
      }
    }).join('');

    // Wire up timer buttons (state is expressed as classes: is-running / is-paused / is-done)
    container.querySelectorAll('.mob-timer-start').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exId;
        const row = container.querySelector(`.mob-ex-row[data-ex-id="${exId}"]`);
        const display = row?.querySelector('.mob-timer-display');
        const t = _timers[exId];

        if (t?.interval) {
          // Pause
          clearInterval(t.interval); t.interval = null;
          btn.textContent = 'Resume';
          btn.classList.remove('is-running');
          btn.classList.add('is-paused');
        } else {
          // Start / Resume
          if (!_timers[exId]) _timers[exId] = { remaining: +btn.dataset.dur, total: +btn.dataset.dur, interval: null, done: false };
          if (_timers[exId].done) return;
          btn.textContent = 'Pause';
          btn.classList.remove('is-paused');
          btn.classList.add('is-running');
          _timers[exId].interval = setInterval(() => {
            _timers[exId].remaining -= 1;
            if (display) display.textContent = fmtMmSs(Math.max(0, _timers[exId].remaining));
            if (_timers[exId].remaining <= 0) {
              clearInterval(_timers[exId].interval); _timers[exId].interval = null; _timers[exId].done = true;
              if (display) { display.textContent = '00:00'; display.classList.add('is-done'); }
              btn.textContent = 'Done'; btn.disabled = true;
              btn.classList.remove('is-running', 'is-paused');
              const doneLabel = row?.querySelector('.mob-done-label');
              if (doneLabel) doneLabel.style.display = 'inline-flex';
              navigator.vibrate?.(400);
            }
          }, 1000);
        }
      });
    });

    container.querySelectorAll('.mob-timer-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exId;
        const row = container.querySelector(`.mob-ex-row[data-ex-id="${exId}"]`);
        const display = row?.querySelector('.mob-timer-display');
        const startBtn = row?.querySelector('.mob-timer-start');
        const doneLabel = row?.querySelector('.mob-done-label');
        if (_timers[exId]?.interval) clearInterval(_timers[exId].interval);
        _timers[exId] = { remaining: +btn.dataset.dur, total: +btn.dataset.dur, interval: null, done: false };
        if (display) { display.textContent = fmtMmSs(+btn.dataset.dur); display.classList.remove('is-done'); }
        if (startBtn) { startBtn.textContent = 'Start'; startBtn.disabled = false; startBtn.classList.remove('is-running', 'is-paused'); }
        if (doneLabel) doneLabel.style.display = 'none';
      });
    });
  }

  function renderLogSession(sub) {
    const routines = getRoutines();
    const today = new Date().toISOString().slice(0,10);

    if (!routines.length) {
      sub.innerHTML = `<div class="mx-empty">Add a routine first from <strong>My Routines</strong>.</div>`;
      return;
    }

    sub.innerHTML = `
      <section class="pod mx-pod" aria-label="Log a session">
        <div class="pod-row"><h3 class="pod-title mx-h3">Log a Session</h3></div>
        <div class="mx-field">
          <label class="mx-lbl" for="mobLogR">Routine</label>
          <div class="mx-well mx-well--text mx-well--sel"><select id="mobLogR">${routines.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>
        </div>
        <div class="mx-field">
          <label class="mx-lbl" for="mobLogD">Date</label>
          <div class="mx-well mx-well--text"><input type="date" id="mobLogD" value="${today}"></div>
        </div>
        <div class="mx-field">
          <label class="mx-lbl" for="mobLogN">Notes <em>optional</em></label>
          <div class="mx-well mx-well--area"><textarea id="mobLogN" rows="2" placeholder="How did it feel?"></textarea></div>
        </div>
        <button type="button" id="mobLogSubmit" class="mx-cta">
          <span>Mark Complete</span>
          <span class="mx-cta-icon"><span class="ui-icon">${icon('check')}</span></span>
        </button>
      </section>
      <div id="mobExTimers" class="mob-ex-list"></div>
    `;

    const timerContainer = sub.querySelector('#mobExTimers');
    const sel = sub.querySelector('#mobLogR');

    function refreshTimers() {
      const r = getRoutines().find(r => r.id === sel.value);
      renderExerciseTimers(timerContainer, r);
    }
    sel.addEventListener('change', refreshTimers);
    refreshTimers();

    sub.querySelector('#mobLogSubmit').addEventListener('click', async () => {
      const id    = sel.value;
      const date  = sub.querySelector('#mobLogD').value;
      const notes = sub.querySelector('#mobLogN').value.trim();
      // Clear all running timers for this view
      Object.values(_timers).forEach(t => { if (t.interval) clearInterval(t.interval); });
      await doLog(id, date, notes);
      _tab = 'myRoutines';
      render();
    });
  }

  // ─── Library ──────────────────────────────────────────────────
  function renderLibrary(sub) {
    const filters = ['all','stretching','mobility','prehab'];
    const list = _libFilter === 'all' ? LIBRARY : LIBRARY.filter(r => r.type === _libFilter);

    sub.innerHTML = `
      <div class="mx-presets mob-filters" role="group" aria-label="Filter library">
        ${filters.map(f=>`<button type="button" class="mob-flt mx-preset${_libFilter===f?' active':''}" data-f="${f}" aria-pressed="${_libFilter===f}">${f==='all'?'All':TYPE[f].label}</button>`).join('')}
      </div>
      <div id="mobLibCards"></div>
    `;

    sub.querySelectorAll('.mob-flt').forEach(btn => {
      btn.addEventListener('click', () => { _libFilter = btn.dataset.f; renderLibrary(sub); });
    });

    const cards = sub.querySelector('#mobLibCards');
    list.forEach(lib => {
      const has = getRoutines().some(r => r._libId === lib.id);
      const el = document.createElement('article');
      el.className = 'pod mx-pod mob-card';
      el.setAttribute('aria-label', lib.name);
      el.innerHTML = `
        <div class="mob-card-top">
          <div class="mob-card-title">
            <div class="mob-card-name"><span class="mx-row-title mob-name">${esc(lib.name)}</span>${badge(lib.type)}</div>
            <span class="mx-row-sub">${esc(lib.targetArea)} · ${lib.exercises.length} exercises</span>
          </div>
          <button type="button" class="mob-copy mx-outline${has ? ' is-done' : ''}" data-lid="${lib.id}"${has ? ' disabled' : ''}>
            <span class="ui-icon">${icon(has ? 'check' : 'plus')}</span> ${has ? 'Added' : 'Add'}
          </button>
        </div>
        <ul class="mob-lib-list">
          ${lib.exercises.map(e=>`<li><strong>${esc(e.name)}</strong><span>${esc(e.detail)}</span></li>`).join('')}
        </ul>
      `;
      if (!has) {
        el.querySelector('.mob-copy').addEventListener('click', () => copyFromLibrary(lib));
      }
      cards.appendChild(el);
    });
  }

  // ─── Routine Builder (bottom-sheet modal) ─────────────────────
  function openBuilder(routine) {
    _editing = routine
      ? JSON.parse(JSON.stringify(routine))
      : { id: genId(), username: getUser(), name: '', type: 'mobility', targetArea: '', frequencyPerWeek: 3, exercises: [], assignedByCoach: false, coachNotes: '', createdAt: new Date().toISOString() };

    const coachActive = typeof isCoachModeEnabled === 'function' && isCoachModeEnabled();
    const overlay = document.createElement('div');
    overlay.id = 'mobBuilderOverlay';
    overlay.className = 'mx-sheet-backdrop';
    overlay.innerHTML = `
      <div class="mx-sheet" role="dialog" aria-modal="true" aria-label="${routine?'Edit':'New'} routine">
        <div class="mx-sheet-head">
          <h3 class="pod-title mx-h3">${routine?'Edit':'New'} Routine</h3>
          <button type="button" id="mobBClose" class="mx-iconbtn mx-iconbtn--ghost" aria-label="Close"><span class="ui-icon">${icon('x')}</span></button>
        </div>

        <div class="mx-field">
          <label class="mx-lbl" for="mobBName">Name <em>required</em></label>
          <div class="mx-well mx-well--text"><input id="mobBName" value="${esc(_editing.name)}" placeholder="e.g. Morning Hip Mobility"></div>
        </div>

        <div class="mx-grid2 mob-b-row">
          <div class="mx-field">
            <label class="mx-lbl" for="mobBType">Type</label>
            <div class="mx-well mx-well--text mx-well--sel">
              <select id="mobBType">
                <option value="stretching" ${_editing.type==='stretching'?'selected':''}>Stretching</option>
                <option value="mobility"   ${_editing.type==='mobility'  ?'selected':''}>Mobility</option>
                <option value="prehab"     ${_editing.type==='prehab'    ?'selected':''}>Prehab</option>
              </select>
            </div>
          </div>
          <div class="mx-field">
            <label class="mx-lbl" for="mobBFreq">Days / week</label>
            <div class="mx-well mx-well--num"><input type="number" id="mobBFreq" min="1" max="7" value="${_editing.frequencyPerWeek}" inputmode="numeric"></div>
          </div>
        </div>

        <div class="mx-field">
          <label class="mx-lbl" for="mobBArea">Target area</label>
          <div class="mx-well mx-well--text"><input id="mobBArea" value="${esc(_editing.targetArea)}" placeholder="e.g. Hips, Shoulders, Lower back"></div>
        </div>

        ${coachActive ? `
        <div class="mx-quote mob-coach-box">
          <label class="mob-check">
            <input type="checkbox" id="mobBCoachAssign" ${_editing.assignedByCoach?'checked':''}>
            <span>Assign to client</span>
          </label>
          <div id="mobBCoachExtra" style="display:${_editing.assignedByCoach?'block':'none'};">
            <label class="mx-lbl" for="mobBCoachNotes">Coach notes for client</label>
            <div class="mx-well mx-well--area"><textarea id="mobBCoachNotes" rows="2" placeholder="Instructions or context for the client…">${esc(_editing.coachNotes)}</textarea></div>
          </div>
        </div>` : ''}

        <div class="pod-row">
          <span class="mx-lbl">Exercises</span>
          <button type="button" id="mobBAddEx" class="mx-outline"><span class="ui-icon">${icon('plus')}</span> Add</button>
        </div>
        <div id="mobBExList" class="mob-b-list"></div>
        <button type="button" id="mobBSave" class="mx-cta">
          <span>Save Routine</span>
          <span class="mx-cta-icon"><span class="ui-icon">${icon('check')}</span></span>
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    renderExList(overlay);

    overlay.querySelector('#mobBClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const ct = overlay.querySelector('#mobBCoachAssign');
    if (ct) ct.addEventListener('change', () => { overlay.querySelector('#mobBCoachExtra').style.display = ct.checked ? 'block' : 'none'; });

    overlay.querySelector('#mobBAddEx').addEventListener('click', () => {
      _editing.exercises.push({ id: genId(), name:'', detail:'', durationSeconds:null, reps:null, sets:null });
      renderExList(overlay);
    });
    overlay.querySelector('#mobBSave').addEventListener('click', () => saveBuilder(overlay));
  }

  function renderExList(overlay) {
    const list = overlay.querySelector('#mobBExList');
    list.innerHTML = '';
    _editing.exercises.forEach((ex, i) => {
      const el = document.createElement('div');
      el.className = 'mob-bex';
      el.innerHTML = `
        <div class="pod-row">
          <span class="mx-lbl">Exercise ${i+1}</span>
          <button type="button" class="mob-ex-del mx-link mob-danger" data-i="${i}">Remove</button>
        </div>
        <div class="mx-well mx-well--text"><input class="mob-ex-nm"  data-i="${i}" value="${esc(ex.name)}"   placeholder="Exercise name" aria-label="Exercise ${i+1} name"></div>
        <div class="mx-well mx-well--text"><input class="mob-ex-det" data-i="${i}" value="${esc(ex.detail)}" placeholder="Key cue or form note (one sentence)" aria-label="Exercise ${i+1} cue"></div>
        <div class="mx-grid3">
          <div class="mx-field"><label class="mx-lbl">Secs</label><div class="mx-well mx-well--num"><input type="number" class="mob-ex-dur"  data-i="${i}" value="${ex.durationSeconds??''}" placeholder="—" min="0" inputmode="numeric" aria-label="Exercise ${i+1} duration in seconds"></div></div>
          <div class="mx-field"><label class="mx-lbl">Reps</label><div class="mx-well mx-well--num"><input type="number" class="mob-ex-reps" data-i="${i}" value="${ex.reps??''}"            placeholder="—" min="0" inputmode="numeric" aria-label="Exercise ${i+1} reps"></div></div>
          <div class="mx-field"><label class="mx-lbl">Sets</label><div class="mx-well mx-well--num"><input type="number" class="mob-ex-sets" data-i="${i}" value="${ex.sets??''}"            placeholder="—" min="0" inputmode="numeric" aria-label="Exercise ${i+1} sets"></div></div>
        </div>
      `;
      el.querySelector('.mob-ex-del').addEventListener('click',  () => { _editing.exercises.splice(i,1); renderExList(overlay); });
      el.querySelector('.mob-ex-nm').addEventListener('input',   e => { _editing.exercises[i].name   = e.target.value; });
      el.querySelector('.mob-ex-det').addEventListener('input',  e => { _editing.exercises[i].detail  = e.target.value; });
      el.querySelector('.mob-ex-dur').addEventListener('input',  e => { _editing.exercises[i].durationSeconds = e.target.value ? +e.target.value : null; });
      el.querySelector('.mob-ex-reps').addEventListener('input', e => { _editing.exercises[i].reps   = e.target.value ? +e.target.value : null; });
      el.querySelector('.mob-ex-sets').addEventListener('input', e => { _editing.exercises[i].sets   = e.target.value ? +e.target.value : null; });
      list.appendChild(el);
    });
  }

  function saveBuilder(overlay) {
    const name = overlay.querySelector('#mobBName').value.trim();
    if (!name) { toast('Please enter a routine name.', 'warn'); return; }
    _editing.name            = name;
    _editing.type            = overlay.querySelector('#mobBType').value;
    _editing.frequencyPerWeek= parseInt(overlay.querySelector('#mobBFreq').value) || 3;
    _editing.targetArea      = overlay.querySelector('#mobBArea').value.trim();
    _editing.username        = getUser();
    const ct = overlay.querySelector('#mobBCoachAssign');
    if (ct) {
      _editing.assignedByCoach = ct.checked;
      _editing.coachNotes      = overlay.querySelector('#mobBCoachNotes')?.value.trim() || '';
    }
    const list = getRoutines();
    const idx  = list.findIndex(r => r.id === _editing.id);
    if (idx !== -1) list[idx] = _editing; else list.push(_editing);
    saveRoutines(list);
    atSyncRoutine(_editing);
    toast('Routine saved');
    overlay.remove();
    render();
  }

  // ─── Actions ──────────────────────────────────────────────────
  function deleteRoutine(id) {
    if (!confirm('Delete this routine?')) return;
    saveRoutines(getRoutines().filter(r => r.id !== id));
    render();
  }

  function copyFromLibrary(lib) {
    const copy = { ...JSON.parse(JSON.stringify(lib)), id: genId(), username: getUser(), _libId: lib.id, assignedByCoach: false, coachNotes: '', createdAt: new Date().toISOString() };
    const list = getRoutines(); list.push(copy); saveRoutines(list);
    atSyncRoutine(copy);
    toast(`"${lib.name}" added to your routines`);
    _tab = 'myRoutines'; render();
  }

  async function doLog(routineId, dateStr, notes) {
    const u = getUser();
    const completedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
    const session = { id: genId(), routineId, username: u, completedAt, notes: notes||'' };
    const sList = getSessions(); sList.push(session); saveSessions(sList);
    atSyncSession(session);

    // ── Streak tracking on the routine ────────────────────────────
    const rList = getRoutines();
    const rIdx  = rList.findIndex(r => r.id === routineId);
    if (rIdx !== -1) {
      const r = rList[rIdx];
      const today  = completedAt.slice(0, 10);
      const prevDay = r.lastCompletedDate ? r.lastCompletedDate.slice(0, 10) : null;
      const prevLastDate = r.lastCompletedDate; // for gamification pass-through
      if (!prevDay) {
        r.streakCount = 1;
      } else {
        const diff = Math.round((new Date(today) - new Date(prevDay)) / 86400000);
        if (diff === 0) { /* same day — no change */ }
        else if (diff === 1) r.streakCount = (r.streakCount || 0) + 1;
        else r.streakCount = 1;
      }
      r.longestStreak  = Math.max(r.longestStreak || 0, r.streakCount || 0);
      r.lastCompletedDate = completedAt;
      rList[rIdx] = r;
      saveRoutines(rList);

      // ── Gamification ──────────────────────────────────────────
      if (window.gamification?.awardXp) {
        window.gamification.awardXp(u, 'mobility_session', {
          date: completedAt,
          routineId,
          rewardId: `mobility:${session.id}`,
          lastMobilityDate: prevLastDate
        });
      }
    }

    toast('Session logged');
    window.renderHomeDashboard?.();
  }

  async function quickLog(routineId) {
    await doLog(routineId, new Date().toISOString().slice(0,10), '');
    render();
  }

  // ─── Home dashboard widget ────────────────────────────────────
  window.renderMobilityDashboardCard = function(profile, username) {
    const u = username || getUser();
    if (!u) return '';
    const routines = getRoutines();
    if (!routines.length) return '';

    const pending = routines.filter(r => !loggedToday(r.id));
    const done    = routines.length - pending.length;
    const pillCls = done === routines.length ? 'home-pill-green' : 'home-pill-amber';

    const items = pending.slice(0, 3).map(r => `
      <li class="home-upcoming-item">
        <span>${esc(r.name)}</span>
        <button onclick="event.stopPropagation();window._mobQuickLog('${r.id}')" style="background:var(--primary);color:#fff;border:none;border-radius:6px;padding:3px 10px;font-size:0.74rem;cursor:pointer;font-family:Poppins,sans-serif;">Log</button>
      </li>`).join('');

    return `
      <section class="home-dashboard-card" onclick="if(typeof showTab==='function')showTab('mobilityTab')" style="cursor:pointer;">
        <div class="home-card-header">
          <h3 class="home-card-title">🧘 Flexibility & Mobility</h3>
          <span class="home-status-pill ${pillCls}">${done} / ${routines.length} done</span>
        </div>
        ${pending.length === 0
          ? '<p class="home-mission-progress" style="color:var(--primary);font-weight:600;">All routines completed today 🎉</p>'
          : `<ul class="home-upcoming-list">${items}</ul>`}
      </section>`;
  };

  window._mobQuickLog = async function(routineId) {
    await quickLog(routineId);
    window.renderHomeDashboard?.();
  };

  // ─── Public init (called from showTab) ───────────────────────
  window.initMobilityTab = function() {
    render();
    atFetchRoutines().then(() => render()).catch(() => {});
  };
})();
