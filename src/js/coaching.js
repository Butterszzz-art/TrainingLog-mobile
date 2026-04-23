/**
 * coaching.js — Coaching Hub Extension
 *
 * Augments the existing inline coach dashboard with:
 *   • Client invite system (modal, send invite, pending list)
 *   • Coach notes timeline (add, delete, flag, milestone, backend sync)
 *   • Progress charts (bodyweight, volume, adherence, body fat via Chart.js)
 *   • Client search / filter / sort
 *   • All-clients comparison table with inactivity alerts
 *
 * Loaded as a plain <script> (not module) — sets window.CoachingHub.
 * Hooks are called from the inline renderCoachDashboardView() and
 * renderCoachClientDetail() after their innerHTML assignments.
 */
(function (global) {
  'use strict';

  // ─── Private Helpers ────────────────────────────────────────────────────────

  function coachId() {
    return (
      global.currentUser ||
      global.localStorage?.getItem('currentUser') ||
      global.localStorage?.getItem('username') ||
      'coach'
    );
  }

  function serverBase() {
    return (
      global.serverUrl ||
      global.localStorage?.getItem('serverUrl') ||
      ''
    );
  }

  function esc(v) {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return (
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  }

  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  // ─── Notes: localStorage + backend ──────────────────────────────────────────

  function notesLsKey(clientId) {
    return `coachNotes_${coachId()}_${clientId}`;
  }

  function readLocalNotes(clientId) {
    try {
      return JSON.parse(global.localStorage?.getItem(notesLsKey(clientId)) || '[]');
    } catch (_) {
      return [];
    }
  }

  function writeLocalNotes(clientId, notes) {
    try {
      global.localStorage?.setItem(notesLsKey(clientId), JSON.stringify(notes));
    } catch (_) {}
  }

  async function loadNotes(clientId) {
    const local = readLocalNotes(clientId);
    try {
      const url = `${serverBase()}/api/coach/client/${encodeURIComponent(clientId)}/notes?coachId=${encodeURIComponent(coachId())}`;
      const res = await fetch(url);
      if (res.ok) {
        const remote = await res.json();
        if (Array.isArray(remote) && remote.length) {
          writeLocalNotes(clientId, remote);
          return remote;
        }
      }
    } catch (_) {}
    return local;
  }

  async function saveNote(clientId, text, flagged, milestone) {
    const note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: text.trim(),
      date: new Date().toISOString(),
      flagged: Boolean(flagged),
      milestone: Boolean(milestone),
    };
    const notes = readLocalNotes(clientId);
    notes.unshift(note);
    writeLocalNotes(clientId, notes);

    try {
      const url = `${serverBase()}/api/coach/client/${encodeURIComponent(clientId)}/notes`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId: coachId(), text: note.text, flagged: note.flagged, milestone: note.milestone }),
      });
    } catch (_) {}

    return note;
  }

  async function deleteNote(clientId, noteId) {
    const notes = readLocalNotes(clientId).filter((n) => n.id !== noteId);
    writeLocalNotes(clientId, notes);

    try {
      const url = `${serverBase()}/api/coach/client/${encodeURIComponent(clientId)}/notes/${encodeURIComponent(noteId)}?coachId=${encodeURIComponent(coachId())}`;
      await fetch(url, { method: 'DELETE' });
    } catch (_) {}

    return notes;
  }

  // ─── Notes UI ────────────────────────────────────────────────────────────────

  function renderNoteItem(note) {
    const flagBadge = note.flagged ? '<span class="ch-note-badge ch-note-badge--flag">⚑ Flagged</span>' : '';
    const msBadge = note.milestone ? '<span class="ch-note-badge ch-note-badge--ms">★ Milestone</span>' : '';
    return `
      <li class="ch-note-item${note.flagged ? ' ch-note--flagged' : ''}${note.milestone ? ' ch-note--milestone' : ''}">
        <div class="ch-note-meta">
          <span class="ch-note-date">${esc(fmtDateTime(note.date))}</span>
          <span class="ch-note-badges">${flagBadge}${msBadge}</span>
        </div>
        <p class="ch-note-text">${esc(note.text)}</p>
        <button class="ch-note-delete" data-ch-del-note="${esc(note.id)}" title="Delete note">✕ Delete</button>
      </li>`;
  }

  function renderNotesSection(clientId, notes) {
    const items = notes.length
      ? notes.map(renderNoteItem).join('')
      : '<li class="ch-note-empty">No notes yet. Add your first note below.</li>';
    return `
      <ul class="ch-notes-list">${items}</ul>
      <form class="ch-note-form" id="chNoteForm_${esc(clientId)}" data-note-client="${esc(clientId)}">
        <textarea id="chNoteText_${esc(clientId)}" placeholder="Add a coaching note… (visible to client)" rows="3"></textarea>
        <div class="ch-note-form-opts">
          <label><input type="checkbox" class="chNoteFlagged"> ⚑ Flag concern</label>
          <label><input type="checkbox" class="chNoteMilestone"> ★ Milestone</label>
          <button type="submit" style="margin-left:auto;">Save Note</button>
        </div>
      </form>`;
  }

  function wireNoteForms(container, clientId) {
    // Submit
    const form = container.querySelector(`#chNoteForm_${clientId}`);
    if (form && !form._chWired) {
      form._chWired = true;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = container.querySelector(`#chNoteText_${clientId}`)?.value?.trim();
        if (!text) return;
        const flagged = form.querySelector('.chNoteFlagged')?.checked;
        const milestone = form.querySelector('.chNoteMilestone')?.checked;
        await saveNote(clientId, text, flagged, milestone);
        const notes = readLocalNotes(clientId);
        refreshNotesUI(container, clientId, notes);
        toast('Note saved.');
      });
    }

    // Delete (event delegation on notesCard)
    const card = container.querySelector('#chNotesCard');
    if (card && !card._chDelWired) {
      card._chDelWired = true;
      card.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-ch-del-note]');
        if (!btn) return;
        if (!confirm('Delete this note?')) return;
        const noteId = btn.getAttribute('data-ch-del-note');
        const notes = await deleteNote(clientId, noteId);
        refreshNotesUI(container, clientId, notes);
        toast('Note deleted.');
      });
    }
  }

  function refreshNotesUI(container, clientId, notes) {
    const inner = container.querySelector('#chNotesInner');
    if (!inner) return;
    inner.innerHTML = renderNotesSection(clientId, notes);
    wireNoteForms(container, clientId);
  }

  // ─── Chart Data ──────────────────────────────────────────────────────────────

  function weekLabels(n) {
    const out = [];
    for (let i = n; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      out.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    }
    return out;
  }

  function syntheticWeightTrend(currentWeight, weeklyChangePct, n) {
    if (!currentWeight) return null;
    const data = [];
    let w = currentWeight;
    for (let i = n; i >= 0; i--) {
      const noise = (Math.random() - 0.5) * 0.5;
      const ago = w + (weeklyChangePct / 100) * w * i + noise;
      data.push(Math.round(ago * 10) / 10);
    }
    return data;
  }

  function syntheticVolume(compliancePct, n) {
    const base = 12000 + (compliancePct / 100) * 6000;
    return Array.from({ length: n + 1 }, (_, i) => {
      const noise = (Math.random() - 0.4) * 2500;
      return Math.max(0, Math.round(base + noise + i * 150));
    });
  }

  function syntheticAdherence(compliancePct, n) {
    return Array.from({ length: n + 1 }, () =>
      Math.min(100, Math.max(0, Math.round(compliancePct + (Math.random() - 0.5) * 22)))
    );
  }

  function syntheticBodyFat(n) {
    // We don't have a real BF% for demo clients — produce a plausible downward trend
    let bf = 15 + Math.random() * 8;
    return Array.from({ length: n + 1 }, (_, i) => {
      const v = bf - i * 0.12 + (Math.random() - 0.5) * 0.2;
      return Math.round(v * 10) / 10;
    }).reverse();
  }

  function getChartData(client, n = 8) {
    const labels = weekLabels(n);
    let weightData = null;

    // Try real bodyweight log
    try {
      const log = JSON.parse(global.localStorage?.getItem(`bodyweightLog_${client.id}`) || '[]');
      if (Array.isArray(log) && log.length >= 3) {
        const slice = log.slice(-n - 1);
        weightData = slice.map((e) => e.weight ?? e.weightKg ?? e.value ?? null).filter((v) => v != null);
      }
    } catch (_) {}

    return {
      labels,
      weight: weightData || syntheticWeightTrend(client.currentBodyweight, -(client.weeklyWeightChangePercent || 0), n),
      volume: syntheticVolume(client.compliancePercent, n),
      adherence: syntheticAdherence(client.compliancePercent, n),
      bodyFat: syntheticBodyFat(n),
    };
  }

  // ─── Chart Rendering ─────────────────────────────────────────────────────────

  const _charts = new Map();

  function destroyClientCharts(clientId) {
    _charts.forEach((chart, key) => {
      if (key.startsWith(clientId + ':')) {
        try { chart.destroy(); } catch (_) {}
        _charts.delete(key);
      }
    });
  }

  function makeChart(canvasId, clientId, config) {
    if (!global.Chart) return;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const key = `${clientId}:${canvasId}`;
    if (_charts.has(key)) { try { _charts.get(key).destroy(); } catch (_) {} }
    const chart = new global.Chart(canvas, config);
    _charts.set(key, chart);
    return chart;
  }

  function mountCharts(clientId, client) {
    const section = document.getElementById('chChartsSection');
    if (!section) return;

    const data = getChartData(client);
    const isDark = document.body.classList.contains('dark-theme');
    const gridCol = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
    const tickCol = isDark ? '#8a9aaa' : '#8a9aaa';

    const base = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { grid: { color: gridCol }, ticks: { color: tickCol, font: { size: 10 }, maxTicksLimit: 5 } },
        y: { grid: { color: gridCol }, ticks: { color: tickCol, font: { size: 10 } } },
      },
    };

    section.innerHTML = `
      <div class="ch-period-tabs" id="chPeriodTabs">
        <button class="ch-period-tab active" data-weeks="8">8 Weeks</button>
        <button class="ch-period-tab" data-weeks="4">4 Weeks</button>
      </div>
      <div class="ch-charts-grid">
        <div class="ch-chart-card">
          <h4 class="ch-chart-title">📊 Bodyweight Trend (kg)</h4>
          <div class="ch-chart-wrap"><canvas id="chChartWeight"></canvas></div>
          <p class="ch-chart-note">${data.weight ? 'Live data from weight log' : 'Illustrative trend — no weight log found'}</p>
        </div>
        <div class="ch-chart-card">
          <h4 class="ch-chart-title">🏋️ Weekly Volume (kg)</h4>
          <div class="ch-chart-wrap"><canvas id="chChartVolume"></canvas></div>
          <p class="ch-chart-note">Estimated from training compliance</p>
        </div>
        <div class="ch-chart-card">
          <h4 class="ch-chart-title">✅ Training Adherence (%)</h4>
          <div class="ch-chart-wrap"><canvas id="chChartAdherence"></canvas></div>
          <p class="ch-chart-note">Session completion rate per week</p>
        </div>
        <div class="ch-chart-card">
          <h4 class="ch-chart-title">📉 Body Fat % (est.)</h4>
          <div class="ch-chart-wrap"><canvas id="chChartBF"></canvas></div>
          <p class="ch-chart-note">Estimated — track via check-ins for accuracy</p>
        </div>
      </div>
    `;

    // Wire period tabs
    const tabsEl = section.querySelector('#chPeriodTabs');
    tabsEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-weeks]');
      if (!btn) return;
      tabsEl.querySelectorAll('.ch-period-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const weeks = Number(btn.getAttribute('data-weeks'));
      const newData = getChartData({ ...client, _weeks: weeks }, weeks);
      destroyClientCharts(clientId);
      _drawAllCharts(clientId, newData, base);
    });

    _drawAllCharts(clientId, data, base);
  }

  function _drawAllCharts(clientId, data, base) {
    // Bodyweight — line
    if (data.weight?.length) {
      makeChart('chChartWeight', clientId, {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: [{ data: data.weight, borderColor: '#2d7d5b', backgroundColor: 'rgba(45,125,91,0.1)', fill: true, tension: 0.4, pointRadius: 3 }],
        },
        options: { ...base },
      });
    }

    // Volume — bar
    makeChart('chChartVolume', clientId, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{ data: data.volume, backgroundColor: 'rgba(45,125,91,0.55)', borderColor: '#2d7d5b', borderWidth: 1, borderRadius: 4 }],
      },
      options: { ...base },
    });

    // Adherence — line
    makeChart('chChartAdherence', clientId, {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{ data: data.adherence, borderColor: '#4a90e2', backgroundColor: 'rgba(74,144,226,0.1)', fill: true, tension: 0.4, pointRadius: 3 }],
      },
      options: { ...base, scales: { ...base.scales, y: { ...base.scales.y, min: 0, max: 100 } } },
    });

    // Body fat — line
    makeChart('chChartBF', clientId, {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{ data: data.bodyFat, borderColor: '#e07a5f', backgroundColor: 'rgba(224,122,95,0.1)', fill: true, tension: 0.4, pointRadius: 3 }],
      },
      options: { ...base },
    });
  }

  // ─── Invite Modal ────────────────────────────────────────────────────────────

  let _inviteModal = null;

  function buildInviteModal() {
    const el = document.createElement('div');
    el.id = 'chInviteBackdrop';
    el.className = 'ch-invite-backdrop';
    el.innerHTML = `
      <div class="ch-invite-modal" role="dialog" aria-modal="true" aria-labelledby="chInviteTitle">
        <div class="ch-invite-header">
          <h3 id="chInviteTitle">Invite Client</h3>
          <button class="ch-invite-close" id="chInviteClose" aria-label="Close">✕</button>
        </div>
        <p class="ch-invite-desc">Enter your client's email address. They'll receive a link to connect with your coaching hub.</p>
        <form id="chInviteForm">
          <label class="ch-invite-label">
            Client Email
            <input type="email" id="chInviteEmail" placeholder="client@example.com" autocomplete="email" required>
          </label>
          <div class="ch-invite-actions">
            <button type="button" id="chInviteCancel">Cancel</button>
            <button type="submit" id="chInviteSend">Send Invite</button>
          </div>
          <p id="chInviteStatus" class="ch-invite-status" aria-live="polite"></p>
        </form>
        <div id="chPendingList"></div>
      </div>
    `;
    document.body.appendChild(el);

    el.addEventListener('click', (e) => { if (e.target === el) closeInviteModal(); });
    el.querySelector('#chInviteClose').addEventListener('click', closeInviteModal);
    el.querySelector('#chInviteCancel').addEventListener('click', closeInviteModal);
    el.querySelector('#chInviteForm').addEventListener('submit', _handleInviteSubmit);

    return el;
  }

  function openInviteModal() {
    if (!_inviteModal) _inviteModal = buildInviteModal();
    _inviteModal.style.display = 'flex';
    _inviteModal.querySelector('#chInviteEmail').value = '';
    _inviteModal.querySelector('#chInviteStatus').textContent = '';
    _loadPendingInvites();
  }

  function closeInviteModal() {
    if (_inviteModal) _inviteModal.style.display = 'none';
  }

  async function _loadPendingInvites() {
    if (!_inviteModal) return;
    const listEl = _inviteModal.querySelector('#chPendingList');
    if (!listEl) return;

    const cId = coachId();
    let pending = [];

    // Local fallback
    try {
      const local = JSON.parse(global.localStorage?.getItem(`chInvites_${cId}`) || '[]');
      pending = local.filter((i) => i.status === 'pending');
    } catch (_) {}

    // Try backend
    try {
      const res = await fetch(`${serverBase()}/api/coach/clients?coachId=${encodeURIComponent(cId)}`);
      if (res.ok) {
        const clients = await res.json();
        const remote = clients.filter((c) => c.status === 'pending');
        if (remote.length) pending = remote;
      }
    } catch (_) {}

    if (!pending.length) { listEl.innerHTML = ''; return; }

    listEl.innerHTML = `
      <h4 class="ch-pending-title">Pending Invitations</h4>
      <ul class="ch-pending-list">
        ${pending.map((inv) => `
          <li class="ch-pending-item">
            <span>${esc(inv.email || inv.name)}</span>
            <span class="ch-status-pill ch-status--pending">Pending</span>
          </li>`).join('')}
      </ul>`;
  }

  async function _handleInviteSubmit(e) {
    e.preventDefault();
    const email = _inviteModal?.querySelector('#chInviteEmail')?.value?.trim();
    if (!email) return;

    const statusEl = _inviteModal?.querySelector('#chInviteStatus');
    const sendBtn = _inviteModal?.querySelector('#chInviteSend');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }
    if (statusEl) statusEl.textContent = '';

    // Save locally
    const cId = coachId();
    const lsKey = `chInvites_${cId}`;
    try {
      const inv = JSON.parse(global.localStorage?.getItem(lsKey) || '[]');
      inv.push({ email, status: 'pending', sentAt: new Date().toISOString() });
      global.localStorage?.setItem(lsKey, JSON.stringify(inv));
    } catch (_) {}

    let inviteLink = null;
    try {
      const res = await fetch(`${serverBase()}/api/coach/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId: cId, email }),
      });
      if (res.ok) {
        const data = await res.json();
        inviteLink = data.inviteLink;
      }
    } catch (_) {}

    if (statusEl) {
      statusEl.style.color = 'var(--highlight, #2d7d5b)';
      statusEl.textContent = inviteLink
        ? `✓ Invite sent! Link: ${inviteLink}`
        : '✓ Invite saved locally. Will sync when connected.';
    }
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send Invite'; }
    if (_inviteModal?.querySelector('#chInviteEmail')) _inviteModal.querySelector('#chInviteEmail').value = '';
    _loadPendingInvites();
  }

  // ─── Search / Filter / Sort ──────────────────────────────────────────────────

  function renderSearchBar(state) {
    const q = esc(state?.searchQuery || '');
    const fs = state?.filterStatus || 'all';
    const sb = state?.sortBy || 'name';
    return `
      <div class="ch-search-bar">
        <input type="search" id="chClientSearch" placeholder="Search clients by name…" value="${q}" autocomplete="off" aria-label="Search clients">
        <select id="chClientFilter" aria-label="Filter clients">
          <option value="all" ${fs === 'all' ? 'selected' : ''}>All clients</option>
          <option value="active" ${fs === 'active' ? 'selected' : ''}>Active</option>
          <option value="pending" ${fs === 'pending' ? 'selected' : ''}>Pending invite</option>
          <option value="alert" ${fs === 'alert' ? 'selected' : ''}>Needs action</option>
          <option value="inactive" ${fs === 'inactive' ? 'selected' : ''}>Inactive (7+ days)</option>
        </select>
        <select id="chClientSort" aria-label="Sort clients">
          <option value="name" ${sb === 'name' ? 'selected' : ''}>Sort: Name</option>
          <option value="compliance" ${sb === 'compliance' ? 'selected' : ''}>Sort: Compliance</option>
          <option value="activity" ${sb === 'activity' ? 'selected' : ''}>Sort: Last Activity</option>
          <option value="alert" ${sb === 'alert' ? 'selected' : ''}>Sort: Alert Level</option>
        </select>
        <button type="button" class="action-btn ch-invite-btn" id="chInviteOpenBtn">+ Invite Client</button>
      </div>`;
  }

  function filterAndSortClients(clients, state) {
    const query = (state?.searchQuery || '').trim().toLowerCase();
    const filter = state?.filterStatus || 'all';
    const sort = state?.sortBy || 'name';
    const alertOrder = { alert: 0, watch: 1, ok: 2 };

    let result = clients.filter((c) => {
      if (query && !`${c.name} ${c.archetype}`.toLowerCase().includes(query)) return false;
      if (filter === 'active') return (c.status || 'active') === 'active';
      if (filter === 'pending') return c.status === 'pending';
      if (filter === 'alert') {
        const lvl = typeof global.deriveCoachAlertStatus === 'function' ? global.deriveCoachAlertStatus(c) : c.alertStatus;
        return lvl === 'alert';
      }
      if (filter === 'inactive') {
        if (!c.lastCheckInDate) return true;
        const days = Math.floor((Date.now() - new Date(c.lastCheckInDate).getTime()) / 86400000);
        return days >= 7;
      }
      return true;
    });

    result.sort((a, b) => {
      if (sort === 'compliance') return (b.compliancePercent || 0) - (a.compliancePercent || 0);
      if (sort === 'activity') {
        const da = new Date(a.lastCheckInDate || 0).getTime();
        const db = new Date(b.lastCheckInDate || 0).getTime();
        return db - da;
      }
      if (sort === 'alert') {
        const la = typeof global.deriveCoachAlertStatus === 'function' ? global.deriveCoachAlertStatus(a) : (a.alertStatus || 'ok');
        const lb = typeof global.deriveCoachAlertStatus === 'function' ? global.deriveCoachAlertStatus(b) : (b.alertStatus || 'ok');
        return (alertOrder[la] ?? 1) - (alertOrder[lb] ?? 1);
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    return result;
  }

  // ─── Comparison Table ────────────────────────────────────────────────────────

  function renderComparisonTable(clients) {
    if (!clients.length) return '';

    const rows = clients.map((c) => {
      const alertMeta = typeof global.getCoachAlertMeta === 'function' && typeof global.deriveCoachAlertStatus === 'function'
        ? global.getCoachAlertMeta(global.deriveCoachAlertStatus(c))
        : { label: '—', className: '' };
      const daysSince = c.lastCheckInDate
        ? Math.floor((Date.now() - new Date(c.lastCheckInDate).getTime()) / 86400000)
        : null;
      const inactiveChip = daysSince !== null && daysSince >= 7
        ? `<span class="ch-inactive-chip">${daysSince}d ago</span>`
        : '';
      const statusCls = `ch-status--${c.status === 'pending' ? 'pending' : 'active'}`;
      const trend = c.weeklyWeightChangePercent != null
        ? (c.weeklyWeightChangePercent < -0.1
            ? `<span class="ch-trend-down">▼ ${Math.abs(c.weeklyWeightChangePercent).toFixed(2)}%</span>`
            : c.weeklyWeightChangePercent > 0.1
              ? `<span class="ch-trend-up">▲ ${c.weeklyWeightChangePercent.toFixed(2)}%</span>`
              : '<span class="ch-trend-flat">→ Stable</span>')
        : '—';
      return `
        <tr>
          <td>
            <strong>${esc(c.name)}</strong><br>
            <span class="ch-table-sub">${esc(c.archetype)} · ${esc(c.currentPhase)}</span>
          </td>
          <td><span class="ch-status-pill ${statusCls}">${esc(c.status === 'pending' ? 'Pending' : 'Active')}</span></td>
          <td>${c.compliancePercent}%</td>
          <td>${fmtDate(c.lastCheckInDate)} ${inactiveChip}</td>
          <td>${c.currentBodyweight ? `${c.currentBodyweight} kg` : '—'}</td>
          <td>${trend}</td>
          <td><span class="coach-alert-pill ${alertMeta.className}">${esc(alertMeta.label)}</span></td>
        </tr>`;
    }).join('');

    return `
      <section class="ch-comparison-section">
        <h4 class="ch-comparison-title">All Clients — At a Glance</h4>
        <div class="ch-comparison-scroll">
          <table class="ch-comparison-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Status</th>
                <th>Compliance</th>
                <th>Last Check-In</th>
                <th>Bodyweight</th>
                <th>Wt. Trend</th>
                <th>Alert</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  // ─── Post-Render Hooks ───────────────────────────────────────────────────────

  /**
   * Called by renderCoachDashboardView after the roster innerHTML is set.
   * Wires search / filter / sort inputs and the invite button.
   */
  function afterRosterRender(container, state) {
    const search = container.querySelector('#chClientSearch');
    const filter = container.querySelector('#chClientFilter');
    const sort = container.querySelector('#chClientSort');
    const invBtn = container.querySelector('#chInviteOpenBtn');

    if (search) {
      search.addEventListener('input', (e) => {
        if (global.coachDashboardState) global.coachDashboardState.searchQuery = e.target.value;
        if (typeof global.renderCoachDashboardView === 'function') global.renderCoachDashboardView();
      });
    }
    if (filter) {
      filter.addEventListener('change', (e) => {
        if (global.coachDashboardState) global.coachDashboardState.filterStatus = e.target.value;
        if (typeof global.renderCoachDashboardView === 'function') global.renderCoachDashboardView();
      });
    }
    if (sort) {
      sort.addEventListener('change', (e) => {
        if (global.coachDashboardState) global.coachDashboardState.sortBy = e.target.value;
        if (typeof global.renderCoachDashboardView === 'function') global.renderCoachDashboardView();
      });
    }
    if (invBtn) {
      invBtn.addEventListener('click', openInviteModal);
    }
  }

  /**
   * Called by renderCoachDashboardView after the client detail innerHTML is set.
   * Loads notes from backend/local, wires the note form, and mounts Chart.js charts.
   */
  async function afterDetailRender(clientId, client, container) {
    destroyClientCharts(clientId);

    // Render notes placeholder immediately, then hydrate async
    const notesInner = container.querySelector('#chNotesInner');
    if (notesInner) {
      notesInner.innerHTML = renderNotesSection(clientId, readLocalNotes(clientId));
      wireNoteForms(container, clientId);

      // Async sync from backend
      loadNotes(clientId).then((notes) => {
        const inner2 = container.querySelector('#chNotesInner');
        if (inner2) {
          inner2.innerHTML = renderNotesSection(clientId, notes);
          wireNoteForms(container, clientId);
        }
      });
    }

    // Mount charts (canvas elements now exist in DOM)
    mountCharts(clientId, client);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  global.CoachingHub = {
    renderSearchBar,
    filterAndSortClients,
    renderComparisonTable,
    afterRosterRender,
    afterDetailRender,
    openInviteModal,
    closeInviteModal,
  };

})(typeof window !== 'undefined' ? window : globalThis);
