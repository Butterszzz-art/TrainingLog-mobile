/* Coach dashboard: planning pages (Roadmaps, Calendar).
 *
 * A roadmap is a client's long-term plan: phases (name, start, end, goal)
 * and dated milestones. It is saved on the client (PATCH
 * /api/coach/clients/:id { roadmap }) and the client sees it in the app
 * under Your Coach.
 *
 * The calendar is one month view of what is coming up: each client's next
 * check-in (from their check-in frequency), roadmap phase changes and
 * milestones, and the coach's own entries such as calls
 * (/api/coach/events, only the coach sees those).
 *
 * Uses coach.js globals: coachJson, patchClient, escapeHtml, activeClients,
 * initialsOf, checkInEvery, openClientTab, _clients. */

const planIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const planDate = iso => new Date(iso + 'T00:00:00');
const planDay = (iso, opts) => planDate(iso).toLocaleDateString(undefined, opts || { day: 'numeric', month: 'short' });
const planError = err => (err && err.message === 'Failed to fetch' ? 'Connection error. Try again.' : (err && err.message) || 'Something went wrong. Try again.');

// ── Roadmaps ─────────────────────────────────────────────────────────────
let _rmEdit = null; // { clientId, phases: [...], milestones: [...], message }

function currentPhase(roadmap, todayIso) {
  return ((roadmap && roadmap.phases) || []).find(p => p.start <= todayIso && todayIso <= p.end) || null;
}

function renderRoadmapList() {
  const el = document.getElementById('rmList');
  if (!el) return;
  const today = planIso(new Date());
  const clients = activeClients().slice().sort((a, b) => String(a.clientName || '').localeCompare(String(b.clientName || '')));
  const withOne = clients.filter(c => c.roadmap).length;
  document.getElementById('rmListNote').textContent = withOne + ' of ' + clients.length + ' set';
  el.innerHTML = clients.length ? clients.map(c => {
    const now = currentPhase(c.roadmap, today);
    const next = !now && c.roadmap ? (c.roadmap.phases || []).find(p => p.start > today) : null;
    const sub = now ? now.name + ' until ' + planDay(now.end) : next ? next.name + ' starts ' + planDay(next.start) : c.roadmap ? 'No phase running' : 'No roadmap yet';
    return '<div role="button" tabindex="0" class="client-row' + (_rmEdit && _rmEdit.clientId === c.id ? ' active' : '') + '" onclick="openRoadmap(\'' + escapeHtml(c.id) + '\')">'
      + '<div class="client-avatar">' + escapeHtml(initialsOf(c.clientName)) + '</div>'
      + '<div class="client-info"><div class="client-name">' + escapeHtml(c.clientName || 'Unknown') + '</div>'
      + '<div class="msg-preview">' + escapeHtml(sub) + '</div></div></div>';
  }).join('') : '<div class="client-list-loading">No active clients yet.</div>';
}

function openRoadmap(clientId) {
  const c = _clients.find(x => x.id === clientId);
  if (!c) return;
  const r = c.roadmap || { phases: [], milestones: [] };
  _rmEdit = { clientId, phases: JSON.parse(JSON.stringify(r.phases || [])), milestones: JSON.parse(JSON.stringify(r.milestones || [])), message: '' };
  renderRoadmapList();
  renderRoadmapEditor();
}

