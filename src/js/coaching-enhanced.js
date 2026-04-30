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

function renderCoachStatsBar() {
  const container = document.getElementById('coachStatsBar');
  if (!container) return;
  const clients = (window.coachDashboardState?.clients) || [];
  if (!clients.length) { container.innerHTML = ''; return; }

  const total      = clients.length;
  const alertCount = clients.filter(c => c.alertStatus === 'alert').length;
  const watchCount = clients.filter(c => c.alertStatus === 'watch').length;
  const avgAdh     = clients.reduce((s,c) => s + (c.compliancePercent || 0), 0) / total;
  const activeWeek = clients.filter(c => (c.workoutsLoggedThisWeek || 0) > 0).length;

  container.innerHTML = `
    <div class="coach-stat-chip">
      <div class="chip-value">${total}</div>
      <div class="chip-label">Clients</div>
    </div>
    <div class="coach-stat-chip">
      <div class="chip-value" style="color:#e05060">${alertCount}</div>
      <div class="chip-label">Alerts</div>
    </div>
    <div class="coach-stat-chip">
      <div class="chip-value" style="color:#f0a040">${watchCount}</div>
      <div class="chip-label">Watch</div>
    </div>
    <div class="coach-stat-chip">
      <div class="chip-value">${Math.round(avgAdh)}%</div>
      <div class="chip-label">Avg Adherence</div>
    </div>
    <div class="coach-stat-chip">
      <div class="chip-value">${activeWeek}</div>
      <div class="chip-label">Active This Week</div>
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

function bulkAssignProgram() {
  if (!_bulkSelected.size) return;
  const programs = _coachStore('coachPrograms_v1') || [];
  if (!programs.length) { window.showToast('No saved programs. Create one in the Programs tab first.', 'warn'); return; }

  const opts = programs.map((p,i) => `<option value="${i}">${p.name}</option>`).join('');
  const modal = document.createElement('div');
  modal.className = 'gdpr-modal-overlay';
  modal.innerHTML = `
    <div class="gdpr-modal">
      <h3>Assign Program</h3>
      <p>Assign a program to ${_bulkSelected.size} selected client(s).</p>
      <select id="_bulkProgSel" style="width:100%;margin:0 0 12px;">${opts}</select>
      <div class="gdpr-modal-actions">
        <button class="gdpr-export-btn" onclick="this.closest('.gdpr-modal-overlay').remove()">Cancel</button>
        <button class="gdpr-save-btn" onclick="_confirmBulkAssignProgram()">Assign</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

window._confirmBulkAssignProgram = function() {
  const idx = parseInt(document.getElementById('_bulkProgSel')?.value);
  const programs = _coachStore('coachPrograms_v1') || [];
  const prog = programs[idx];
  if (!prog) return;

  const assignments = _coachStore('coachProgramAssignments_v1') || {};
  _bulkSelected.forEach(id => { assignments[id] = { programId: prog.id, assignedAt: new Date().toISOString() }; });
  _coachStore('coachProgramAssignments_v1', assignments);
  document.querySelector('.gdpr-modal-overlay')?.remove();
  _showExportToast(`Program "${prog.name}" assigned to ${_bulkSelected.size} client(s)`);
};

function bulkUpdateMacros() {
  if (!_bulkSelected.size) return;
  const modal = document.createElement('div');
  modal.className = 'gdpr-modal-overlay';
  modal.innerHTML = `
    <div class="gdpr-modal">
      <h3>Bulk Update Macros</h3>
      <p>Override macro targets for ${_bulkSelected.size} selected client(s). Leave blank to skip that macro.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.8rem;color:var(--secondary-text);">
          Protein (g)<input type="number" id="_bmProtein" placeholder="—" style="margin:0;text-align:center;">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.8rem;color:var(--secondary-text);">
          Carbs (g)<input type="number" id="_bmCarbs" placeholder="—" style="margin:0;text-align:center;">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.8rem;color:var(--secondary-text);">
          Fat (g)<input type="number" id="_bmFat" placeholder="—" style="margin:0;text-align:center;">
        </label>
      </div>
      <div class="gdpr-modal-actions">
        <button class="gdpr-export-btn" onclick="this.closest('.gdpr-modal-overlay').remove()">Cancel</button>
        <button class="gdpr-save-btn" onclick="_confirmBulkMacros()">Update</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

window._confirmBulkMacros = function() {
  const protein = document.getElementById('_bmProtein')?.value;
  const carbs   = document.getElementById('_bmCarbs')?.value;
  const fat     = document.getElementById('_bmFat')?.value;
  const store   = _coachStore('coachNutritionAssignments_v1') || {};

  _bulkSelected.forEach(id => {
    const existing = store[id] || {};
    const days = existing.days || { training: {}, rest: {} };
    if (protein) { days.training.protein = +protein; days.rest.protein = Math.round(+protein * 0.85); }
    if (carbs)   { days.training.carbs   = +carbs;   days.rest.carbs   = Math.round(+carbs   * 0.7);  }
    if (fat)     { days.training.fat     = +fat;     days.rest.fat     = +fat; }
    store[id] = { ...existing, days, updatedAt: new Date().toISOString() };
  });
  _coachStore('coachNutritionAssignments_v1', store);
  document.querySelector('.gdpr-modal-overlay')?.remove();
  _showExportToast(`Macros updated for ${_bulkSelected.size} client(s)`);
};

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
      <td style="color:${c.alertStatus === 'alert' ? '#c0392b' : c.alertStatus === 'watch' ? '#e67e22' : '#27ae60'}">${c.alertStatus}</td>
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

window.bulkAssignProgram  = bulkAssignProgram;
window.bulkUpdateMacros   = bulkUpdateMacros;
window.bulkExportCSV      = bulkExportCSV;
window.bulkExportPDF      = bulkExportPDF;

/* ══════════════════════════════════════════════════════════════
   3. PROGRAM BUILDER
   ══════════════════════════════════════════════════════════════ */

const EXERCISE_LIBRARY = {
  'Chest': [
    { name: 'Bench Press',       icon: '🏋️' },
    { name: 'Incline DB Press',  icon: '🏋️' },
    { name: 'Cable Fly',         icon: '〰️' },
    { name: 'Push-Up',           icon: '💪' },
    { name: 'Dips',              icon: '💪' },
  ],
  'Back': [
    { name: 'Deadlift',          icon: '🏋️' },
    { name: 'Pull-Up',           icon: '💪' },
    { name: 'Barbell Row',       icon: '🏋️' },
    { name: 'Lat Pulldown',      icon: '〰️' },
    { name: 'Seated Cable Row',  icon: '〰️' },
  ],
  'Legs': [
    { name: 'Squat',             icon: '🏋️' },
    { name: 'Leg Press',         icon: '🦵' },
    { name: 'Romanian DL',       icon: '🏋️' },
    { name: 'Leg Curl',          icon: '〰️' },
    { name: 'Leg Extension',     icon: '〰️' },
    { name: 'Calf Raise',        icon: '🦵' },
  ],
  'Shoulders': [
    { name: 'Overhead Press',    icon: '🏋️' },
    { name: 'Lateral Raise',     icon: '💪' },
    { name: 'Face Pull',         icon: '〰️' },
    { name: 'Arnold Press',      icon: '🏋️' },
  ],
  'Arms': [
    { name: 'Barbell Curl',      icon: '💪' },
    { name: 'Tricep Pushdown',   icon: '〰️' },
    { name: 'Hammer Curl',       icon: '💪' },
    { name: 'Skull Crusher',     icon: '🏋️' },
  ],
  'Core': [
    { name: 'Plank',             icon: '🧘' },
    { name: 'Hanging Leg Raise', icon: '💪' },
    { name: 'Cable Crunch',      icon: '〰️' },
    { name: 'Ab Wheel',          icon: '🔄' },
  ],
  'Cardio / CF': [
    { name: 'Box Jump',          icon: '📦' },
    { name: 'Kettlebell Swing',  icon: '🔔' },
    { name: 'Assault Bike',      icon: '🚴' },
    { name: 'Row Erg',           icon: '🚣' },
    { name: 'Double-Under',      icon: '🪂' },
    { name: 'Thruster',          icon: '🏋️' },
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

function renderCoachProgramBuilder() {
  const container = document.getElementById('coachSub_programs');
  if (!container) return;

  container.innerHTML = `
    <div class="prog-builder-layout">
      <!-- Exercise library sidebar -->
      <div class="exercise-library">
        <h4>Exercise Library</h4>
        <input type="text" class="exercise-library-search" id="exLibSearch" placeholder="Search exercises…" oninput="filterExLib(this.value)">
        <div id="exLibList">${_buildExLibHTML()}</div>
      </div>

      <!-- Canvas -->
      <div class="prog-canvas">
        <div class="prog-canvas-header">
          <div class="prog-canvas-title">
            <input type="text" id="progNameInput" value="${_escH(_progState.name)}" placeholder="Program name" oninput="_progState.name=this.value">
          </div>
          <div class="prog-canvas-actions">
            <button onclick="saveCoachProgram()" style="background:var(--primary);color:#fff;">💾 Save</button>
            <button onclick="loadCoachProgramList()" style="background:var(--surface-bg);border:1px solid var(--border-color);color:var(--text-color);">📂 Load</button>
          </div>
        </div>

        <!-- Template buttons -->
        <div class="prog-template-bar">
          <span style="font-size:0.75rem;color:var(--secondary-text);align-self:center;">Templates:</span>
          <button class="prog-template-btn" onclick="applyProgTemplate('bodybuilding')">🏆 Bodybuilding</button>
          <button class="prog-template-btn" onclick="applyProgTemplate('powerlifting')">🏋️ Powerlifting</button>
          <button class="prog-template-btn" onclick="applyProgTemplate('crossfit')">💪 CrossFit</button>
          <button class="prog-template-btn" onclick="clearProgram()">🗑️ Clear</button>
        </div>

        <!-- Weekly grid -->
        <div class="prog-week-grid" id="progWeekGrid">
          ${DAYS.map(day => _buildDayColHTML(day)).join('')}
        </div>

        <!-- Assign to client -->
        <div class="prog-assign-bar">
          <span style="font-size:0.82rem;color:var(--secondary-text);font-weight:600;">Assign to:</span>
          <select id="progAssignClient">
            <option value="">— select client —</option>
            ${_buildClientOptions()}
          </select>
          <button class="prog-assign-btn" onclick="assignProgramToClient()">Assign Program</button>
        </div>

        <!-- Saved programs list -->
        <div id="savedProgsList" style="margin-top:10px;"></div>
      </div>
    </div>`;

  _bindDragAndDrop();
  renderSavedProgramsList();
}

function _buildExLibHTML(filter) {
  filter = (filter || '').toLowerCase();
  return Object.entries(EXERCISE_LIBRARY).map(([cat, exercises]) => {
    const filtered = filter
      ? exercises.filter(e => e.name.toLowerCase().includes(filter))
      : exercises;
    if (!filtered.length) return '';
    return `<div class="exercise-category">
      <div class="exercise-category-label">${cat}</div>
      ${filtered.map(e => `
        <div class="exercise-item" draggable="true" data-exercise="${_escH(e.name)}">
          <span class="exercise-item-icon">${e.icon}</span>
          ${_escH(e.name)}
        </div>`).join('')}
    </div>`;
  }).join('');
}

function _buildDayColHTML(day) {
  const exercises = _progState.days[day] || [];
  const slots = exercises.map((ex, i) => `
    <div class="prog-exercise-slot" data-day="${day}" data-idx="${i}">
      <span class="prog-exercise-slot-name">${_escH(ex)}</span>
      <button class="prog-exercise-slot-remove" onclick="removeProgExercise('${day}',${i})" title="Remove">×</button>
    </div>`).join('');
  const rest = exercises.length === 0 ? '<div class="prog-day-rest">Rest</div>' : '';
  return `
    <div class="prog-day-col" id="progDay_${day}" data-day="${day}">
      <div class="prog-day-label">${day}</div>
      ${slots}
      ${rest}
    </div>`;
}

function _buildClientOptions() {
  const clients = (window.coachDashboardState?.clients) || [];
  return clients.map(c => `<option value="${_escH(c.id)}">${_escH(c.name)}</option>`).join('');
}

function _bindDragAndDrop() {
  // Library items → drag start
  document.querySelectorAll('.exercise-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/exercise', item.dataset.exercise);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
  });

  // Day columns → drop targets
  document.querySelectorAll('.prog-day-col').forEach(col => {
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
  });
}

function _refreshDayCol(day) {
  const col = document.getElementById('progDay_' + day);
  if (!col) return;
  col.innerHTML = `<div class="prog-day-label">${day}</div>` + _buildDayColHTML(day).replace(/^[\s\S]*<div class="prog-day-label">[^<]*<\/div>/, '');
  // Re-bind drop on the refreshed col
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', e => {
    e.preventDefault();
    col.classList.remove('drag-over');
    const exercise = e.dataTransfer.getData('text/exercise');
    if (exercise) {
      _progState.days[day].push(exercise);
      _refreshDayCol(day);
    }
  });
}

window.removeProgExercise = function(day, idx) {
  _progState.days[day].splice(idx, 1);
  _refreshDayCol(day);
};

window.filterExLib = function(q) {
  const list = document.getElementById('exLibList');
  if (list) { list.innerHTML = _buildExLibHTML(q); _bindDragAndDrop(); }
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
  const opts = programs.map((p,i) => `<option value="${i}">${p.name} (${p.savedAt?.slice(0,10)})</option>`).join('');
  const modal = document.createElement('div');
  modal.className = 'gdpr-modal-overlay';
  modal.innerHTML = `
    <div class="gdpr-modal">
      <h3>Load Program</h3>
      <select id="_loadProgSel" style="width:100%;margin:0 0 12px;">${opts}</select>
      <div class="gdpr-modal-actions">
        <button class="gdpr-export-btn" onclick="this.closest('.gdpr-modal-overlay').remove()">Cancel</button>
        <button class="gdpr-save-btn" onclick="_confirmLoadProgram()">Load</button>
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

window.assignProgramToClient = function() {
  const clientId = document.getElementById('progAssignClient')?.value;
  if (!clientId) { window.showToast('Select a client first.', 'warn'); return; }
  const programs = _coachStore('coachPrograms_v1') || [];
  const prog = programs.find(p => p.id === _progState.id);
  if (!prog) { window.showToast('Save the program before assigning.', 'warn'); return; }
  const assignments = _coachStore('coachProgramAssignments_v1') || {};
  assignments[clientId] = { programId: prog.id, programName: prog.name, assignedAt: new Date().toISOString() };
  _coachStore('coachProgramAssignments_v1', assignments);
  const clients = (window.coachDashboardState?.clients) || [];
  const client  = clients.find(c => c.id === clientId);
  _showExportToast(`Assigned to ${client?.name || clientId}`);
};

function renderSavedProgramsList() {
  const container = document.getElementById('savedProgsList');
  if (!container) return;
  const programs = _coachStore('coachPrograms_v1') || [];
  if (!programs.length) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <h4 style="margin:0 0 8px;font-size:0.8rem;color:var(--secondary-text);text-transform:uppercase;letter-spacing:0.05em;">Saved Programs</h4>
    ${programs.map((p, i) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;margin-bottom:6px;background:var(--card-bg);">
        <div>
          <div style="font-size:0.85rem;font-weight:600;">${_escH(p.name)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);">Saved ${p.savedAt?.slice(0,10) || '—'}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button onclick="_loadProgIdx(${i})" style="padding:4px 10px;font-size:0.75rem;font-weight:700;border-radius:6px;background:var(--surface-bg);border:1px solid var(--border-color);color:var(--text-color);margin:0;box-shadow:none;">Load</button>
          <button onclick="_deleteProgIdx(${i})" style="padding:4px 10px;font-size:0.75rem;font-weight:700;border-radius:6px;background:transparent;border:1px solid rgba(220,53,69,0.4);color:#e05060;margin:0;box-shadow:none;">Delete</button>
        </div>
      </div>`).join('')}`;
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

let _activeThreadClientId = null;

function _getMsgStore() {
  return _coachStore('coachMessages_v1') || {};
}
function _saveMsgStore(store) {
  _coachStore('coachMessages_v1', store);
}
function _getThread(clientId) {
  return _getMsgStore()[clientId] || [];
}
function _addMessage(clientId, text, type, fromCoach) {
  const store  = _getMsgStore();
  const thread = store[clientId] || [];
  thread.push({
    id: Date.now(),
    text,
    type: type || 'note',
    from: fromCoach ? 'coach' : 'athlete',
    ts:   new Date().toISOString(),
    read: fromCoach,
  });
  store[clientId] = thread;
  _saveMsgStore(store);
}
function _markThreadRead(clientId) {
  const store = _getMsgStore();
  (store[clientId] || []).forEach(m => { m.read = true; });
  _saveMsgStore(store);
}
function _unreadCount(clientId) {
  return _getThread(clientId).filter(m => !m.read && m.from === 'athlete').length;
}

function renderCoachMessaging() {
  const container = document.getElementById('coachSub_messaging');
  if (!container) return;

  const clients = (window.coachDashboardState?.clients) || [];

  const clientListHTML = clients.length
    ? clients.map(c => {
        const unread = _unreadCount(c.id);
        const initials = c.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        return `
          <div class="coach-client-list-item${_activeThreadClientId === c.id ? ' active' : ''}"
               onclick="openMessageThread('${c.id}')" data-client-id="${c.id}">
            <div class="coach-client-list-avatar">${initials}</div>
            <span>${_escH(c.name)}</span>
            ${unread ? `<span class="coach-client-unread">${unread}</span>` : ''}
          </div>`;
      }).join('')
    : '<div style="padding:12px;font-size:0.82rem;color:var(--secondary-text);">No clients yet.</div>';

  const notifKey = 'coachNotifSettings_v1';
  const notif    = _coachStore(notifKey) || { missedSession: true, checkIn: true, plateau: false };

  container.innerHTML = `
    <div class="coach-messaging-layout">
      <div class="coach-client-list-panel">
        ${clientListHTML}
      </div>
      <div>
        <div id="coachThreadContainer">
          ${_activeThreadClientId
            ? _buildThreadHTML(_activeThreadClientId)
            : '<div style="padding:24px;text-align:center;color:var(--secondary-text);font-size:0.85rem;">Select a client to view messages.</div>'}
        </div>
        <!-- Notification settings -->
        <div class="gdpr-section" style="margin-top:14px;">
          <h4>Notification Settings</h4>
          <div class="coach-notif-row">
            <span>Missed session alert</span>
            <input type="checkbox" ${notif.missedSession?'checked':''} onchange="_saveNotif('missedSession',this.checked)">
          </div>
          <div class="coach-notif-row">
            <span>Check-in reminder</span>
            <input type="checkbox" ${notif.checkIn?'checked':''} onchange="_saveNotif('checkIn',this.checked)">
          </div>
          <div class="coach-notif-row">
            <span>Plateau / stagnation flag</span>
            <input type="checkbox" ${notif.plateau?'checked':''} onchange="_saveNotif('plateau',this.checked)">
          </div>
        </div>
      </div>
    </div>`;
}

function _buildThreadHTML(clientId) {
  const clients = (window.coachDashboardState?.clients) || [];
  const client  = clients.find(c => c.id === clientId);
  const thread  = _getThread(clientId);
  _markThreadRead(clientId);

  const msgs = thread.length
    ? thread.map(m => `
        <div class="coach-message from-${m.from}">
          ${m.type !== 'note' ? `<div class="coach-msg-tag ${m.type}">${m.type}</div>` : ''}
          <div>${_escH(m.text)}</div>
          <div class="coach-message-meta">${new Date(m.ts).toLocaleString()}</div>
        </div>`).join('')
    : '<div style="text-align:center;color:var(--secondary-text);font-size:0.82rem;padding:20px 0;">No messages yet. Send the first note!</div>';

  return `
    <div class="coach-thread">
      <div class="coach-thread-header">${_escH(client?.name || clientId)}</div>
      <div class="coach-thread-messages" id="threadMessages">${msgs}</div>
      <div class="coach-thread-input">
        <select id="msgType" style="width:90px;font-size:0.78rem;margin:0;">
          <option value="note">📝 Note</option>
          <option value="alert">🚨 Alert</option>
          <option value="praise">🎉 Praise</option>
        </select>
        <textarea id="msgText" placeholder="Write a message…"></textarea>
        <button class="coach-send-btn" onclick="sendCoachMessage()">Send</button>
      </div>
    </div>`;
}

window.openMessageThread = function(clientId) {
  _activeThreadClientId = clientId;
  const threadContainer = document.getElementById('coachThreadContainer');
  if (threadContainer) threadContainer.innerHTML = _buildThreadHTML(clientId);
  // Update active state in list
  document.querySelectorAll('.coach-client-list-item').forEach(el =>
    el.classList.toggle('active', el.dataset.clientId === clientId)
  );
  // Clear unread badge
  const item = document.querySelector(`.coach-client-list-item[data-client-id="${clientId}"] .coach-client-unread`);
  if (item) item.remove();
};

window.sendCoachMessage = function() {
  const text = document.getElementById('msgText')?.value.trim();
  const type = document.getElementById('msgType')?.value || 'note';
  if (!text || !_activeThreadClientId) return;
  _addMessage(_activeThreadClientId, text, type, true);
  const msgTextEl = document.getElementById('msgText');
  if (msgTextEl) msgTextEl.value = '';
  const threadContainer = document.getElementById('coachThreadContainer');
  if (threadContainer) threadContainer.innerHTML = _buildThreadHTML(_activeThreadClientId);
  // Scroll to bottom
  const msgs = document.getElementById('threadMessages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
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
      <div class="coach-chart-card" style="grid-column: 1 / -1;">
        <h4>Client Adherence Rates (%)</h4>
        <canvas id="adherenceChart" height="120"></canvas>
      </div>

      <!-- Workouts per week -->
      <div class="coach-chart-card">
        <h4>Workouts This Week</h4>
        <canvas id="workoutsChart" height="160"></canvas>
      </div>

      <!-- Alert breakdown -->
      <div class="coach-chart-card">
        <h4>Alert Status Breakdown</h4>
        <canvas id="alertPieChart" height="160"></canvas>
      </div>
    </div>

    <!-- Improvement / stagnation table -->
    <div class="coach-chart-card" style="margin-bottom:14px;">
      <h4>Client Performance Flags</h4>
      <div style="overflow-x:auto;">
        <table class="coach-insight-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Phase</th>
              <th>Compliance</th>
              <th>Workouts/Wk</th>
              <th>Weight Δ/Wk</th>
              <th>Trend</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            ${clients.map(c => _buildInsightRow(c)).join('') ||
              '<tr><td colspan="7" style="text-align:center;color:var(--secondary-text);">No client data.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  _renderAdherenceChart(clients);
  _renderWorkoutsChart(clients);
  _renderAlertPieChart(clients);
}

function _buildInsightRow(c) {
  const adh = c.compliancePercent ?? 0;
  const wk  = c.workoutsLoggedThisWeek ?? 0;
  const wΔ  = c.weeklyWeightChangePercent ?? 0;
  const trend = adh >= 80 && wk >= 3 ? 'up' : adh < 60 || wk <= 1 ? 'down' : 'flat';
  const trendIcon = { up: '↑', down: '↓', flat: '→' }[trend];
  const flags = [];
  if (c.alertStatus === 'alert') flags.push(`<span class="injury-flag">🚨 Alert</span>`);
  if (trend === 'down')          flags.push(`<span class="stagnation-badge">📉 Stagnating</span>`);
  if ((c.cardioMissedSessions || 0) >= 2) flags.push(`<span class="stagnation-badge">🏃 Cardio missed</span>`);

  return `<tr>
    <td><strong>${_escH(c.name)}</strong></td>
    <td>${_escH(c.currentPhase || '—')}</td>
    <td>${adh}%</td>
    <td>${wk}</td>
    <td>${wΔ > 0 ? '+' : ''}${wΔ.toFixed ? wΔ.toFixed(2) : wΔ}%</td>
    <td class="trend-${trend}">${trendIcon} ${trend}</td>
    <td>${flags.join(' ') || '<span style="color:var(--text-muted)">—</span>'}</td>
  </tr>`;
}

function _renderAdherenceChart(clients) {
  const canvas = document.getElementById('adherenceChart');
  if (!canvas || !window.Chart) return;
  if (_analyticsCharts.adherence) { _analyticsCharts.adherence.destroy(); }
  const colors = clients.map(c =>
    c.compliancePercent >= 80 ? '#4da87a' : c.compliancePercent >= 60 ? '#f0a040' : '#e05060'
  );
  _analyticsCharts.adherence = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: clients.map(c => c.name),
      datasets: [{ label: 'Adherence %', data: clients.map(c => c.compliancePercent ?? 0), backgroundColor: colors, borderRadius: 6 }]
    },
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 100, ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.06)' } }, x: { ticks: { color: '#888' } } }
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
      datasets: [{ label: 'Workouts', data: clients.map(c => c.workoutsLoggedThisWeek ?? 0), backgroundColor: '#4da8da', borderRadius: 6 }]
    },
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: { y: { min: 0, ticks: { stepSize: 1, color: '#888' }, grid: { color: 'rgba(255,255,255,0.06)' } }, x: { ticks: { color: '#888' } } }
    }
  });
}

function _renderAlertPieChart(clients) {
  const canvas = document.getElementById('alertPieChart');
  if (!canvas || !window.Chart) return;
  if (_analyticsCharts.pie) { _analyticsCharts.pie.destroy(); }
  const ok    = clients.filter(c => c.alertStatus === 'ok').length;
  const watch = clients.filter(c => c.alertStatus === 'watch').length;
  const alert = clients.filter(c => c.alertStatus === 'alert').length;
  _analyticsCharts.pie = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['OK', 'Watch', 'Alert'],
      datasets: [{ data: [ok, watch, alert], backgroundColor: ['#4da87a','#f0a040','#e05060'], borderWidth: 0 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#ccc', font: { size: 11 } } } }
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
    const badge   = `<span class="gdpr-badge ${consent.status}">${consent.status}</span>`;
    return `<tr>
      <td><strong>${_escH(c.name)}</strong></td>
      <td>${badge}</td>
      <td>${consent.consentDate ? consent.consentDate.slice(0,10) : '—'}</td>
      <td>
        <button onclick="sendConsentRequest('${c.id}')" style="padding:4px 10px;font-size:0.75rem;font-weight:700;border-radius:6px;background:var(--surface-bg);border:1px solid var(--border-color);color:var(--text-color);margin:0;box-shadow:none;">
          ${consent.status === 'consented' ? 'Revoke' : 'Send Request'}
        </button>
        <button onclick="exportClientData('${c.id}')" style="padding:4px 10px;font-size:0.75rem;font-weight:700;border-radius:6px;background:transparent;border:1px solid var(--border-color);color:var(--secondary-text);margin:0 0 0 4px;box-shadow:none;">Export</button>
        <button onclick="deleteClientData('${c.id}')" style="padding:4px 10px;font-size:0.75rem;font-weight:700;border-radius:6px;background:transparent;border:1px solid rgba(220,53,69,0.4);color:#e05060;margin:0 0 0 4px;box-shadow:none;">Delete</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--secondary-text);">No clients.</td></tr>';

  container.innerHTML = `
    <!-- Consent overview -->
    <div class="gdpr-section">
      <h4>🔒 Client Data Consents</h4>
      <p>Track and manage GDPR consent for each client. All data is stored locally; no personal data is shared without explicit consent.</p>
      <div style="overflow-x:auto;">
        <table class="coach-insight-table">
          <thead>
            <tr><th>Client</th><th>Status</th><th>Consent Date</th><th>Actions</th></tr>
          </thead>
          <tbody>${clientRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Coach data-sharing settings -->
    <div class="gdpr-section">
      <h4>⚙️ Data Sharing Settings</h4>
      <p>Configure what data can be shared with clients and third parties.</p>
      <ul class="gdpr-consent-list" id="coachDataSharingList">
        ${_buildDataSharingCheckboxes()}
      </ul>
      <div class="gdpr-action-row">
        <button class="gdpr-save-btn" onclick="saveCoachDataSettings()">Save Preferences</button>
      </div>
    </div>

    <!-- Right to erasure / export -->
    <div class="gdpr-section">
      <h4>📤 Your Coach Data</h4>
      <p>You can export all coaching data (programs, messages, assignments) or request deletion at any time.</p>
      <div class="gdpr-action-row">
        <button class="gdpr-export-btn" onclick="exportAllCoachData()">Export All Data (JSON)</button>
        <button class="gdpr-delete-btn" onclick="deleteAllCoachData()">Delete All Coach Data</button>
      </div>
    </div>`;
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
      <input type="checkbox" id="ds_${key}" ${settings[key] ? 'checked' : ''}>
      <label for="ds_${key}">${label}</label>
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
      <h3>🔒 Data Consent Request</h3>
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
    const msgStore = _getMsgStore();         delete msgStore[clientId];         _saveMsgStore(msgStore);
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
    messages:        _getMsgStore(),
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
