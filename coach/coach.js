/* =============================================================
   COACH DASHBOARD — JavaScript
   Auth, client roster, detail panels, program assignment,
   macro editor, notes, invites, AI assistant.
   ============================================================= */

const SERVER_URL = 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
// Firebase's public Web API key (safe to ship client-side — it just
// identifies the project, real access control is server-side rules/auth).
// Used only for the "Forgot password?" flow below, which calls Google's
// Identity Toolkit REST API directly rather than pulling in the whole
// Firebase client SDK for one endpoint.
const FIREBASE_API_KEY = 'AIzaSyCgZTztfMhwQdRfc4no_ZduDEfOv30gMcY';

// Session token lives under the same 'token' key firebase-auth.js's
// hourly auto-refresh (watchTokenRefresh) writes to — this page shares one
// Firebase session per browser/origin with the main app, same as every
// other fetch in the codebase already does. '_username' stays coach-scoped
// under its own key since it's just for display.
let _token = localStorage.getItem('token') || null;
let _username = localStorage.getItem('coachUser') || null;
let _clients = [];
let _activeFilter = 'all';
let _searchQuery = '';
let _selectedClientId = null;
let _bulkSelected = new Set();
let _leads = [];
let _sidebarMode = 'clients';
let _selectedLeadId = null;
let _clientsLoadError = false;

function authHeaders() {
  // Read localStorage fresh each call rather than the in-memory `_token`
  // captured at login: firebase-auth.js's watchTokenRefresh silently
  // rewrites this key roughly hourly (Firebase ID tokens expire that
  // often) without notifying this module, so `_token` alone would go
  // stale mid-session.
  return { Authorization: 'Bearer ' + (localStorage.getItem('token') || _token), 'Content-Type': 'application/json' };
}

// ── Auth ──────────────────────────────────────────────────────

function checkAuth() {
  if (_token && _username) {
    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('appShell').style.display = '';
    document.getElementById('headerUser').textContent = _username;
    loadClients();
    loadLeads();
    loadPrograms().then(renderWorkspace);
  }
}

