/* =============================================================
   COACHING MODE — ENHANCED FEATURES
   Program builder, messaging, bulk actions, data insights,
   and GDPR / privacy controls.
   Depends on: index.html's existing coachDashboardState,
               loadCoachClients(), Chart.js
   ============================================================= */

'use strict';

/* ── Storage helpers ─────────────────────────────────────────── */

function _coachStore(key, val) {
  if (val === undefined) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  localStorage.setItem(key, JSON.stringify(val));
}

function _coachUser() {
  return window.currentUser || localStorage.getItem('fitnessAppUser') || 'coach';
}

/* ── Sub-tab navigation ──────────────────────────────────────── */

function initCoachSubtabs() {
  const nav = document.getElementById('coachSubtabNav');
  if (!nav) return;
  nav.addEventListener('click', e => {
    const btn = e.target.closest('.coach-subtab');
    if (!btn) return;
    nav.querySelectorAll('.coach-subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.coachSubtab;
    document.querySelectorAll('.coach-subview').forEach(v =>
      v.classList.toggle('active', v.id === 'coachSub_' + target)
    );
    // Lazy-render each panel on first visit
    if (target === 'analytics')  renderCoachAnalytics();
    if (target === 'messaging')  renderCoachMessaging();
    if (target === 'gdpr')       renderCoachGdpr();
    if (target === 'programs')   renderCoachProgramBuilder();
  });
}

/* ══════════════════════════════════════════════════════════════
   1. AGGREGATE STATS BAR
   ══════════════════════════════════════════════════════════════ */

// The roster uses ok / watch / action; older code also called the urgent state "alert".
function _isUrgentStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'action' || s === 'alert';
}

function renderCoachStatsBar() {
  const container = document.getElementById('coachStatsBar');
  if (!container) return;
  const clients = (window.coachDashboardState?.clients) || [];
  if (!clients.length) { container.innerHTML = ''; return; }

  const total      = clients.length;
  const alertCount = clients.filter(c => _isUrgentStatus(c.alertStatus)).length;
  const watchCount = clients.filter(c => c.alertStatus === 'watch').length;
  const avgAdh     = clients.reduce((s,c) => s + (c.compliancePercent || 0), 0) / total;
  const activeWeek = clients.filter(c => (c.workoutsLoggedThisWeek || 0) > 0).length;

  container.innerHTML = `
    <div class="mx-tiles coach-stats-tiles">
      <div class="mx-stat coach-stat-chip"><span class="mx-stat-l chip-label">Clients</span><span class="mx-stat-v chip-value">${total}</span></div>
      <div class="mx-stat coach-stat-chip"><span class="mx-stat-l chip-label">Active this week</span><span class="mx-stat-v chip-value">${activeWeek}</span></div>
      <div class="mx-stat coach-stat-chip"><span class="mx-stat-l chip-label">Avg adherence</span><span class="mx-stat-v chip-value">${Math.round(avgAdh)}<small>%</small></span></div>
      <div class="mx-stat coach-stat-chip coach-stat--alert${alertCount ? ' is-on' : ''}"><span class="mx-stat-l chip-label">Needs action</span><span class="mx-stat-v chip-value">${alertCount}</span></div>
      <div class="mx-stat coach-stat-chip coach-stat--watch${watchCount ? ' is-on' : ''}"><span class="mx-stat-l chip-label">Watch</span><span class="mx-stat-v chip-value">${watchCount}</span></div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════
   2. BULK ACTIONS
   ══════════════════════════════════════════════════════════════ */

const _bulkSelected = new Set();
// Expose on window so inline onclick handlers in index.html can reach it
window._bulkSelected = _bulkSelected;

// Global helper called by the "Clear" bulk toolbar button
window.clearBulkSelection = function () {
  _bulkSelected.clear();
  _updateBulkToolbar();
  document.querySelectorAll('.coach-client-select').forEach(cb => { cb.checked = false; });
};

function initBulkActions() {
  // Delegate checkbox changes on the roster grid
  const dashboard = document.getElementById('coachDashboardContent');
  if (!dashboard) return;

  dashboard.addEventListener('change', e => {
    const cb = e.target.closest('.coach-client-select');
    if (!cb) return;
    const id = cb.dataset.clientId;
    if (cb.checked) _bulkSelected.add(id);
    else             _bulkSelected.delete(id);
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

// Bulk program-assign/macro-update were removed here (moved to
// desktop-only per product decision: mobile Coach Mode is now overview +
// quick note/reply, actual coaching work lives in coach/coach.js). Neither
// had a bulk equivalent on desktop either — only per-client — so there was
// nothing honest to redirect these buttons to; they're just gone, along
// with their local coachProgramAssignments_v1/coachNutritionAssignments_v1
// stores (nothing else reads them — see the DATA INSIGHTS section's
// GDPR export/delete, which still lists those keys defensively but they'll
// just be empty going forward).

function bulkExportCSV() {
  const clients = (window.coachDashboardState?.clients) || [];
  const selected = clients.filter(c => _bulkSelected.has(c.id));
  if (!selected.length) return;

  const header = ['Name','Archetype','Phase','Compliance%','Last Check-In','Workouts/Week','Alert Status'];
  const rows   = selected.map(c => [
    c.name, c.archetype, c.currentPhase,
    c.compliancePercent, c.lastCheckInDate,
    c.workoutsLoggedThisWeek, c.alertStatus
  ]);

  const csv = [header, ...rows].map(r => r.map(v => `"${(v ?? '').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `coach-report-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  _showExportToast('CSV exported');
}