// Phases as proportional blocks, with a marker for today.
function roadmapBar(phases) {
  const valid = phases.filter(p => p.name && p.start && p.end && p.end >= p.start);
  if (!valid.length) return '';
  const start = valid.reduce((m, p) => (p.start < m ? p.start : m), valid[0].start);
  const end = valid.reduce((m, p) => (p.end > m ? p.end : m), valid[0].end);
  const span = Math.max(1, (planDate(end) - planDate(start)) / 86400000 + 1);
  const pos = iso => Math.max(0, Math.min(100, ((planDate(iso) - planDate(start)) / 86400000 / span) * 100));
  const today = planIso(new Date());
  return '<div class="rm-bar" aria-hidden="true">' + valid.map((p, i) => {
    const left = pos(p.start);
    const width = Math.max(2, (((planDate(p.end) - planDate(p.start)) / 86400000 + 1) / span) * 100);
    return '<span class="rm-seg rm-seg--' + (i % 4) + (p.start <= today && today <= p.end ? ' is-now' : '') + '" style="left:' + left + '%;width:' + Math.min(width, 100 - left) + '%;" title="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</span>';
  }).join('') + (today >= start && today <= end ? '<span class="rm-today" style="left:' + pos(today) + '%;"></span>' : '') + '</div>'
    + '<div class="rm-bar-ends"><span>' + escapeHtml(planDay(start, { day: 'numeric', month: 'short', year: 'numeric' })) + '</span><span>' + escapeHtml(planDay(end, { day: 'numeric', month: 'short', year: 'numeric' })) + '</span></div>';
}

function renderRoadmapEditor() {
  const el = document.getElementById('rmEditor');
  const e = _rmEdit;
  const c = e && _clients.find(x => x.id === e.clientId);
  if (!el || !c) return;
  const phaseRows = e.phases.map((p, i) => '<div class="rm-row" data-rm-phase="' + i + '">'
    + '<input class="coach-input" data-rm="name" value="' + escapeHtml(p.name || '') + '" maxlength="60" placeholder="Phase, e.g. Cut" aria-label="Phase name">'
    + '<input class="coach-input" type="date" data-rm="start" value="' + escapeHtml(p.start || '') + '" aria-label="Start date">'
    + '<input class="coach-input" type="date" data-rm="end" value="' + escapeHtml(p.end || '') + '" aria-label="End date">'
    + '<input class="coach-input" data-rm="goal" value="' + escapeHtml(p.goal || '') + '" maxlength="200" placeholder="Goal, e.g. down to 78 kg" aria-label="Goal">'
    + '<button type="button" class="pb-icon" data-rm-act="del-phase" aria-label="Remove phase">✕</button></div>').join('');
  const stoneRows = e.milestones.map((m, i) => '<div class="rm-row rm-row--stone" data-rm-stone="' + i + '">'
    + '<input class="coach-input" type="date" data-rm="date" value="' + escapeHtml(m.date || '') + '" aria-label="Milestone date">'
    + '<input class="coach-input" data-rm="title" value="' + escapeHtml(m.title || '') + '" maxlength="80" placeholder="Milestone, e.g. Photo shoot" aria-label="Milestone">'
    + '<button type="button" class="pb-icon" data-rm-act="del-stone" aria-label="Remove milestone">✕</button></div>').join('');
  el.innerHTML = '<div class="pod-row"><span class="ws-list-name">Roadmap · ' + escapeHtml(c.clientName || 'Client') + '</span>'
    + '<button class="bulk-action-btn bulk-action-btn--ghost" onclick="selectClient(\'' + escapeHtml(c.id) + '\')">Open client</button></div>'
    + '<div id="rmBarSlot">' + roadmapBar(e.phases) + '</div>'
    + '<div class="ci-settings-label">Phases</div>'
    + (phaseRows || '<p class="ws-empty-note">No phases yet. A phase is a block such as "Build", "Cut" or "Peak week" with a start and end date.</p>')
    + '<button type="button" class="pb-link" data-rm-act="add-phase"' + (e.phases.length >= 12 ? ' disabled' : '') + '>+ Add phase</button>'
    + '<div class="ci-settings-label">Milestones</div>'
    + (stoneRows || '<p class="ws-empty-note">No milestones yet. A milestone is a single date such as a show, a photo shoot or a test day.</p>')
    + '<button type="button" class="pb-link" data-rm-act="add-stone"' + (e.milestones.length >= 20 ? ' disabled' : '') + '>+ Add milestone</button>'
    + '<div class="ci-compose-row rm-foot"><span class="ci-compose-status" id="rmStatus">' + escapeHtml(e.message) + '</span>'
    + (c.roadmap ? '<button class="bulk-action-btn bulk-action-btn--ghost" data-rm-act="clear">Remove roadmap</button>' : '')
    + '<button class="bulk-action-btn" data-rm-act="save">Save roadmap</button></div>'
    + '<p class="ws-empty-note">' + escapeHtml(c.clientName || 'Your client') + ' sees this in the app under Your Coach and is notified when you save.</p>';
}