async function doCoachLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  if (!username || !password) { errorEl.textContent = 'Enter username and password.'; return; }

  if (!window.firebaseAuth?.isAvailable()) {
    errorEl.textContent = 'Sign-in is not available right now (Firebase not configured in this build).';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Connecting…';
  errorEl.textContent = '';

  try {
    const fb = await window.firebaseAuth.login({ usernameOrEmail: username, password });

    if (fb.needsVerification) {
      errorEl.textContent = 'This account’s email isn’t verified yet — check your inbox for the verification link.';
      return;
    }

    _token = fb.token;
    _username = fb.username || username;
    localStorage.setItem('coachUser', _username);

    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('appShell').style.display = '';
    document.getElementById('headerUser').textContent = _username;
    loadClients();
    loadLeads();
    loadPrograms().then(renderWorkspace);
  } catch (err) {
    errorEl.textContent = err?.message || 'Invalid credentials.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

// Resolves the typed username to an email via the backend (login here is by
// username, but Firebase's password-reset flow is email-based), then asks
// Google's Identity Toolkit directly to send the reset link — no dedicated
// backend route needed for that second step, it's the same public REST call
// the Firebase client SDK's sendPasswordResetEmail() makes under the hood.
async function doForgotPassword() {
  const username = document.getElementById('loginUsername').value.trim();
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('forgotPasswordBtn');

  if (!username) {
    errorEl.className = 'login-error';
    errorEl.textContent = 'Enter your username above first, then click "Forgot password?".';
    return;
  }

  btn.disabled = true;
  errorEl.className = 'login-error info';
  errorEl.textContent = 'Sending reset link…';

  try {
    const resolveRes = await fetch(SERVER_URL + '/auth/email-for-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const resolveData = await resolveRes.json();
    if (!resolveRes.ok || !resolveData.success || !resolveData.email) {
      errorEl.className = 'login-error';
      errorEl.textContent = resolveData.error?.message || 'No account found for that username.';
      return;
    }

    const resetRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=' + FIREBASE_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: resolveData.email }),
    });
    if (!resetRes.ok) {
      const resetData = await resetRes.json().catch(() => ({}));
      errorEl.className = 'login-error';
      errorEl.textContent = resetData.error?.message || 'Could not send reset email.';
      return;
    }

    errorEl.className = 'login-error success';
    errorEl.textContent = 'Reset link sent to ' + resolveData.email + ' — check your inbox.';
  } catch {
    errorEl.className = 'login-error';
    errorEl.textContent = 'Connection error — could not send reset link.';
  } finally {
    btn.disabled = false;
  }
}

function doLogout() {
  _token = null; _username = null;
  window.firebaseAuth?.logout?.();
  localStorage.removeItem('token');
  localStorage.removeItem('authToken');
  localStorage.removeItem('coachUser');
  location.reload();
}

// ── Fetch clients ─────────────────────────────────────────────

async function loadClients() {
  const listEl = document.getElementById('clientList');
  listEl.innerHTML = '<div class="client-list-loading">Loading clients…</div>';
  _clientsLoadError = false;

  try {
    const res = await fetch(SERVER_URL + '/api/coach/clients?coachId=' + encodeURIComponent(_username), {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data?.error?.message || 'Request failed');
    // A genuinely empty roster is a real, honest state — render it as such
    // (see renderClientList/renderWorkspace) rather than papering over it
    // with fabricated demo clients, which is what this used to do.
    _clients = Array.isArray(data.clients) ? data.clients : [];
  } catch {
    _clients = [];
    _clientsLoadError = true;
  }

  renderClientList();
  renderWorkspace();
}

// ── Render client list ────────────────────────────────────────

function renderClientList() {
  const listEl = document.getElementById('clientList');
  let filtered = _clients.slice();
  if (_activeFilter === 'pending') filtered = filtered.filter(c => c.status === 'pending');
  else if (_activeFilter !== 'all') filtered = filtered.filter(c => c.status !== 'pending' && c.alertStatus === _activeFilter);
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    filtered = filtered.filter(c => (c.clientName || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q));
  }

  if (!filtered.length) {
    listEl.innerHTML = '<div class="client-list-loading">'
      + (_clientsLoadError ? 'Couldn\'t load your clients — check your connection and try again.'
        : _clients.length ? 'No clients match.'
        : 'No clients yet. Use + Invite, or convert a lead.')
      + '</div>';
    updateFilterCounts();
    return;
  }

  listEl.innerHTML = filtered.map(c => {
    const initials = escapeHtml((c.clientName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase());
    const isActive = c.id === _selectedClientId;
    const isChecked = _bulkSelected.has(c.id);
    const pending = c.status === 'pending';
    const daysSince = daysSinceIso(c.lastCheckIn);
    const meta = pending
      ? 'Invite pending'
      : escapeHtml(c.trainingMode || '—') + ' · ' + (daysSince === null ? 'No check-in' : daysSince + 'd ago');
    const id = escapeHtml(c.id);

    return '<div class="client-row' + (isActive ? ' active' : '') + (pending ? ' is-pending' : '') + '" data-id="' + id + '" onclick="selectClient(\'' + id + '\')">'
      + (pending ? '<span class="client-checkbox"></span>' : '<input type="checkbox" class="client-checkbox" ' + (isChecked ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleBulk(\'' + id + '\')" aria-label="Select ' + escapeHtml(c.clientName) + '">')
      + '<div class="client-avatar">' + initials + '</div>'
      + '<div class="client-info"><div class="client-name">' + escapeHtml(c.clientName || 'Unknown') + '</div>'
      + '<div class="client-meta">' + meta + '</div></div>'
      + '<div class="client-alert ' + (pending ? 'pending' : escapeHtml(c.alertStatus || 'ok')) + '"></div></div>';
  }).join('');
  updateFilterCounts();
}

// Whole days between an ISO date (YYYY-MM-DD) and today; null if missing.
function daysSinceIso(value) {
  if (!value) return null;
  const t = Date.parse(String(value).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(t)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - t) / 86400000));
}

function activeClients() {
  return _clients.filter(c => c.status !== 'pending');
}

function updateFilterCounts() {
  const counts = { all: _clients.length, action: 0, watch: 0, ok: 0, pending: 0 };
  _clients.forEach(c => {
    if (c.status === 'pending') counts.pending++;
    else if (counts[c.alertStatus] !== undefined) counts[c.alertStatus]++;
  });
  // Scoped to #statusFilters — .filter-tab is a shared class.
  document.querySelectorAll('#statusFilters .filter-tab').forEach(tab => {
    const f = tab.dataset.filter;
    const labels = { all: 'All', action: 'Needs Action', watch: 'Watch', ok: 'Stable', pending: 'Pending' };
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
  if (_sidebarMode === 'leads') renderLeadList(); else renderClientList();
}

document.getElementById('sidebarModeToggle')?.addEventListener('click', e => {
  const tab = e.target.closest('.mode-tab');
  if (tab) switchSidebarMode(tab.dataset.mode);
});

// ── Workspace (triage-first landing view) ───────────────────────
// Stat row / priority client / roster table are derived from the real
// _clients array already loaded by loadClients(). Review-queue and
// messages panels are static shells (see TODO(coach-workspace) markers
// in coach/index.html) since no backing data model exists for those yet.

function renderWorkspace() {
  const view = document.getElementById('workspaceView');
  if (!view) return;

  const linked = activeClients();
  const counts = { all: linked.length, action: 0, watch: 0, ok: 0 };
  linked.forEach(c => { if (counts[c.alertStatus] !== undefined) counts[c.alertStatus]++; });
  const pendingCount = _clients.length - linked.length;

  const rosterSummaryText =
    linked.length + ' client' + (linked.length === 1 ? '' : 's') +
    (pendingCount ? ' · ' + pendingCount + ' pending' : '') +
    (counts.action ? ' · ' + counts.action + ' need attention' : '');
  document.getElementById('wsHeaderSub').textContent = rosterSummaryText;
  const headerSummaryEl = document.getElementById('headerRosterSummary');
  if (headerSummaryEl) {
    headerSummaryEl.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + rosterSummaryText;
  }

  document.getElementById('wsStatRow').innerHTML = [
    ['Total clients', counts.all, ''],
    ['Needs action', counts.action, counts.action ? 'ws-stat-danger' : ''],
    ['Watch', counts.watch, counts.watch ? 'ws-stat-warn' : ''],
    ['Stable', counts.ok, ''],
  ].map(([label, val, cls]) =>
    '<div class="pod ws-stat-tile ' + cls + '"><div class="stat-tile-label">' + label + '</div>' +
    '<div class="stat-tile-value">' + val + '</div></div>'
  ).join('');

  // Priority client: first "needs action", else first "watch", else none.
  const priority = linked.find(c => c.alertStatus === 'action') || linked.find(c => c.alertStatus === 'watch');
  const priorityEl = document.getElementById('wsPriorityCard');
  if (priority) {
    const ci = priority.latestCheckInData || {};
    const days = daysSinceIso(priority.lastCheckIn);
    const reason = (priority.alerts || [])[0];
    priorityEl.innerHTML =
      '<div class="pod pod--hero ws-priority-card">' +
      '<div class="pod-row"><span class="pod-kicker">Needs attention</span>' +
      '<span class="ws-priority-tag ' + escapeHtml(priority.alertStatus) + '">' + escapeHtml(priority.alertStatus) + '</span></div>' +
      '<div class="ws-priority-main">' +
      '<span class="ws-priority-name">' + escapeHtml(priority.clientName || 'Unknown') + '</span>' +
      '<span class="ws-priority-meta">' + (reason ? escapeHtml(reason.label + ': ' + reason.reason) : escapeHtml(priority.currentProgram || 'No program')) +
      ' &middot; last check-in ' + (days === null ? 'never' : days + 'd ago') + '</span>' +
      '</div>' +
      '<div class="ws-priority-stats">' +
      stat('Sleep', ci.sleep != null ? ci.sleep + '/10' : '—') +
      stat('Energy', ci.energy != null ? ci.energy + '/10' : '—') +
      stat('Compliance', priority.compliancePercent != null ? priority.compliancePercent + '%' : '—') +
      stat('Bodyweight', priority.currentBodyweight != null ? priority.currentBodyweight + ' kg' : '—') +
      '</div>' +
      '<button class="cta-capsule ws-priority-cta" onclick="selectClient(\'' + escapeHtml(priority.id) + '\')">Open client file</button>' +
      '</div>';
  } else {
    priorityEl.innerHTML = '<div class="pod pod--hero ws-priority-card"><p class="ws-empty-note">'
      + (_clientsLoadError ? 'Couldn\'t load your clients — check your connection and try again.'
        : linked.length ? 'Everyone\'s on track — no flagged clients right now.'
        : 'No clients yet.')
      + '</p></div>';
  }

  // Roster table — every linked client, sorted by alert severity then name.
  const severity = { action: 0, watch: 1, ok: 2 };
  const sorted = linked.slice().sort((a, b) =>
    (severity[a.alertStatus] ?? 3) - (severity[b.alertStatus] ?? 3) ||
    (a.clientName || '').localeCompare(b.clientName || '')
  );
  document.getElementById('wsRosterCount').textContent = linked.length;
  // Everything here comes from what each client shares (see the mobile
  // app's Settings → Your Coach); anything not shared shows "—".
  const rosterHeader =
    '<div class="ws-roster-row ws-roster-row--header">' +
      '<span>Client</span><span>Program</span><span class="ws-roster-cell--right">Weight</span>' +
      '<span class="ws-roster-cell--right">Rate/wk</span><span class="ws-roster-cell--right">Compliance</span>' +
      '<span class="ws-roster-cell--right">Last check-in</span><span>Next action</span>' +
    '</div>';
  document.getElementById('wsRosterTable').innerHTML = rosterHeader + (sorted.map(c => {
    const days = daysSinceIso(c.lastCheckIn);
    const rate = c.weeklyWeightChangePercent;
    const next = (c.alerts || [])[0];
    return '<div class="ws-roster-row" onclick="selectClient(\'' + escapeHtml(c.id) + '\')">' +
      '<span class="ws-roster-name">' + escapeHtml(c.clientName || 'Unknown') + '</span>' +
      '<span class="ws-roster-cell">' + escapeHtml(c.currentProgram || c.activeProgramName || '—') + '</span>' +
      '<span class="ws-roster-cell ws-roster-cell--right tabular-nums">' + (c.currentBodyweight != null ? c.currentBodyweight + ' kg' : '—') + '</span>' +
      '<span class="ws-roster-cell ws-roster-cell--right tabular-nums">' + (rate != null ? (rate > 0 ? '+' : '') + Number(rate).toFixed(2) + '%' : '—') + '</span>' +
      '<span class="ws-roster-cell ws-roster-cell--right tabular-nums">' + (c.compliancePercent != null ? c.compliancePercent + '%' : '—') + '</span>' +
      '<span class="ws-roster-cell ws-roster-cell--right tabular-nums">' + (days === null ? '—' : days + 'd') + '</span>' +
      '<span class="ws-roster-alert ' + escapeHtml(c.alertStatus || 'ok') + '">' + escapeHtml(next ? next.label : 'On track') + '</span>' +
      '</div>';
  }).join('') || '<p class="ws-empty-note">No clients yet.</p>');

  // Templates: the shared program library, with how many clients have each.
  const templatesEl = document.getElementById('wsTemplatesList');
  if (!_programs.length) {
    templatesEl.innerHTML = '<p class="ws-empty-note">No programs in your library yet. Build one in a client\'s Program tab or on the phone (Coach Ops → Programs).</p>';
  } else {
    templatesEl.innerHTML = _programs.map(p => {
      const assigned = linked.filter(c => c.currentProgramId === p.id).length;
      return '<div class="ws-list-row"><span class="ws-list-name">' + escapeHtml(p.name) + '</span>' +
        '<span class="ws-list-count">' + assigned + '</span></div>';
    }).join('');
  }

  railNavUpdateCounts(counts, _programs.length);
  if (_activeWorkspaceSection === 'checkins') renderCheckinsList();
}

// ── Rail nav (left sidebar) ──────────────────────────────────────
// Real tab switching — one .ws-panel visible at a time. Used to be
// scrollIntoView() to a section on one long always-rendered page; every
// destination below now has real, distinct content (Programs and
// Analytics were dropped as separate destinations — see index.html's
// rail-nav comment for why). Settings still has no desktop view.

let _activeWorkspaceSection = 'queue';

function railNavUpdateCounts(counts, templateCount) {
  const el = (id) => document.getElementById(id);
  if (el('railCountQueue')) el('railCountQueue').textContent = counts.action;
  if (el('railCountClients')) el('railCountClients').textContent = counts.all;
  if (el('railCountTemplates')) el('railCountTemplates').textContent = templateCount;
  if (el('railCountCheckins')) el('railCountCheckins').textContent = getStaleCheckinClients().length;
}

// Clients with no check-in at all, or none in 7+ days — most overdue
// first. Same definition railNavUpdateCounts() already used for the rail
// badge count; this is the first place it's actually rendered as a list.
function getStaleCheckinClients() {
  return activeClients()
    .map(c => ({
      client: c,
      days: c.lastCheckIn ? (Date.now() - new Date(c.lastCheckIn).getTime()) / 86400000 : Infinity
    }))
    .filter(x => x.days >= 7)
    .sort((a, b) => b.days - a.days);
}

function renderCheckinsList() {
  const el = document.getElementById('wsCheckinsList');
  if (!el) return;
  const stale = getStaleCheckinClients();
  el.innerHTML = stale.length
    ? stale.map(({ client: c, days }) => {
        const label = Number.isFinite(days) ? Math.floor(days) + 'd since last check-in' : 'No check-in shared yet';
        return '<div class="ws-roster-row" onclick="selectClient(\'' + escapeHtml(c.id) + '\')">'
          + '<span class="ws-roster-name">' + escapeHtml(c.clientName || 'Unknown') + '</span>'
          + '<span class="ws-roster-cell">' + escapeHtml(label) + '</span>'
          + '</div>';
      }).join('')
    : '<p class="ws-empty-note">Everyone\'s checked in within the last week.</p>';
}

function railNavGo(section) {
  if (section === 'settings') {
    // No desktop settings view exists yet — say so rather than silently
    // doing nothing or faking a page.
    alert('Settings isn\'t available in the coach console yet — use the mobile app\'s Settings tab for now.');
    return;
  }

  document.querySelectorAll('.rail-nav-item').forEach(b => b.classList.toggle('active', b.dataset.rail === section));
  document.querySelectorAll('.ws-panel').forEach(p => p.classList.toggle('active', p.id === 'wsPanel-' + section));
  _activeWorkspaceSection = section;

  // Any rail destination returns to the workspace view first, in case a
  // client file is currently open.
  if (typeof backToWorkspace === 'function' && document.getElementById('clientDetail').style.display !== 'none') {
    backToWorkspace();
  }
  if (section === 'checkins') renderCheckinsList();
}

function toggleBulk(id) {
  if (_bulkSelected.has(id)) _bulkSelected.delete(id);
  else _bulkSelected.add(id);
  const bar = document.getElementById('bulkBar');
  bar.style.display = _bulkSelected.size > 0 ? '' : 'none';
  document.getElementById('bulkCount').textContent = _bulkSelected.size + ' selected';
  renderClientList();
}

async function bulkMessage() {
  const clients = activeClients().filter(c => _bulkSelected.has(c.id));
  const names = clients.map(c => c.clientName).join(', ');
  const msg = prompt('Message to send to ' + clients.length + ' clients:\n(' + names + ')');
  if (!msg) return;

  const results = await Promise.all(clients.map(c =>
    fetch(SERVER_URL + '/api/coach/clients/' + encodeURIComponent(c.id) + '/notes', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text: msg })
    }).then(r => r.json()).then(d => d.success).catch(() => false)
  ));
  const sent = results.filter(Boolean).length;
  alert(sent === clients.length
    ? 'Message sent to ' + sent + ' client' + (sent === 1 ? '' : 's') + '.'
    : sent + ' of ' + clients.length + ' sent — some failed, try those individually.');
  _bulkSelected.clear();
  document.getElementById('bulkBar').style.display = 'none';
  renderClientList();
}

// ── Select client ─────────────────────────────────────────────

function backToWorkspace() {
  _selectedClientId = null;
  renderClientList();
  document.getElementById('clientDetail').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('workspaceView').style.display = '';
  document.querySelector('.app-shell')?.classList.remove('is-rail-collapsed');
}

// Full history (check-ins, bodyweight series, weekly sessions) for the
// open client, from GET /api/coach/clients/:id.
let _clientDetails = {};

async function loadClientDetail(id) {
  try {
    const res = await fetch(SERVER_URL + '/api/coach/clients/' + encodeURIComponent(id), { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data?.error?.message || 'Request failed');
    _clientDetails[id] = data.client;
  } catch {
    _clientDetails[id] = null;
  }
  return _clientDetails[id];
}

function renderClientFile(client) {
  renderDetailHeader(client);
  renderOverview(client);
  renderCheckIn(client);
  renderProgram(client);
  renderNutrition(client);
  if (client.status !== 'pending') renderNotes(client);
  else document.getElementById('dtab_notes').innerHTML = '<div class="d-card"><p class="ws-empty-note">You can send notes once they accept.</p></div>';
}

async function selectClient(id) {
  _selectedClientId = id;
  renderClientList();
  const client = _clients.find(c => c.id === id);
  if (!client) return;

  document.getElementById('workspaceView').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('clientDetail').style.display = '';
  // Rail collapses to icon-only while viewing a client file (spec: 72px).
  document.querySelector('.app-shell')?.classList.add('is-rail-collapsed');

  renderClientFile(client);
  switchDetailTab('overview');
  if (client.status === 'pending') return;
  await Promise.all([loadClientDetail(id), loadPrograms()]);
  if (_selectedClientId === id) renderClientFile(client);
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
// (escapeHtml lives further down, alongside the leads section that needs it)

function stat(label, value) {
  return '<div class="d-stat"><div class="d-stat-val">' + value + '</div><div class="d-stat-lbl">' + label + '</div></div>';
}

function scoreBar(label, value, max, inverse) {
  const v = Number(value) || 0;
  const pct = Math.round((v / max) * 100);
  const color = inverse
    ? (v <= 3 ? 'var(--fill-meter-a)' : v <= 6 ? 'var(--fill-meter-brass)' : 'var(--danger-grad)')
    : (v >= 7 ? 'var(--fill-meter-a)' : v >= 4 ? 'var(--fill-meter-brass)' : 'var(--danger-grad)');
  return '<div class="checkin-score-row">'
    + '<span class="checkin-score-label">' + label + '</span>'
    + '<div class="checkin-score-bar"><div class="checkin-score-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
    + '<span class="checkin-score-val">' + v + '/' + max + '</span></div>';
}

// ── Detail: Header ────────────────────────────────────────────

function renderDetailHeader(c) {
  const initials = escapeHtml((c.clientName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase());
  const pending = c.status === 'pending';
  const days = daysSinceIso(c.lastCheckIn);
  const sharingOff = c.sharing ? Object.entries({ checkIns: 'check-ins', bodyweight: 'bodyweight', workouts: 'workouts' })
    .filter(([k]) => c.sharing[k] === false).map(([, label]) => label) : [];
  const meta = pending
    ? 'Invite sent — waiting for them to accept in the app (Settings → Your Coach)'
    : escapeHtml(c.trainingMode || '—') + ' · Last check-in: ' + (days === null ? 'never' : days + ' days ago')
      + (c.email ? ' · ' + escapeHtml(c.email) : '')
      + (sharingOff.length ? ' · Not sharing: ' + escapeHtml(sharingOff.join(', ')) : '');

  document.getElementById('detailHeader').innerHTML =
    '<div class="detail-avatar">' + initials + '</div>'
    + '<div class="detail-info"><div class="detail-name">' + escapeHtml(c.clientName || 'Unknown') + '</div>'
    + '<div class="detail-meta">' + meta + '</div></div>'
    + '<span class="detail-status ' + (pending ? 'watch' : escapeHtml(c.alertStatus || 'ok')) + '">' + (pending ? 'pending' : escapeHtml(c.alertStatus || 'ok')) + '</span>'
    + '<button class="capsule-chip capsule-chip--warn" onclick="removeClient()">' + (pending ? 'Cancel invite' : 'Remove client') + '</button>';
}

async function removeClient() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  const pending = client.status === 'pending';
  const ok = confirm(pending
    ? 'Cancel the invite to ' + client.clientName + '?'
    : 'Remove ' + client.clientName + '? The link ends and everything they shared with you is deleted. This can\'t be undone.');
  if (!ok) return;
  try {
    const res = await fetch(SERVER_URL + '/api/coach/clients/' + encodeURIComponent(client.id), { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) { alert(data?.error?.message || 'Could not remove.'); return; }
    delete _clientDetails[client.id];
    backToWorkspace();
    loadClients();
  } catch {
    alert('Connection error — try again.');
  }
}

// ── Detail: Overview ──────────────────────────────────────────

function sparkline(points) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const w = 320, h = 80, pad = 4;
  const ys = points.map(p => p.weight);
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const d = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (p.weight - min) / span) * (h - pad * 2);
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
  return '<svg class="coach-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Bodyweight ' + min + ' to ' + max + ' kg">'
    + '<path d="' + d + '" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
}

function weekBars(weeks) {
  if (!Array.isArray(weeks) || !weeks.length) return '';
  const max = Math.max(1, ...weeks.map(w => w.count));
  return '<div class="chart-empty-shell chart-empty-shell--bars coach-week-bars">'
    + weeks.map(w => '<span class="chart-empty-bar is-real" style="height:' + Math.max(4, Math.round((w.count / max) * 100)) + '%" title="Week of ' + escapeHtml(w.weekStart) + ': ' + w.count + ' sessions"></span>').join('')
    + '</div>';
}

function renderOverview(c) {
  const el = document.getElementById('dtab_overview');
  if (c.status === 'pending') {
    el.innerHTML = '<div class="d-card"><p class="ws-empty-note">Nothing to show until ' + escapeHtml(c.clientName) + ' accepts your invite.</p></div>';
    return;
  }
  const d = _clientDetails[c.id];
  const loading = d === undefined;
  const ci = (d?.checkIns || [])[0] || c.latestCheckInData || {};
  const bw = d?.bodyweight || [];
  const weeks = d?.weeklyWorkouts || [];
  const m = c.macroTargets || {};
  const rate = c.weeklyWeightChangePercent;
  const empty = (text) => '<p class="ws-empty-note">' + (loading ? 'Loading…' : text) + '</p>';

  el.innerHTML =
    '<div class="d-card"><div class="d-card-title">Quick Stats</div><div class="d-stat-grid">'
    + stat('Bodyweight', c.currentBodyweight != null ? c.currentBodyweight + ' kg' : '—')
    + stat('Rate / wk', rate != null ? (rate > 0 ? '+' : '') + Number(rate).toFixed(2) + '%' : '—')
    + stat('Compliance', c.compliancePercent != null ? c.compliancePercent + '%' : '—')
    + stat('Sessions this wk', c.workoutsLoggedThisWeek != null ? c.workoutsLoggedThisWeek : '—')
    + '</div></div>'
    + '<div class="d-card"><div class="d-card-title">Alerts</div>'
    + ((c.alerts || []).length
      ? c.alerts.map(a => '<div class="checkin-score-row"><span class="checkin-score-label">' + escapeHtml(a.label) + '</span><span class="checkin-score-val" style="width:auto;flex:1;text-align:right;">' + escapeHtml(a.reason) + '</span></div>').join('')
      : '<p class="ws-empty-note">' + (c.lastSharedAt ? 'No alerts — on track.' : 'No data shared yet. It appears after the client next opens the app.') + '</p>')
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">Weight &middot; trend</div>'
    + (bw.length >= 2 ? sparkline(bw) + '<p class="ws-empty-note">' + bw[0].weight + ' → ' + bw[bw.length - 1].weight + ' kg · ' + escapeHtml(bw[0].date) + ' to ' + escapeHtml(bw[bw.length - 1].date) + '</p>'
      : empty('Not enough weigh-ins shared for a trend.'))
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">Sessions per week</div>'
    + (weeks.length ? weekBars(weeks) + '<p class="ws-empty-note">Last ' + weeks.length + ' weeks' + (c.activeProgramName ? ' · following ' + escapeHtml(c.activeProgramName) : '') + '</p>'
      : empty('No workouts shared yet.'))
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">Macro targets</div>'
    + (m.calories ? '<div class="d-stat-grid">' + stat('Calories', m.calories) + stat('Protein', m.protein + 'g') + stat('Carbs', m.carbs + 'g') + stat('Fat', m.fat + 'g') + '</div>'
      : '<p class="ws-empty-note">No targets sent yet — see the Nutrition tab.</p>')
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">Latest Check-In</div>'
    + (ci.date
      ? '<p class="ws-empty-note">' + escapeHtml(ci.date) + '</p>' + scoreRows(ci)
      : empty('No check-ins shared yet.'))
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">AI Coach Actions</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + '<button class="bulk-action-btn" onclick="aiAnalyse()"' + (ci.date ? '' : ' disabled title="Needs a shared check-in"') + '>🧠 Analyse Check-In</button>'
    + '<button class="bulk-action-btn" onclick="aiDraft()">✍️ Draft Message</button>'
    + '</div><div id="aiResultBox" style="margin-top:10px;"></div></div>';
}

function scoreRows(ci) {
  return [['Sleep', 'sleep'], ['Energy', 'energy'], ['Stress', 'stress', true], ['Hunger', 'hunger'], ['Training', 'trainingPerformance'], ['Cardio', 'cardioAdherence']]
    .filter(([, k]) => ci[k] != null)
    .map(([label, k, inverse]) => scoreBar(label, ci[k], 10, inverse))
    .join('');
}

// ── Detail: Check-In ──────────────────────────────────────────

function renderCheckIn(c) {
  const el = document.getElementById('dtab_checkin');
  const d = _clientDetails[c.id];
  const list = d?.checkIns || [];
  if (c.status === 'pending' || !list.length) {
    el.innerHTML = '<div class="d-card"><p style="color:var(--text-muted);text-align:center;padding:24px 0;">'
      + (d === undefined && c.status !== 'pending' ? 'Loading…' : 'No check-ins shared yet.') + '</p></div>';
    return;
  }
  // Progress photos stay on the client's phone; they aren't shared with coaches.
  el.innerHTML = list.map((ci, i) =>
    '<div class="d-card"><div class="d-card-title">' + (i === 0 ? 'Latest check-in · ' : '') + escapeHtml(ci.date) + '</div>'
    + scoreRows(ci)
    + (ci.bodyweight ? '<p class="ws-empty-note">Bodyweight ' + ci.bodyweight + ' kg</p>' : '')
    + (ci.summary ? '<p class="ws-empty-note">' + escapeHtml(ci.summary) + '</p>' : '')
    + (ci.notes ? '<p class="checkin-client-quote">&ldquo;' + escapeHtml(ci.notes) + '&rdquo;</p>' : '')
    + '</div>'
  ).join('');
}

// ══════════════════════════════════════════════════════════════
// COACH-4: Program library + assignment, macro targets
// ══════════════════════════════════════════════════════════════
// Programs live on the server (/api/coach/programs), shared with the
// mobile Coach Ops builder. Assigning one sends its full content to the
// client, who gets a Start button in Settings → Your Coach.

let _programs = [];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function loadPrograms() {
  try {
    const res = await fetch(SERVER_URL + '/api/coach/programs', { headers: authHeaders() });
    const data = await res.json();
    if (res.ok && data.success) _programs = data.programs || [];
  } catch { /* keep the last list */ }
  return _programs;
}

function formatExercise(ex) {
  if (typeof ex === 'string') return ex + ' 3x10';
  return ex.name + ' ' + ex.sets + 'x' + ex.reps + (ex.repsMax ? '-' + ex.repsMax : '');
}

// One exercise per line: "Squat 4x6-8" (sets×reps optional, defaults 3x10).
function parseDayLines(text) {
  return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const m = line.match(/^(.*?)\s+(\d{1,2})\s*[x×]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/i);
    if (!m) return { name: line.slice(0, 80), sets: 3, reps: 10 };
    const ex = { name: m[1].trim().slice(0, 80), sets: Number(m[2]), reps: Number(m[3]) };
    if (m[4] && Number(m[4]) > ex.reps) ex.repsMax = Number(m[4]);
    return ex;
  });
}