function bulkExportPDF() {
  const clients = (window.coachDashboardState?.clients) || [];
  const selected = clients.filter(c => _bulkSelected.has(c.id));
  if (!selected.length) return;

  // Build a print-ready HTML page and open in new tab
  const rows = selected.map(c => `
    <tr>
      <td>${c.name}</td>
      <td>${c.archetype || '—'}</td>
      <td>${c.currentPhase || '—'}</td>
      <td>${c.compliancePercent ?? '—'}%</td>
      <td>${c.lastCheckInDate || '—'}</td>
      <td>${c.workoutsLoggedThisWeek ?? '—'}</td>
      <td style="color:${_isUrgentStatus(c.alertStatus) ? '#c0392b' : c.alertStatus === 'watch' ? '#e67e22' : '#27ae60'}">${c.alertStatus}</td>
    </tr>`).join('');

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
    <p>Generated by Pocket Coach · ${new Date().toLocaleString()} · ${selected.length} client(s)</p>
    <table>
      <thead><tr><th>Name</th><th>Archetype</th><th>Phase</th><th>Compliance</th><th>Last Check-In</th><th>Workouts/Week</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <script>window.onload=()=>window.print()<\/script>
    </body></html>`;

  window.openReportWindow(html, { title: 'Coach Progress Report', filename: 'coach-report.html' });
  _showExportToast('PDF report opened for printing');
}

window.bulkExportCSV      = bulkExportCSV;
window.bulkExportPDF      = bulkExportPDF;

/* ══════════════════════════════════════════════════════════════
   3. PROGRAM BUILDER
   ══════════════════════════════════════════════════════════════ */

const EXERCISE_LIBRARY = {
  'Chest': [
    { name: 'Bench Press' },
    { name: 'Incline DB Press' },
    { name: 'Cable Fly' },
    { name: 'Push-Up' },
    { name: 'Dips' },
  ],
  'Back': [
    { name: 'Deadlift' },
    { name: 'Pull-Up' },
    { name: 'Barbell Row' },
    { name: 'Lat Pulldown' },
    { name: 'Seated Cable Row' },
  ],
  'Legs': [
    { name: 'Squat' },
    { name: 'Leg Press' },
    { name: 'Romanian DL' },
    { name: 'Leg Curl' },
    { name: 'Leg Extension' },
    { name: 'Calf Raise' },
  ],
  'Shoulders': [
    { name: 'Overhead Press' },
    { name: 'Lateral Raise' },
    { name: 'Face Pull' },
    { name: 'Arnold Press' },
  ],
  'Arms': [
    { name: 'Barbell Curl' },
    { name: 'Tricep Pushdown' },
    { name: 'Hammer Curl' },
    { name: 'Skull Crusher' },
  ],
  'Core': [
    { name: 'Plank' },
    { name: 'Hanging Leg Raise' },
    { name: 'Cable Crunch' },
    { name: 'Ab Wheel' },
  ],
  'Cardio / CF': [
    { name: 'Box Jump' },
    { name: 'Kettlebell Swing' },
    { name: 'Assault Bike' },
    { name: 'Row Erg' },
    { name: 'Double-Under' },
    { name: 'Thruster' },
  ],
};

const PROGRAM_TEMPLATES = {
  bodybuilding: {
    name: 'BB Push-Pull-Legs',
    days: {
      Mon: ['Bench Press','Incline DB Press','Cable Fly','Overhead Press','Lateral Raise'],
      Tue: ['Deadlift','Barbell Row','Lat Pulldown','Hammer Curl','Barbell Curl'],
      Wed: ['Squat','Leg Press','Romanian DL','Leg Curl','Calf Raise'],
      Thu: ['Overhead Press','Arnold Press','Lateral Raise','Tricep Pushdown','Skull Crusher'],
      Fri: ['Pull-Up','Seated Cable Row','Face Pull','Barbell Curl','Hammer Curl'],
      Sat: ['Squat','Leg Press','Leg Extension','Calf Raise','Plank'],
      Sun: [],
    }
  },
  powerlifting: {
    name: 'PL Strength Block',
    days: {
      Mon: ['Squat','Romanian DL','Leg Curl','Plank'],
      Tue: ['Bench Press','Incline DB Press','Tricep Pushdown','Face Pull'],
      Wed: [],
      Thu: ['Deadlift','Barbell Row','Lat Pulldown','Hanging Leg Raise'],
      Fri: ['Bench Press','Overhead Press','Lateral Raise','Skull Crusher'],
      Sat: ['Squat','Romanian DL','Calf Raise'],
      Sun: [],
    }
  },
  crossfit: {
    name: 'CF GPP Week',
    days: {
      Mon: ['Squat','Box Jump','Assault Bike'],
      Tue: ['Deadlift','Kettlebell Swing','Row Erg'],
      Wed: ['Thruster','Double-Under','Plank'],
      Thu: [],
      Fri: ['Bench Press','Push-Up','Assault Bike'],
      Sat: ['Squat','Deadlift','Row Erg','Kettlebell Swing'],
      Sun: [],
    }
  },
};

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// In-memory state for the builder
let _progState = {
  name:    'New Program',
  days:    Object.fromEntries(DAYS.map(d => [d, []])),
  id:      null,
};

// Day the "tap an exercise to add it" action targets (drag-and-drop still works on desktop).
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
            <div class="mx-well mx-well--text"><input type="text" id="progNameInput" value="${_escH(_progState.name)}" placeholder="Program name" oninput="_progState.name=this.value"></div>
          </div>
          <div class="prog-canvas-actions">
            <button type="button" class="mx-cta prog-save-btn" onclick="saveCoachProgram()"><span>Save</span><span class="mx-cta-icon"><span class="ui-icon">${ICONS.check}</span></span></button>
            <button type="button" class="mx-outline" onclick="loadCoachProgramList()">Load</button>
          </div>
          <div class="mx-field">
            <span class="mx-lbl">Templates</span>
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
          <p class="mx-sub prog-hint">Tap a day, then tap an exercise below to add it. On desktop you can also drag exercises onto a day.</p>
          <div class="prog-week-grid" id="progWeekGrid">
            ${DAYS.map(day => _buildDayColHTML(day)).join('')}
          </div>
        </section>
      </div>

      <section class="pod mx-pod exercise-library" aria-label="Exercise library">
        <div class="pod-row"><h4 class="pod-title mx-h3">Exercise Library</h4></div>
        <div class="mx-well mx-well--text"><input type="text" class="exercise-library-search" id="exLibSearch" placeholder="Search exercises…" aria-label="Search exercises" oninput="filterExLib(this.value)"></div>
        <div class="exercise-custom-add">
          <div class="mx-well mx-well--text"><input type="text" id="exCustomInput" placeholder="Add custom exercise…" aria-label="Custom exercise name" maxlength="60" onkeydown="if(event.key==='Enter'){event.preventDefault();addCustomExercise();}"></div>
          <button type="button" class="exercise-custom-add-btn mx-iconbtn" aria-label="Add custom exercise" onclick="addCustomExercise()"><span class="ui-icon">${ICONS.plus}</span></button>
        </div>
        <div id="exLibList">${_buildExLibHTML()}</div>
      </section>

      <!-- Building/saving a program template is fine here — it's your own
           library, nothing reaches a client. Assigning one to a specific
           client is coaching work; that action lives on the desktop
           dashboard now (coach/coach.js Program tab). -->
      <p class="mx-sub prog-assign-bar">Save this program, then assign it to a client from the desktop coach dashboard.</p>

      <div id="savedProgsList"></div>
    </div>`;

  _bindDragAndDrop();
  _bindExLibClicks();
  renderSavedProgramsList();
}

