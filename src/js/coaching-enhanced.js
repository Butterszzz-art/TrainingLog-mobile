/* =============================================================
   COACHING MODE — COACH OPS
   Stats bar, bulk export, program library + builder, messaging,
   insights and client data (privacy).
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

/* ══════════════════════════════════════════════════════════════
   1. AGGREGATE STATS BAR
   ══════════════════════════════════════════════════════════════ */

function renderCoachStatsBar() {
  const container = document.getElementById('coachStatsBar');
  if (!container) return;
  const clients = _activeClients();
  if (!clients.length) { container.innerHTML = ''; return; }

  const withAdh    = clients.filter(c => c.compliancePercent !== null && c.compliancePercent !== undefined);
  const avgAdh     = withAdh.length ? Math.round(withAdh.reduce((s, c) => s + c.compliancePercent, 0) / withAdh.length) : null;
  const alertCount = clients.filter(c => _isUrgentStatus(c.alertStatus)).length;
  const watchCount = clients.filter(c => c.alertStatus === 'watch').length;
  const activeWeek = clients.filter(c => (c.workoutsLoggedThisWeek || 0) > 0).length;

  container.innerHTML = `
    <div class="mx-tiles coach-stats-tiles">
      <div class="mx-stat coach-stat-chip"><span class="mx-stat-l chip-label">Clients</span><span class="mx-stat-v chip-value">${clients.length}</span></div>
      <div class="mx-stat coach-stat-chip"><span class="mx-stat-l chip-label">Active this week</span><span class="mx-stat-v chip-value">${activeWeek}</span></div>
      <div class="mx-stat coach-stat-chip"><span class="mx-stat-l chip-label">Avg adherence</span><span class="mx-stat-v chip-value">${avgAdh === null ? '—' : `${avgAdh}<small>%</small>`}</span></div>
      <div class="mx-stat coach-stat-chip coach-stat--alert${alertCount ? ' is-on' : ''}"><span class="mx-stat-l chip-label">Needs action</span><span class="mx-stat-v chip-value">${alertCount}</span></div>
      <div class="mx-stat coach-stat-chip coach-stat--watch${watchCount ? ' is-on' : ''}"><span class="mx-stat-l chip-label">Watch</span><span class="mx-stat-v chip-value">${watchCount}</span></div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════
   2. BULK EXPORT (CSV / print)
   ══════════════════════════════════════════════════════════════ */

const _bulkSelected = new Set();
window._bulkSelected = _bulkSelected;

window.clearBulkSelection = function () {
  _bulkSelected.clear();
  _updateBulkToolbar();
  document.querySelectorAll('.coach-client-select').forEach(cb => { cb.checked = false; });
};

function initBulkActions() {
  const dashboard = document.getElementById('coachDashboardContent');
  if (!dashboard) return;
  dashboard.addEventListener('change', e => {
    const cb = e.target.closest('.coach-client-select');
    if (!cb) return;
    const id = cb.dataset.clientId;
    if (cb.checked) _bulkSelected.add(id);
    else            _bulkSelected.delete(id);
    _updateBulkToolbar();
  });
}

function _updateBulkToolbar() {
  const toolbar = document.getElementById('coachBulkToolbar');
  if (!toolbar) return;
  const count = _bulkSelected.size;
  if (count === 0) { toolbar.hidden = true; return; }
  toolbar.hidden = false;
  const countEl = toolbar.querySelector('.coach-bulk-count');
  if (countEl) countEl.textContent = `${count} client${count > 1 ? 's' : ''} selected`;
}

function _exportRows() {
  return _activeClients().filter(c => _bulkSelected.has(c.id)).map(c => [
    c.name, c.archetype, c.currentProgram || c.activeProgramName || '',
    _dash(c.compliancePercent), _dash(c.lastCheckInDate), _dash(c.workoutsLoggedThisWeek),
    _dash(c.currentBodyweight), c.alertStatus
  ]);
}
const _EXPORT_HEADER = ['Name', 'Mode', 'Program', 'Compliance %', 'Last check-in', 'Sessions this week', 'Bodyweight (kg)', 'Status'];

function bulkExportCSV() {
  const rows = _exportRows();
  if (!rows.length) return;
  const csv = [_EXPORT_HEADER, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `coach-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  _showExportToast('CSV exported');
}