function roadmapProblem(e) {
  for (const p of e.phases) {
    if (!p.name || !p.name.trim()) return 'Give every phase a name.';
    if (!p.start || !p.end) return 'Give "' + p.name + '" a start and an end date.';
    if (p.end < p.start) return '"' + p.name + '" ends before it starts.';
  }
  for (const m of e.milestones) {
    if (!m.title || !m.title.trim() || !m.date) return 'Give every milestone a date and a name.';
  }
  return e.phases.length || e.milestones.length ? '' : 'Add at least one phase or milestone.';
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('rmEditor');
  if (!el) return;
  el.addEventListener('input', ev => {
    const t = ev.target;
    if (!_rmEdit || !t.dataset.rm) return;
    const phase = t.closest('[data-rm-phase]');
    const stone = t.closest('[data-rm-stone]');
    if (phase) _rmEdit.phases[Number(phase.dataset.rmPhase)][t.dataset.rm] = t.value;
    else if (stone) _rmEdit.milestones[Number(stone.dataset.rmStone)][t.dataset.rm] = t.value;
    if (phase && t.dataset.rm !== 'goal') document.getElementById('rmBarSlot').innerHTML = roadmapBar(_rmEdit.phases);
  });
  el.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-rm-act]');
    const e = _rmEdit;
    if (!b || !e || b.disabled) return;
    const act = b.dataset.rmAct;
    const c = _clients.find(x => x.id === e.clientId);
    e.message = '';
    if (act === 'add-phase') {
      // A new phase starts the day after the last one ends.
      const last = e.phases[e.phases.length - 1];
      let start = planIso(new Date());
      if (last && last.end) { const d = planDate(last.end); d.setDate(d.getDate() + 1); start = planIso(d); }
      const end = planDate(start); end.setDate(end.getDate() + 27);
      e.phases.push({ name: '', start, end: planIso(end), goal: '' });
    } else if (act === 'del-phase') e.phases.splice(Number(b.closest('[data-rm-phase]').dataset.rmPhase), 1);
    else if (act === 'add-stone') e.milestones.push({ date: '', title: '' });
    else if (act === 'del-stone') e.milestones.splice(Number(b.closest('[data-rm-stone]').dataset.rmStone), 1);
    else if (act === 'clear') {
      if (!confirm('Remove the roadmap for ' + (c.clientName || 'this client') + '? It disappears from their app.')) return;
      if (!(await patchClient(c.id, { roadmap: null }))) return;
      c.roadmap = null;
      e.phases = []; e.milestones = [];
      e.message = 'Roadmap removed.';
      renderRoadmapList();
    } else if (act === 'save') {
      const problem = roadmapProblem(e);
      if (problem) { e.message = problem; renderRoadmapEditor(); document.getElementById('rmStatus').classList.add('is-error'); return; }
      const roadmap = {
        phases: e.phases.map(p => ({ name: p.name.trim(), start: p.start, end: p.end, goal: (p.goal || '').trim() })).sort((a, b) => a.start.localeCompare(b.start)),
        milestones: e.milestones.map(m => ({ date: m.date, title: m.title.trim() })).sort((a, b) => a.date.localeCompare(b.date)),
      };
      b.disabled = true;
      if (!(await patchClient(c.id, { roadmap }))) { b.disabled = false; return; }
      c.roadmap = roadmap;
      e.phases = JSON.parse(JSON.stringify(roadmap.phases));
      e.milestones = JSON.parse(JSON.stringify(roadmap.milestones));
      e.message = 'Saved. ' + (c.clientName || 'Your client') + ' can see it in the app.';
      renderRoadmapList();
    }
    renderRoadmapEditor();
  });
});

