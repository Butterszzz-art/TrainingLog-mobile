/* =============================================================
   COACH DASHBOARD — JavaScript
   Auth, client roster, detail panels, program assignment,
   macro editor, notes, invites, AI assistant.
   ============================================================= */

const SERVER_URL = 'https://traininglog-backend.onrender.com';

let _token = localStorage.getItem('coachToken') || null;
let _username = localStorage.getItem('coachUser') || null;
let _clients = [];
let _activeFilter = 'all';
let _searchQuery = '';
let _selectedClientId = null;
let _bulkSelected = new Set();

function authHeaders() {
  return { Authorization: 'Bearer ' + _token, 'Content-Type': 'application/json' };
}

// ── Auth ──────────────────────────────────────────────────────

function checkAuth() {
  if (_token && _username) {
    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('appShell').style.display = '';
    document.getElementById('headerUser').textContent = _username;
    loadClients();
  }
}

async function doCoachLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  if (!username || !password) { errorEl.textContent = 'Enter username and password.'; return; }

  btn.disabled = true;
  btn.textContent = 'Connecting…';
  errorEl.textContent = '';

  try {
    const res = await fetch(SERVER_URL + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      errorEl.textContent = data.error?.message || 'Invalid credentials.';
      return;
    }

    _token = data.token;
    _username = data.username || username;
    localStorage.setItem('coachToken', _token);
    localStorage.setItem('coachUser', _username);

    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('appShell').style.display = '';
    document.getElementById('headerUser').textContent = _username;
    loadClients();
  } catch {
    errorEl.textContent = 'Connection error — server may be starting up. Try again in 30s.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

function doLogout() {
  _token = null; _username = null;
  localStorage.removeItem('coachToken');
  localStorage.removeItem('coachUser');
  location.reload();
}

// ── Fetch clients ─────────────────────────────────────────────

async function loadClients() {
  const listEl = document.getElementById('clientList');
  listEl.innerHTML = '<div class="client-list-loading">Loading clients…</div>';

  try {
    const res = await fetch(SERVER_URL + '/api/coach/clients?coachId=' + encodeURIComponent(_username), {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.clients) && data.clients.length) {
      _clients = data.clients;
    } else {
      _clients = getDemoClients();
    }
  } catch {
    _clients = getDemoClients();
  }

  renderClientList();
}

function getDemoClients() {
  return [
    { id: 'demo1', clientName: 'Sarah Mitchell', email: 'sarah@test.com', status: 'active', trainingMode: 'bodybuilding', currentProgram: 'PPL Hypertrophy', lastCheckIn: '2026-06-23', alertStatus: 'ok', currentNutritionSummary: '2200 kcal · 160g P · 220g C · 65g F', latestCheckInData: { sleep: 8, energy: 7, stress: 3, hunger: 5, trainingPerformance: 8, bodyweight: 62.5 } },
    { id: 'demo2', clientName: 'James Cooper', email: 'james@test.com', status: 'active', trainingMode: 'powerlifting', currentProgram: 'Peaking Block', lastCheckIn: '2026-06-22', alertStatus: 'action', currentNutritionSummary: '3200 kcal · 200g P · 350g C · 90g F', latestCheckInData: { sleep: 5, energy: 4, stress: 8, hunger: 7, trainingPerformance: 4, bodyweight: 95.2 } },
    { id: 'demo3', clientName: 'Mia Johnson', email: 'mia@test.com', status: 'active', trainingMode: 'hybrid', currentProgram: 'General Fitness', lastCheckIn: '2026-06-21', alertStatus: 'watch', currentNutritionSummary: '1800 kcal · 130g P · 180g C · 55g F', latestCheckInData: { sleep: 6, energy: 6, stress: 5, hunger: 4, trainingPerformance: 6, bodyweight: 58.0 } },
    { id: 'demo4', clientName: 'Liam Brown', email: 'liam@test.com', status: 'active', trainingMode: 'bodybuilding', currentProgram: 'Arm Specialisation', lastCheckIn: '2026-06-24', alertStatus: 'ok', currentNutritionSummary: '2800 kcal · 180g P · 300g C · 75g F', latestCheckInData: { sleep: 9, energy: 8, stress: 2, hunger: 6, trainingPerformance: 9, bodyweight: 84.3 } },
    { id: 'demo5', clientName: 'Emma Davis', email: 'emma@test.com', status: 'active', trainingMode: 'recreational', currentProgram: 'Full Body 3x', lastCheckIn: '2026-06-20', alertStatus: 'watch', currentNutritionSummary: '2000 kcal · 140g P · 200g C · 60g F', latestCheckInData: { sleep: 7, energy: 5, stress: 6, hunger: 8, trainingPerformance: 5, bodyweight: 70.1 } },
  ];
}

// ── Render client list ────────────────────────────────────────

function renderClientList() {
  const listEl = document.getElementById('clientList');
  let filtered = _clients.slice();
  if (_activeFilter !== 'all') filtered = filtered.filter(c => c.alertStatus === _activeFilter);
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    filtered = filtered.filter(c => (c.clientName || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q));
  }

  if (!filtered.length) {
    listEl.innerHTML = '<div class="client-list-loading">No clients match.</div>';
    return;
  }

  listEl.innerHTML = filtered.map(c => {
    const initials = (c.clientName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const isActive = c.id === _selectedClientId;
    const isChecked = _bulkSelected.has(c.id);
    const daysSince = c.lastCheckIn ? Math.floor((Date.now() - new Date(c.lastCheckIn).getTime()) / 86400000) : '—';

    return '<div class="client-row' + (isActive ? ' active' : '') + '" data-id="' + c.id + '" onclick="selectClient(\'' + c.id + '\')">'
      + '<input type="checkbox" class="client-checkbox" ' + (isChecked ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleBulk(\'' + c.id + '\')">'
      + '<div class="client-avatar">' + initials + '</div>'
      + '<div class="client-info"><div class="client-name">' + (c.clientName || 'Unknown') + '</div>'
      + '<div class="client-meta">' + (c.trainingMode || '—') + ' · ' + (daysSince === '—' ? 'No check-in' : daysSince + 'd ago') + '</div></div>'
      + '<div class="client-alert ' + (c.alertStatus || 'ok') + '"></div></div>';
  }).join('');
  updateFilterCounts();
}

function updateFilterCounts() {
  const counts = { all: _clients.length, action: 0, watch: 0, ok: 0 };
  _clients.forEach(c => { if (counts[c.alertStatus] !== undefined) counts[c.alertStatus]++; });
  document.querySelectorAll('.filter-tab').forEach(tab => {
    const f = tab.dataset.filter;
    const labels = { all: 'All', action: 'Needs Action', watch: 'Watch', ok: 'Stable' };
    tab.textContent = labels[f] + ' (' + (counts[f] || 0) + ')';
  });
}

document.getElementById('statusFilters')?.addEventListener('click', e => {
  const tab = e.target.closest('.filter-tab');
  if (!tab) return;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  _activeFilter = tab.dataset.filter;
  renderClientList();
});

function filterClients() {
  _searchQuery = document.getElementById('clientSearch')?.value || '';
  renderClientList();
}

function toggleBulk(id) {
  if (_bulkSelected.has(id)) _bulkSelected.delete(id);
  else _bulkSelected.add(id);
  const bar = document.getElementById('bulkBar');
  bar.style.display = _bulkSelected.size > 0 ? '' : 'none';
  document.getElementById('bulkCount').textContent = _bulkSelected.size + ' selected';
  renderClientList();
}

function bulkMessage() {
  const clients = _clients.filter(c => _bulkSelected.has(c.id));
  const names = clients.map(c => c.clientName).join(', ');
  const msg = prompt('Message to send to ' + clients.length + ' clients:\n(' + names + ')');
  if (!msg) return;
  clients.forEach(c => saveCoachNote(c.id, msg));
  alert('Message sent to ' + clients.length + ' clients.');
  _bulkSelected.clear();
  document.getElementById('bulkBar').style.display = 'none';
  renderClientList();
}

// ── Select client ─────────────────────────────────────────────

function selectClient(id) {
  _selectedClientId = id;
  renderClientList();
  const client = _clients.find(c => c.id === id);
  if (!client) return;

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('clientDetail').style.display = '';

  renderDetailHeader(client);
  renderOverview(client);
  renderCheckIn(client);
  renderProgram(client);
  renderNutrition(client);
  renderNotes(client);
  switchDetailTab('overview');
}

// ── Detail tabs ───────────────────────────────────────────────

document.getElementById('detailTabs')?.addEventListener('click', e => {
  const tab = e.target.closest('.detail-tab');
  if (tab) switchDetailTab(tab.dataset.dtab);
});

function switchDetailTab(name) {
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.dtab === name));
  document.querySelectorAll('.detail-panel').forEach(p => p.classList.toggle('active', p.id === 'dtab_' + name));
}

// ── Helpers ───────────────────────────────────────────────────

function stat(label, value) {
  return '<div class="d-stat"><div class="d-stat-val">' + value + '</div><div class="d-stat-lbl">' + label + '</div></div>';
}

function scoreBar(label, value, max, inverse) {
  const v = Number(value) || 0;
  const pct = Math.round((v / max) * 100);
  const color = inverse
    ? (v <= 3 ? 'var(--primary)' : v <= 6 ? 'var(--highlight)' : 'var(--danger)')
    : (v >= 7 ? 'var(--primary)' : v >= 4 ? 'var(--highlight)' : 'var(--danger)');
  return '<div class="checkin-score-row">'
    + '<span class="checkin-score-label">' + label + '</span>'
    + '<div class="checkin-score-bar"><div class="checkin-score-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
    + '<span class="checkin-score-val">' + v + '/' + max + '</span></div>';
}

// ── Detail: Header ────────────────────────────────────────────

function renderDetailHeader(c) {
  const initials = (c.clientName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const daysSince = c.lastCheckIn ? Math.floor((Date.now() - new Date(c.lastCheckIn).getTime()) / 86400000) + ' days ago' : 'Never';

  document.getElementById('detailHeader').innerHTML =
    '<div class="detail-avatar">' + initials + '</div>'
    + '<div class="detail-info"><div class="detail-name">' + (c.clientName || 'Unknown') + '</div>'
    + '<div class="detail-meta">' + (c.trainingMode || '—') + ' · Last check-in: ' + daysSince + ' · ' + (c.email || '') + '</div></div>'
    + '<span class="detail-status ' + (c.alertStatus || 'ok') + '">' + (c.alertStatus || 'ok') + '</span>';
}

// ── Detail: Overview ──────────────────────────────────────────

function renderOverview(c) {
  const ci = c.latestCheckInData || {};
  document.getElementById('dtab_overview').innerHTML =
    '<div class="d-card"><div class="d-card-title">Quick Stats</div><div class="d-stat-grid">'
    + stat('Bodyweight', ci.bodyweight ? ci.bodyweight + ' kg' : '—')
    + stat('Program', c.currentProgram || '—')
    + stat('Mode', c.trainingMode || '—')
    + stat('Status', c.alertStatus || '—')
    + '</div></div>'
    + '<div class="d-card"><div class="d-card-title">Latest Check-In</div>'
    + scoreBar('Sleep', ci.sleep, 10) + scoreBar('Energy', ci.energy, 10)
    + scoreBar('Stress', ci.stress, 10, true) + scoreBar('Hunger', ci.hunger, 10)
    + scoreBar('Training', ci.trainingPerformance, 10) + '</div>'
    + '<div class="d-card"><div class="d-card-title">AI Coach Actions</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + '<button class="bulk-action-btn" onclick="aiAnalyse()">🧠 Analyse Check-In</button>'
    + '<button class="bulk-action-btn" onclick="aiDraft()">✍️ Draft Message</button>'
    + '</div><div id="aiResultBox" style="margin-top:10px;"></div></div>';
}

// ── Detail: Check-In ──────────────────────────────────────────

function renderCheckIn(c) {
  const ci = c.latestCheckInData || {};
  const el = document.getElementById('dtab_checkin');
  if (!ci.sleep && !ci.energy) {
    el.innerHTML = '<div class="d-card"><p style="color:var(--text-muted);text-align:center;padding:24px 0;">No check-in data available.</p></div>';
    return;
  }
  el.innerHTML = '<div class="d-card"><div class="d-card-title">Full Check-In Review</div>'
    + scoreBar('Sleep Quality', ci.sleep, 10) + scoreBar('Energy Level', ci.energy, 10)
    + scoreBar('Stress Level', ci.stress, 10, true) + scoreBar('Hunger', ci.hunger, 10)
    + scoreBar('Training Performance', ci.trainingPerformance, 10) + '</div>'
    + '<div class="d-card"><div class="d-card-title">Bodyweight</div><div class="d-stat-grid">'
    + stat('Current', ci.bodyweight ? ci.bodyweight + ' kg' : '—')
    + stat('Last Check-In', c.lastCheckIn || '—') + '</div></div>';
}

// ══════════════════════════════════════════════════════════════
// COACH-4: Program Assignment + Macro Plan Editor
// ══════════════════════════════════════════════════════════════

function renderProgram(c) {
  const el = document.getElementById('dtab_program');
  const programs = getCoachPrograms();
  const currentProg = c.currentProgram || '';

  let programListHtml = '<option value="">— No program —</option>';
  programs.forEach(p => {
    const sel = p.name === currentProg ? ' selected' : '';
    programListHtml += '<option value="' + p.name + '"' + sel + '>' + p.name + '</option>';
  });

  el.innerHTML = '<div class="d-card"><div class="d-card-title">Assign Program</div>'
    + '<select id="coachProgramSelect" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.9rem;margin-bottom:10px;">'
    + programListHtml + '</select>'
    + '<div style="display:flex;gap:8px;">'
    + '<button class="bulk-action-btn" onclick="assignProgram()">Save Assignment</button>'
    + '<button class="bulk-action-btn" style="background:var(--highlight);" onclick="showProgramBuilder()">+ Create Program</button>'
    + '</div>'
    + '<div id="programBuilderArea" style="margin-top:12px;"></div>'
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">Current Program Details</div>'
    + '<p style="color:var(--text-sec);">' + (currentProg || 'No program assigned.') + '</p></div>';
}

function getCoachPrograms() {
  try { return JSON.parse(localStorage.getItem('coachPrograms_' + _username) || '[]'); } catch { return []; }
}

function assignProgram() {
  const sel = document.getElementById('coachProgramSelect');
  if (!sel) return;
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  client.currentProgram = sel.value;
  alert('Program "' + sel.value + '" assigned to ' + client.clientName);
  renderProgram(client);
  renderOverview(client);
}

function showProgramBuilder() {
  const area = document.getElementById('programBuilderArea');
  if (!area) return;
  area.innerHTML = '<div style="border:1px solid var(--border);border-radius:12px;padding:14px;background:var(--surface);">'
    + '<input type="text" id="newProgName" placeholder="Program name" style="width:100%;padding:10px;margin-bottom:8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:0.9rem;">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">'
    + '<input type="number" id="newProgDays" placeholder="Days/week" min="1" max="7" style="padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);">'
    + '<select id="newProgFocus" style="padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);"><option value="hypertrophy">Hypertrophy</option><option value="strength">Strength</option><option value="conditioning">Conditioning</option><option value="general">General</option></select>'
    + '</div>'
    + '<textarea id="newProgNotes" placeholder="Program notes / split description…" style="width:100%;min-height:60px;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:0.85rem;resize:vertical;margin-bottom:8px;"></textarea>'
    + '<button class="bulk-action-btn" onclick="saveCoachProgram()">Save Program</button>'
    + '</div>';
}

function saveCoachProgram() {
  const name = document.getElementById('newProgName')?.value?.trim();
  if (!name) { alert('Enter a program name.'); return; }
  const days = Number(document.getElementById('newProgDays')?.value) || 4;
  const focus = document.getElementById('newProgFocus')?.value || 'general';
  const notes = document.getElementById('newProgNotes')?.value?.trim() || '';

  const programs = getCoachPrograms();
  programs.push({ name, days, focus, notes, createdAt: new Date().toISOString() });
  localStorage.setItem('coachPrograms_' + _username, JSON.stringify(programs));

  const client = _clients.find(c => c.id === _selectedClientId);
  if (client) renderProgram(client);
  alert('Program "' + name + '" created.');
}

// ── Macro Plan Editor ─────────────────────────────────────────

function renderNutrition(c) {
  const el = document.getElementById('dtab_nutrition');
  const saved = getClientMacros(c.id);

  el.innerHTML = '<div class="d-card"><div class="d-card-title">Macro Plan Editor</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'
    + macroField('Calories', 'macroCalories', saved.calories || '')
    + macroField('Protein (g)', 'macroProtein', saved.protein || '')
    + macroField('Carbs (g)', 'macroCarbs', saved.carbs || '')
    + macroField('Fat (g)', 'macroFat', saved.fat || '')
    + '</div>'
    + '<div class="d-card-title" style="margin-top:8px;">Day Type Adjustments</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'
    + macroField('Training Day Cal', 'macroTrainCal', saved.trainingCal || '')
    + macroField('Rest Day Cal', 'macroRestCal', saved.restCal || '')
    + macroField('High Carb Day', 'macroHighCarb', saved.highCarb || '')
    + macroField('Low Carb Day', 'macroLowCarb', saved.lowCarb || '')
    + '</div>'
    + '<textarea id="macroNotes" placeholder="Nutrition notes for client…" style="width:100%;min-height:60px;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.85rem;resize:vertical;margin-bottom:10px;">' + (saved.notes || '') + '</textarea>'
    + '<button class="bulk-action-btn" onclick="saveClientMacros()">Save Macro Plan</button>'
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">Current Summary</div>'
    + '<p style="color:var(--text-sec);">' + (c.currentNutritionSummary || 'No nutrition plan set.') + '</p></div>';
}

function macroField(label, id, value) {
  return '<label style="display:flex;flex-direction:column;gap:3px;font-size:0.72rem;color:var(--text-muted);font-weight:600;">'
    + label + '<input type="number" id="' + id + '" value="' + value + '" style="padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.9rem;margin:0;">'
    + '</label>';
}

function getClientMacros(clientId) {
  try { return JSON.parse(localStorage.getItem('coachMacros_' + clientId) || '{}'); } catch { return {}; }
}

function saveClientMacros() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  const macros = {
    calories: document.getElementById('macroCalories')?.value || '',
    protein: document.getElementById('macroProtein')?.value || '',
    carbs: document.getElementById('macroCarbs')?.value || '',
    fat: document.getElementById('macroFat')?.value || '',
    trainingCal: document.getElementById('macroTrainCal')?.value || '',
    restCal: document.getElementById('macroRestCal')?.value || '',
    highCarb: document.getElementById('macroHighCarb')?.value || '',
    lowCarb: document.getElementById('macroLowCarb')?.value || '',
    notes: document.getElementById('macroNotes')?.value || '',
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem('coachMacros_' + client.id, JSON.stringify(macros));
  client.currentNutritionSummary = macros.calories + ' kcal · ' + macros.protein + 'g P · ' + macros.carbs + 'g C · ' + macros.fat + 'g F';
  alert('Macro plan saved for ' + client.clientName);
  renderNutrition(client);
  renderOverview(client);
}

// ══════════════════════════════════════════════════════════════
// COACH-5: Notes to Client
// ══════════════════════════════════════════════════════════════

function renderNotes(c) {
  const el = document.getElementById('dtab_notes');
  const notes = getClientNotes(c.id);

  el.innerHTML = '<div class="d-card"><div class="d-card-title">Send Note to ' + (c.clientName?.split(' ')[0] || 'Client') + '</div>'
    + '<textarea id="coachNoteInput" style="width:100%;min-height:100px;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:inherit;font-size:0.88rem;resize:vertical;margin-bottom:10px;" placeholder="Write a note — the athlete will see this in their app…"></textarea>'
    + '<div style="display:flex;gap:8px;">'
    + '<button class="bulk-action-btn" onclick="saveNote()">💬 Send Note</button>'
    + '<button class="bulk-action-btn" style="background:var(--highlight);" onclick="aiDraftIntoNotes()">✍️ AI Draft</button>'
    + '</div></div>'
    + '<div class="d-card"><div class="d-card-title">Note History (' + notes.length + ')</div>'
    + (notes.length ? notes.map(n => {
      const d = new Date(n.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return '<div style="padding:10px 0;border-bottom:1px solid rgba(132,157,144,0.1);">'
        + '<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;">' + d + '</div>'
        + '<div style="font-size:0.85rem;color:var(--text-sec);line-height:1.5;">' + n.text + '</div></div>';
    }).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">No notes yet.</p>')
    + '</div>';
}

function getClientNotes(clientId) {
  try { return JSON.parse(localStorage.getItem('coachNotes_' + clientId) || '[]'); } catch { return []; }
}

function saveCoachNote(clientId, text) {
  const notes = getClientNotes(clientId);
  notes.unshift({ text, from: _username, ts: Date.now() });
  localStorage.setItem('coachNotes_' + clientId, JSON.stringify(notes));
}

function saveNote() {
  const text = document.getElementById('coachNoteInput')?.value?.trim();
  if (!text) { alert('Write a note first.'); return; }
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  saveCoachNote(client.id, text);
  alert('Note sent to ' + client.clientName);
  renderNotes(client);
}

// ══════════════════════════════════════════════════════════════
// COACH-6: Client Invite Flow
// ══════════════════════════════════════════════════════════════

function showInviteModal() {
  let overlay = document.getElementById('inviteOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'inviteOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:24px;';
    document.body.appendChild(overlay);
  }

  const code = 'PC-' + _username.toUpperCase().slice(0, 4) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const invites = getInvites();

  overlay.innerHTML = '<div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:420px;width:100%;">'
    + '<h3 style="margin:0 0 16px;color:var(--text);">Invite a Client</h3>'
    + '<p style="font-size:0.85rem;color:var(--text-sec);margin-bottom:16px;">Share this invite code with your athlete. They enter it in their Pocket Coach app under Settings → Connect to Coach.</p>'
    + '<div style="display:flex;gap:8px;margin-bottom:16px;">'
    + '<input type="text" id="inviteCode" value="' + code + '" readonly style="flex:1;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--primary);font-family:monospace;font-size:1.1rem;font-weight:700;text-align:center;">'
    + '<button onclick="copyInviteCode()" style="padding:12px 18px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-weight:700;cursor:pointer;">Copy</button>'
    + '</div>'
    + '<div style="margin-bottom:16px;">'
    + '<input type="text" id="inviteClientName" placeholder="Client name (optional)" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.9rem;margin-bottom:8px;">'
    + '<input type="email" id="inviteClientEmail" placeholder="Client email (optional)" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.9rem;">'
    + '</div>'
    + '<button onclick="saveInvite(\'' + code + '\')" style="width:100%;padding:12px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-weight:700;cursor:pointer;margin-bottom:16px;">Save Invite</button>'
    + (invites.length ? '<div style="border-top:1px solid var(--border);padding-top:12px;"><div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">Pending Invites (' + invites.length + ')</div>'
    + invites.map(inv => '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(132,157,144,0.1);font-size:0.82rem;">'
      + '<span style="color:var(--text-sec);">' + (inv.name || inv.code) + '</span>'
      + '<span style="color:var(--text-muted);">' + inv.code + '</span></div>').join('') + '</div>' : '')
    + '<button onclick="document.getElementById(\'inviteOverlay\').remove()" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;margin-top:8px;">Close</button>'
    + '</div>';
}

function copyInviteCode() {
  const input = document.getElementById('inviteCode');
  if (!input) return;
  navigator.clipboard?.writeText(input.value).then(() => alert('Invite code copied!')).catch(() => { input.select(); document.execCommand('copy'); });
}

function getInvites() {
  try { return JSON.parse(localStorage.getItem('coachInvites_' + _username) || '[]'); } catch { return []; }
}

function saveInvite(code) {
  const name = document.getElementById('inviteClientName')?.value?.trim() || '';
  const email = document.getElementById('inviteClientEmail')?.value?.trim() || '';
  const invites = getInvites();
  invites.unshift({ code, name, email, createdAt: new Date().toISOString(), status: 'pending' });
  localStorage.setItem('coachInvites_' + _username, JSON.stringify(invites));
  alert('Invite saved! Share the code: ' + code);
  showInviteModal();
}

// ══════════════════════════════════════════════════════════════
// COACH-7: AI Coach Assistant
// ══════════════════════════════════════════════════════════════

async function aiAnalyse() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  const ci = client.latestCheckInData || {};
  const box = document.getElementById('aiResultBox');
  if (box) box.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">🧠 Analysing check-in…</p>';

  try {
    const res = await fetch(SERVER_URL + '/api/ai/checkin-summary', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        sleep: ci.sleep || 5, energy: ci.energy || 5, stress: ci.stress || 5,
        hunger: ci.hunger, trainingPerformance: ci.trainingPerformance,
        bodyweightThisWeek: ci.bodyweight || 70,
        compliancePercent: 80, goal: 'maintain',
        archetype: client.trainingMode || 'hybrid',
        adjustmentNotes: ''
      })
    });
    const data = await res.json();
    if (box) box.innerHTML = '<div style="background:var(--surface);border-left:3px solid var(--primary);border-radius:0 10px 10px 0;padding:12px;margin-top:8px;">'
      + '<div style="font-size:0.72rem;font-weight:700;color:var(--primary);text-transform:uppercase;margin-bottom:6px;">AI Analysis</div>'
      + '<div style="font-size:0.85rem;color:var(--text-sec);line-height:1.5;">' + (data.summary || 'No analysis available.') + '</div></div>';
  } catch {
    if (box) box.innerHTML = '<p style="color:var(--danger);font-size:0.82rem;">Failed to analyse — check connection.</p>';
  }
}