function renderProgram(c) {
  const el = document.getElementById('dtab_program');
  if (c.status === 'pending') {
    el.innerHTML = '<div class="d-card"><p class="ws-empty-note">You can assign a program once they accept.</p></div>';
    return;
  }
  const current = _programs.find(p => p.id === c.currentProgramId);
  const options = '<option value="">— Choose a program —</option>' + _programs.map(p =>
    '<option value="' + escapeHtml(p.id) + '"' + (p.id === c.currentProgramId ? ' selected' : '') + '>' + escapeHtml(p.name) + ' (' + (p.exerciseCount || 0) + ' exercises)</option>'
  ).join('');

  const preview = current
    ? WEEKDAYS.filter(d => (current.days?.[d] || []).length).map(d =>
        '<div class="checkin-score-row"><span class="checkin-score-label">' + d + '</span><span class="checkin-score-val" style="text-align:left;flex:1;">'
        + escapeHtml((current.days[d] || []).map(formatExercise).join(' · ')) + '</span></div>').join('')
    : '<p class="ws-empty-note">' + (c.currentProgram ? escapeHtml(c.currentProgram) + ' (no longer in your library)' : 'No program assigned.') + '</p>';

  el.innerHTML = '<div class="d-card"><div class="d-card-title">Assign Program</div>'
    + '<select id="coachProgramSelect" class="coach-input">' + options + '</select>'
    + '<div class="detail-breadcrumb-actions" style="margin-top:10px;">'
    + '<button class="bulk-action-btn" onclick="assignProgram()">Assign</button>'
    + (c.currentProgramId ? '<button class="bulk-action-btn" style="background:var(--surface);color:var(--text-sec);" onclick="unassignProgram()">Remove</button>' : '')
    + '<button class="bulk-action-btn" style="background:var(--highlight);" onclick="showProgramBuilder()">+ New program</button>'
    + '</div>'
    + '<div id="programBuilderArea" style="margin-top:12px;"></div></div>'
    + '<div class="d-card"><div class="d-card-title">Assigned: ' + escapeHtml(c.currentProgram || 'none') + '</div>' + preview
    + (c.activeProgramName && c.activeProgramName !== c.currentProgram ? '<p class="ws-empty-note">Client is currently following: ' + escapeHtml(c.activeProgramName) + '</p>' : '')
    + '</div>';
}

