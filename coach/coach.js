/* =============================================================
   COACH DASHBOARD — JavaScript
   Auth, client roster, filtering, detail panel rendering.
   ============================================================= */

const SERVER_URL = 'https://traininglog-backend.onrender.com';

let _token = localStorage.getItem('coachToken') || null;
let _username = localStorage.getItem('coachUser') || null;
let _clients = [];
let _activeFilter = 'all';
let _searchQuery = '';
let _selectedClientId = null;
let _bulkSelected = new Set();

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
  btn.textContent = 'Signing in…';
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
  } catch (err) {
    errorEl.textContent = 'Connection error. Try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

function doLogout() {
  _token = null;
  _username = null;
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
      headers: { Authorization: 'Bearer ' + _token },
    });
    const data = await res.json();

    if (data.success && Array.isArray(data.clients)) {
      _clients = data.clients;
    } else {
      _clients = [];
    }
  } catch {
    // Fallback: demo data for development
    _clients = getDemoClients();
  }

  if (!_clients.length) {
    _clients = getDemoClients();
  }

  renderClientList();
}

function getDemoClients() {
  return [
    { id: 'demo1', clientName: 'Sarah Mitchell', email: 'sarah@test.com', status: 'active', trainingMode: 'bodybuilding', currentProgram: 'PPL Hypertrophy', lastCheckIn: '2026-06-23', alertStatus: 'ok', latestCheckInData: { sleep: 8, energy: 7, stress: 3, hunger: 5, trainingPerformance: 8, bodyweight: 62.5 } },
    { id: 'demo2', clientName: 'James Cooper', email: 'james@test.com', status: 'active', trainingMode: 'powerlifting', currentProgram: 'Peaking Block', lastCheckIn: '2026-06-22', alertStatus: 'action', latestCheckInData: { sleep: 5, energy: 4, stress: 8, hunger: 7, trainingPerformance: 4, bodyweight: 95.2 } },
    { id: 'demo3', clientName: 'Mia Johnson', email: 'mia@test.com', status: 'active', trainingMode: 'hybrid', currentProgram: 'General Fitness', lastCheckIn: '2026-06-21', alertStatus: 'watch', latestCheckInData: { sleep: 6, energy: 6, stress: 5, hunger: 4, trainingPerformance: 6, bodyweight: 58.0 } },
    { id: 'demo4', clientName: 'Liam Brown', email: 'liam@test.com', status: 'active', trainingMode: 'bodybuilding', currentProgram: 'Arm Specialisation', lastCheckIn: '2026-06-24', alertStatus: 'ok', latestCheckInData: { sleep: 9, energy: 8, stress: 2, hunger: 6, trainingPerformance: 9, bodyweight: 84.3 } },
    { id: 'demo5', clientName: 'Emma Davis', email: 'emma@test.com', status: 'active', trainingMode: 'recreational', currentProgram: 'Full Body 3x', lastCheckIn: '2026-06-20', alertStatus: 'watch', latestCheckInData: { sleep: 7, energy: 5, stress: 6, hunger: 8, trainingPerformance: 5, bodyweight: 70.1 } },
  ];
}

// ── Render client list ────────────────────────────────────────

