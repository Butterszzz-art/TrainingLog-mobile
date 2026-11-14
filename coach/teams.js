/* Coach dashboard: Training Groups and Automations.
 *
 * A group is a named set of your clients (/api/coach/groups). From a group
 * you can message everyone, give them all one program, or ask them all for
 * a check-in. Each of those is the same per-client action the client page
 * does, run once per member. Clients don't see groups.
 *
 * Automations are rules the server runs for you (/api/coach/automations):
 * a check-in reminder for clients who are past their frequency, and a
 * welcome message for new clients.
 *
 * Uses coach.js globals: coachJson, escapeHtml, activeClients, initialsOf,
 * checkInRequestOpen, programLabel, renderWorkspace, _clients, _programs. */

const teamError = err => (err && err.message === 'Failed to fetch' ? 'Connection error. Try again.' : (err && err.message) || 'Something went wrong. Try again.');

// ── Training Groups ──────────────────────────────────────────────────────
let _groups = null;
let _groupEdit = null; // { id (null = new), name, clientUids: Set, message }

async function renderGroupsPage() {
  const el = document.getElementById('grpList');
  if (!el) return;
  if (!_groups) {
    try { _groups = (await coachJson('/api/coach/groups')).groups || []; } catch (err) { el.innerHTML = '<div class="client-list-loading">' + escapeHtml(teamError(err)) + '</div>'; return; }
  }
  const count = document.getElementById('railCountGroups');
  if (count) count.textContent = _groups.length;
  el.innerHTML = _groups.length ? _groups.map(g => {
    const n = g.clientUids.filter(uid => _clients.some(c => c.id === uid)).length;
    return '<div role="button" tabindex="0" class="client-row' + (_groupEdit && _groupEdit.id === g.id ? ' active' : '') + '" onclick="openGroup(\'' + escapeHtml(g.id) + '\')">'
      + '<div class="client-avatar">' + escapeHtml(initialsOf(g.name)) + '</div>'
      + '<div class="client-info"><div class="client-name">' + escapeHtml(g.name) + '</div>'
      + '<div class="msg-preview">' + n + ' client' + (n === 1 ? '' : 's') + '</div></div></div>';
  }).join('') : '<div class="client-list-loading">No groups yet. Make one to message or program several clients at once.</div>';
  if (_groupEdit) renderGroupEditor();
}

function openGroup(id) {
  const g = (_groups || []).find(x => x.id === id);
  _groupEdit = { id: g ? g.id : null, name: g ? g.name : '', clientUids: new Set(g ? g.clientUids : []), message: '' };
  renderGroupsPage();
  renderGroupEditor();
  if (!g) document.getElementById('grpName')?.focus();
}

function groupMembers() {
  return activeClients().filter(c => _groupEdit.clientUids.has(c.id));
}

function renderGroupEditor() {
  const el = document.getElementById('grpEditor');
  const e = _groupEdit;
  if (!el || !e) return;
  const clients = _clients.slice().sort((a, b) => String(a.clientName || '').localeCompare(String(b.clientName || '')));
  const saved = !!e.id;
  const members = groupMembers();
  const programOptions = '<option value="">Choose a program…</option>' + _programs.map(p => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(programLabel(p)) + '</option>').join('');
  el.innerHTML = '<div class="pod-row"><span class="ws-list-name">' + (saved ? 'Group' : 'New group') + '</span>'
    + (saved ? '<button class="bulk-action-btn bulk-action-btn--ghost" data-grp="delete">Delete group</button>' : '') + '</div>'
    + '<input id="grpName" class="coach-input" value="' + escapeHtml(e.name) + '" maxlength="60" placeholder="Group name, e.g. Prep team" aria-label="Group name">'
    + '<div class="ci-settings-label">Members</div>'
    + (clients.length ? '<div class="ws-check-grid" id="grpMembers">' + clients.map(c =>
      '<label><input type="checkbox" value="' + escapeHtml(c.id) + '"' + (e.clientUids.has(c.id) ? ' checked' : '') + '> ' + escapeHtml(c.clientName || 'Unknown') + (c.status === 'pending' ? ' <small>(invite pending)</small>' : '') + '</label>').join('') + '</div>'
      : '<p class="ws-empty-note">You have no clients yet.</p>')
    + '<div class="ci-compose-row"><span class="ci-compose-status" id="grpStatus">' + escapeHtml(e.message) + '</span>'
    + '<button class="bulk-action-btn" data-grp="save">' + (saved ? 'Save group' : 'Create group') + '</button></div>'
    + (saved ? '<div class="grp-actions">'
      + '<div class="ci-settings-label">Message everyone (' + members.length + ' active)</div>'
      + '<textarea id="grpMessage" class="coach-input" rows="2" maxlength="4000" placeholder="Each client gets this as a message from you."></textarea>'
      + '<button class="bulk-action-btn" data-grp="message"' + (members.length ? '' : ' disabled') + '>Send to group</button>'
      + '<div class="ci-settings-label">Give everyone a program</div>'
      + '<div class="grp-inline"><select id="grpProgram" class="coach-input">' + programOptions + '</select>'
      + '<button class="bulk-action-btn" data-grp="program"' + (members.length && _programs.length ? '' : ' disabled') + '>Assign to group</button></div>'
      + '<div class="ci-settings-label">Check-ins</div>'
      + '<button class="bulk-action-btn bulk-action-btn--ghost" data-grp="checkin"' + (members.length ? '' : ' disabled') + '>Request a check-in from everyone</button>'
      + '<p class="ws-empty-note">These run once per client, the same as doing it on each client\'s page. Clients with a pending invite are skipped.</p></div>' : '');
}