// ── Calendar ─────────────────────────────────────────────────────────────
let _calMonth = null;   // first day of the month on screen
let _calDay = null;     // selected YYYY-MM-DD
let _events = null;     // the coach's own entries

// Everything on the calendar, keyed by date: [{ kind, label, clientId?, event? }].
function calendarItems() {
  const map = {};
  const add = (date, item) => { (map[date] = map[date] || []).push(item); };
  const today = planIso(new Date());
  activeClients().forEach(c => {
    const name = c.clientName || 'Client';
    if (c.lastCheckIn) {
      const due = planDate(String(c.lastCheckIn).slice(0, 10));
      due.setDate(due.getDate() + checkInEvery(c));
      const iso = planIso(due);
      if (iso < today) add(today, { kind: 'overdue', label: 'Check-in overdue · ' + name, clientId: c.id, tab: 'checkin' });
      else add(iso, { kind: 'checkin', label: 'Check-in due · ' + name, clientId: c.id, tab: 'checkin' });
    }
    ((c.roadmap && c.roadmap.phases) || []).forEach(p => {
      add(p.start, { kind: 'phase', label: p.name + ' starts · ' + name, clientId: c.id });
      add(p.end, { kind: 'phase', label: p.name + ' ends · ' + name, clientId: c.id });
    });
    ((c.roadmap && c.roadmap.milestones) || []).forEach(m => add(m.date, { kind: 'milestone', label: m.title + ' · ' + name, clientId: c.id }));
  });
  (_events || []).forEach(ev => {
    const who = ev.clientUid ? (_clients.find(c => c.id === ev.clientUid) || {}).clientName : '';
    add(ev.date, { kind: ev.kind === 'call' ? 'call' : 'event', label: (ev.time ? ev.time + ' ' : '') + ev.title + (who ? ' · ' + who : ''), event: ev, clientId: ev.clientUid || '' });
  });
  return map;
}

async function renderCalendarPage() {
  if (!_calMonth) { const n = new Date(); _calMonth = new Date(n.getFullYear(), n.getMonth(), 1); _calDay = planIso(n); }
  renderCalendar();
  if (!_events) {
    try { _events = (await coachJson('/api/coach/events')).events || []; } catch (err) { _events = []; document.getElementById('calNote').textContent = planError(err); }
    renderCalendar();
  }
}

function calendarGo(step) {
  if (step === 0) { const n = new Date(); _calMonth = new Date(n.getFullYear(), n.getMonth(), 1); _calDay = planIso(n); }
  else _calMonth = new Date(_calMonth.getFullYear(), _calMonth.getMonth() + step, 1);
  renderCalendar();
}

function calendarPick(iso) {
  _calDay = iso;
  renderCalendar();
}

function renderCalendar() {
  const grid = document.getElementById('calGrid');
  if (!grid || !_calMonth) return;
  const items = calendarItems();
  const today = planIso(new Date());
  document.getElementById('calTitle').textContent = _calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  // Monday-first grid covering the whole month.
  const first = new Date(_calMonth);
  first.setDate(1 - ((first.getDay() + 6) % 7));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(first); d.setDate(first.getDate() + i);
    if (i >= 35 && d.getMonth() !== _calMonth.getMonth()) break;
    const iso = planIso(d);
    const list = items[iso] || [];
    cells.push('<div role="button" tabindex="0" class="cal-cell' + (d.getMonth() !== _calMonth.getMonth() ? ' is-out' : '') + (iso === today ? ' is-today' : '') + (iso === _calDay ? ' is-picked' : '') + '" onclick="calendarPick(\'' + iso + '\')" aria-label="' + escapeHtml(planDay(iso, { weekday: 'long', day: 'numeric', month: 'long' })) + ', ' + list.length + ' item' + (list.length === 1 ? '' : 's') + '">'
      + '<span class="cal-num">' + d.getDate() + '</span>'
      + list.slice(0, 3).map(x => '<span class="cal-chip cal-chip--' + x.kind + '">' + escapeHtml(x.label) + '</span>').join('')
      + (list.length > 3 ? '<span class="cal-more">+' + (list.length - 3) + ' more</span>' : '') + '</div>');
  }
  grid.innerHTML = '<div class="cal-week">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => '<span>' + d + '</span>').join('') + '</div><div class="cal-cells">' + cells.join('') + '</div>';
  renderCalendarDay(items);
}