window.setProgActiveDay = function(day) {
  _progActiveDay = day;
  document.querySelectorAll('.prog-day-col').forEach(col => {
    const on = col.dataset.day === day;
    col.classList.toggle('is-active', on);
    col.querySelector('.prog-day-label')?.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const lbl = document.getElementById('progActiveDayLbl');
  if (lbl) lbl.textContent = 'Adding to ' + day;
};

/* ── Custom exercises (coach-defined, not in the premade library) ─── */

function _getCustomExercises() {
  return _coachStore('coachCustomExercises_v1') || [];
}

function _saveCustomExercises(list) {
  _coachStore('coachCustomExercises_v1', list);
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

window.addCustomExercise = function() {
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

window.removeCustomExercise = function(name) {
  _saveCustomExercises(_getCustomExercises().filter(n => n.toLowerCase() !== String(name).toLowerCase()));
  _refreshExLib(document.getElementById('exLibSearch')?.value || '');
};

function _buildExLibHTML(filter) {
  filter = (filter || '').toLowerCase();
  const customHTML = _buildCustomExHTML(filter);
  const builtInHTML = Object.entries(EXERCISE_LIBRARY).map(([cat, exercises]) => {
    const filtered = filter
      ? exercises.filter(e => e.name.toLowerCase().includes(filter))
      : exercises;
    if (!filtered.length) return '';
    return `<div class="exercise-category">
      <div class="exercise-category-label">${cat}</div>
      <div class="exercise-items">
      ${filtered.map(e => `
        <div class="exercise-item" draggable="true" data-exercise="${_escH(e.name)}" role="button" tabindex="0" aria-label="Add ${_escH(e.name)}">
          <span class="exercise-item-name">${_escH(e.name)}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
  return customHTML + builtInHTML;
}

function _dayColInner(day) {
  const exercises = _progState.days[day] || [];
  if (!exercises.length) return '<div class="prog-day-rest">Rest</div>';
  return exercises.map((ex, i) => `
    <div class="prog-exercise-slot" data-day="${day}" data-idx="${i}">
      <span class="prog-exercise-slot-name">${_escH(ex)}</span>
      <button type="button" class="prog-exercise-slot-remove" onclick="event.stopPropagation();removeProgExercise('${day}',${i})" title="Remove" aria-label="Remove ${_escH(ex)} from ${day}"><span class="ui-icon">${ICONS.x}</span></button>
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

function _bindExerciseItemDrag() {
  // Library items are recreated on every refresh (search, add/remove custom),
  // so they're safe to rebind each time. Drag = desktop; tap/Enter = add to the
  // active day (touch screens have no HTML5 drag-and-drop).
  document.querySelectorAll('.exercise-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/exercise', item.dataset.exercise);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    const add = () => {
      const ex = item.dataset.exercise;
      if (!ex) return;
      _progState.days[_progActiveDay] = [...(_progState.days[_progActiveDay] || []), ex];
      _refreshDayCol(_progActiveDay);
    };
    item.addEventListener('click', e => { if (e.target.closest('.exercise-item-remove')) return; add(); });
    item.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.exercise-item-remove')) { e.preventDefault(); add(); }
    });
  });
}

function _bindDayColDrop(col) {
  // Day columns persist across drops/refreshes (only their innerHTML changes),
  // so guard against rebinding the same listeners on top of themselves —
  // that would fire one drop N times after N rebinds.
  if (col._dropBound) return;
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', e => {
    e.preventDefault();
    col.classList.remove('drag-over');
    const exercise = e.dataTransfer.getData('text/exercise');
    const day = col.dataset.day;
    if (exercise && day) {
      _progState.days[day] = [...(_progState.days[day] || []), exercise];
      _refreshDayCol(day);
    }
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
  // col itself isn't replaced, so its drop listener (bound once in
  // _bindDayColDrop) stays attached — only the slots inside change.
  const slots = col.querySelector('.prog-day-slots');
  if (slots) slots.innerHTML = _dayColInner(day);
  const count = col.querySelector('.prog-day-count');
  if (count) count.textContent = (_progState.days[day] || []).length || '';
}

window.removeProgExercise = function(day, idx) {
  _progState.days[day].splice(idx, 1);
  _refreshDayCol(day);
};

window.filterExLib = function(q) {
  _refreshExLib(q);
};

window.applyProgTemplate = function(key) {
  const tmpl = PROGRAM_TEMPLATES[key];
  if (!tmpl) return;
  window.showConfirm(`Load "${tmpl.name}" template? This will replace the current week.`).then(ok => {
    if (!ok) return;
    _progState.name = tmpl.name;
    _progState.days = Object.fromEntries(DAYS.map(d => [d, [...(tmpl.days[d] || [])]]));
    const nameInput = document.getElementById('progNameInput');
    if (nameInput) nameInput.value = _progState.name;
    DAYS.forEach(d => _refreshDayCol(d));
  });
};

window.clearProgram = function() {
  _progState.days = Object.fromEntries(DAYS.map(d => [d, []]));
  DAYS.forEach(d => _refreshDayCol(d));
};

window.saveCoachProgram = function() {
  const programs = _coachStore('coachPrograms_v1') || [];
  const now = new Date().toISOString();
  if (!_progState.id) _progState.id = 'prog_' + Date.now();
  const idx = programs.findIndex(p => p.id === _progState.id);
  const record = { id: _progState.id, name: _progState.name, days: _progState.days, savedAt: now };
  if (idx >= 0) programs[idx] = record;
  else          programs.push(record);
  _coachStore('coachPrograms_v1', programs);
  renderSavedProgramsList();
  _showExportToast(`"${_progState.name}" saved`);
};

window.loadCoachProgramList = function() {
  const programs = _coachStore('coachPrograms_v1') || [];
  if (!programs.length) { window.showToast('No saved programs yet.', 'warn'); return; }
  const opts = programs.map((p,i) => `<option value="${i}">${_escH(p.name)} (${p.savedAt?.slice(0,10)})</option>`).join('');
  const modal = document.createElement('div');
  modal.className = 'gdpr-modal-overlay';
  modal.innerHTML = `
    <div class="gdpr-modal" role="dialog" aria-modal="true" aria-label="Load program">
      <h3>Load Program</h3>
      <div class="mx-well mx-well--text mx-well--sel"><select id="_loadProgSel" aria-label="Saved program">${opts}</select></div>
      <div class="gdpr-modal-actions">
        <button type="button" class="gdpr-export-btn" onclick="this.closest('.gdpr-modal-overlay').remove()">Cancel</button>
        <button type="button" class="gdpr-save-btn" onclick="_confirmLoadProgram()">Load</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
};

window._confirmLoadProgram = function() {
  const idx = parseInt(document.getElementById('_loadProgSel')?.value);
  const programs = _coachStore('coachPrograms_v1') || [];
  const prog = programs[idx];
  if (!prog) return;
  _progState = { ...prog };
  const nameInput = document.getElementById('progNameInput');
  if (nameInput) nameInput.value = _progState.name;
  DAYS.forEach(d => _refreshDayCol(d));
  document.querySelector('.gdpr-modal-overlay')?.remove();
};

function renderSavedProgramsList() {
  const container = document.getElementById('savedProgsList');
  if (!container) return;
  const programs = _coachStore('coachPrograms_v1') || [];
  if (!programs.length) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <section class="pod mx-pod" aria-label="Saved programs">
      <div class="pod-row"><h4 class="pod-title mx-h3">Saved Programs</h4><span class="mx-meta">${programs.length}</span></div>
      <div>
      ${programs.map((p, i) => `
        <div class="mx-row saved-prog-row">
          <div class="mx-row-main">
            <span class="mx-row-title">${_escH(p.name)}</span>
            <span class="mx-row-sub">Saved ${p.savedAt?.slice(0,10) || '—'}</span>
          </div>
          <div class="saved-prog-actions">
            <button type="button" class="mx-outline" onclick="_loadProgIdx(${i})">Load</button>
            <button type="button" class="mx-iconbtn mx-iconbtn--ghost" onclick="_deleteProgIdx(${i})" aria-label="Delete ${_escH(p.name)}"><span class="ui-icon">${ICONS.x}</span></button>
          </div>
        </div>`).join('')}
      </div>
    </section>`;
}

window._loadProgIdx = function(i) {
  const programs = _coachStore('coachPrograms_v1') || [];
  const prog = programs[i];
  if (!prog) return;
  _progState = { ...prog, days: { ...prog.days } };
  const nameInput = document.getElementById('progNameInput');
  if (nameInput) nameInput.value = _progState.name;
  DAYS.forEach(d => _refreshDayCol(d));
};

window._deleteProgIdx = function(i) {
  const programs = _coachStore('coachPrograms_v1') || [];
  window.showConfirm(`Delete "${programs[i]?.name}"?`, { danger: true }).then(ok => {
    if (!ok) return;
    programs.splice(i, 1);
    _coachStore('coachPrograms_v1', programs);
    renderSavedProgramsList();
  });
};

/* ══════════════════════════════════════════════════════════════
   4. MESSAGING & FEEDBACK
   ══════════════════════════════════════════════════════════════ */

// Notes are real now: POST/GET /api/coach/clients/:id/notes (server mirrors
// each one onto the client's own users/{uid}/coachNotes so their app can
// read it — see traininglog-backend-sync). This used to be pure
// coachMessages_v1 localStorage on the coach's own browser, including a
// fake "athlete" sender/read-receipt model — there was never an athlete-side
// UI that could actually send a reply, so that two-way illusion is gone
// along with the local-only storage. What's here is a real, one-way
// coach → client note thread.
let _activeThreadClientId = null;
let _serverThreads = {}; // clientId -> notes[] | null (null = load error)

function _getThread(clientId) {
  return _serverThreads[clientId] || [];
}

async function _loadThreadFromServer(clientId) {
  try {
    const base = (window.SERVER_URL || '').replace(/\/$/, '');
    const res = await fetch(`${base}/api/coach/clients/${encodeURIComponent(clientId)}/notes`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data?.error?.message || 'Request failed');
    _serverThreads[clientId] = Array.isArray(data.notes) ? data.notes.slice().reverse() : [];
  } catch {
    _serverThreads[clientId] = null;
  }
}

function renderCoachMessaging() {
  const container = document.getElementById('coachSub_messaging');
  if (!container) return;

  const clients = (window.coachDashboardState?.clients) || [];

  const clientListHTML = clients.length
    ? clients.map(c => {
        const initials = c.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        return `
          <button type="button" class="coach-client-list-item${_activeThreadClientId === c.id ? ' active' : ''}"
               onclick="openMessageThread('${c.id}')" data-client-id="${c.id}" aria-pressed="${_activeThreadClientId === c.id}">
            <span class="coach-client-list-avatar">${initials}</span>
            <span>${_escH(c.name)}</span>
          </button>`;
      }).join('')
    : '<div class="mx-empty">No clients yet.</div>';

  const notifKey = 'coachNotifSettings_v1';
  const notif    = _coachStore(notifKey) || { missedSession: true, checkIn: true, plateau: false };
  const notifRow = (key, label) => `
    <label class="coach-notif-row">
      <span>${label}</span>
      <input type="checkbox" ${notif[key]?'checked':''} onchange="_saveNotif('${key}',this.checked)">
    </label>`;

  container.innerHTML = `
    <div class="coach-messaging-layout">
      <div class="coach-client-list-panel" role="group" aria-label="Clients">
        ${clientListHTML}
      </div>
      <div id="coachThreadContainer">
        ${_activeThreadClientId
          ? _buildThreadHTML(_activeThreadClientId)
          : '<div class="mx-empty">Select a client to view messages.</div>'}
      </div>
      <section class="pod mx-pod gdpr-section" aria-label="Notification settings">
        <div class="pod-row"><h4 class="pod-title mx-h3">Notification Settings</h4></div>
        <div>
          ${notifRow('missedSession', 'Missed session alert')}
          ${notifRow('checkIn', 'Check-in reminder')}
          ${notifRow('plateau', 'Plateau / stagnation flag')}
        </div>
      </section>
    </div>`;
}

function _buildThreadHTML(clientId) {
  const clients = (window.coachDashboardState?.clients) || [];
  const client  = clients.find(c => c.id === clientId);
  const thread  = _serverThreads[clientId];

  let msgs;
  if (thread === null) {
    msgs = '<div class="coach-thread-note coach-thread-note--err">Couldn\'t load messages — check your connection.</div>';
  } else if (!thread.length) {
    msgs = '<div class="coach-thread-note">No messages yet. Send the first note!</div>';
  } else {
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
    <section class="pod mx-pod coach-thread" aria-label="Messages with ${_escH(client?.name || clientId)}">
      <div class="coach-thread-header"><span class="mx-kicker">Notes to</span><span class="mx-row-title">${_escH(client?.name || clientId)}</span></div>
      <div class="coach-thread-messages" id="threadMessages">${msgs}</div>
      <div class="coach-thread-input">
        <div class="mx-well mx-well--text mx-well--sel coach-msg-type">
          <select id="msgType" aria-label="Message type">
            <option value="note">Note</option>
            <option value="alert">Alert</option>
            <option value="praise">Praise</option>
          </select>
        </div>
        <div class="mx-well mx-well--area"><textarea id="msgText" placeholder="Write a message…" aria-label="Message"></textarea></div>
        <button type="button" class="coach-send-btn mx-cta" onclick="sendCoachMessage()"><span>Send</span><span class="mx-cta-icon"><span class="ui-icon">${ICONS.chevronRight}</span></span></button>
      </div>
    </section>`;
}

window.openMessageThread = async function(clientId) {
  _activeThreadClientId = clientId;
  const threadContainer = document.getElementById('coachThreadContainer');
  if (threadContainer) threadContainer.innerHTML = '<div class="mx-empty">Loading…</div>';
  document.querySelectorAll('.coach-client-list-item').forEach(el =>
    el.classList.toggle('active', el.dataset.clientId === clientId)
  );

  await _loadThreadFromServer(clientId);
  if (_activeThreadClientId === clientId && threadContainer) {
    threadContainer.innerHTML = _buildThreadHTML(clientId);
  }
};

window.sendCoachMessage = async function() {
  const textEl = document.getElementById('msgText');
  const text = textEl?.value.trim();
  const type = document.getElementById('msgType')?.value || 'note';
  if (!text || !_activeThreadClientId) return;
  const finalText = type !== 'note' ? `[${type.toUpperCase()}] ${text}` : text;
  const clientId = _activeThreadClientId;

  const sendBtn = document.querySelector('.coach-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const base = (window.SERVER_URL || '').replace(/\/$/, '');
    const res = await fetch(`${base}/api/coach/clients/${encodeURIComponent(clientId)}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ text: finalText })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (window.showToast) window.showToast(data?.error?.message || 'Could not send message.');
      return;
    }
    if (textEl) textEl.value = '';
    await _loadThreadFromServer(clientId);
    const threadContainer = document.getElementById('coachThreadContainer');
    if (threadContainer) threadContainer.innerHTML = _buildThreadHTML(clientId);
    const msgs = document.getElementById('threadMessages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  } catch {
    if (window.showToast) window.showToast('Connection error — try again.');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
};

window._saveNotif = function(key, val) {
  const notifKey = 'coachNotifSettings_v1';
  const notif    = _coachStore(notifKey) || {};
  notif[key]     = val;
  _coachStore(notifKey, notif);
};

/* ══════════════════════════════════════════════════════════════
   5. DATA INSIGHTS / ANALYTICS
   ══════════════════════════════════════════════════════════════ */

let _analyticsCharts = {};

function renderCoachAnalytics() {
  const container = document.getElementById('coachSub_analytics');
  if (!container) return;
  const clients = (window.coachDashboardState?.clients) || [];

  container.innerHTML = `
    <div class="coach-analytics-grid">
      <!-- Adherence bar chart -->
      <section class="pod mx-pod coach-chart-card">
        <div class="pod-row"><h4 class="pod-title mx-h3">Client Adherence (%)</h4></div>
        <canvas id="adherenceChart" height="140" aria-label="Adherence per client"></canvas>
      </section>

      <!-- Workouts per week -->
      <section class="pod mx-pod coach-chart-card">
        <div class="pod-row"><h4 class="pod-title mx-h3">Workouts This Week</h4></div>
        <canvas id="workoutsChart" height="160" aria-label="Workouts this week per client"></canvas>
      </section>

      <!-- Alert breakdown -->
      <section class="pod mx-pod coach-chart-card">
        <div class="pod-row"><h4 class="pod-title mx-h3">Alert Status</h4></div>
        <div class="coach-chart-box"><canvas id="alertPieChart" aria-label="Alert status breakdown"></canvas></div>
      </section>
    </div>

    <!-- Improvement / stagnation flags -->
    <section class="pod mx-pod coach-chart-card" aria-label="Client performance flags">
      <div class="pod-row"><h4 class="pod-title mx-h3">Client Performance Flags</h4><span class="mx-meta">${clients.length}</span></div>
      <div class="coach-insight-list">
        ${clients.map(c => _buildInsightRow(c)).join('') || '<div class="mx-empty">No client data.</div>'}
      </div>
    </section>`;

  _renderAdherenceChart(clients);
  _renderWorkoutsChart(clients);
  _renderAlertPieChart(clients);
}

function _buildInsightRow(c) {
  const adh = c.compliancePercent ?? 0;
  const wk  = c.workoutsLoggedThisWeek ?? 0;
  const wΔ  = Number(c.weeklyWeightChangePercent ?? 0) || 0;
  const trend = adh >= 80 && wk >= 3 ? 'up' : adh < 60 || wk <= 1 ? 'down' : 'flat';
  const trendLabel = { up: '▲ Up', down: '▼ Down', flat: '● Flat' }[trend];
  const trendCls = { up: 'mx-chip--green', down: 'mx-chip--red', flat: '' }[trend];
  const flags = [];
  if (_isUrgentStatus(c.alertStatus)) flags.push('<span class="mx-tag mx-tag--red injury-flag">Alert</span>');
  if (trend === 'down')               flags.push('<span class="mx-tag mx-tag--brass stagnation-badge">Stagnating</span>');
  if ((c.cardioMissedSessions || 0) >= 2) flags.push('<span class="mx-tag mx-tag--brass stagnation-badge">Cardio missed</span>');

  return `
    <article class="coach-insight-row">
      <div class="pod-row">
        <div class="coach-insight-id"><span class="mx-row-title">${_escH(c.name)}</span><span class="mx-row-sub">${_escH(c.currentPhase || '—')}</span></div>
        <span class="mx-chip mx-chip--sm trend-${trend} ${trendCls}">${trendLabel}</span>
      </div>
      <div class="mx-tiles">
        <div class="mx-stat"><span class="mx-stat-l">Compliance</span><span class="mx-stat-v">${adh}<small>%</small></span></div>
        <div class="mx-stat"><span class="mx-stat-l">Workouts/wk</span><span class="mx-stat-v">${wk}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">Weight Δ/wk</span><span class="mx-stat-v">${wΔ > 0 ? '+' : ''}${wΔ.toFixed(2)}<small>%</small></span></div>
      </div>
      <div class="mx-tags">${flags.join('') || '<span class="mx-tag">No flags</span>'}</div>
    </article>`;
}

function _renderAdherenceChart(clients) {
  const canvas = document.getElementById('adherenceChart');
  if (!canvas || !window.Chart) return;
  if (_analyticsCharts.adherence) { _analyticsCharts.adherence.destroy(); }
  const colors = clients.map(c =>
    c.compliancePercent >= 80 ? '#6fae8b' : c.compliancePercent >= 60 ? '#c79a54' : '#c9707c'
  );
  _analyticsCharts.adherence = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: clients.map(c => c.name),
      datasets: [{ label: 'Adherence %', data: clients.map(c => c.compliancePercent ?? 0), backgroundColor: colors, borderRadius: 6 }]
    },
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 100, ticks: { color: '#86998e' }, grid: { color: 'rgba(255,255,255,0.06)' } }, x: { ticks: { color: '#86998e' } } }
    }
  });
}

function _renderWorkoutsChart(clients) {
  const canvas = document.getElementById('workoutsChart');
  if (!canvas || !window.Chart) return;
  if (_analyticsCharts.workouts) { _analyticsCharts.workouts.destroy(); }
  _analyticsCharts.workouts = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: clients.map(c => c.name),
      datasets: [{ label: 'Workouts', data: clients.map(c => c.workoutsLoggedThisWeek ?? 0), backgroundColor: '#3d9d73', borderRadius: 6 }]
    },
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: { y: { min: 0, ticks: { stepSize: 1, color: '#86998e' }, grid: { color: 'rgba(255,255,255,0.06)' } }, x: { ticks: { color: '#86998e' } } }
    }
  });
}

function _renderAlertPieChart(clients) {
  const canvas = document.getElementById('alertPieChart');
  if (!canvas || !window.Chart) return;
  if (_analyticsCharts.pie) { _analyticsCharts.pie.destroy(); }
  const ok    = clients.filter(c => c.alertStatus === 'ok').length;
  const watch = clients.filter(c => c.alertStatus === 'watch').length;
  const alert = clients.filter(c => _isUrgentStatus(c.alertStatus)).length;
  _analyticsCharts.pie = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['OK', 'Watch', 'Alert'],
      datasets: [{ data: [ok, watch, alert], backgroundColor: ['#6fae8b','#c79a54','#c9707c'], borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#c9d2cc', font: { size: 11 } } } }
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   6. GDPR / PRIVACY
   ══════════════════════════════════════════════════════════════ */

const GDPR_STORE_KEY = 'coachGdprConsents_v1';

function _getGdprStore()      { return _coachStore(GDPR_STORE_KEY) || {}; }
function _saveGdprStore(data) { _coachStore(GDPR_STORE_KEY, data); }

function renderCoachGdpr() {
  const container = document.getElementById('coachSub_gdpr');
  if (!container) return;
  const clients = (window.coachDashboardState?.clients) || [];
  const store   = _getGdprStore();

  const clientRows = clients.map(c => {
    const consent = store[c.id] || { status: 'pending', dataSharing: false, analytics: false };
    const chipCls = { consented: 'mx-chip--green', pending: 'mx-chip--brass', withdrawn: 'mx-chip--red' }[consent.status] || '';
    const badge   = `<span class="gdpr-badge ${consent.status} mx-chip mx-chip--sm ${chipCls}">${consent.status}</span>`;
    return `
      <article class="coach-consent-row">
        <div class="pod-row">
          <div class="coach-insight-id"><span class="mx-row-title">${_escH(c.name)}</span><span class="mx-row-sub">Consent date: ${consent.consentDate ? consent.consentDate.slice(0,10) : '—'}</span></div>
          ${badge}
        </div>
        <div class="coach-consent-actions">
          <button type="button" class="mx-outline" onclick="sendConsentRequest('${c.id}')">${consent.status === 'consented' ? 'Revoke' : 'Send Request'}</button>
          <button type="button" class="mx-outline" onclick="exportClientData('${c.id}')">Export</button>
          <button type="button" class="mx-outline mx-outline--danger" onclick="deleteClientData('${c.id}')">Delete</button>
        </div>
      </article>`;
  }).join('') || '<div class="mx-empty">No clients.</div>';

  container.innerHTML = `
    <!-- Consent overview -->
    <section class="pod mx-pod gdpr-section">
      <div class="pod-row"><h4 class="pod-title mx-h3">Client Data Consents</h4></div>
      <p class="mx-sub">Track and manage GDPR consent for each client. All data is stored locally; no personal data is shared without explicit consent.</p>
      <div class="coach-consent-list">${clientRows}</div>
    </section>

    <!-- Coach data-sharing settings -->
    <section class="pod mx-pod gdpr-section">
      <div class="pod-row"><h4 class="pod-title mx-h3">Data Sharing Settings</h4></div>
      <p class="mx-sub">Configure what data can be shared with clients and third parties.</p>
      <ul class="gdpr-consent-list" id="coachDataSharingList">
        ${_buildDataSharingCheckboxes()}
      </ul>
      <button type="button" class="mx-cta gdpr-save-btn" onclick="saveCoachDataSettings()"><span>Save Preferences</span><span class="mx-cta-icon"><span class="ui-icon">${ICONS.check}</span></span></button>
    </section>

    <!-- Right to erasure / export -->
    <section class="pod mx-pod gdpr-section">
      <div class="pod-row"><h4 class="pod-title mx-h3">Your Coach Data</h4></div>
      <p class="mx-sub">You can export all coaching data (programs, messages, assignments) or request deletion at any time.</p>
      <div class="gdpr-action-row">
        <button type="button" class="mx-outline mx-outline--block gdpr-export-btn" onclick="exportAllCoachData()"><span class="ui-icon">${ICONS.download}</span> Export All Data (JSON)</button>
        <button type="button" class="mx-outline mx-outline--block mx-outline--danger gdpr-delete-btn" onclick="deleteAllCoachData()">Delete All Coach Data</button>
      </div>
    </section>`;
}

function _buildDataSharingCheckboxes() {
  const settings = _coachStore('coachDataSettings_v1') || { shareProgress: true, shareNutrition: true, shareAnalytics: false, thirdParty: false };
  const items = [
    ['shareProgress',   'Share workout progress with clients'],
    ['shareNutrition',  'Share assigned nutrition plans with clients'],
    ['shareAnalytics',  'Allow anonymised analytics for platform improvement'],
    ['thirdParty',      'Allow data sharing with certified third-party tools'],
  ];
  return items.map(([key, label]) => `
    <li>
      <label for="ds_${key}">${label}</label>
      <input type="checkbox" id="ds_${key}" ${settings[key] ? 'checked' : ''}>
    </li>`).join('');
}

window.saveCoachDataSettings = function() {
  const keys    = ['shareProgress','shareNutrition','shareAnalytics','thirdParty'];
  const settings = {};
  keys.forEach(k => { settings[k] = !!document.getElementById('ds_' + k)?.checked; });
  _coachStore('coachDataSettings_v1', settings);
  _showExportToast('Data preferences saved');
};

window.sendConsentRequest = function(clientId) {
  const store   = _getGdprStore();
  const consent = store[clientId] || {};
  if (consent.status === 'consented') {
    window.showConfirm('Revoke consent for this client? This will stop data collection.', { danger: true }).then(ok => {
      if (!ok) return;
      store[clientId] = { ...consent, status: 'withdrawn', revokedAt: new Date().toISOString() };
      _saveGdprStore(store);
      renderCoachGdpr();
    });
    return;
  }
  // Show consent request modal
  const clients = (window.coachDashboardState?.clients) || [];
  const client  = clients.find(c => c.id === clientId);
  const modal = document.createElement('div');
  modal.className = 'gdpr-modal-overlay';
  modal.innerHTML = `
    <div class="gdpr-modal">
      <h3>Data Consent Request</h3>
      <p>Send this consent agreement to <strong>${_escH(client?.name || clientId)}</strong>. By confirming, you record that the client has agreed to the following:</p>
      <ul class="gdpr-consent-list">
        <li><input type="checkbox" checked disabled><label>Collection and storage of workout logs</label></li>
        <li><input type="checkbox" checked disabled><label>Processing of body composition check-ins</label></li>
        <li><input type="checkbox" checked disabled><label>Viewing of progress metrics by their assigned coach</label></li>
        <li><input type="checkbox" id="_gdprNutrition"><label>Sharing nutrition targets with coach</label></li>
        <li><input type="checkbox" id="_gdprAnalytics"><label>Inclusion in anonymised platform analytics</label></li>
      </ul>
      <div class="gdpr-modal-actions">
        <button class="gdpr-export-btn" onclick="this.closest('.gdpr-modal-overlay').remove()">Cancel</button>
        <button class="gdpr-save-btn" onclick="_recordConsent('${clientId}')">Record Consent</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
};

window._recordConsent = function(clientId) {
  const store = _getGdprStore();
  store[clientId] = {
    status:      'consented',
    consentDate: new Date().toISOString(),
    nutrition:   !!document.getElementById('_gdprNutrition')?.checked,
    analytics:   !!document.getElementById('_gdprAnalytics')?.checked,
  };
  _saveGdprStore(store);
  document.querySelector('.gdpr-modal-overlay')?.remove();
  renderCoachGdpr();
  _showExportToast('Consent recorded');
};

window.exportClientData = function(clientId) {
  const clients  = (window.coachDashboardState?.clients) || [];
  const client   = clients.find(c => c.id === clientId) || { id: clientId };
  const messages = _getThread(clientId);
  const assignments = (_coachStore('coachProgramAssignments_v1') || {})[clientId];
  const nutrition   = (_coachStore('coachNutritionAssignments_v1') || {})[clientId];
  const consent     = (_getGdprStore())[clientId];

  const exportData = { exportedAt: new Date().toISOString(), client, messages, programAssignment: assignments, nutritionPlan: nutrition, gdprConsent: consent };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `client-data-${(client.name || clientId).replace(/\s+/g,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

window.deleteClientData = function(clientId) {
  const clients = (window.coachDashboardState?.clients) || [];
  const client  = clients.find(c => c.id === clientId);
  window.showConfirm(`Permanently delete all data for ${client?.name || clientId}? This cannot be undone.`, { danger: true }).then(ok => {
    if (!ok) return;
    delete _serverThreads[clientId]; // local cache only — notes now live server-side, not covered by this local-data wipe
    const asnStore = _coachStore('coachProgramAssignments_v1') || {}; delete asnStore[clientId]; _coachStore('coachProgramAssignments_v1', asnStore);
    const nutStore = _coachStore('coachNutritionAssignments_v1') || {}; delete nutStore[clientId]; _coachStore('coachNutritionAssignments_v1', nutStore);
    const gdprStore = _getGdprStore(); delete gdprStore[clientId]; _saveGdprStore(gdprStore);
    renderCoachGdpr();
    _showExportToast(`Data for ${client?.name || clientId} deleted`);
  });
};

window.exportAllCoachData = function() {
  const data = {
    exportedAt:      new Date().toISOString(),
    programs:        _coachStore('coachPrograms_v1'),
    // Messages/notes live server-side now (see /api/coach/clients/:id/notes)
    // — not local data, so not part of this local-export snapshot.
    programAssign:   _coachStore('coachProgramAssignments_v1'),
    nutritionAssign: _coachStore('coachNutritionAssignments_v1'),
    gdprConsents:    _getGdprStore(),
    dataSettings:    _coachStore('coachDataSettings_v1'),
    notifSettings:   _coachStore('coachNotifSettings_v1'),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `all-coach-data-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

window.deleteAllCoachData = function() {
  window.showConfirm('Delete ALL coaching data (programs, messages, assignments)? This cannot be undone.', { danger: true, confirmText: 'Delete All' }).then(ok => {
    if (!ok) return;
    ['coachPrograms_v1','coachMessages_v1','coachProgramAssignments_v1',
     'coachNutritionAssignments_v1','coachGdprConsents_v1',
     'coachDataSettings_v1','coachNotifSettings_v1'].forEach(k => localStorage.removeItem(k));
    renderCoachGdpr();
    _showExportToast('All coach data deleted');
  });
};

/* ── Utility: export toast ───────────────────────────────────── */

function _showExportToast(msg) {
  let toast = document.getElementById('_coachExportToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id        = '_coachExportToast';
    toast.className = 'export-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

/* ── HTML escape util ────────────────────────────────────────── */

function _escH(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════════════════════════════════════
   INIT — wire everything up after DOM + coach data ready
   ══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  initCoachSubtabs();
  initBulkActions();

  // Re-render stats bar whenever coach dashboard refreshes
  const origRender = window.renderCoachDashboard;
  if (typeof origRender === 'function') {
    window.renderCoachDashboard = async function() {
      await origRender();
      renderCoachStatsBar();
      // Inject checkboxes into existing client cards for bulk selection
      _injectBulkCheckboxes();
    };
  }

  // Bulk toolbar button wiring
  document.getElementById('coachBulkAssign')?.addEventListener('click', bulkAssignProgram);
  document.getElementById('coachBulkMacros')?.addEventListener('click', bulkUpdateMacros);
  document.getElementById('coachBulkCSV')?.addEventListener('click', bulkExportCSV);
  document.getElementById('coachBulkPDF')?.addEventListener('click', bulkExportPDF);
});

function _injectBulkCheckboxes() {
  document.querySelectorAll('.coach-client-card').forEach(card => {
    const clientId = card.dataset.clientId;
    if (!clientId || card.querySelector('.coach-client-select')) return;
    card.style.position = 'relative';
    const cb = document.createElement('input');
    cb.type            = 'checkbox';
    cb.className       = 'coach-client-select';
    cb.dataset.clientId = clientId;
    card.prepend(cb);
  });
}

// Expose for manual calls
window.renderCoachStatsBar       = renderCoachStatsBar;
window.renderCoachAnalytics      = renderCoachAnalytics;
window.renderCoachMessaging      = renderCoachMessaging;
window.renderCoachGdpr           = renderCoachGdpr;
window.renderCoachProgramBuilder = renderCoachProgramBuilder;