// Writes real fields on the client's Firestore doc (PATCH /api/coach/clients/:id)
// — mirrored server-side onto the client's own coachAssignment view.
async function patchClient(clientId, fields) {
  try {
    const res = await fetch(SERVER_URL + '/api/coach/clients/' + encodeURIComponent(clientId), {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(fields)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data?.error?.message || 'Could not save — try again.');
      return false;
    }
    return true;
  } catch {
    alert('Connection error — try again.');
    return false;
  }
}

async function assignProgram() {
  const sel = document.getElementById('coachProgramSelect');
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!sel || !client) return;
  if (!sel.value) { alert('Choose a program first.'); return; }
  if (!(await patchClient(client.id, { programId: sel.value }))) return;
  const prog = _programs.find(p => p.id === sel.value);
  client.currentProgramId = sel.value;
  client.currentProgram = prog ? prog.name : client.currentProgram;
  alert('"' + client.currentProgram + '" sent to ' + client.clientName + '. They can start it from Settings → Your Coach.');
  renderProgram(client);
  renderWorkspace();
}

async function unassignProgram() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client || !(await patchClient(client.id, { programId: '' }))) return;
  client.currentProgramId = '';
  client.currentProgram = '';
  renderProgram(client);
}

function showProgramBuilder(program) {
  const area = document.getElementById('programBuilderArea');
  if (!area) return;
  const p = program || { name: '', days: {} };
  area.innerHTML = '<div class="coach-builder">'
    + '<input type="text" id="newProgName" class="coach-input" placeholder="Program name" maxlength="80" value="' + escapeHtml(p.name) + '">'
    + '<p class="ws-empty-note">One exercise per line, e.g. <code>Squat 4x6-8</code>. Leave a day empty for rest.</p>'
    + '<div class="coach-builder-days">'
    + WEEKDAYS.map(d => '<label class="coach-builder-day"><span>' + d + '</span><textarea id="newProgDay_' + d + '" rows="4" class="coach-input">'
      + escapeHtml((p.days?.[d] || []).map(formatExercise).join('\n')) + '</textarea></label>').join('')
    + '</div>'
    + '<button class="bulk-action-btn" onclick="saveCoachProgram()">Save to library</button>'
    + '</div>';
  document.getElementById('newProgName')?.focus();
}