function bulkExportPDF() {
  const rows = _exportRows();
  if (!rows.length) return;
  const statusColor = s => (_isUrgentStatus(s) ? '#c0392b' : s === 'watch' ? '#e67e22' : '#27ae60');
  const body = rows.map(r => `<tr>${r.slice(0, -1).map(v => `<td>${_escH(v)}</td>`).join('')}<td style="color:${statusColor(r[r.length - 1])}">${_escH(r[r.length - 1])}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Coach Progress Report — ${new Date().toLocaleDateString()}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      h1 { font-size: 1.4rem; margin-bottom: 4px; }
      p  { font-size: 0.85rem; color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
      th { background: #f0f0f0; padding: 8px 10px; text-align: left; border: 1px solid #ddd; }
      td { padding: 7px 10px; border: 1px solid #ddd; }
      tr:nth-child(even) td { background: #fafafa; }
      @media print { @page { margin: 1cm; } }
    </style></head><body>
    <h1>Progress Report</h1>
    <p>Generated by Pocket Coach · ${new Date().toLocaleString()} · ${rows.length} client(s)</p>
    <table><thead><tr>${_EXPORT_HEADER.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    <script>window.onload=()=>window.print()<\/script>
    </body></html>`;
  window.openReportWindow(html, { title: 'Coach Progress Report', filename: 'coach-report.html' });
  _showExportToast('Report opened for printing');
}

window.bulkExportCSV = bulkExportCSV;
window.bulkExportPDF = bulkExportPDF;

/* ══════════════════════════════════════════════════════════════
   3. PROGRAM LIBRARY + BUILDER
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
  'Cardio / CF': ['Box Jump', 'Kettlebell Swing', 'Assault Bike', 'Row Erg', 'Double-Under', 'Thruster'],
};

const PROGRAM_TEMPLATES = {
  bodybuilding: {
    name: 'BB Push-Pull-Legs',
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
    name: 'PL Strength Block',
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
    name: 'CF GPP Week',
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
  return { id: null, name: 'New Program', days: Object.fromEntries(DAYS.map(d => [d, []])) };
}
function _normalizeProgramState(p) {
  return { id: p.id || null, name: p.name || 'Program', days: Object.fromEntries(DAYS.map(d => [d, ((p.days && p.days[d]) || []).map(_toExercise)])) };
}

let _progState = _emptyProgram();
let _progActiveDay = 'Mon';

function renderCoachProgramBuilder() {
  const container = document.getElementById('coachSub_programs');
  if (!container) return;

  container.innerHTML = `
    <div class="prog-builder-layout">
      <div class="prog-canvas">
        <section class="pod mx-pod prog-head">
          <div class="mx-field prog-canvas-title">
            <label class="mx-lbl" for="progNameInput">Program name</label>
            <div class="mx-well mx-well--text"><input type="text" id="progNameInput" value="${_escH(_progState.name)}" placeholder="Program name" maxlength="80" oninput="_progState.name=this.value"></div>
          </div>
          <div class="prog-canvas-actions">
            <button type="button" class="mx-cta prog-save-btn" onclick="saveCoachProgram()"><span>Save to library</span><span class="mx-cta-icon"><span class="ui-icon">${ICONS.check}</span></span></button>
            <button type="button" class="mx-outline" onclick="newCoachProgram()">New</button>
          </div>
          <div class="mx-field">
            <span class="mx-lbl">Start from a template</span>
            <div class="prog-template-bar">
              <button type="button" class="prog-template-btn" onclick="applyProgTemplate('bodybuilding')">Bodybuilding</button>
              <button type="button" class="prog-template-btn" onclick="applyProgTemplate('powerlifting')">Powerlifting</button>
              <button type="button" class="prog-template-btn" onclick="applyProgTemplate('crossfit')">CrossFit</button>
              <button type="button" class="prog-template-btn prog-template-clear" onclick="clearProgram()">Clear</button>
            </div>
          </div>
        </section>

        <section class="pod mx-pod prog-week" aria-label="Weekly plan">
          <div class="pod-row">
            <h4 class="pod-title mx-h3">Week</h4>
            <span class="mx-chip mx-chip--sm mx-chip--green" id="progActiveDayLbl">Adding to ${_progActiveDay}</span>
          </div>
          <p class="mx-sub prog-hint">Tap a day, then tap exercises below to add them. Edit sets×reps on each one (e.g. 4x8-12). On desktop you can also drag exercises onto a day.</p>
          <div class="prog-week-grid" id="progWeekGrid">
            ${DAYS.map(day => _buildDayColHTML(day)).join('')}
          </div>
        </section>
      </div>

      <section class="pod mx-pod exercise-library" aria-label="Exercise library">
        <div class="pod-row"><h4 class="pod-title mx-h3">Exercises</h4></div>
        <div class="mx-well mx-well--text"><input type="text" class="exercise-library-search" id="exLibSearch" placeholder="Search exercises…" aria-label="Search exercises" oninput="filterExLib(this.value)"></div>
        <div class="exercise-custom-add">
          <div class="mx-well mx-well--text"><input type="text" id="exCustomInput" placeholder="Add custom exercise…" aria-label="Custom exercise name" maxlength="60" onkeydown="if(event.key==='Enter'){event.preventDefault();addCustomExercise();}"></div>
          <button type="button" class="exercise-custom-add-btn mx-iconbtn" aria-label="Add custom exercise" onclick="addCustomExercise()"><span class="ui-icon">${ICONS.plus}</span></button>
        </div>
        <div id="exLibList">${_buildExLibHTML()}</div>
      </section>

      <p class="mx-sub prog-assign-bar">Saved programs can be assigned from a client's page (Clients → Open client → Program). The client gets the full plan and a Start button.</p>

      <div id="savedProgsList"><div class="mx-empty">Loading your library…</div></div>
    </div>`;

  _bindDragAndDrop();
  _bindExLibClicks();
  _bindSchemeInputs();
  renderSavedProgramsList();
}

window.setProgActiveDay = function (day) {
  _progActiveDay = day;
  document.querySelectorAll('.prog-day-col').forEach(col => {
    const on = col.dataset.day === day;
    col.classList.toggle('is-active', on);
    col.querySelector('.prog-day-label')?.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const lbl = document.getElementById('progActiveDayLbl');
  if (lbl) lbl.textContent = 'Adding to ' + day;
};

/* ── Custom exercises (coach-defined, kept on this device) ─── */

function _getCustomExercises() {
  try { return JSON.parse(localStorage.getItem('coachCustomExercises_v1')) || []; } catch { return []; }
}
function _saveCustomExercises(list) {
  localStorage.setItem('coachCustomExercises_v1', JSON.stringify(list));
}

function _buildCustomExHTML(filter) {
  const custom = _getCustomExercises();
  const filtered = filter ? custom.filter(name => name.toLowerCase().includes(filter)) : custom;
  if (!filtered.length) return '';
  return `<div class="exercise-category exercise-category-custom">
    <div class="exercise-category-label">Custom</div>
    <div class="exercise-items">
    ${filtered.map(name => `
      <div class="exercise-item exercise-item-custom" draggable="true" data-exercise="${_escH(name)}" role="button" tabindex="0" aria-label="Add ${_escH(name)}">
        <span class="exercise-item-name">${_escH(name)}</span>
        <button type="button" class="exercise-item-remove" title="Remove custom exercise" aria-label="Remove ${_escH(name)} from custom list"><span class="ui-icon">${ICONS.x}</span></button>
      </div>`).join('')}
    </div>
  </div>`;
}

function _refreshExLib(filter) {
  const exLibList = document.getElementById('exLibList');
  if (!exLibList) return;
  exLibList.innerHTML = _buildExLibHTML(filter);
  _bindDragAndDrop();
}

function _bindExLibClicks() {
  const list = document.getElementById('exLibList');
  if (!list || list._customBound) return;
  list.addEventListener('click', e => {
    const btn = e.target.closest('.exercise-item-remove');
    if (!btn) return;
    e.stopPropagation();
    const name = btn.closest('.exercise-item')?.dataset.exercise;
    if (name) removeCustomExercise(name);
  });
  list._customBound = true;
}

window.addCustomExercise = function () {
  const input = document.getElementById('exCustomInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  const custom = _getCustomExercises();
  if (custom.some(n => n.toLowerCase() === name.toLowerCase())) {
    if (window.showToast) window.showToast('Already in your custom list.');
    input.value = '';
    return;
  }
  custom.unshift(name);
  _saveCustomExercises(custom);
  input.value = '';
  _refreshExLib(document.getElementById('exLibSearch')?.value || '');
  input.focus();
};

window.removeCustomExercise = function (name) {
  _saveCustomExercises(_getCustomExercises().filter(n => n.toLowerCase() !== String(name).toLowerCase()));
  _refreshExLib(document.getElementById('exLibSearch')?.value || '');
};

function _buildExLibHTML(filter) {
  filter = (filter || '').toLowerCase();
  const builtIn = Object.entries(EXERCISE_LIBRARY).map(([cat, names]) => {
    const filtered = filter ? names.filter(n => n.toLowerCase().includes(filter)) : names;
    if (!filtered.length) return '';
    return `<div class="exercise-category">
      <div class="exercise-category-label">${cat}</div>
      <div class="exercise-items">
      ${filtered.map(n => `
        <div class="exercise-item" draggable="true" data-exercise="${_escH(n)}" role="button" tabindex="0" aria-label="Add ${_escH(n)}">
          <span class="exercise-item-name">${_escH(n)}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
  return _buildCustomExHTML(filter) + builtIn;
}

function _dayColInner(day) {
  const exercises = _progState.days[day] || [];
  if (!exercises.length) return '<div class="prog-day-rest">Rest</div>';
  return exercises.map((ex, i) => `
    <div class="prog-exercise-slot" data-day="${day}" data-idx="${i}">
      <span class="prog-exercise-slot-name">${_escH(ex.name)}</span>
      <input class="prog-scheme" type="text" value="${_formatScheme(ex)}" data-day="${day}" data-idx="${i}" aria-label="Sets and reps for ${_escH(ex.name)}" maxlength="9">
      <button type="button" class="prog-exercise-slot-remove" onclick="event.stopPropagation();removeProgExercise('${day}',${i})" title="Remove" aria-label="Remove ${_escH(ex.name)} from ${day}"><span class="ui-icon">${ICONS.x}</span></button>
    </div>`).join('');
}

function _buildDayColHTML(day) {
  const count = (_progState.days[day] || []).length;
  const active = day === _progActiveDay;
  return `
    <div class="prog-day-col${active ? ' is-active' : ''}" id="progDay_${day}" data-day="${day}">
      <button type="button" class="prog-day-label" onclick="setProgActiveDay('${day}')" aria-pressed="${active}">
        <span>${day}</span><span class="prog-day-count">${count || ''}</span>
      </button>
      <div class="prog-day-slots">${_dayColInner(day)}</div>
    </div>`;
}

function _bindSchemeInputs() {
  const grid = document.getElementById('progWeekGrid');
  if (!grid || grid._schemeBound) return;
  grid.addEventListener('change', e => {
    const input = e.target.closest('.prog-scheme');
    if (!input) return;
    const ex = (_progState.days[input.dataset.day] || [])[Number(input.dataset.idx)];
    if (!ex) return;
    const parsed = _parseScheme(input.value);
    if (!parsed) {
      input.value = _formatScheme(ex);
      if (window.showToast) window.showToast('Use sets x reps, e.g. 4x8 or 3x8-12.', 'warn');
      return;
    }
    delete ex.repsMax;
    Object.assign(ex, parsed);
    input.value = _formatScheme(ex);
  });
  grid._schemeBound = true;
}

function _addToDay(day, name) {
  _progState.days[day] = [...(_progState.days[day] || []), { name, sets: DEFAULT_SETS, reps: DEFAULT_REPS }];
  _refreshDayCol(day);
}

function _bindExerciseItemDrag() {
  // Drag = desktop; tap/Enter = add to the active day (touch screens have
  // no HTML5 drag-and-drop).
  document.querySelectorAll('.exercise-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/exercise', item.dataset.exercise);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    const add = () => { if (item.dataset.exercise) _addToDay(_progActiveDay, item.dataset.exercise); };
    item.addEventListener('click', e => { if (e.target.closest('.exercise-item-remove')) return; add(); });
    item.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.exercise-item-remove')) { e.preventDefault(); add(); }
    });
  });
}

