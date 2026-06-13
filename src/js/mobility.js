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
    stretching: { bg: 'rgba(55,138,221,0.15)',  color: '#378ADD', label: 'Stretching' },
    mobility:   { bg: 'rgba(99,153,34,0.15)',   color: '#639922', label: 'Mobility'   },
    prehab:     { bg: 'rgba(186,117,23,0.15)',  color: '#BA7517', label: 'Prehab'     }
  };

  function badge(type) {
    const s = TYPE[type] || TYPE.mobility;
    return `<span style="background:${s.bg};color:${s.color};padding:2px 9px;border-radius:20px;font-size:0.73rem;font-weight:600;">${s.label}</span>`;
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

  // ─── Main render ─────────────────────────────────────────────
  function render() {
    const wrap = document.getElementById('mobilityTabContent');
    if (!wrap) return;

    wrap.innerHTML = `
      <div style="padding:0 0 16px;">
        <h2 style="margin:0 0 12px;font-size:1.25rem;font-weight:700;color:var(--text-color);">🧘 Flexibility & Mobility</h2>
        <div class="settings-subtabs" style="margin-bottom:14px;">
          <button type="button" class="settings-subtab${_tab==='myRoutines'?' active':''}" data-mob="myRoutines">My Routines</button>
          <button type="button" class="settings-subtab${_tab==='logSession'?' active':''}" data-mob="logSession">Log Session</button>
          <button type="button" class="settings-subtab${_tab==='library'?' active':''}" data-mob="library">Browse Library</button>
        </div>
        <div id="mobSub"></div>
      </div>
    `;

    wrap.querySelectorAll('[data-mob]').forEach(btn => {
      btn.addEventListener('click', () => { _tab = btn.dataset.mob; render(); });
    });

    const sub = wrap.querySelector('#mobSub');
    if (_tab === 'myRoutines')  renderMyRoutines(sub);
    else if (_tab === 'logSession') renderLogSession(sub);
    else renderLibrary(sub);
  }

  // ─── My Routines ──────────────────────────────────────────────
  function renderMyRoutines(sub) {
    const routines = getRoutines();
    sub.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <button id="mobAddBtn" style="background:var(--primary);color:#fff;border:none;border-radius:10px;padding:8px 16px;font-weight:600;font-size:0.85rem;cursor:pointer;font-family:Poppins,sans-serif;">+ Add Routine</button>
      </div>
      ${!routines.length ? `<div class="panel" style="text-align:center;padding:32px 16px;color:var(--secondary-text);font-size:0.9rem;">No routines yet.<br>Add one above or copy from the library.</div>` : ''}
      <div id="mobCards"></div>
    `;
    sub.querySelector('#mobAddBtn').addEventListener('click', () => openBuilder(null));

    const cards = sub.querySelector('#mobCards');
    routines.forEach(r => {
      const wk = sessionsThisWeek(r.id).length;
      const last = lastSessionDate(r.id);
      const done = loggedToday(r.id);
      const el = document.createElement('div');
      el.className = 'panel';
      el.style.cssText = 'margin-bottom:10px;padding:14px 14px 10px;';
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px;">
              <strong style="font-size:0.95rem;color:var(--text-color);">${esc(r.name)}</strong>
              ${badge(r.type)}
              ${r.assignedByCoach ? '<span title="Coach assigned" style="font-size:1rem;">🧭</span>' : ''}
            </div>
            <div style="font-size:0.78rem;color:var(--secondary-text);">
              📍 ${esc(r.targetArea)} &nbsp;·&nbsp; ${wk} / ${r.frequencyPerWeek} this week &nbsp;·&nbsp; Last: ${last ? new Date(last).toLocaleDateString() : 'Never'}
            </div>
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0;">
            <button class="mob-edit" data-id="${r.id}" style="background:none;border:1px solid var(--border-color);border-radius:7px;padding:4px 9px;color:var(--secondary-text);font-size:0.76rem;cursor:pointer;">Edit</button>
            <button class="mob-del"  data-id="${r.id}" style="background:none;border:1px solid rgba(200,50,50,0.3);border-radius:7px;padding:4px 9px;color:#c05060;font-size:0.76rem;cursor:pointer;">✕</button>
          </div>
        </div>
        ${r.assignedByCoach && r.coachNotes ? `<div style="background:rgba(95,168,126,0.1);border-left:3px solid var(--primary);border-radius:0 6px 6px 0;padding:5px 10px;font-size:0.8rem;color:var(--secondary-text);margin-bottom:7px;">🧭 <em>${esc(r.coachNotes)}</em></div>` : ''}
        <button class="mob-log" data-id="${r.id}" style="width:100%;background:${done?'rgba(95,168,126,0.15)':'var(--primary)'};color:${done?'var(--primary)':'#fff'};border:${done?'1px solid var(--primary)':'none'};border-radius:8px;padding:7px;font-weight:600;font-size:0.83rem;cursor:pointer;font-family:Poppins,sans-serif;">
          ${done ? '✅ Logged today' : '▶ Log session'}
        </button>
      `;
      el.querySelector('.mob-log').addEventListener('click',  () => quickLog(r.id));
      el.querySelector('.mob-edit').addEventListener('click', () => openBuilder(r));
      el.querySelector('.mob-del').addEventListener('click',  () => deleteRoutine(r.id));
      cards.appendChild(el);
    });
  }

  // ─── Log Session ──────────────────────────────────────────────
  function renderLogSession(sub) {
    const routines = getRoutines();
    const today = new Date().toISOString().slice(0,10);

    sub.innerHTML = `
      <div class="panel" style="padding:16px;margin-top:4px;">
        <h3 style="margin:0 0 14px;font-size:1rem;font-weight:700;color:var(--text-color);">Log a Session</h3>
        ${!routines.length
          ? `<p style="color:var(--secondary-text);font-size:0.88rem;">Add a routine first from <strong>My Routines</strong>.</p>`
          : `
          <label style="display:block;margin-bottom:4px;font-size:0.82rem;color:var(--secondary-text);">Routine</label>
          <select id="mobLogR" style="width:100%;margin-bottom:12px;">${routines.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
          <label style="display:block;margin-bottom:4px;font-size:0.82rem;color:var(--secondary-text);">Date</label>
          <input type="date" id="mobLogD" value="${today}" style="width:100%;margin-bottom:12px;">
          <label style="display:block;margin-bottom:4px;font-size:0.82rem;color:var(--secondary-text);">Notes (optional)</label>
          <textarea id="mobLogN" rows="2" placeholder="How did it feel?" style="width:100%;border-radius:8px;border:1px solid var(--border-color);background:var(--elevated-bg);color:var(--text-color);padding:8px;font-family:Poppins,sans-serif;font-size:0.83rem;box-sizing:border-box;margin-bottom:14px;resize:vertical;"></textarea>
          <button id="mobLogSubmit" style="width:100%;background:var(--primary);color:#fff;border:none;border-radius:10px;padding:10px;font-weight:700;font-size:0.9rem;cursor:pointer;font-family:Poppins,sans-serif;">Mark Complete ✅</button>
        `}
      </div>
    `;

    const btn = sub.querySelector('#mobLogSubmit');
    if (btn) {
      btn.addEventListener('click', async () => {
        const id    = sub.querySelector('#mobLogR').value;
        const date  = sub.querySelector('#mobLogD').value;
        const notes = sub.querySelector('#mobLogN').value.trim();
        await doLog(id, date, notes);
        _tab = 'myRoutines';
        render();
      });
    }
  }

  // ─── Library ──────────────────────────────────────────────────
  function renderLibrary(sub) {
    const filters = ['all','stretching','mobility','prehab'];
    const list = _libFilter === 'all' ? LIBRARY : LIBRARY.filter(r => r.type === _libFilter);

    sub.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px;">
        ${filters.map(f=>`<button class="mob-flt" data-f="${f}" style="background:${_libFilter===f?'var(--primary)':'var(--elevated-bg)'};color:${_libFilter===f?'#fff':'var(--secondary-text)'};border:1px solid var(--border-color);border-radius:20px;padding:5px 13px;font-size:0.78rem;cursor:pointer;font-family:Poppins,sans-serif;">${f==='all'?'All':TYPE[f].label}</button>`).join('')}
      </div>
      <div id="mobLibCards"></div>
    `;

    sub.querySelectorAll('.mob-flt').forEach(btn => {
      btn.addEventListener('click', () => { _libFilter = btn.dataset.f; renderLibrary(sub); });
    });

    const cards = sub.querySelector('#mobLibCards');
    list.forEach(lib => {
      const has = getRoutines().some(r => r._libId === lib.id);
      const el = document.createElement('div');
      el.className = 'panel';
      el.style.cssText = 'margin-bottom:10px;padding:14px;';
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:3px;">
              <strong style="color:var(--text-color);">${esc(lib.name)}</strong>${badge(lib.type)}
            </div>
            <div style="font-size:0.78rem;color:var(--secondary-text);">📍 ${esc(lib.targetArea)} · ${lib.exercises.length} exercises</div>
          </div>
          <button class="mob-copy" data-lid="${lib.id}" style="background:${has?'rgba(95,168,126,0.15)':'var(--primary)'};color:${has?'var(--primary)':'#fff'};border:${has?'1px solid var(--primary)':'none'};border-radius:8px;padding:6px 12px;font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;margin-left:8px;">${has?'✓ Added':'+ Add'}</button>
        </div>
        <div style="font-size:0.78rem;color:var(--secondary-text);">
          ${lib.exercises.map(e=>`<div style="padding:3px 0;border-bottom:1px solid var(--border-color);">• <strong>${esc(e.name)}</strong> — ${esc(e.detail)}</div>`).join('')}
        </div>
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
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:3000;display:flex;align-items:flex-end;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--card-bg);border-radius:20px 20px 0 0;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;padding:18px 16px 36px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="margin:0;font-size:1.05rem;font-weight:700;color:var(--text-color);">${routine?'Edit':'New'} Routine</h3>
          <button id="mobBClose" style="background:none;border:none;color:var(--secondary-text);font-size:1.4rem;cursor:pointer;line-height:1;">✕</button>
        </div>

        <label style="display:block;margin-bottom:3px;font-size:0.82rem;color:var(--secondary-text);">Name *</label>
        <input id="mobBName" value="${esc(_editing.name)}" placeholder="e.g. Morning Hip Mobility" style="width:100%;margin-bottom:12px;box-sizing:border-box;">

        <div style="display:flex;gap:10px;margin-bottom:12px;">
          <div style="flex:1;">
            <label style="display:block;margin-bottom:3px;font-size:0.82rem;color:var(--secondary-text);">Type</label>
            <select id="mobBType" style="width:100%;">
              <option value="stretching" ${_editing.type==='stretching'?'selected':''}>Stretching</option>
              <option value="mobility"   ${_editing.type==='mobility'  ?'selected':''}>Mobility</option>
              <option value="prehab"     ${_editing.type==='prehab'    ?'selected':''}>Prehab</option>
            </select>
          </div>
          <div style="flex:0 0 80px;">
            <label style="display:block;margin-bottom:3px;font-size:0.82rem;color:var(--secondary-text);">Days/week</label>
            <input type="number" id="mobBFreq" min="1" max="7" value="${_editing.frequencyPerWeek}" style="width:100%;box-sizing:border-box;">
          </div>
        </div>

        <label style="display:block;margin-bottom:3px;font-size:0.82rem;color:var(--secondary-text);">Target Area</label>
        <input id="mobBArea" value="${esc(_editing.targetArea)}" placeholder="e.g. Hips, Shoulders, Lower back" style="width:100%;margin-bottom:${coachActive?'12px':'16px'};box-sizing:border-box;">

        ${coachActive ? `
        <div style="background:rgba(95,168,126,0.08);border:1px solid rgba(95,168,126,0.25);border-radius:10px;padding:12px;margin-bottom:14px;">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;">
            <input type="checkbox" id="mobBCoachAssign" ${_editing.assignedByCoach?'checked':''}>
            <span style="font-size:0.85rem;color:var(--text-color);font-weight:600;">🧭 Assign to client</span>
          </label>
          <div id="mobBCoachExtra" style="display:${_editing.assignedByCoach?'block':'none'};">
            <label style="display:block;margin-bottom:3px;font-size:0.8rem;color:var(--secondary-text);">Coach notes for client</label>
            <textarea id="mobBCoachNotes" rows="2" placeholder="Instructions or context for the client…" style="width:100%;border-radius:8px;border:1px solid var(--border-color);background:var(--elevated-bg);color:var(--text-color);padding:8px;font-family:Poppins,sans-serif;font-size:0.82rem;box-sizing:border-box;resize:vertical;">${esc(_editing.coachNotes)}</textarea>
          </div>
        </div>` : ''}

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="font-size:0.88rem;color:var(--text-color);">Exercises</strong>
          <button id="mobBAddEx" style="background:none;border:1px solid var(--primary);color:var(--primary);border-radius:8px;padding:4px 12px;font-size:0.78rem;cursor:pointer;font-family:Poppins,sans-serif;">+ Add</button>
        </div>
        <div id="mobBExList"></div>
        <button id="mobBSave" style="width:100%;background:var(--primary);color:#fff;border:none;border-radius:10px;padding:11px;font-weight:700;font-size:0.9rem;cursor:pointer;margin-top:14px;font-family:Poppins,sans-serif;">Save Routine</button>
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
      el.style.cssText = 'background:var(--elevated-bg);border:1px solid var(--border-color);border-radius:10px;padding:10px;margin-bottom:8px;';
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
          <strong style="font-size:0.78rem;color:var(--secondary-text);">Exercise ${i+1}</strong>
          <button class="mob-ex-del" data-i="${i}" style="background:none;border:none;color:#c05060;cursor:pointer;font-size:0.85rem;padding:0;">✕ Remove</button>
        </div>
        <input class="mob-ex-nm"  data-i="${i}" value="${esc(ex.name)}"   placeholder="Exercise name" style="width:100%;margin-bottom:5px;box-sizing:border-box;font-size:0.83rem;">
        <input class="mob-ex-det" data-i="${i}" value="${esc(ex.detail)}" placeholder="Key cue or form note (one sentence)" style="width:100%;margin-bottom:8px;box-sizing:border-box;font-size:0.8rem;">
        <div style="display:flex;gap:8px;">
          <div style="flex:1;"><label style="font-size:0.72rem;color:var(--secondary-text);">Duration (sec)</label><input type="number" class="mob-ex-dur"  data-i="${i}" value="${ex.durationSeconds??''}" placeholder="—" min="0" style="width:100%;box-sizing:border-box;font-size:0.8rem;"></div>
          <div style="flex:1;"><label style="font-size:0.72rem;color:var(--secondary-text);">Reps</label>          <input type="number" class="mob-ex-reps" data-i="${i}" value="${ex.reps??''}"          placeholder="—" min="0" style="width:100%;box-sizing:border-box;font-size:0.8rem;"></div>
          <div style="flex:1;"><label style="font-size:0.72rem;color:var(--secondary-text);">Sets</label>          <input type="number" class="mob-ex-sets" data-i="${i}" value="${ex.sets??''}"          placeholder="—" min="0" style="width:100%;box-sizing:border-box;font-size:0.8rem;"></div>
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
    toast('Routine saved ✅');
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
    toast(`"${lib.name}" added to your routines ✅`);
    _tab = 'myRoutines'; render();
  }

  async function doLog(routineId, dateStr, notes) {
    const session = { id: genId(), routineId, username: getUser(), completedAt: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(), notes: notes||'' };
    const list = getSessions(); list.push(session); saveSessions(list);
    atSyncSession(session);
    toast('Session logged ✅');
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