function renderClientList() {
  const listEl = document.getElementById('clientList');
  let filtered = _clients.slice();

  // Filter by alert status
  if (_activeFilter !== 'all') {
    filtered = filtered.filter(c => c.alertStatus === _activeFilter);
  }

  // Search
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    filtered = filtered.filter(c =>
      (c.clientName || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.trainingMode || '').toLowerCase().includes(q)
    );
  }

  if (!filtered.length) {
    listEl.innerHTML = '<div class="client-list-loading">No clients match your filters.</div>';
    return;
  }

  listEl.innerHTML = filtered.map(c => {
    const initials = (c.clientName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const isActive = c.id === _selectedClientId;
    const isChecked = _bulkSelected.has(c.id);
    const daysSince = c.lastCheckIn ? Math.floor((Date.now() - new Date(c.lastCheckIn).getTime()) / 86400000) : '—';
    const meta = (c.trainingMode || '—') + ' · ' + (daysSince === '—' ? 'No check-in' : daysSince + 'd ago');

    return '<div class="client-row' + (isActive ? ' active' : '') + '" data-id="' + c.id + '" onclick="selectClient(\'' + c.id + '\')">'
      + '<input type="checkbox" class="client-checkbox" ' + (isChecked ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleBulk(\'' + c.id + '\')">'
      + '<div class="client-avatar">' + initials + '</div>'
      + '<div class="client-info">'
      + '<div class="client-name">' + (c.clientName || 'Unknown') + '</div>'
      + '<div class="client-meta">' + meta + '</div>'
      + '</div>'
      + '<div class="client-alert ' + (c.alertStatus || 'ok') + '"></div>'
      + '</div>';
  }).join('');

  // Update filter counts
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

// ── Filters ───────────────────────────────────────────────────

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

// ── Bulk select ───────────────────────────────────────────────

function toggleBulk(id) {
  if (_bulkSelected.has(id)) _bulkSelected.delete(id);
  else _bulkSelected.add(id);

  const bar = document.getElementById('bulkBar');
  if (_bulkSelected.size > 0) {
    bar.style.display = '';
    document.getElementById('bulkCount').textContent = _bulkSelected.size + ' selected';
  } else {
    bar.style.display = 'none';
  }
  renderClientList();
}

function bulkMessage() {
  const names = _clients.filter(c => _bulkSelected.has(c.id)).map(c => c.clientName).join(', ');
  alert('Send message to: ' + names + '\n\n(Bulk messaging will be implemented in COACH-5)');
}

// ── Select client → render detail ─────────────────────────────

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

  // Reset to overview tab
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

// ── Detail: Header ────────────────────────────────────────────

function renderDetailHeader(c) {
  const initials = (c.clientName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const daysSince = c.lastCheckIn ? Math.floor((Date.now() - new Date(c.lastCheckIn).getTime()) / 86400000) + ' days ago' : 'Never';

  document.getElementById('detailHeader').innerHTML =
    '<div class="detail-avatar">' + initials + '</div>'
    + '<div class="detail-info">'
    + '<div class="detail-name">' + (c.clientName || 'Unknown') + '</div>'
    + '<div class="detail-meta">' + (c.trainingMode || '—') + ' · Last check-in: ' + daysSince + ' · ' + (c.email || '') + '</div>'
    + '</div>'
    + '<span class="detail-status ' + (c.alertStatus || 'ok') + '">' + (c.alertStatus || 'ok') + '</span>';
}

// ── Detail: Overview ──────────────────────────────────────────

function renderOverview(c) {
  const ci = c.latestCheckInData || {};
  const el = document.getElementById('dtab_overview');

  el.innerHTML =
    '<div class="d-card"><div class="d-card-title">Quick Stats</div>'
    + '<div class="d-stat-grid">'
    + stat('Bodyweight', ci.bodyweight ? ci.bodyweight + ' kg' : '—')
    + stat('Program', c.currentProgram || '—')
    + stat('Mode', c.trainingMode || '—')
    + stat('Status', c.alertStatus || '—')
    + '</div></div>'
    + '<div class="d-card"><div class="d-card-title">Latest Check-In Scores</div>'
    + scoreBar('Sleep', ci.sleep, 10)
    + scoreBar('Energy', ci.energy, 10)
    + scoreBar('Stress', ci.stress, 10, true)
    + scoreBar('Hunger', ci.hunger, 10)
    + scoreBar('Training', ci.trainingPerformance, 10)
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">AI Quick Actions</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + '<button class="bulk-action-btn" onclick="aiAnalyse()">🧠 Analyse Check-In</button>'
    + '<button class="bulk-action-btn" onclick="aiDraft()">✍️ Draft Message</button>'
    + '</div></div>';
}

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
    + '<span class="checkin-score-val">' + v + '/' + max + '</span>'
    + '</div>';
}

// ── Detail: Check-In ──────────────────────────────────────────

function renderCheckIn(c) {
  const ci = c.latestCheckInData || {};
  const el = document.getElementById('dtab_checkin');

  if (!ci.sleep && !ci.energy) {
    el.innerHTML = '<div class="d-card"><p style="color:var(--text-muted);text-align:center;padding:24px 0;">No check-in data available for this client.</p></div>';
    return;
  }

  el.innerHTML =
    '<div class="d-card"><div class="d-card-title">Full Check-In Review</div>'
    + scoreBar('Sleep Quality', ci.sleep, 10)
    + scoreBar('Energy Level', ci.energy, 10)
    + scoreBar('Stress Level', ci.stress, 10, true)
    + scoreBar('Hunger', ci.hunger, 10)
    + scoreBar('Training Performance', ci.trainingPerformance, 10)
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">Bodyweight</div>'
    + '<div class="d-stat-grid">'
    + stat('Current', ci.bodyweight ? ci.bodyweight + ' kg' : '—')
    + stat('Last Check-In', c.lastCheckIn || '—')
    + '</div></div>';
}

// ── Detail: Program ───────────────────────────────────────────

function renderProgram(c) {
  const el = document.getElementById('dtab_program');
  el.innerHTML =
    '<div class="d-card"><div class="d-card-title">Current Program</div>'
    + '<div class="d-stat-grid">'
    + stat('Program', c.currentProgram || 'None assigned')
    + stat('Mode', c.trainingMode || '—')
    + '</div>'
    + '<p style="color:var(--text-muted);font-size:0.82rem;margin-top:12px;">Program assignment editor coming in COACH-4.</p>'
    + '</div>';
}

// ── Detail: Nutrition ─────────────────────────────────────────

function renderNutrition(c) {
  const el = document.getElementById('dtab_nutrition');
  el.innerHTML =
    '<div class="d-card"><div class="d-card-title">Nutrition Plan</div>'
    + '<p style="color:var(--text-sec);">' + (c.currentNutritionSummary || 'No nutrition plan set.') + '</p>'
    + '<p style="color:var(--text-muted);font-size:0.82rem;margin-top:12px;">Macro plan editor coming in COACH-4.</p>'
    + '</div>';
}

// ── Detail: Notes ─────────────────────────────────────────────

function renderNotes(c) {
  const el = document.getElementById('dtab_notes');
  el.innerHTML =
    '<div class="d-card"><div class="d-card-title">Coach Notes</div>'
    + '<textarea id="coachNoteInput" style="width:100%;min-height:120px;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:inherit;font-size:0.88rem;resize:vertical;" placeholder="Write a note to this client…"></textarea>'
    + '<button class="bulk-action-btn" style="margin-top:8px;" onclick="saveNote()">Save Note</button>'
    + '<p style="color:var(--text-muted);font-size:0.82rem;margin-top:12px;">Notes will be visible to the athlete in their app. Full implementation in COACH-5.</p>'
    + '</div>';
}

// ── AI Actions (placeholder) ──────────────────────────────────

function aiAnalyse() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  alert('AI Analysis for ' + client.clientName + '\n\nThis will call /api/ai/checkin-summary with the client\'s check-in data.\n\nComing in COACH-7.');
}

function aiDraft() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  alert('Draft Message for ' + client.clientName + '\n\nThis will call /api/ai/coach-draft-message.\n\nComing in COACH-7.');
}

// ── Invite (placeholder) ─────────────────────────────────────

function showInviteModal() {
  alert('Client invite flow coming in COACH-6.\n\nThis will generate an invite link or code that athletes can use to connect to your coaching roster.');
}

function saveNote() {
  alert('Note saved! (Coming in COACH-5 — will persist to Airtable and show in the athlete\'s app.)');
}

// ── Boot ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', checkAuth);

// Allow Enter key to submit login
document.getElementById('loginPassword')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') doCoachLogin();
});