function _bindDayColDrop(col) {
  // Day columns persist across refreshes (only their innerHTML changes), so
  // bind once or a single drop would fire N times.
  if (col._dropBound) return;
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', e => {
    e.preventDefault();
    col.classList.remove('drag-over');
    const exercise = e.dataTransfer.getData('text/exercise');
    if (exercise && col.dataset.day) _addToDay(col.dataset.day, exercise);
  });
  col._dropBound = true;
}

function _bindDragAndDrop() {
  _bindExerciseItemDrag();
  document.querySelectorAll('.prog-day-col').forEach(_bindDayColDrop);
}

function _refreshDayCol(day) {
  const col = document.getElementById('progDay_' + day);
  if (!col) return;
  const slots = col.querySelector('.prog-day-slots');
  if (slots) slots.innerHTML = _dayColInner(day);
  const count = col.querySelector('.prog-day-count');
  if (count) count.textContent = (_progState.days[day] || []).length || '';
}

function _refreshAllDays() {
  const nameInput = document.getElementById('progNameInput');
  if (nameInput) nameInput.value = _progState.name;
  DAYS.forEach(_refreshDayCol);
}

window.removeProgExercise = function (day, idx) {
  _progState.days[day].splice(idx, 1);
  _refreshDayCol(day);
};