async function saveCoachProgram() {
  const name = document.getElementById('newProgName')?.value?.trim();
  if (!name) { alert('Enter a program name.'); return; }
  const days = {};
  let total = 0;
  WEEKDAYS.forEach(d => { days[d] = parseDayLines(document.getElementById('newProgDay_' + d)?.value); total += days[d].length; });
  if (!total) { alert('Add at least one exercise.'); return; }
  const id = 'prog_' + Date.now().toString(36);
  try {
    const res = await fetch(SERVER_URL + '/api/coach/programs/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ name, days }) });
    const data = await res.json();
    if (!res.ok || !data.success) { alert(data?.error?.message || 'Could not save.'); return; }
  } catch {
    alert('Connection error — try again.');
    return;
  }
  await loadPrograms();
  const client = _clients.find(c => c.id === _selectedClientId);
  if (client) renderProgram(client);
  const sel = document.getElementById('coachProgramSelect');
  if (sel) sel.value = id;
  renderWorkspace();
}

// ── Macro targets ─────────────────────────────────────────────

function renderNutrition(c) {
  const el = document.getElementById('dtab_nutrition');
  if (c.status === 'pending') {
    el.innerHTML = '<div class="d-card"><p class="ws-empty-note">You can send macro targets once they accept.</p></div>';
    return;
  }
  const m = c.macroTargets || {};
  el.innerHTML = '<div class="d-card"><div class="d-card-title">Macro targets</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'
    + macroField('Calories', 'macroCalories', m.calories)
    + macroField('Protein (g)', 'macroProtein', m.protein)
    + macroField('Carbs (g)', 'macroCarbs', m.carbs)
    + macroField('Fat (g)', 'macroFat', m.fat)
    + '</div>'
    + '<textarea id="macroNotes" class="coach-input" placeholder="Short note shown with the targets (optional), e.g. training days +50g carbs">' + escapeHtml(noteFromSummary(c.currentNutritionSummary)) + '</textarea>'
    + '<button class="bulk-action-btn" style="margin-top:10px;" onclick="saveClientMacros()">Send targets</button>'
    + '<p class="ws-empty-note">' + escapeHtml(c.clientName) + ' reviews and applies them from Settings → Your Coach.</p>'
    + '</div>'
    + '<div class="d-card"><div class="d-card-title">Current</div>'
    + '<p style="color:var(--text-sec);">' + escapeHtml(c.currentNutritionSummary || 'No nutrition plan set.') + '</p></div>';
}

function macroField(label, id, value) {
  return '<label style="display:flex;flex-direction:column;gap:3px;font-size:0.72rem;color:var(--text-muted);font-weight:600;">'
    + label + '<input type="number" min="0" id="' + id + '" value="' + (value ?? '') + '" class="coach-input" style="margin:0;">'
    + '</label>';
}

// The summary is "2400 kcal · 180P / 250C / 70F" plus an optional " — note".
function noteFromSummary(summary) {
  const i = String(summary || '').indexOf(' — ');
  return i >= 0 ? summary.slice(i + 3) : '';
}

async function saveClientMacros() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  const read = id => Number(document.getElementById(id)?.value);
  const targets = { calories: read('macroCalories'), protein: read('macroProtein'), carbs: read('macroCarbs'), fat: read('macroFat') };
  if (!Object.values(targets).every(v => Number.isFinite(v) && v > 0)) { alert('Fill in calories, protein, carbs and fat.'); return; }
  const note = document.getElementById('macroNotes')?.value?.trim() || '';
  const summary = targets.calories + ' kcal · ' + targets.protein + 'P / ' + targets.carbs + 'C / ' + targets.fat + 'F' + (note ? ' — ' + note : '');
  if (!(await patchClient(client.id, { macroTargets: targets, nutritionSummary: summary }))) return;
  client.macroTargets = targets;
  client.currentNutritionSummary = summary;
  alert('Targets sent to ' + client.clientName + '.');
  renderNutrition(client);
  renderOverview(client);
}

// ══════════════════════════════════════════════════════════════
// COACH-5: Notes to Client
// ══════════════════════════════════════════════════════════════

// Notes now actually reach the client: POST/GET /api/coach/clients/:id/notes
// (server mirrors each note onto the client's own users/{uid}/coachNotes so
// their app can read it — see traininglog-backend-sync). This used to be
// pure localStorage on the coach's own browser with UI copy claiming
// otherwise; that's gone.
let _clientNotesCache = {}; // clientId -> notes[] | null (null = load error)

