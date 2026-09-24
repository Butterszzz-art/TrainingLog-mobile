/* =============================================================
   COACHING MODE — COACH OPS
   Roster summary + export, program library and editor, inbox,
   insights and client data (privacy), in the native coach layout
   (css/coach-native.css, shell in src/js/coach-native.js).
   Depends on: index.html's coachDashboardState, coachApi(),
               renderCoachDashboard(), Chart.js
   ============================================================= */

'use strict';

function _coachUser() {
  return window.currentUser || localStorage.getItem('fitnessAppUser') || 'coach';
}

// Roster rows that are linked (pending invites have no data yet).
function _activeClients() {
  return ((window.coachDashboardState && window.coachDashboardState.clients) || []).filter(c => !c.isPending);
}

function _isUrgentStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'action' || s === 'alert';
}

const _dash = v => (v === null || v === undefined || v === '' ? '—' : v);
const _icon = (name) => (window.CN_ICONS && window.CN_ICONS[name]) || '';
const _initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

function _toneFor(c) {
  if (_isUrgentStatus(c.alertStatus)) return 'is-action';
  if (c.alertStatus === 'watch') return 'is-watch';
  return '';
}

function _title(text, actionHtml) {
  return `<div class="cn-header"><h1 class="cn-title">${_escH(text)}</h1>${actionHtml || ''}</div>`;
}

/* ══════════════════════════════════════════════════════════════
   1. ROSTER SUMMARY + EXPORT
   ══════════════════════════════════════════════════════════════ */

// One line under the Clients title: count, who needs you, adherence.
function renderCoachStatsBar() {
  const el = document.getElementById('coachStatsBar');
  if (!el) return;
  const all = (window.coachDashboardState && window.coachDashboardState.clients) || [];
  const clients = _activeClients();
  const pending = all.length - clients.length;
  if (!all.length) { el.textContent = ''; return; }
  const need = clients.filter(c => _isUrgentStatus(c.alertStatus) || c.alertStatus === 'watch').length;
  const withAdh = clients.filter(c => c.compliancePercent !== null && c.compliancePercent !== undefined);
  const avg = withAdh.length ? Math.round(withAdh.reduce((s, c) => s + c.compliancePercent, 0) / withAdh.length) : null;
  el.textContent = [
    `${clients.length} client${clients.length === 1 ? '' : 's'}`,
    need ? `${need} need${need === 1 ? 's' : ''} you` : 'everyone on track',
    avg !== null ? `${avg}% avg adherence` : '',
    pending ? `${pending} pending` : ''
  ].filter(Boolean).join(' · ');
}

const _EXPORT_HEADER = ['Name', 'Mode', 'Program', 'Compliance %', 'Last check-in', 'Sessions this week', 'Bodyweight (kg)', 'Status'];