// Runs one request per member; → how many worked.
async function groupEach(members, request) {
  const results = await Promise.all(members.map(c => request(c).then(() => true).catch(() => false)));
  return results.filter(Boolean).length;
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('grpEditor');
  if (!el) return;
  el.addEventListener('input', ev => { if (_groupEdit && ev.target.id === 'grpName') _groupEdit.name = ev.target.value; });
  el.addEventListener('change', ev => {
    const t = ev.target;
    if (!_groupEdit || !t.closest('#grpMembers')) return;
    if (t.checked) _groupEdit.clientUids.add(t.value); else _groupEdit.clientUids.delete(t.value);
  });
  el.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-grp]');
    const e = _groupEdit;
    if (!b || !e || b.disabled) return;
    const act = b.dataset.grp;
    const say = (msg, isError) => { e.message = msg; renderGroupEditor(); document.getElementById('grpStatus').classList.toggle('is-error', !!isError); };
    const members = groupMembers();
    const of = n => n + ' of ' + members.length;
    b.disabled = true;
    try {
      if (act === 'save') {
        if (!e.name.trim()) { say('Give the group a name.', true); return; }
        const id = e.id || 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const data = await coachJson('/api/coach/groups/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ name: e.name.trim(), clientUids: [...e.clientUids] }) });
        _groups = _groups.filter(g => g.id !== data.group.id).concat(data.group).sort((a, b2) => a.name.localeCompare(b2.name));
        e.id = data.group.id;
        e.clientUids = new Set(data.group.clientUids);
        e.message = 'Saved.';
        renderGroupsPage();
      } else if (act === 'delete') {
        if (!confirm('Delete the group "' + e.name + '"? The clients stay on your roster.')) { b.disabled = false; return; }
        await coachJson('/api/coach/groups/' + encodeURIComponent(e.id), { method: 'DELETE' });
        _groups = _groups.filter(g => g.id !== e.id);
        _groupEdit = null;
        document.getElementById('grpEditor').innerHTML = '<p class="ws-empty-note">Group deleted.</p>';
        renderGroupsPage();
      } else if (act === 'message') {
        const text = document.getElementById('grpMessage').value.trim();
        if (!text) { b.disabled = false; document.getElementById('grpMessage').focus(); return; }
        const sent = await groupEach(members, c => coachJson('/api/coach/clients/' + encodeURIComponent(c.id) + '/notes', { method: 'POST', body: JSON.stringify({ text }) }).then(() => {
          Object.assign(c, { lastMessageAt: new Date().toISOString(), lastMessageText: text.replace(/\s+/g, ' ').slice(0, 140), lastMessageAuthor: 'coach' });
        }));
        say(sent === members.length ? 'Sent to ' + sent + ' client' + (sent === 1 ? '' : 's') + '.' : 'Sent to ' + of(sent) + '. Try the others from their own page.', sent !== members.length);
      } else if (act === 'program') {
        const programId = document.getElementById('grpProgram').value;
        const prog = _programs.find(p => p.id === programId);
        if (!prog) { say('Choose a program first.', true); return; }
        if (!confirm('Send "' + prog.name + '" to ' + members.length + ' client' + (members.length === 1 ? '' : 's') + '? It replaces the program you assigned them before.')) { b.disabled = false; return; }
        const done = await groupEach(members, c => coachJson('/api/coach/clients/' + encodeURIComponent(c.id), { method: 'PATCH', body: JSON.stringify({ programId }) }).then(() => {
          c.currentProgramId = programId; c.currentProgram = prog.name;
        }));
        renderWorkspace();
        say(done === members.length ? '"' + prog.name + '" sent to ' + done + ' client' + (done === 1 ? '' : 's') + '.' : 'Sent to ' + of(done) + '. Try the others from their own page.', done !== members.length);
      } else if (act === 'checkin') {
        const todo = members.filter(c => !checkInRequestOpen(c));
        const done = await groupEach(todo, c => coachJson('/api/coach/clients/' + encodeURIComponent(c.id) + '/checkin-request', { method: 'POST' }).then(d => {
          c.checkInRequestedAt = d.checkInRequestedAt || new Date().toISOString();
        }));
        const skipped = members.length - todo.length;
        say('Asked ' + done + ' client' + (done === 1 ? '' : 's') + (skipped ? '; ' + skipped + ' already had an open request' : '') + (done < todo.length ? '; ' + (todo.length - done) + ' failed' : '') + '.', done < todo.length);
      }
    } catch (err) {
      say(teamError(err), true);
    }
  });
});