function renderNotes(c) {
  const el = document.getElementById('dtab_notes');
  el.innerHTML = '<div class="d-card"><div class="d-card-title">Send Note to ' + (c.clientName?.split(' ')[0] || 'Client') + '</div>'
    + '<textarea id="coachNoteInput" style="width:100%;min-height:100px;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-family:inherit;font-size:0.88rem;resize:vertical;margin-bottom:10px;" placeholder="Write a note — the athlete will see this in their app…"></textarea>'
    + '<div style="display:flex;gap:8px;align-items:center;">'
    + '<button class="bulk-action-btn" onclick="saveNote()">💬 Send Note</button>'
    + '<button class="bulk-action-btn" style="background:var(--highlight);" onclick="aiDraftIntoNotes()">✍️ AI Draft</button>'
    + '<span class="checkin-photo-label" style="margin-left:auto;">&#8984;&crarr; to send</span>'
    + '</div></div>'
    + '<div class="d-card"><div class="d-card-title">Note History</div><div id="noteHistoryBody">'
    + '<p style="color:var(--text-muted);font-size:0.85rem;">Loading…</p></div></div>';
  document.getElementById('coachNoteInput')?.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveNote(); }
  });
  loadClientNotes(c.id);
}

async function loadClientNotes(clientId) {
  try {
    const res = await fetch(SERVER_URL + '/api/coach/clients/' + encodeURIComponent(clientId) + '/notes', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data?.error?.message || 'Request failed');
    _clientNotesCache[clientId] = Array.isArray(data.notes) ? data.notes : [];
  } catch {
    _clientNotesCache[clientId] = null;
  }
  if (_selectedClientId === clientId) renderNoteHistory(clientId);
}

function renderNoteHistory(clientId) {
  const el = document.getElementById('noteHistoryBody');
  if (!el) return;
  const notes = _clientNotesCache[clientId];
  if (notes === null) {
    el.innerHTML = '<p style="color:var(--danger);font-size:0.85rem;">Couldn\'t load note history — check your connection.</p>';
    return;
  }
  el.innerHTML = notes.length ? notes.map(n => {
    const ms = n.createdAt?._seconds ? n.createdAt._seconds * 1000 : n.createdAt;
    const d = ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    return '<div style="padding:10px 0;border-bottom:1px solid rgba(132,157,144,0.1);">'
      + '<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;">' + escapeHtml(d) + '</div>'
      + '<div style="font-size:0.85rem;color:var(--text-sec);line-height:1.5;">' + escapeHtml(n.text) + '</div></div>';
  }).join('') : '<p style="color:var(--text-muted);font-size:0.85rem;">No notes yet.</p>';
}

async function saveNote() {
  const textarea = document.getElementById('coachNoteInput');
  const text = textarea?.value?.trim();
  if (!text) { alert('Write a note first.'); return; }
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;

  try {
    const res = await fetch(SERVER_URL + '/api/coach/clients/' + encodeURIComponent(client.id) + '/notes', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data?.error?.message || 'Could not send note — try again.');
      return;
    }
    if (textarea) textarea.value = '';
    alert('Note sent to ' + client.clientName);
    loadClientNotes(client.id);
  } catch {
    alert('Connection error — try again.');
  }
}

// ══════════════════════════════════════════════════════════════
// COACH-6: Client Invite Flow
// ══════════════════════════════════════════════════════════════
// Used to generate a fake local "PC-XXXX-XXXX" code (localStorage only,
// under coachInvites_{username}) that told the athlete to enter it under
// a "Settings → Connect to Coach" screen that never existed anywhere in
// the app — nothing was ever real here. Replaced with the same real
// invite endpoint convertLead() already uses: the coach enters the
// client's existing Pocket Coach username, a real invite is sent, and it
// shows up for the client to accept in their own app's Settings → Your
// Coach (this is now the desktop-side entry point for what used to also
// be available, just as fake, from the mobile app's Add Client button).

function showInviteModal() {
  let overlay = document.getElementById('inviteOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'inviteOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:24px;';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = '<div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:420px;width:100%;">'
    + '<h3 style="margin:0 0 16px;color:var(--text);">Invite a Client</h3>'
    + '<p style="font-size:0.85rem;color:var(--text-sec);margin-bottom:16px;">They must already have a Pocket Coach account. This sends a real invite — they\'ll see it under Settings → Your Coach in their own app.</p>'
    + '<input type="text" id="inviteClientUsername" placeholder="Their Pocket Coach username" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.95rem;margin-bottom:16px;">'
    + '<div id="inviteModalError" style="color:var(--danger);font-size:0.82rem;margin-bottom:10px;min-height:1.1em;"></div>'
    + '<button id="inviteModalSendBtn" onclick="sendCoachInvite()" style="width:100%;padding:12px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-weight:700;cursor:pointer;margin-bottom:8px;">Send Invite</button>'
    + '<button onclick="document.getElementById(\'inviteOverlay\').remove()" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;">Cancel</button>'
    + '</div>';
  document.getElementById('inviteClientUsername')?.focus();
}

async function sendCoachInvite() {
  const input = document.getElementById('inviteClientUsername');
  const errorEl = document.getElementById('inviteModalError');
  const btn = document.getElementById('inviteModalSendBtn');
  const username = input?.value?.trim();
  if (!username) { if (errorEl) errorEl.textContent = 'Enter a username.'; return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (errorEl) errorEl.textContent = '';

  try {
    const res = await fetch(SERVER_URL + '/api/coach/clients/invite', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ clientUsername: username })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      if (errorEl) errorEl.textContent = data?.error?.message || 'Could not send invite.';
      if (btn) { btn.disabled = false; btn.textContent = 'Send Invite'; }
      return;
    }
    document.getElementById('inviteOverlay')?.remove();
    alert('Invite sent to ' + username + ' — they\'ll appear in your roster once they accept.');
    loadClients();
  } catch {
    if (errorEl) errorEl.textContent = 'Connection error — try again.';
    if (btn) { btn.disabled = false; btn.textContent = 'Send Invite'; }
  }
}


// ══════════════════════════════════════════════════════════════
// COACH-7: AI Coach Assistant
// ══════════════════════════════════════════════════════════════

// Only real, shared data goes to the AI. Anything the client hasn't shared
// is left out rather than filled with a plausible-looking default.
function aiClientContext(client) {
  const d = _clientDetails[client.id] || {};
  const checkIns = d.checkIns || [];
  const ci = checkIns[0] || client.latestCheckInData || null;
  const bw = d.bodyweight || [];
  return { d, checkIns, ci, bw };
}

function aiBox(title, body, color) {
  return '<div style="background:var(--surface);border-left:3px solid ' + color + ';border-radius:0 10px 10px 0;padding:12px;margin-top:8px;">'
    + '<div style="font-size:0.72rem;font-weight:700;color:' + color + ';text-transform:uppercase;margin-bottom:6px;">' + title + '</div>'
    + '<div style="font-size:0.85rem;color:var(--text-sec);line-height:1.5;white-space:pre-wrap;">' + escapeHtml(body) + '</div></div>';
}

async function aiAnalyse() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  const { checkIns, ci, bw } = aiClientContext(client);
  const box = document.getElementById('aiResultBox');
  if (!ci || ci.sleep == null || ci.energy == null || ci.stress == null) {
    if (box) box.innerHTML = '<p class="ws-empty-note">Needs a shared check-in with sleep, energy and stress scores.</p>';
    return;
  }
  const thisWeek = ci.bodyweight ?? client.currentBodyweight;
  if (thisWeek == null || client.compliancePercent == null) {
    if (box) box.innerHTML = '<p class="ws-empty-note">Needs shared bodyweight and compliance (the client has one of these switched off or not logged yet).</p>';
    return;
  }
  const lastWeekEntry = bw.length >= 2 ? bw[bw.length - 2] : null;
  if (box) box.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">🧠 Analysing check-in…</p>';

  try {
    const res = await fetch(SERVER_URL + '/api/ai/checkin-summary', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        sleep: ci.sleep, energy: ci.energy, stress: ci.stress,
        hunger: ci.hunger, trainingPerformance: ci.trainingPerformance,
        bodyweightThisWeek: thisWeek,
        bodyweightLastWeek: lastWeekEntry ? lastWeekEntry.weight : (checkIns[1]?.bodyweight ?? null),
        compliancePercent: client.compliancePercent,
        goal: client.currentProgram || 'current phase',
        archetype: client.trainingMode || 'general',
        adjustmentNotes: ci.notes || ''
      })
    });
    const data = await res.json();
    if (box) box.innerHTML = res.ok ? aiBox('AI Analysis', data.summary || 'No analysis available.', 'var(--primary)')
      : '<p style="color:var(--danger);font-size:0.82rem;">' + escapeHtml(data.error || 'Analysis failed.') + '</p>';
  } catch {
    if (box) box.innerHTML = '<p style="color:var(--danger);font-size:0.82rem;">Failed to analyse — check connection.</p>';
  }
}