function renderCalendarDay(items) {
  const el = document.getElementById('calDay');
  if (!el || !_calDay) return;
  const list = (items || calendarItems())[_calDay] || [];
  const clients = activeClients();
  el.innerHTML = '<div class="pod-row"><span class="pod-kicker">' + escapeHtml(planDay(_calDay, { weekday: 'long', day: 'numeric', month: 'long' })) + '</span></div>'
    + (list.length ? list.map(x => '<div class="ws-list-row"><span class="cal-dot cal-chip--' + x.kind + '"></span><span class="ws-list-name">' + escapeHtml(x.label)
      + (x.event && x.event.note ? '<span class="lib-sub">' + escapeHtml(x.event.note) + '</span>' : '') + '</span>'
      + (x.clientId ? '<button class="bulk-action-btn bulk-action-btn--ghost" onclick="openClientTab(\'' + escapeHtml(x.clientId) + '\', \'' + (x.tab || 'overview') + '\')">Open client</button>' : '')
      + (x.event ? '<button class="bulk-action-btn bulk-action-btn--ghost" onclick="deleteCalendarEvent(\'' + escapeHtml(x.event.id) + '\')">Delete</button>' : '') + '</div>').join('')
      : '<p class="ws-empty-note">Nothing on this day.</p>')
    + '<details class="fl-add"><summary>Add a call or reminder on this day</summary>'
    + '<div class="fl-add-grid fl-add-grid--2"><input id="calTitleIn" class="coach-input" placeholder="Title, e.g. Call with Sam" maxlength="100">'
    + '<input id="calTime" class="coach-input" type="time" aria-label="Time (optional)"></div>'
    + '<div class="fl-add-grid fl-add-grid--2"><select id="calClient" class="coach-input" aria-label="Client (optional)"><option value="">No client</option>'
    + clients.map(c => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.clientName || 'Unknown') + '</option>').join('') + '</select>'
    + '<select id="calKind" class="coach-input" aria-label="Type"><option value="call">Call</option><option value="other">Reminder</option></select></div>'
    + '<input id="calNoteIn" class="coach-input" placeholder="Note (optional)" maxlength="500">'
    + '<button class="bulk-action-btn" onclick="saveCalendarEvent()">Add</button> <span class="ws-empty-note" id="calStatus"></span>'
    + '<p class="ws-empty-note">Only you see these. Clients are not notified.</p></details>';
}

async function saveCalendarEvent() {
  const v = id => document.getElementById(id).value.trim();
  const say = msg => { document.getElementById('calStatus').textContent = msg; };
  if (!v('calTitleIn')) { say('Give it a title.'); return; }
  const id = 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    const data = await coachJson('/api/coach/events/' + id, { method: 'PUT', body: JSON.stringify({ title: v('calTitleIn'), date: _calDay, time: v('calTime'), kind: v('calKind'), clientUid: v('calClient'), note: v('calNoteIn') }) });
    _events = (_events || []).concat(data.event);
    renderCalendar();
  } catch (err) { say(planError(err)); }
}

async function deleteCalendarEvent(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    await coachJson('/api/coach/events/' + encodeURIComponent(id), { method: 'DELETE' });
    _events = (_events || []).filter(e => e.id !== id);
    renderCalendar();
  } catch (err) { alert(planError(err)); }
}