async function aiDraft() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  const ci = client.latestCheckInData || {};
  const box = document.getElementById('aiResultBox');
  if (box) box.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">✍️ Drafting message…</p>';

  try {
    const res = await fetch(SERVER_URL + '/api/ai/coach-draft-message', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        clientName: client.clientName,
        archetype: client.trainingMode || 'hybrid',
        currentPhase: 'general',
        compliancePercent: 80,
        checkIn: ci,
        bodyweightChange: 0,
        alerts: client.alertStatus === 'action' ? [{ label: 'Low recovery', reason: 'Sleep and energy below threshold' }] : [],
        currentProgramSummary: client.currentProgram || '',
        currentNutritionSummary: client.currentNutritionSummary || '',
      })
    });
    const data = await res.json();
    if (box) box.innerHTML = '<div style="background:var(--surface);border-left:3px solid var(--highlight);border-radius:0 10px 10px 0;padding:12px;margin-top:8px;">'
      + '<div style="font-size:0.72rem;font-weight:700;color:var(--highlight);text-transform:uppercase;margin-bottom:6px;">AI Draft Message</div>'
      + '<div style="font-size:0.85rem;color:var(--text-sec);line-height:1.5;white-space:pre-wrap;">' + (data.draft || 'No draft available.') + '</div>'
      + '<button class="bulk-action-btn" style="margin-top:10px;" onclick="useAiDraft()">📋 Copy to Notes</button></div>';
  } catch {
    if (box) box.innerHTML = '<p style="color:var(--danger);font-size:0.82rem;">Failed to draft — check connection.</p>';
  }
}

function aiDraftIntoNotes() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  const ci = client.latestCheckInData || {};
  const textarea = document.getElementById('coachNoteInput');
  if (textarea) textarea.value = 'Generating AI draft…';

  fetch(SERVER_URL + '/api/ai/coach-draft-message', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      clientName: client.clientName,
      archetype: client.trainingMode || 'hybrid',
      currentPhase: 'general', compliancePercent: 80,
      checkIn: ci, bodyweightChange: 0, alerts: [],
      currentProgramSummary: client.currentProgram || '',
      currentNutritionSummary: client.currentNutritionSummary || '',
    })
  }).then(r => r.json()).then(data => {
    if (textarea) textarea.value = data.draft || 'Could not generate draft.';
  }).catch(() => {
    if (textarea) textarea.value = 'Failed to generate — check connection.';
  });
}

function useAiDraft() {
  const draftEl = document.querySelector('#aiResultBox .bulk-action-btn')?.parentElement?.querySelector('div:nth-child(2)');
  if (!draftEl) return;
  const text = draftEl.textContent;
  navigator.clipboard?.writeText(text).then(() => alert('Draft copied to clipboard!'));
}

// ── Boot ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', checkAuth);
document.getElementById('loginPassword')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') doCoachLogin();
});