function draftPayload(client) {
  const { ci } = aiClientContext(client);
  return {
    clientName: client.clientName,
    archetype: client.trainingMode || 'general',
    currentPhase: client.currentProgram || client.activeProgramName || '',
    compliancePercent: client.compliancePercent,
    checkIn: ci,
    bodyweightChange: client.weeklyWeightChangePercent,
    alerts: (client.alerts || []).map(a => ({ label: a.label, reason: a.reason })),
    currentProgramSummary: client.currentProgram || '',
    currentNutritionSummary: client.currentNutritionSummary || ''
  };
}

let _lastDraft = '';

async function aiDraft() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  const box = document.getElementById('aiResultBox');
  if (box) box.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">✍️ Drafting message…</p>';
  try {
    const res = await fetch(SERVER_URL + '/api/ai/coach-draft-message', { method: 'POST', headers: authHeaders(), body: JSON.stringify(draftPayload(client)) });
    const data = await res.json();
    _lastDraft = data.draft || '';
    if (box) box.innerHTML = aiBox('AI Draft Message', _lastDraft || 'No draft available.', 'var(--highlight)')
      + (_lastDraft ? '<button class="bulk-action-btn" style="margin-top:10px;" onclick="useAiDraft()">Use in Notes</button>' : '');
  } catch {
    if (box) box.innerHTML = '<p style="color:var(--danger);font-size:0.82rem;">Failed to draft — check connection.</p>';
  }
}

function aiDraftIntoNotes() {
  const client = _clients.find(c => c.id === _selectedClientId);
  if (!client) return;
  const textarea = document.getElementById('coachNoteInput');
  if (textarea) textarea.value = 'Generating AI draft…';
  fetch(SERVER_URL + '/api/ai/coach-draft-message', { method: 'POST', headers: authHeaders(), body: JSON.stringify(draftPayload(client)) })
    .then(r => r.json())
    .then(data => { if (textarea) textarea.value = data.draft || 'Could not generate draft.'; })
    .catch(() => { if (textarea) textarea.value = 'Failed to generate — check connection.'; });
}

function useAiDraft() {
  if (!_lastDraft) return;
  switchDetailTab('notes');
  const textarea = document.getElementById('coachNoteInput');
  if (textarea) { textarea.value = _lastDraft; textarea.focus(); }
}