// ── Automations ──────────────────────────────────────────────────────────
let _automations = null;

async function renderAutomationsPage(message, isError) {
  const el = document.getElementById('wsAutomations');
  if (!el) return;
  if (!_automations) {
    try { _automations = (await coachJson('/api/coach/automations')).automations; } catch (err) { el.innerHTML = '<p class="ws-empty-note">' + escapeHtml(teamError(err)) + '</p>'; return; }
  }
  const a = _automations;
  const graceOptions = [0, 1, 2, 3, 5, 7].concat([0, 1, 2, 3, 5, 7].includes(a.checkInReminder.graceDays) ? [] : [a.checkInReminder.graceDays]).sort((x, y) => x - y);
  el.innerHTML = '<div class="auto-rule">'
    + '<label class="auto-toggle"><input type="checkbox" id="autoReminderOn"' + (a.checkInReminder.enabled ? ' checked' : '') + '> <b>Check-in reminder</b></label>'
    + '<p class="ws-empty-note">When a client is past their check-in frequency, they get the same notification as your Request check-in button. Checked every morning. Each client is reminded once per missed check-in.</p>'
    + '<label class="auto-inline">Remind them <select id="autoGrace" class="coach-input">' + graceOptions.map(d =>
      '<option value="' + d + '"' + (d === a.checkInReminder.graceDays ? ' selected' : '') + '>' + (d === 0 ? 'on the day it is due' : d + ' day' + (d === 1 ? '' : 's') + ' after it is due') + '</option>').join('') + '</select></label>'
    + '</div><div class="auto-rule">'
    + '<label class="auto-toggle"><input type="checkbox" id="autoWelcomeOn"' + (a.welcome.enabled ? ' checked' : '') + '> <b>Welcome message</b></label>'
    + '<p class="ws-empty-note">Sent as a message from you when a client accepts your invite or links with your coach code. Once per client.</p>'
    + '<textarea id="autoWelcomeText" class="coach-input" rows="4" maxlength="1000" placeholder="e.g. Welcome! Start by filling in your first check-in this weekend. Message me here any time.">' + escapeHtml(a.welcome.text) + '</textarea>'
    + '</div><div class="ci-compose-row"><span class="ci-compose-status' + (isError ? ' is-error' : '') + '">' + escapeHtml(message || '') + '</span>'
    + '<button class="bulk-action-btn" onclick="saveAutomations()">Save automations</button></div>';
}

async function saveAutomations() {
  const body = {
    checkInReminder: { enabled: document.getElementById('autoReminderOn').checked, graceDays: Number(document.getElementById('autoGrace').value) },
    welcome: { enabled: document.getElementById('autoWelcomeOn').checked, text: document.getElementById('autoWelcomeText').value.trim() },
  };
  if (body.welcome.enabled && !body.welcome.text) { _automations = { ..._automations, ...body, welcome: { enabled: false, text: '' } }; renderAutomationsPage('Write the welcome message before switching it on.', true); return; }
  try {
    _automations = (await coachJson('/api/coach/automations', { method: 'PUT', body: JSON.stringify(body) })).automations;
    renderAutomationsPage('Saved.');
  } catch (err) {
    _automations = { ..._automations, ...body };
    renderAutomationsPage(teamError(err), true);
  }
}