window.filterExLib = function (q) { _refreshExLib(q); };

window.applyProgTemplate = function (key) {
  const tmpl = PROGRAM_TEMPLATES[key];
  if (!tmpl) return;
  window.showConfirm(`Load "${tmpl.name}"? This replaces the current week.`).then(ok => {
    if (!ok) return;
    _progState = { ..._normalizeProgramState(tmpl), id: null };
    _refreshAllDays();
  });
};

window.clearProgram = function () {
  _progState.days = Object.fromEntries(DAYS.map(d => [d, []]));
  _refreshAllDays();
};

window.newCoachProgram = function () {
  _progState = _emptyProgram();
  _refreshAllDays();
};

window.saveCoachProgram = async function () {
  const name = String(_progState.name || '').trim();
  if (!name) { window.showToast('Give the program a name.', 'warn'); return; }
  const total = DAYS.reduce((n, d) => n + (_progState.days[d] || []).length, 0);
  if (!total) { window.showToast('Add at least one exercise.', 'warn'); return; }
  if (!_progState.id) _progState.id = 'prog_' + Date.now().toString(36);
  const btn = document.querySelector('.prog-save-btn');
  if (btn) btn.disabled = true;
  try {
    await window.CoachProgramLibrary.save(_progState.id, { name, days: _progState.days });
    _showExportToast(`"${name}" saved to your library`);
    renderSavedProgramsList();
  } catch (err) {
    window.showToast(err.message || 'Could not save. Check your connection.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

async function renderSavedProgramsList() {
  const container = document.getElementById('savedProgsList');
  if (!container) return;
  let programs;
  try {
    programs = await window.CoachProgramLibrary.list(true);
  } catch {
    container.innerHTML = '<div class="mx-empty">Couldn\'t load your library. Check your connection.</div>';
    return;
  }
  if (!programs.length) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <section class="pod mx-pod" aria-label="Your program library">
      <div class="pod-row"><h4 class="pod-title mx-h3">Your Library</h4><span class="mx-meta">${programs.length}</span></div>
      <div>
      ${programs.map(p => `
        <div class="mx-row saved-prog-row">
          <div class="mx-row-main">
            <span class="mx-row-title">${_escH(p.name)}</span>
            <span class="mx-row-sub">${DAYS.filter(d => (p.days?.[d] || []).length).join(', ') || 'No days'} · ${p.exerciseCount || 0} exercises</span>
          </div>
          <div class="saved-prog-actions">
            <button type="button" class="mx-outline" data-prog-load="${_escH(p.id)}">Edit</button>
            <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-prog-delete="${_escH(p.id)}" aria-label="Delete ${_escH(p.name)}"><span class="ui-icon">${ICONS.x}</span></button>
          </div>
        </div>`).join('')}
      </div>
    </section>`;
  container.onclick = e => {
    const load = e.target.closest('[data-prog-load]');
    const del = e.target.closest('[data-prog-delete]');
    const id = load ? load.dataset.progLoad : del ? del.dataset.progDelete : null;
    const prog = programs.find(p => p.id === id);
    if (!prog) return;
    if (load) {
      _progState = _normalizeProgramState(prog);
      _refreshAllDays();
      document.getElementById('progNameInput')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    window.showConfirm(`Delete "${prog.name}" from your library? Clients it was assigned to keep their copy.`, { danger: true }).then(async ok => {
      if (!ok) return;
      try {
        await window.CoachProgramLibrary.remove(prog.id);
        if (_progState.id === prog.id) _progState.id = null;
        renderSavedProgramsList();
      } catch (err) {
        window.showToast(err.message || 'Could not delete.', 'error');
      }
    });
  };
}

/* ══════════════════════════════════════════════════════════════
   4. MESSAGING (coach → client notes)
   POST/GET /api/coach/clients/:id/notes; each note is mirrored into the
   client's app (Settings → Your Coach). One-way: clients can't reply in
   the app yet.
   ══════════════════════════════════════════════════════════════ */

let _activeThreadClientId = null;
let _serverThreads = {}; // clientId -> notes[] | null (null = load error)

async function _loadThreadFromServer(clientId) {
  try {
    const data = await window.coachApi('GET', `/api/coach/clients/${encodeURIComponent(clientId)}/notes`);
    _serverThreads[clientId] = Array.isArray(data.notes) ? data.notes.slice().reverse() : [];
  } catch {
    _serverThreads[clientId] = null;
  }
}

function renderCoachMessaging() {
  const container = document.getElementById('coachSub_messaging');
  if (!container) return;
  const clients = _activeClients();

  const clientListHTML = clients.length
    ? clients.map(c => {
        const initials = c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        return `
          <button type="button" class="coach-client-list-item${_activeThreadClientId === c.id ? ' active' : ''}"
               data-thread-client="${_escH(c.id)}" data-client-id="${_escH(c.id)}" aria-pressed="${_activeThreadClientId === c.id}">
            <span class="coach-client-list-avatar" data-avatar-user="${_escH(c.name)}">${_escH(initials)}</span>
            <span>${_escH(c.name)}</span>
          </button>`;
      }).join('')
    : '<div class="mx-empty">No linked clients yet.</div>';

  container.innerHTML = `
    <div class="coach-messaging-layout">
      <div class="coach-client-list-panel" role="group" aria-label="Clients">${clientListHTML}</div>
      <div id="coachThreadContainer">
        ${_activeThreadClientId ? _buildThreadHTML(_activeThreadClientId) : '<div class="mx-empty">Select a client to view notes.</div>'}
      </div>
    </div>`;
  container.querySelector('.coach-client-list-panel').onclick = e => {
    const btn = e.target.closest('[data-thread-client]');
    if (btn) openMessageThread(btn.dataset.threadClient);
  };
}

function _buildThreadHTML(clientId) {
  const client = _activeClients().find(c => c.id === clientId);
  const thread = _serverThreads[clientId];
  let msgs;
  if (thread === undefined) msgs = '<div class="coach-thread-note">Loading…</div>';
  else if (thread === null) msgs = '<div class="coach-thread-note coach-thread-note--err">Couldn\'t load notes. Check your connection.</div>';
  else if (!thread.length) msgs = '<div class="coach-thread-note">No notes yet. Send the first one.</div>';
  else {
    msgs = thread.map(m => {
      const ms = m.createdAt?._seconds ? m.createdAt._seconds * 1000 : m.createdAt;
      return `
        <div class="coach-message from-coach">
          <div>${_escH(m.text)}</div>
          <div class="coach-message-meta">${ms ? new Date(ms).toLocaleString() : ''}</div>
        </div>`;
    }).join('');
  }

  return `
    <section class="pod mx-pod coach-thread" aria-label="Notes to ${_escH(client?.name || '')}">
      <div class="coach-thread-header"><span class="mx-kicker">Notes to</span><span class="mx-row-title">${_escH(client?.name || '')}</span></div>
      <div class="coach-thread-messages" id="threadMessages">${msgs}</div>
      <div class="coach-thread-input">
        <div class="mx-well mx-well--text mx-well--sel coach-msg-type">
          <select id="msgType" aria-label="Note type">
            <option value="note">Note</option>
            <option value="alert">Heads-up</option>
            <option value="praise">Praise</option>
          </select>
        </div>
        <div class="mx-well mx-well--area"><textarea id="msgText" placeholder="Write a note. ${_escH(client?.name || 'Your client')} sees it in Settings → Your Coach." aria-label="Note"></textarea></div>
        <button type="button" class="coach-send-btn mx-cta" onclick="sendCoachMessage()"><span>Send</span><span class="mx-cta-icon"><span class="ui-icon">${ICONS.chevronRight}</span></span></button>
      </div>
    </section>`;
}

window.openMessageThread = async function (clientId) {
  _activeThreadClientId = clientId;
  const threadContainer = document.getElementById('coachThreadContainer');
  delete _serverThreads[clientId];
  if (threadContainer) threadContainer.innerHTML = _buildThreadHTML(clientId);
  document.querySelectorAll('.coach-client-list-item').forEach(el => {
    const on = el.dataset.clientId === clientId;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', String(on));
  });
  await _loadThreadFromServer(clientId);
  if (_activeThreadClientId === clientId && threadContainer) threadContainer.innerHTML = _buildThreadHTML(clientId);
};

window.sendCoachMessage = async function () {
  const textEl = document.getElementById('msgText');
  const text = textEl?.value.trim();
  const type = document.getElementById('msgType')?.value || 'note';
  if (!text || !_activeThreadClientId) return;
  const prefix = { alert: '[HEADS-UP] ', praise: '[PRAISE] ' }[type] || '';
  const clientId = _activeThreadClientId;
  const sendBtn = document.querySelector('.coach-send-btn');
  if (sendBtn) sendBtn.disabled = true;
  try {
    await window.coachApi('POST', `/api/coach/clients/${encodeURIComponent(clientId)}/notes`, { text: prefix + text });
    if (textEl) textEl.value = '';
    await _loadThreadFromServer(clientId);
    const threadContainer = document.getElementById('coachThreadContainer');
    if (threadContainer) threadContainer.innerHTML = _buildThreadHTML(clientId);
    const msgs = document.getElementById('threadMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } catch (err) {
    if (window.showToast) window.showToast(err.message || 'Could not send. Try again.', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
};

/* ══════════════════════════════════════════════════════════════
   5. INSIGHTS
   ══════════════════════════════════════════════════════════════ */

let _analyticsCharts = {};

function renderCoachAnalytics() {
  const container = document.getElementById('coachSub_analytics');
  if (!container) return;
  const clients = _activeClients();
  if (!clients.length) {
    container.innerHTML = '<div class="mx-empty">Insights appear once clients have accepted your invite and opened the app.</div>';
    return;
  }

  container.innerHTML = `
    <div class="coach-analytics-grid">
      <section class="pod mx-pod coach-chart-card">
        <div class="pod-row"><h4 class="pod-title mx-h3">Adherence (%)</h4></div>
        <canvas id="adherenceChart" height="140" aria-label="Adherence per client"></canvas>
      </section>
      <section class="pod mx-pod coach-chart-card">
        <div class="pod-row"><h4 class="pod-title mx-h3">Sessions this week</h4></div>
        <canvas id="workoutsChart" height="160" aria-label="Sessions this week per client"></canvas>
      </section>
      <section class="pod mx-pod coach-chart-card">
        <div class="pod-row"><h4 class="pod-title mx-h3">Status</h4></div>
        <div class="coach-chart-box"><canvas id="alertPieChart" aria-label="Status breakdown"></canvas></div>
      </section>
    </div>
    <section class="pod mx-pod coach-chart-card" aria-label="Client flags">
      <div class="pod-row"><h4 class="pod-title mx-h3">Client flags</h4><span class="mx-meta">${clients.length}</span></div>
      <div class="coach-insight-list">${clients.map(_buildInsightRow).join('')}</div>
    </section>`;

  _renderAdherenceChart(clients);
  _renderWorkoutsChart(clients);
  _renderAlertPieChart(clients);
}

function _buildInsightRow(c) {
  const adh = c.compliancePercent;
  const wk = c.workoutsLoggedThisWeek;
  const wΔ = c.weeklyWeightChangePercent;
  const alerts = Array.isArray(c.alerts) ? c.alerts : [];
  const tags = alerts.map(a => `<span class="mx-tag ${a.severity === 'action' ? 'mx-tag--red' : 'mx-tag--brass'}" title="${_escH(a.reason)}">${_escH(a.label)}</span>`).join('');
  return `
    <article class="coach-insight-row">
      <div class="pod-row">
        <div class="coach-insight-id"><span class="mx-row-title">${_escH(c.name)}</span><span class="mx-row-sub">${_escH(c.currentPhase || '—')}</span></div>
      </div>
      <div class="mx-tiles">
        <div class="mx-stat"><span class="mx-stat-l">Compliance</span><span class="mx-stat-v">${adh === null || adh === undefined ? '—' : `${adh}<small>%</small>`}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">Sessions/wk</span><span class="mx-stat-v">${_dash(wk)}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">Weight Δ/wk</span><span class="mx-stat-v">${wΔ === null || wΔ === undefined ? '—' : `${wΔ > 0 ? '+' : ''}${Number(wΔ).toFixed(2)}<small>%</small>`}</span></div>
      </div>
      <div class="mx-tags">${tags || `<span class="mx-tag">${c.lastSharedAt ? 'No flags' : 'No data shared yet'}</span>`}</div>
    </article>`;
}

const _chartTick = { color: '#86998e' };
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
        backgroundColor: withData.map(c => (c.compliancePercent >= 80 ? '#6fae8b' : c.compliancePercent >= 65 ? '#c79a54' : '#c9707c')),
        borderRadius: 6
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: _chartTick, grid: _chartGrid }, x: { ticks: _chartTick } } }
  });
}

function _renderWorkoutsChart(clients) {
  const canvas = document.getElementById('workoutsChart');
  if (!canvas || !window.Chart) return;
  if (_analyticsCharts.workouts) _analyticsCharts.workouts.destroy();
  const withData = clients.filter(c => c.workoutsLoggedThisWeek !== null && c.workoutsLoggedThisWeek !== undefined);
  _analyticsCharts.workouts = new Chart(canvas, {
    type: 'bar',
    data: { labels: withData.map(c => c.name), datasets: [{ label: 'Sessions', data: withData.map(c => c.workoutsLoggedThisWeek), backgroundColor: '#3d9d73', borderRadius: 6 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { min: 0, ticks: { ..._chartTick, stepSize: 1 }, grid: _chartGrid }, x: { ticks: _chartTick } } }
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
    data: { labels: ['On track', 'Watch', 'Needs action'], datasets: [{ data: [clients.length - watch - action, watch, action], backgroundColor: ['#6fae8b', '#c79a54', '#c9707c'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#c9d2cc', font: { size: 11 } } } } }
  });
}

/* ══════════════════════════════════════════════════════════════
   6. CLIENT DATA (privacy)
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
      `<span class="mx-chip mx-chip--sm ${s[k] === false ? '' : 'mx-chip--green'}">${_SHARE_LABELS[k]}${s[k] === false ? ' off' : ''}</span>`).join('');
    return `
      <article class="coach-consent-row">
        <div class="pod-row">
          <div class="coach-insight-id"><span class="mx-row-title">${_escH(c.name)}</span><span class="mx-row-sub">Last shared: ${_escH(c.lastSharedAt || 'never')}</span></div>
        </div>
        <div class="mx-tags">${chips}</div>
        <div class="coach-consent-actions">
          <button type="button" class="mx-outline" data-gdpr-export="${_escH(c.id)}">Export</button>
          <button type="button" class="mx-outline mx-outline--danger" data-gdpr-remove="${_escH(c.id)}">Remove client</button>
        </div>
      </article>`;
  }).join('') || '<div class="mx-empty">No linked clients.</div>';

  container.innerHTML = `
    <section class="pod mx-pod gdpr-section">
      <div class="pod-row"><h4 class="pod-title mx-h3">Client data</h4></div>
      <p class="mx-sub">Clients choose what you can see when they accept your invite, and can change it or leave at any time from their own app. Removing a client deletes everything they shared with you.</p>
      <div class="coach-consent-list">${rows}</div>
    </section>
    <section class="pod mx-pod gdpr-section">
      <div class="pod-row"><h4 class="pod-title mx-h3">Your coach data</h4></div>
      <p class="mx-sub">Download your program library and roster as JSON.</p>
      <div class="gdpr-action-row">
        <button type="button" class="mx-outline mx-outline--block gdpr-export-btn" data-gdpr-export-all><span class="ui-icon">${ICONS.download}</span> Export all (JSON)</button>
      </div>
    </section>`;

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
    initBulkActions();

    // Re-render the stats bar whenever the roster refreshes.
    const origRender = window.renderCoachDashboard;
    if (typeof origRender === 'function') {
      window.renderCoachDashboard = async function () {
        await origRender();
        renderCoachStatsBar();
        _injectBulkCheckboxes();
      };
    }

    document.getElementById('coachBulkCSV')?.addEventListener('click', bulkExportCSV);
    document.getElementById('coachBulkPDF')?.addEventListener('click', bulkExportPDF);
  });
}

function _injectBulkCheckboxes() {
  document.querySelectorAll('.coach-client-card:not(.is-pending)').forEach(card => {
    const clientId = card.dataset.clientId;
    if (!clientId || card.querySelector('.coach-client-select')) return;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'coach-client-select';
    cb.dataset.clientId = clientId;
    cb.setAttribute('aria-label', 'Select for export');
    card.prepend(cb);
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