// ══════════════════════════════════════════════════════════════
// COACH-8: Leads (Client Intake)
// ══════════════════════════════════════════════════════════════
// A "lead" is a pre-signup intake submission (POST /api/intake, no auth
// required on that side) — the person hasn't necessarily created a Pocket
// Coach account yet, so they can't appear in the real client roster above.
// This mirrors ClientIntake's calculation-review screen, ported into this
// dashboard's existing d-card/d-stat visual language instead of its own.

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(n, decimals = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

async function loadLeads() {
  try {
    const res = await fetch(SERVER_URL + '/api/coach/leads', { headers: authHeaders() });
    const data = await res.json();
    _leads = (data.success && Array.isArray(data.leads)) ? data.leads : [];
  } catch {
    _leads = [];
  }
  updateLeadsBadge();
  if (_sidebarMode === 'leads') renderLeadList();
}

function updateLeadsBadge() {
  const badge = document.getElementById('leadsBadge');
  if (!badge) return;
  badge.hidden = _leads.length === 0;
  badge.textContent = String(_leads.length);
}

function switchSidebarMode(mode) {
  _sidebarMode = mode;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.getElementById('statusFilters').style.display = mode === 'clients' ? '' : 'none';
  const inviteBtn = document.getElementById('sidebarInviteBtn');
  if (inviteBtn) inviteBtn.style.display = mode === 'clients' ? '' : 'none';

  if (mode === 'clients') renderClientList(); else renderLeadList();

  // Reset the main panel to the empty state — whatever was selected in the
  // other list doesn't make sense to keep showing here.
  _selectedClientId = null;
  _selectedLeadId = null;
  document.getElementById('emptyState').style.display = '';
  document.getElementById('clientDetail').style.display = 'none';
  document.getElementById('leadDetail').style.display = 'none';
}

function renderLeadList() {
  const listEl = document.getElementById('clientList');
  let filtered = _leads.slice();
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    filtered = filtered.filter(l => (l.naam || '').toLowerCase().includes(q));
  }

  if (!filtered.length) {
    listEl.innerHTML = '<div class="client-list-loading">No leads yet.</div>';
    return;
  }

  listEl.innerHTML = filtered.map(l => {
    const initials = (l.naam || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const isActive = l.id === _selectedLeadId;
    const createdMs = l.createdAt?._seconds ? l.createdAt._seconds * 1000 : l.createdAt;
    const created = createdMs ? new Date(createdMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

    return '<div class="client-row' + (isActive ? ' active' : '') + '" onclick="selectLead(\'' + l.id + '\')">'
      + '<div class="client-avatar">' + escapeHtml(initials) + '</div>'
      + '<div class="client-info"><div class="client-name">' + escapeHtml(l.naam || 'Unnamed') + '</div>'
      + '<div class="client-meta">' + escapeHtml(created) + ' · ' + escapeHtml(l.status || 'new') + '</div></div>'
      + '</div>';
  }).join('');
}

function selectLead(id) {
  _selectedLeadId = id;
  renderLeadList();
  const lead = _leads.find(l => l.id === id);
  if (!lead) return;

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('clientDetail').style.display = 'none';
  document.getElementById('leadDetail').style.display = '';

  renderLeadDetail(lead);
}

function kerncijfer(label, value, unit, sub) {
  return '<div class="d-stat"><div class="d-stat-val">' + value + (unit ? ' <span style="font-size:0.6em;">' + escapeHtml(unit) + '</span>' : '') + '</div>'
    + '<div class="d-stat-lbl">' + escapeHtml(label) + '</div>'
    + (sub ? '<div class="d-stat-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>';
}

function mealTable(meals) {
  const rows = (meals || []).map(m => '<tr' + (m.postTraining ? ' class="post-training"' : '') + '>'
    + '<td>Meal ' + m.maaltijd + (m.postTraining ? ' (post-training)' : '') + '</td>'
    + '<td>' + fmt(m.eiwit, 1) + ' g</td><td>' + fmt(m.vet, 1) + ' g</td><td>' + fmt(m.koolhydraten, 1) + ' g</td><td>' + fmt(m.kcal) + ' kcal</td></tr>').join('');
  return '<table class="lead-table"><thead><tr><th>Meal</th><th>Protein</th><th>Fat</th><th>Carbs</th><th>Kcal</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="5" style="color:var(--text-muted);">No data.</td></tr>') + '</tbody></table>';
}

function renderLeadDetail(lead) {
  const i = lead.intake || {};
  const c = lead.calculations || {};
  const p = i.persoonsgegevens || {};

  const initials = (lead.naam || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const statusBadge = lead.status === 'converted' ? '<span class="detail-status ok">CONVERTED</span>'
    : lead.status === 'dismissed' ? '<span class="detail-status action">DISMISSED</span>'
    : '<span class="detail-status new">LEAD</span>';

  document.getElementById('leadDetailHeader').innerHTML =
    '<div class="detail-avatar">' + escapeHtml(initials) + '</div>'
    + '<div class="detail-info"><div class="detail-name">' + escapeHtml(lead.naam || 'Unnamed') + '</div>'
    + '<div class="detail-meta">' + (p.leeftijd ?? '—') + ' yrs · ' + (p.gewicht ?? '—') + ' kg · ' + (p.vetpercentage ?? '—') + '% body fat · Goal: '
    + escapeHtml(i.doel?.categorie || '—') + (p.email ? ' · ' + escapeHtml(p.email) : '') + '</div></div>'
    + statusBadge;

  const flags = (c.rodeVlaggen || []).length
    ? c.rodeVlaggen.map(v => '<div class="lead-flag lead-flag--' + escapeHtml(v.niveau) + '">' + escapeHtml(v.bericht) + '</div>').join('')
    : '<p style="color:var(--text-muted);font-size:0.85rem;">No flags detected.</p>';

  const motivatie = i.motivatieMindset?.motivatie;
  const mentaleInstelling = i.motivatieMindset?.mentaleInstelling;

  const blessureBlokken = [];
  if (i.blessures?.tekst) blessureBlokken.push('<p><strong>Reported:</strong> ' + escapeHtml(i.blessures.tekst) + '</p>');
  for (const oef of (i.blessures?.vermijdenOefeningen || [])) blessureBlokken.push('<p><strong>Avoid:</strong> ' + escapeHtml(oef) + '</p>');
  for (const conflict of (c.advies?.blessureConflicten || [])) blessureBlokken.push('<p><strong>' + escapeHtml(conflict.oefening) + ':</strong> ' + escapeHtml(conflict.reden) + '</p>');

  const rmRows = (c.rm || []).map(r => '<tr><td>' + escapeHtml(r.oefening) + '</td><td>' + fmt(r.kg, 1) + ' kg</td><td>' + r.herhalingen + '</td><td>' + r.sets + '</td><td>' + fmt(r.geschat1RM, 1) + ' kg</td></tr>').join('');

  const convertCard = lead.status === 'converted'
    ? '<div class="d-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">'
      + '<div style="font-size:0.85rem;color:var(--text-sec);">This lead has been linked to a Pocket Coach account and now appears in your Clients list.</div></div>'
    : lead.status === 'dismissed'
    ? '<div class="d-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
      + '<div style="font-size:0.85rem;color:var(--text-sec);">Dismissed — hidden from your active queue, but kept here for reference.</div>'
      + '<button class="sidebar-invite-btn sidebar-invite-btn--ghost" onclick="dismissLead(\'' + lead.id + '\', false)">Restore</button></div>'
    : '<div class="d-card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">'
      + '<div style="font-size:0.85rem;color:var(--text-sec);">Once they\'ve created a Pocket Coach account, link them here as a real client.</div>'
      + '<div style="display:flex;gap:8px;">'
      + '<button class="sidebar-invite-btn sidebar-invite-btn--ghost" onclick="dismissLead(\'' + lead.id + '\', true)">Dismiss</button>'
      + '<button class="sidebar-invite-btn" onclick="convertLead(\'' + lead.id + '\')">Convert to Client</button>'
      + '</div></div>';

  document.getElementById('leadDetailBody').innerHTML =
    convertCard
    + '<div class="d-card"><div class="d-card-title">Key Numbers</div><div class="d-stat-grid">'
    + kerncijfer('BMR', fmt(c.bmr), 'kcal')
    + kerncijfer('Maintenance/day', fmt(c.onderhoudPerDag), 'kcal')
    + kerncijfer('Target — rest day', fmt(c.beoogdeInnameRustdag), 'kcal', c.bereiken ? 'range ' + fmt(c.bereiken.beoogdeInname.min) + '–' + fmt(c.bereiken.beoogdeInname.max) + ' kcal' : '')
    + kerncijfer('Target — training day', fmt(c.beoogdeInnameTrainingsdag), 'kcal')
    + kerncijfer('Protein', fmt(c.macros?.eiwit, 1), 'g', c.bereiken ? 'range ' + fmt(c.bereiken.eiwit.min) + '–' + fmt(c.bereiken.eiwit.maxSlank) + ' g' : '')
    + kerncijfer('Fat', fmt(c.macros?.vet, 1), 'g', c.bereiken ? 'range ' + fmt(c.bereiken.vet.min) + '–' + fmt(c.bereiken.vet.max) + ' g' : '')
    + kerncijfer('Carbs — rest day', fmt(c.macros?.koolhydratenRustdag, 1), 'g')
    + kerncijfer('Carbs — training day', fmt(c.macros?.koolhydratenTrainingsdag, 1), 'g')
    + '</div></div>'

    + '<div class="d-card"><div class="d-card-title">Flags</div>' + flags + '</div>'

    + ((motivatie || mentaleInstelling) ? '<div class="d-card"><div class="d-card-title">Motivation &amp; Mindset</div>'
      + (motivatie ? '<p><strong>Motivation:</strong> ' + escapeHtml(motivatie) + '</p>' : '')
      + (mentaleInstelling ? '<p><strong>Mentality:</strong> ' + escapeHtml(mentaleInstelling) + '</p>' : '')
      + '</div>' : '')

    + (c.advies?.splitsdagen ? '<div class="d-card"><div class="d-card-title">Training Advice</div>'
      + '<p><strong>Suggested split (' + (c.instellingenGebruikt?.trainingsdagenPerWeek ?? '—') + 'x/week):</strong> ' + escapeHtml(c.advies.splitsdagen.naam) + '</p>'
      + '<p>' + c.advies.splitsdagen.dagen.map(escapeHtml).join(' → ') + '</p></div>' : '')

    + '<div class="d-card"><div class="d-card-title">Nutrition — Rest Day vs. Training Day</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">'
    + '<div><p style="font-weight:600;margin-bottom:6px;">Rest day</p>' + mealTable(c.maaltijdVerdeling?.rustdag) + '</div>'
    + '<div><p style="font-weight:600;margin-bottom:6px;">Training day</p>' + mealTable(c.maaltijdVerdeling?.trainingsdag) + '</div>'
    + '</div></div>'

    + '<div class="d-card"><div class="d-card-title">Injuries &amp; Notes</div>'
    + (blessureBlokken.join('') || '<p style="color:var(--text-muted);font-size:0.85rem;">No injuries reported.</p>') + '</div>'

    + '<div class="d-card"><div class="d-card-title">Strength (' + fmt(c.frameSize?.enkelomtrek, 1) + ' cm ankle — '
    + (c.frameSize?.binnenNorm ? 'within norm' : 'outside norm') + ')</div>'
    + '<table class="lead-table"><thead><tr><th>Exercise</th><th>Kg</th><th>Reps</th><th>Sets</th><th>Est. 1RM</th></tr></thead>'
    + '<tbody>' + (rmRows || '<tr><td colspan="5" style="color:var(--text-muted);">No strength data.</td></tr>') + '</tbody></table></div>';
}

// Converts a lead into a real roster client by calling the actual
// coach-client invite endpoint (POST /api/coach/clients/invite) — this is
// the real, server-verified relationship, not the local invite-code demo
// above (COACH-6). Requires the prospect to already have a Pocket Coach
// account; the coach asks them for their username directly (e.g. via the
// email/WhatsApp thread the intake generated).
async function convertLead(leadId) {
  const lead = _leads.find(l => l.id === leadId);
  if (!lead) return;

  const username = prompt("Enter the client's Pocket Coach username (they must already have an account):");
  if (!username?.trim()) return;

  try {
    const res = await fetch(SERVER_URL + '/api/coach/clients/invite', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ clientUsername: username.trim() })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data?.error?.message || 'Could not send invite.');
      return;
    }

    await fetch(SERVER_URL + '/api/coach/leads/' + encodeURIComponent(leadId), {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'converted' })
    }).catch(() => {});

    lead.status = 'converted';
    alert('Invite sent to ' + username.trim() + '. They\'ll appear in your Clients list once they accept it.');
    loadClients();
    renderLeadList();
    renderLeadDetail(lead);
  } catch {
    alert('Connection error — try again.');
  }
}

// Dismiss (or restore) a lead — for spam/test/not-interested submissions
// that don't warrant converting to a client but shouldn't clutter the
// active queue either. Soft state only (PATCH status), same as convertLead
// above: the underlying Firestore document is never deleted, so nothing
// here is a one-way action — a dismissed lead can always be restored.
async function dismissLead(leadId, dismiss) {
  const lead = _leads.find(l => l.id === leadId);
  if (!lead) return;

  try {
    const res = await fetch(SERVER_URL + '/api/coach/leads/' + encodeURIComponent(leadId), {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: dismiss ? 'dismissed' : 'new' })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data?.error?.message || 'Could not update this lead.');
      return;
    }

    lead.status = dismiss ? 'dismissed' : 'new';
    renderLeadList();
    renderLeadDetail(lead);
  } catch {
    alert('Connection error — try again.');
  }
}

// ── Boot ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', checkAuth);
document.getElementById('loginPassword')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') doCoachLogin();
});