function exportRosterCSV() {
  const rows = _activeClients().map(c => [
    c.name, c.archetype, c.currentProgram || c.activeProgramName || '',
    _dash(c.compliancePercent), _dash(c.lastCheckInDate), _dash(c.workoutsLoggedThisWeek),
    _dash(c.currentBodyweight), c.alertStatus
  ]);
  if (!rows.length) { window.showToast('No clients to export yet.', 'warn'); return; }
  const csv = [_EXPORT_HEADER, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `coach-roster-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  _showExportToast('Roster exported');
}
window.exportRosterCSV = exportRosterCSV;
// Older toolbar hooks (index.html's hidden bulk bar) export the whole roster now.
window.bulkExportCSV = exportRosterCSV;
window.bulkExportPDF = exportRosterCSV;
window.clearBulkSelection = function () {};

/* ══════════════════════════════════════════════════════════════
   2. PROGRAM LIBRARY + EDITOR
   Programs live on the server (GET/PUT/DELETE /api/coach/programs) so
   the phone and the desktop console share one library, and assigning
   one sends its full content to the client.
   ══════════════════════════════════════════════════════════════ */

const LEGACY_PROGRAMS_KEY = 'coachPrograms_v1';

window.CoachProgramLibrary = (function () {
  let cache = null;
  let migrated = false;

  // One-off: programs saved before the library moved to the server lived
  // only in this browser. Upload them, then drop the local copy.
  async function migrateLocal() {
    if (migrated) return;
    migrated = true;
    let local = [];
    try { local = JSON.parse(localStorage.getItem(LEGACY_PROGRAMS_KEY) || '[]'); } catch { local = []; }
    if (!Array.isArray(local) || !local.length) return;
    let failed = 0;
    for (const p of local) {
      const id = String(p.id || 'prog_' + Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g, '_');
      try { await window.coachApi('PUT', `/api/coach/programs/${encodeURIComponent(id)}`, { name: p.name, days: p.days }); }
      catch { failed++; }
    }
    if (!failed) localStorage.removeItem(LEGACY_PROGRAMS_KEY);
  }

  async function list(force) {
    if (cache && !force) return cache;
    await migrateLocal();
    const data = await window.coachApi('GET', '/api/coach/programs');
    cache = Array.isArray(data.programs) ? data.programs : [];
    return cache;
  }
  async function save(id, program) {
    const data = await window.coachApi('PUT', `/api/coach/programs/${encodeURIComponent(id)}`, program);
    cache = null;
    return data.program;
  }
  async function remove(id) {
    await window.coachApi('DELETE', `/api/coach/programs/${encodeURIComponent(id)}`);
    cache = null;
  }
  return { list, save, remove, cached: () => cache || [] };
})();

const EXERCISE_LIBRARY = {
  'Chest': ['Bench Press', 'Incline DB Press', 'Cable Fly', 'Push-Up', 'Dips'],
  'Back': ['Deadlift', 'Pull-Up', 'Barbell Row', 'Lat Pulldown', 'Seated Cable Row'],
  'Legs': ['Squat', 'Leg Press', 'Romanian DL', 'Leg Curl', 'Leg Extension', 'Calf Raise'],
  'Shoulders': ['Overhead Press', 'Lateral Raise', 'Face Pull', 'Arnold Press'],
  'Arms': ['Barbell Curl', 'Tricep Pushdown', 'Hammer Curl', 'Skull Crusher'],
  'Core': ['Plank', 'Hanging Leg Raise', 'Cable Crunch', 'Ab Wheel'],
  'Conditioning': ['Box Jump', 'Kettlebell Swing', 'Assault Bike', 'Row Erg', 'Double-Under', 'Thruster'],
};

const PROGRAM_TEMPLATES = {
  bodybuilding: {
    name: 'Push-Pull-Legs',
    days: {
      Mon: ['Bench Press', 'Incline DB Press', 'Cable Fly', 'Overhead Press', 'Lateral Raise'],
      Tue: ['Deadlift', 'Barbell Row', 'Lat Pulldown', 'Hammer Curl', 'Barbell Curl'],
      Wed: ['Squat', 'Leg Press', 'Romanian DL', 'Leg Curl', 'Calf Raise'],
      Thu: ['Overhead Press', 'Arnold Press', 'Lateral Raise', 'Tricep Pushdown', 'Skull Crusher'],
      Fri: ['Pull-Up', 'Seated Cable Row', 'Face Pull', 'Barbell Curl', 'Hammer Curl'],
      Sat: ['Squat', 'Leg Press', 'Leg Extension', 'Calf Raise', 'Plank'],
      Sun: [],
    }
  },
  powerlifting: {
    name: 'Strength Block',
    days: {
      Mon: [{ name: 'Squat', sets: 5, reps: 5 }, 'Romanian DL', 'Leg Curl', 'Plank'],
      Tue: [{ name: 'Bench Press', sets: 5, reps: 5 }, 'Incline DB Press', 'Tricep Pushdown', 'Face Pull'],
      Wed: [],
      Thu: [{ name: 'Deadlift', sets: 3, reps: 5 }, 'Barbell Row', 'Lat Pulldown', 'Hanging Leg Raise'],
      Fri: [{ name: 'Bench Press', sets: 4, reps: 8 }, 'Overhead Press', 'Lateral Raise', 'Skull Crusher'],
      Sat: [{ name: 'Squat', sets: 4, reps: 8 }, 'Romanian DL', 'Calf Raise'],
      Sun: [],
    }
  },
  crossfit: {
    name: 'Conditioning Week',
    days: {
      Mon: ['Squat', 'Box Jump', 'Assault Bike'],
      Tue: ['Deadlift', 'Kettlebell Swing', 'Row Erg'],
      Wed: ['Thruster', 'Double-Under', 'Plank'],
      Thu: [],
      Fri: ['Bench Press', 'Push-Up', 'Assault Bike'],
      Sat: ['Squat', 'Deadlift', 'Row Erg', 'Kettlebell Swing'],
      Sun: [],
    }
  },
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_SETS = 3;
const DEFAULT_REPS = 10;

// Exercises are { name, sets, reps, repsMax? }; older saves used plain names.
function _toExercise(ex) {
  if (typeof ex === 'string') return { name: ex, sets: DEFAULT_SETS, reps: DEFAULT_REPS };
  return { name: ex.name, sets: ex.sets || DEFAULT_SETS, reps: ex.reps || DEFAULT_REPS, ...(ex.repsMax ? { repsMax: ex.repsMax } : {}) };
}
function _formatScheme(ex) {
  return `${ex.sets}×${ex.reps}${ex.repsMax ? '-' + ex.repsMax : ''}`;
}
// "4x8-12", "4×8", "3 x 5" → { sets, reps, repsMax? }; null if unreadable.
function _parseScheme(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})\s*[x×*]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/i);
  if (!m) return null;
  const out = { sets: Number(m[1]), reps: Number(m[2]) };
  if (m[3] && Number(m[3]) > out.reps) out.repsMax = Number(m[3]);
  return out.sets > 0 && out.reps > 0 ? out : null;
}

function _emptyProgram() {
  return { id: null, name: 'New program', days: Object.fromEntries(DAYS.map(d => [d, []])) };
}
function _normalizeProgramState(p) {
  return { id: p.id || null, name: p.name || 'Program', days: Object.fromEntries(DAYS.map(d => [d, ((p.days && p.days[d]) || []).map(_toExercise)])) };
}

let _progState = _emptyProgram();
let _progView = 'list';       // 'list' | 'edit'
let _progDay = 'Mon';
let _progDirty = false;

function _getCustomExercises() {
  try { return JSON.parse(localStorage.getItem('coachCustomExercises_v1')) || []; } catch { return []; }
}
function _saveCustomExercises(list) {
  localStorage.setItem('coachCustomExercises_v1', JSON.stringify(list));
}

function renderCoachProgramBuilder() {
  const container = document.getElementById('coachSub_programs');
  if (!container) return;
  if (_progView === 'edit') { _renderProgramEditor(container); return; }

  container.innerHTML = `
    ${_title('Programs', `<button type="button" class="cn-iconbtn" data-prog-new aria-label="New program">${_icon('plus')}</button>`)}
    <p class="cn-summary">Build once, assign to any client. They get the full plan with a Start button.</p>
    <div id="savedProgsList"><div class="cn-empty">Loading your library…</div></div>
    <h2 class="cn-group-label">Start from a template</h2>
    <div class="cn-group cn-group--plain">
      ${Object.entries(PROGRAM_TEMPLATES).map(([key, t]) => `
        <button type="button" class="cn-row" data-prog-template="${key}">
          <span class="cn-row-main"><span class="cn-row-title">${_escH(t.name)}</span><span class="cn-row-sub">${DAYS.filter(d => t.days[d].length).length} days a week</span></span>
          <span class="cn-chev">${_icon('chevron')}</span>
        </button>`).join('')}
    </div>`;

  container.onclick = (e) => {
    if (e.target.closest('[data-prog-new]')) { _openEditor(_emptyProgram()); return; }
    const tpl = e.target.closest('[data-prog-template]');
    if (tpl) { _openEditor({ ..._normalizeProgramState(PROGRAM_TEMPLATES[tpl.dataset.progTemplate]), id: null }); return; }
    const open = e.target.closest('[data-prog-open]');
    if (open) {
      const prog = window.CoachProgramLibrary.cached().find(p => p.id === open.dataset.progOpen);
      if (prog) _openEditor(_normalizeProgramState(prog));
    }
  };
  renderSavedProgramsList();
}

async function renderSavedProgramsList() {
  const el = document.getElementById('savedProgsList');
  if (!el) return;
  let programs;
  try {
    programs = await window.CoachProgramLibrary.list(true);
  } catch {
    el.innerHTML = '<div class="cn-empty">Couldn\'t load your library. Check your connection.</div>';
    return;
  }
  const assignedCount = (id) => _activeClients().filter(c => c.currentProgramId === id).length;
  el.innerHTML = programs.length ? `
    <h2 class="cn-group-label">Your library</h2>
    <div class="cn-group cn-group--plain">
      ${programs.map(p => {
        const n = assignedCount(p.id);
        const days = DAYS.filter(d => (p.days?.[d] || []).length).length;
        return `
        <button type="button" class="cn-row" data-prog-open="${_escH(p.id)}">
          <span class="cn-row-main"><span class="cn-row-title">${_escH(p.name)}</span>
            <span class="cn-row-sub">${days} day${days === 1 ? '' : 's'}, ${p.exerciseCount || 0} exercises${n ? `, ${n} client${n === 1 ? '' : 's'}` : ''}</span></span>
          <span class="cn-chev">${_icon('chevron')}</span>
        </button>`;
      }).join('')}
    </div>` : `<div class="cn-empty"><strong>No programs yet</strong>Tap + or start from a template below.</div>`;
}

function _openEditor(program) {
  _progState = program;
  _progDay = DAYS.find(d => (program.days[d] || []).length) || 'Mon';
  _progView = 'edit';
  _progDirty = false;
  renderCoachProgramBuilder();
  window.scrollTo({ top: 0 });
}

function _dayTitle(day) {
  const n = (_progState.days[day] || []).length;
  return n ? `${day}, ${n} exercise${n === 1 ? '' : 's'}` : `${day}, rest day`;
}

function _renderProgramEditor(container) {
  const total = DAYS.reduce((n, d) => n + _progState.days[d].length, 0);
  const trainingDays = DAYS.filter(d => _progState.days[d].length).length;
  const list = _progState.days[_progDay];
  const assigned = _progState.id ? _activeClients().filter(c => c.currentProgramId === _progState.id).length : 0;

  container.innerHTML = `
    <div class="cn-navbar">
      <button type="button" class="cn-link" data-prog-back>${_icon('back')}Programs</button>
      <button type="button" class="cn-link" data-prog-save style="font-weight:600">Save</button>
    </div>
    <div class="cn-field" style="padding:0 4px">
      <label for="progNameInput">Program name</label>
      <input id="progNameInput" class="cn-name-input" type="text" maxlength="80" value="${_escH(_progState.name)}">
      <span class="cn-sub">${trainingDays} training day${trainingDays === 1 ? '' : 's'}, ${total} exercise${total === 1 ? '' : 's'}${assigned ? `. Assigned to ${assigned} client${assigned === 1 ? '' : 's'}` : ''}.</span>
    </div>

    <div class="cn-days" role="tablist" aria-label="Day">
      ${DAYS.map(d => `<button type="button" role="tab" class="cn-day${_progState.days[d].length ? ' has-work' : ''}" aria-selected="${d === _progDay}" data-prog-day="${d}">${d.slice(0, 2)}<i></i></button>`).join('')}
    </div>

    <div class="cn-card-head" style="margin:18px 4px 8px"><h2 class="cn-h2">${_dayTitle(_progDay)}</h2>
      ${list.length ? `<span class="cn-caption">${list.reduce((n, e) => n + e.sets, 0)} sets</span>` : ''}</div>
    <div class="cn-group cn-group--plain" id="progDayList">
      ${list.map((ex, i) => `
        <div class="cn-row" style="min-height:60px">
          <span class="cn-row-main"><span class="cn-row-title">${_escH(ex.name)}</span></span>
          <input class="cn-scheme" type="text" value="${_formatScheme(ex)}" data-prog-scheme="${i}" aria-label="Sets and reps for ${_escH(ex.name)}" maxlength="9">
          <button type="button" class="cn-row-remove" data-prog-remove="${i}" aria-label="Remove ${_escH(ex.name)}">${_icon('x')}</button>
        </div>`).join('')}
      <button type="button" class="cn-row cn-add-row" data-prog-add>${_icon('plus')}Add exercise</button>
    </div>
    <p class="cn-caption" style="margin:8px 4px 0">Type sets×reps as 4x8 or 3x8-12.</p>

    <div class="cn-sticky">
      <button type="button" class="cn-btn cn-btn--primary" data-prog-assign>Assign to clients</button>
    </div>
    ${_progState.id ? `<button type="button" class="cn-leave" data-prog-delete>Delete program</button>` : ''}`;

  container.oninput = (e) => {
    if (e.target.id === 'progNameInput') { _progState.name = e.target.value; _progDirty = true; }
  };
  container.onchange = (e) => {
    const input = e.target.closest('[data-prog-scheme]');
    if (!input) return;
    const ex = _progState.days[_progDay][Number(input.dataset.progScheme)];
    const parsed = _parseScheme(input.value);
    if (!parsed) {
      input.value = _formatScheme(ex);
      window.showToast('Use sets x reps, e.g. 4x8 or 3x8-12.', 'warn');
      return;
    }
    delete ex.repsMax;
    Object.assign(ex, parsed);
    input.value = _formatScheme(ex);
    _progDirty = true;
  };
  container.onclick = async (e) => {
    const t = (sel) => e.target.closest(sel);
    let el;
    if (t('[data-prog-back]')) {
      if (_progDirty && !(await window.showConfirm('Leave without saving your changes?', { confirmText: 'Leave' }))) return;
      _progView = 'list';
      renderCoachProgramBuilder();
      return;
    }
    if ((el = t('[data-prog-day]'))) { _progDay = el.dataset.progDay; renderCoachProgramBuilder(); return; }
    if ((el = t('[data-prog-remove]'))) {
      _progState.days[_progDay].splice(Number(el.dataset.progRemove), 1);
      _progDirty = true;
      renderCoachProgramBuilder();
      return;
    }
    if (t('[data-prog-add]')) { _openExercisePicker(); return; }
    if (t('[data-prog-save]')) { await saveCoachProgram(); return; }
    if (t('[data-prog-assign]')) { _openAssignSheet(); return; }
    if (t('[data-prog-delete]')) {
      const ok = await window.showConfirm(`Delete "${_progState.name}" from your library? Clients it was assigned to keep their copy.`, { danger: true, confirmText: 'Delete' });
      if (!ok) return;
      try {
        await window.CoachProgramLibrary.remove(_progState.id);
        _progView = 'list';
        renderCoachProgramBuilder();
      } catch (err) {
        window.showToast(err.message || 'Could not delete.', 'error');
      }
    }
  };
}

function _openExercisePicker() {
  const buildList = (filter) => {
    const f = (filter || '').toLowerCase();
    const custom = _getCustomExercises().filter(n => !f || n.toLowerCase().includes(f));
    const groups = (custom.length ? [['Your exercises', custom]] : []).concat(
      Object.entries(EXERCISE_LIBRARY).map(([cat, names]) => [cat, names.filter(n => !f || n.toLowerCase().includes(f))]));
    const html = groups.filter(([, names]) => names.length).map(([cat, names]) => `
      <h3 class="cn-group-label" style="margin-top:6px">${_escH(cat)}</h3>
      <div class="cn-group cn-group--plain">${names.map(n => `<button type="button" class="cn-row" style="min-height:50px" data-pick="${_escH(n)}"><span class="cn-row-main"><span class="cn-row-title" style="font-weight:500">${_escH(n)}</span></span><span class="cn-chev" style="color:var(--cn-accent)">${_icon('plus')}</span></button>`).join('')}</div>`).join('');
    const exact = f && groups.some(([, names]) => names.some(n => n.toLowerCase() === f));
    const addCustom = f && !exact
      ? `<button type="button" class="cn-btn cn-btn--block" data-pick-custom="${_escH(filter.trim())}">Add "${_escH(filter.trim())}"</button>` : '';
    return addCustom + (html || (addCustom ? '' : '<div class="cn-empty">No matches.</div>'));
  };
  const sheet = window.cnSheet(`
    <h2 class="cn-sheet-title">Add to ${_escH(_progDay)}</h2>
    <div class="cn-field"><label for="exPickSearch">Search or type a new exercise</label><input id="exPickSearch" class="cn-input" type="search" autocomplete="off"></div>
    <div id="exPickList">${buildList('')}</div>`, { label: 'Add exercise' });
  const listEl = sheet.el.querySelector('#exPickList');
  sheet.el.querySelector('#exPickSearch').addEventListener('input', (e) => { listEl.innerHTML = buildList(e.target.value); });
  sheet.el.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    const custom = e.target.closest('[data-pick-custom]');
    const name = pick ? pick.dataset.pick : custom ? custom.dataset.pickCustom : null;
    if (!name) return;
    if (custom) {
      const list = _getCustomExercises();
      if (!list.some(n => n.toLowerCase() === name.toLowerCase())) { list.unshift(name); _saveCustomExercises(list); }
    }
    _progState.days[_progDay].push({ name, sets: DEFAULT_SETS, reps: DEFAULT_REPS });
    _progDirty = true;
    renderCoachProgramBuilder();
    window.showToast(`${name} added to ${_progDay}`);
  });
}

window.saveCoachProgram = async function () {
  const name = String(_progState.name || '').trim();
  if (!name) { window.showToast('Give the program a name.', 'warn'); return false; }
  const total = DAYS.reduce((n, d) => n + (_progState.days[d] || []).length, 0);
  if (!total) { window.showToast('Add at least one exercise.', 'warn'); return false; }
  if (!_progState.id) _progState.id = 'prog_' + Date.now().toString(36);
  try {
    await window.CoachProgramLibrary.save(_progState.id, { name, days: _progState.days });
    _progDirty = false;
    _showExportToast(`"${name}" saved`);
    renderCoachProgramBuilder();
    return true;
  } catch (err) {
    window.showToast(err.message || 'Could not save. Check your connection.', 'error');
    return false;
  }
};

async function _openAssignSheet() {
  const clients = _activeClients();
  if (!clients.length) { window.showToast('No linked clients yet. Invite one from Clients.', 'warn'); return; }
  const sheet = window.cnSheet(`
    <h2 class="cn-sheet-title">Assign "${_escH(_progState.name)}"</h2>
    <p class="cn-sub" style="margin:0">Saves the program, then sends it to the clients you pick. Anyone on another program switches to this one.</p>
    <div class="cn-group cn-group--plain">
      ${clients.map(c => `
        <label class="cn-row" style="min-height:58px">
          <span class="cn-avatar cn-avatar--sm ${_toneFor(c)}">${_escH(_initials(c.name))}</span>
          <span class="cn-row-main"><span class="cn-row-title">${_escH(c.name)}</span><span class="cn-row-sub">${_escH(c.currentProgram || 'No program')}</span></span>
          <input type="checkbox" class="cn-check" value="${_escH(c.id)}" ${c.currentProgramId && c.currentProgramId === _progState.id ? 'checked disabled' : ''}>
        </label>`).join('')}
    </div>
    <p class="cn-error" id="assignErr" aria-live="polite"></p>
    <button type="button" class="cn-btn cn-btn--primary cn-btn--block" data-assign-go>Assign</button>`, { label: 'Assign program', autofocus: false });
  const go = sheet.el.querySelector('[data-assign-go]');
  go.addEventListener('click', async () => {
    const ids = [...sheet.el.querySelectorAll('.cn-check:checked:not(:disabled)')].map(i => i.value);
    if (!ids.length) { sheet.el.querySelector('#assignErr').textContent = 'Pick at least one client.'; return; }
    go.disabled = true;
    if (!(await window.saveCoachProgram())) { go.disabled = false; return; }
    const results = await Promise.all(ids.map(id =>
      window.coachApi('PATCH', `/api/coach/clients/${encodeURIComponent(id)}`, { programId: _progState.id }).then(() => true, () => false)));
    const ok = results.filter(Boolean).length;
    sheet.close();
    window.showToast(ok === ids.length ? `Sent to ${ok} client${ok === 1 ? '' : 's'}` : `Sent to ${ok} of ${ids.length}. Try the others again.`, ok === ids.length ? undefined : 'error');
    if (typeof window.renderCoachDashboard === 'function') await window.renderCoachDashboard();
    renderCoachProgramBuilder();
  });
}

/* ══════════════════════════════════════════════════════════════
   3. INBOX (coach → client notes)
   POST/GET /api/coach/clients/:id/notes; each note is mirrored into the
   client's app (Settings → Your Coach). One-way: clients can't reply in
   the app yet.
   ══════════════════════════════════════════════════════════════ */

let _activeThreadClientId = null;
let _serverThreads = {}; // clientId -> notes[] (oldest first) | null (load error)

async function _loadThreadFromServer(clientId) {
  try {
    const data = await window.coachApi('GET', `/api/coach/clients/${encodeURIComponent(clientId)}/notes`);
    // Oldest first, by timestamp (don't rely on the server's order).
    _serverThreads[clientId] = Array.isArray(data.notes) ? data.notes.slice().sort((a, b) => _noteMs(a) - _noteMs(b)) : [];
  } catch {
    _serverThreads[clientId] = null;
  }
}

const _noteMs = (n) => (n && n.createdAt && n.createdAt._seconds ? n.createdAt._seconds * 1000 : (n && n.createdAt) || 0);
function _relTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff <= 0) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function renderCoachMessaging() {
  const container = document.getElementById('coachSub_messaging');
  if (!container) return;
  if (_activeThreadClientId) { _renderThread(container, _activeThreadClientId); return; }
  const clients = _activeClients();

  const rows = () => clients.map(c => {
    const notes = _serverThreads[c.id];
    const last = Array.isArray(notes) && notes.length ? notes[notes.length - 1] : null;
    const sub = notes === undefined ? 'Loading…' : last ? `You: ${last.text}` : 'No notes yet';
    return `
      <button type="button" class="cn-row" data-thread-client="${_escH(c.id)}">
        <span class="cn-avatar ${_toneFor(c)}">${_escH(_initials(c.name))}</span>
        <span class="cn-row-main"><span class="cn-row-title">${_escH(c.name)}</span><span class="cn-row-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escH(sub)}</span></span>
        <span class="cn-caption">${last ? _escH(_relTime(_noteMs(last))) : ''}</span>
      </button>`;
  }).join('');

  const paint = () => {
    container.innerHTML = `
      ${_title('Inbox')}
      <p class="cn-summary">Notes land in your client's app under Your Coach.</p>
      ${clients.length ? `<div class="cn-group">${rows()}</div>` : '<div class="cn-empty"><strong>No linked clients yet</strong>Invite someone from Clients to start a thread.</div>'}`;
  };
  paint();
  container.onclick = (e) => {
    const b = e.target.closest('[data-thread-client]');
    if (b) window.openMessageThread(b.dataset.threadClient);
  };
  // Previews: fetch each thread once, repaint as they arrive.
  Promise.all(clients.filter(c => _serverThreads[c.id] === undefined).map(c => _loadThreadFromServer(c.id)))
    .then(() => { if (!_activeThreadClientId && document.getElementById('coachSub_messaging')?.classList.contains('active')) paint(); });
}

function _renderThread(container, clientId) {
  const client = _activeClients().find(c => c.id === clientId) || { name: 'Client', id: clientId };
  const thread = _serverThreads[clientId];
  const ci = client.latestCheckIn;
  const context = ci && ci.date
    ? `<div class="cn-context">${_icon('clipboard')}Check-in ${_escH(new Date(ci.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}: ${[['sleep', 'sleep'], ['energy', 'energy'], ['stress', 'stress']].filter(([k]) => ci[k] != null).map(([k, l]) => `${l} ${ci[k]}`).join(', ') || 'no scores'}</div>`
    : '';

  let body;
  if (thread === undefined) body = '<div class="cn-empty">Loading…</div>';
  else if (thread === null) body = '<div class="cn-empty">Couldn\'t load notes. Check your connection.</div>';
  else if (!thread.length) body = `<div class="cn-empty">No notes yet. Say hello to ${_escH(client.name)}.</div>`;
  else {
    let lastDay = '';
    body = thread.map(n => {
      const ms = _noteMs(n);
      const day = ms ? new Date(ms).toDateString() : '';
      const sep = day && day !== lastDay ? `<span class="cn-day-sep">${_escH(new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>` : '';
      lastDay = day;
      return `${sep}<div class="cn-bubble">${_escH(n.text)}</div>`;
    }).join('') + '<span class="cn-bubble-meta">Delivered</span>';
  }

  container.innerHTML = `
    <div class="cn-thread-head">
      <button type="button" class="cn-link" data-thread-back style="justify-self:start">${_icon('back')}Inbox</button>
      <div class="cn-thread-who"><span class="cn-avatar cn-avatar--sm ${_toneFor(client)}">${_escH(_initials(client.name))}</span>${_escH(client.name)}</div>
      <button type="button" class="cn-link" data-thread-open style="justify-self:end;font-size:15px">Profile</button>
    </div>
    <div class="cn-thread" id="threadMessages">${context}${body}</div>
    <div class="cn-composer">
      <div class="cn-quick">
        <button type="button" class="is-ai" data-quick="ai">Draft with AI</button>
        <button type="button" data-quick="Quick reminder to send your weekly check-in when you get a minute.">Check-in reminder</button>
        <button type="button" data-quick="Great work this week. Keep it going.">Praise</button>
      </div>
      <div class="cn-compose-row">
        <label for="msgText" class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Message to ${_escH(client.name)}</label>
        <textarea id="msgText" class="cn-textarea" rows="1" placeholder="Message ${_escH(client.name)}"></textarea>
        <button type="button" class="cn-send" data-thread-send aria-label="Send">${_icon('send')}</button>
      </div>
    </div>`;

  const textEl = container.querySelector('#msgText');
  const grow = () => { textEl.style.height = 'auto'; textEl.style.height = Math.min(textEl.scrollHeight, 160) + 'px'; };
  textEl.addEventListener('input', grow);
  container.onclick = async (e) => {
    const t = (sel) => e.target.closest(sel);
    let el;
    if (t('[data-thread-back]')) { _activeThreadClientId = null; renderCoachMessaging(); return; }
    if (t('[data-thread-open]')) { if (typeof window.openCoachClientDetail === 'function') window.openCoachClientDetail(clientId); return; }
    if (t('[data-thread-send]')) { window.sendCoachMessage(); return; }
    if ((el = t('[data-quick]'))) {
      if (el.dataset.quick !== 'ai') { textEl.value = el.dataset.quick; grow(); textEl.focus(); return; }
      el.disabled = true;
      el.textContent = 'Drafting…';
      try {
        textEl.value = await window.requestCoachDraftMessage(clientId);
        grow();
        textEl.focus();
      } catch (err) {
        window.showToast(err.name === 'AbortError' ? 'Draft timed out. Try again.' : (err.message || 'Draft failed.'), 'error');
      } finally {
        el.disabled = false;
        el.textContent = 'Draft with AI';
      }
    }
  };
  const msgs = container.querySelector('#threadMessages');
  if (msgs) msgs.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

window.openMessageThread = async function (clientId) {
  _activeThreadClientId = clientId;
  const container = document.getElementById('coachSub_messaging');
  if (container) _renderThread(container, clientId);
  window.scrollTo({ top: 0 });
  await _loadThreadFromServer(clientId);
  if (_activeThreadClientId === clientId && container) _renderThread(container, clientId);
};

// From a client's page: jump to Inbox with their thread open.
window.openCoachInbox = function (clientId) {
  _activeThreadClientId = clientId;
  if (typeof window.openCoachOps === 'function') window.openCoachOps('messaging');
  window.openMessageThread(clientId);
};

window.sendCoachMessage = async function () {
  const textEl = document.getElementById('msgText');
  const text = textEl?.value.trim();
  if (!text || !_activeThreadClientId) return;
  const clientId = _activeThreadClientId;
  const sendBtn = document.querySelector('[data-thread-send]');
  if (sendBtn) sendBtn.disabled = true;
  try {
    await window.coachApi('POST', `/api/coach/clients/${encodeURIComponent(clientId)}/notes`, { text });
    await _loadThreadFromServer(clientId);
    const container = document.getElementById('coachSub_messaging');
    if (container && _activeThreadClientId === clientId) _renderThread(container, clientId);
  } catch (err) {
    if (window.showToast) window.showToast(err.message || 'Could not send. Try again.', 'error');
    if (sendBtn) sendBtn.disabled = false;
  }
};

/* ══════════════════════════════════════════════════════════════
   4. INSIGHTS
   ══════════════════════════════════════════════════════════════ */

let _analyticsCharts = {};

function renderCoachAnalytics() {
  const container = document.getElementById('coachSub_analytics');
  if (!container) return;
  const clients = _activeClients();
  if (!clients.length) {
    container.innerHTML = `${_title('Insights')}<div class="cn-empty"><strong>Nothing to show yet</strong>Insights appear once clients accept your invite and open the app.</div>`;
    return;
  }

  container.innerHTML = `
    ${_title('Insights')}
    <p class="cn-summary">From what your clients share. Anyone not sharing a metric is left out of that chart.</p>
    <section class="cn-card"><div class="cn-card-head"><span class="cn-card-title">Adherence</span><span class="cn-caption">last 4 weeks</span></div>
      <canvas id="adherenceChart" height="150" aria-label="Adherence per client"></canvas></section>
    <section class="cn-card"><div class="cn-card-head"><span class="cn-card-title">Sessions this week</span></div>
      <canvas id="workoutsChart" height="150" aria-label="Sessions this week per client"></canvas></section>
    <section class="cn-card"><div class="cn-card-head"><span class="cn-card-title">Status</span></div>
      <div style="position:relative;height:190px"><canvas id="alertPieChart" aria-label="Status breakdown"></canvas></div></section>
    <h2 class="cn-group-label">Client flags</h2>
    <div class="cn-group">${clients.map(_buildInsightRow).join('')}</div>`;

  container.onclick = (e) => {
    const b = e.target.closest('[data-insight-client]');
    if (b && typeof window.openCoachClientDetail === 'function') window.openCoachClientDetail(b.dataset.insightClient);
  };
  _renderAdherenceChart(clients);
  _renderWorkoutsChart(clients);
  _renderAlertPieChart(clients);
}

function _buildInsightRow(c) {
  const alerts = Array.isArray(c.alerts) ? c.alerts : [];
  const facts = [
    c.compliancePercent != null ? `${c.compliancePercent}% adherence` : null,
    c.workoutsLoggedThisWeek != null ? `${c.workoutsLoggedThisWeek} sessions` : null,
    c.weeklyWeightChangePercent != null ? `${c.weeklyWeightChangePercent > 0 ? '+' : ''}${Number(c.weeklyWeightChangePercent).toFixed(2)}%/wk` : null
  ].filter(Boolean).join(' · ');
  const sub = alerts.length
    ? `<span class="cn-row-sub ${_toneFor(c)}">${_escH(alerts.map(a => a.label).join(', '))}</span>`
    : `<span class="cn-row-sub">${_escH(facts || (c.lastSharedAt ? 'No flags' : 'No data shared yet'))}</span>`;
  return `
    <button type="button" class="cn-row" data-insight-client="${_escH(c.id)}">
      <span class="cn-avatar ${_toneFor(c)}">${_escH(_initials(c.name))}</span>
      <span class="cn-row-main"><span class="cn-row-title">${_escH(c.name)}</span>${sub}</span>
      <span class="cn-chev">${_icon('chevron')}</span>
    </button>`;
}

const _chartTick = { color: '#7D8983', font: { family: 'Geist, system-ui, sans-serif' } };
const _chartGrid = { color: 'rgba(255,255,255,0.06)' };

function _renderAdherenceChart(clients) {
  const canvas = document.getElementById('adherenceChart');
  if (!canvas || !window.Chart) return;
  if (_analyticsCharts.adherence) _analyticsCharts.adherence.destroy();
  const withData = clients.filter(c => c.compliancePercent !== null && c.compliancePercent !== undefined);
  _analyticsCharts.adherence = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: withData.map(c => c.name),
      datasets: [{
        label: 'Adherence %',
        data: withData.map(c => c.compliancePercent),
        backgroundColor: withData.map(c => (c.compliancePercent >= 80 ? '#3DBE85' : c.compliancePercent >= 65 ? '#E9C07A' : '#F2A098')),
        borderRadius: 6
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: _chartTick, grid: _chartGrid }, x: { ticks: _chartTick, grid: { display: false } } } }
  });
}

function _renderWorkoutsChart(clients) {
  const canvas = document.getElementById('workoutsChart');
  if (!canvas || !window.Chart) return;
  if (_analyticsCharts.workouts) _analyticsCharts.workouts.destroy();
  const withData = clients.filter(c => c.workoutsLoggedThisWeek !== null && c.workoutsLoggedThisWeek !== undefined);
  _analyticsCharts.workouts = new Chart(canvas, {
    type: 'bar',
    data: { labels: withData.map(c => c.name), datasets: [{ label: 'Sessions', data: withData.map(c => c.workoutsLoggedThisWeek), backgroundColor: '#3DBE85', borderRadius: 6 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { min: 0, ticks: { ..._chartTick, stepSize: 1 }, grid: _chartGrid }, x: { ticks: _chartTick, grid: { display: false } } } }
  });
}

function _renderAlertPieChart(clients) {
  const canvas = document.getElementById('alertPieChart');
  if (!canvas || !window.Chart) return;
  if (_analyticsCharts.pie) _analyticsCharts.pie.destroy();
  const watch = clients.filter(c => c.alertStatus === 'watch').length;
  const action = clients.filter(c => _isUrgentStatus(c.alertStatus)).length;
  _analyticsCharts.pie = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: ['On track', 'Watch', 'Needs action'], datasets: [{ data: [clients.length - watch - action, watch, action], backgroundColor: ['#3DBE85', '#E9C07A', '#F2A098'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { color: '#C7D0CA', font: { size: 12, family: 'Geist, system-ui, sans-serif' } } } } }
  });
}

/* ══════════════════════════════════════════════════════════════
   5. CLIENT DATA (privacy)
   What each client shares is their choice, set in their own app
   (Settings → Your Coach). This panel shows it, exports what you hold
   for a client (subject-access requests) and removes a client, which
   deletes their shared data from the server.
   ══════════════════════════════════════════════════════════════ */

const _SHARE_LABELS = { checkIns: 'Check-ins', bodyweight: 'Bodyweight', workouts: 'Workouts' };

function renderCoachGdpr() {
  const container = document.getElementById('coachSub_gdpr');
  if (!container) return;
  const clients = _activeClients();

  const rows = clients.map(c => {
    const s = c.sharing || { checkIns: true, bodyweight: true, workouts: true };
    const chips = Object.keys(_SHARE_LABELS).map(k =>
      `<span class="cn-chip ${s[k] === false ? 'is-pending' : 'is-ok'}">${_SHARE_LABELS[k]}${s[k] === false ? ' off' : ''}</span>`).join('');
    return `
      <section class="cn-card">
        <div class="cn-card-head"><span class="cn-card-title">${_escH(c.name)}</span><span class="cn-caption">Last shared ${_escH(c.lastSharedAt || 'never')}</span></div>
        <div class="cn-chips">${chips}</div>
        <div style="display:flex;gap:8px">
          <button type="button" class="cn-btn cn-btn--sm" data-gdpr-export="${_escH(c.id)}">Export</button>
          <button type="button" class="cn-btn cn-btn--sm cn-btn--danger" data-gdpr-remove="${_escH(c.id)}">Remove client</button>
        </div>
      </section>`;
  }).join('') || '<div class="cn-empty">No linked clients.</div>';

  container.innerHTML = `
    ${_title('Client data')}
    <p class="cn-summary">Clients choose what you see when they accept your invite, and can change it or leave any time. Removing a client deletes everything they shared with you.</p>
    ${rows}
    <h2 class="cn-group-label">Your coach data</h2>
    <button type="button" class="cn-btn cn-btn--block" data-gdpr-export-all>${_icon('download')} Export programs and roster (JSON)</button>`;

  container.onclick = e => {
    const exp = e.target.closest('[data-gdpr-export]');
    const rem = e.target.closest('[data-gdpr-remove]');
    if (exp) exportClientData(exp.dataset.gdprExport);
    else if (rem) deleteClientData(rem.dataset.gdprRemove);
    else if (e.target.closest('[data-gdpr-export-all]')) exportAllCoachData();
  };
}

function _downloadJSON(data, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

window.exportClientData = async function (clientId) {
  try {
    const [detail, notes] = await Promise.all([
      window.coachApi('GET', `/api/coach/clients/${encodeURIComponent(clientId)}`),
      window.coachApi('GET', `/api/coach/clients/${encodeURIComponent(clientId)}/notes`)
    ]);
    const name = detail.client?.clientName || clientId;
    _downloadJSON({ exportedAt: new Date().toISOString(), client: detail.client, notes: notes.notes || [] },
      `client-data-${String(name).replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (err) {
    window.showToast(err.message || 'Export failed.', 'error');
  }
};

window.deleteClientData = function (clientId) {
  const client = _activeClients().find(c => c.id === clientId);
  const name = client?.name || 'this client';
  window.showConfirm(`Remove ${name}? The link ends and everything they shared with you is deleted. This can't be undone.`, { danger: true, confirmText: 'Remove' }).then(async ok => {
    if (!ok) return;
    try {
      await window.coachApi('DELETE', `/api/coach/clients/${encodeURIComponent(clientId)}`);
      _showExportToast(`${name} removed`);
      if (typeof window.renderCoachDashboard === 'function') await window.renderCoachDashboard();
      renderCoachGdpr();
    } catch (err) {
      window.showToast(err.message || 'Could not remove.', 'error');
    }
  });
};

window.exportAllCoachData = async function () {
  try {
    const programs = await window.CoachProgramLibrary.list(true);
    _downloadJSON({
      exportedAt: new Date().toISOString(),
      coach: _coachUser(),
      programs,
      clients: _activeClients().map(c => ({ id: c.id, name: c.name, status: c.status, currentProgram: c.currentProgram, nutrition: c.currentNutritionSummary, sharing: c.sharing }))
    }, `all-coach-data-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (err) {
    window.showToast(err.message || 'Export failed.', 'error');
  }
};

/* ── Utilities ───────────────────────────────────────────────── */

function _showExportToast(msg) {
  if (typeof window.showToast === 'function') { window.showToast(msg); return; }
  let toast = document.getElementById('_coachExportToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = '_coachExportToast';
    toast.className = 'export-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function _escH(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════ */

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Refresh the summary line whenever the roster refreshes.
    const origRender = window.renderCoachDashboard;
    if (typeof origRender === 'function') {
      window.renderCoachDashboard = async function () {
        await origRender();
        renderCoachStatsBar();
      };
    }
  });
}

if (typeof window !== 'undefined') {
  window.renderCoachStatsBar       = renderCoachStatsBar;
  window.renderCoachAnalytics      = renderCoachAnalytics;
  window.renderCoachMessaging      = renderCoachMessaging;
  window.renderCoachGdpr           = renderCoachGdpr;
  window.renderCoachProgramBuilder = renderCoachProgramBuilder;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _parseScheme, _formatScheme, _toExercise };
}
