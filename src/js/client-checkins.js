/* =============================================================
   CLIENT CHECK-IN SYSTEM
   Lets coaches log per-athlete session notes, ratings, and
   wellbeing check-ins from the Coach Dashboard tab.
   Renders into #coachCheckinPanel (injected into Coaching tab).
   ============================================================= */

(function initClientCheckins() {
  'use strict';

  const KEY = 'coachCheckins_v1';

  const SESSION_TYPES = ['Training', 'Rest day', 'Deload', 'Assessment', 'Check-in call', 'Injury review'];

  /* ── Storage ─────────────────────────────────────────────── */

  function _loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }

  function _saveAll(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function getClientCheckins(clientId) {
    return (_loadAll()[clientId] || []).slice().reverse();
  }

  function saveCheckin(clientId, checkin) {
    const all = _loadAll();
    if (!all[clientId]) all[clientId] = [];
    all[clientId].unshift({ ...checkin, createdAt: Date.now() });
    // Keep last 200 check-ins per client
    if (all[clientId].length > 200) all[clientId] = all[clientId].slice(0, 200);
    _saveAll(all);
  }

  function deleteCheckin(clientId, idx) {
    const all = _loadAll();
    if (all[clientId]) {
      all[clientId].splice(idx, 1);
      _saveAll(all);
    }
  }

  /* ── Get roster from coaching module ─────────────────────── */

  function _getRoster() {
    // Try the coaching module's client list
    try {
      const clients = JSON.parse(localStorage.getItem('coachClients') || '[]');
      if (clients.length) return clients;
    } catch {}
    // Fallback: scan localStorage for athlete profiles
    const roster = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('athleteProfile_')) {
        try {
          const p = JSON.parse(localStorage.getItem(k));
          if (p?.username) roster.push({ id: p.username, name: p.name || p.username });
        } catch {}
      }
    }
    return roster;
  }

  /* ── Render the full check-in panel ─────────────────────── */

  let _activeClient = null;

  function renderCheckinPanel() {
    const host = document.getElementById('coachCheckinPanel');
    if (!host) return;

    const roster = _getRoster();

    host.innerHTML = `
      <div class="cc-layout">
        <!-- Left: form -->
        <div class="cc-form-col">
          <h3 class="cc-heading">📝 Log Check-in</h3>

          <div class="cc-field">
            <label class="cc-label">Athlete</label>
            <select id="ccClientSelect" class="cc-select" onchange="ccSelectClient(this.value)">
              <option value="">— Select athlete —</option>
              ${roster.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('')}
              <option value="__manual__">+ Enter manually</option>
            </select>
            <input type="text" id="ccManualName" class="cc-input" placeholder="Athlete name / ID"
              style="display:none;margin-top:6px;" />
          </div>

          <div class="cc-field">
            <label class="cc-label">Date</label>
            <input type="date" id="ccDate" class="cc-input"
              value="${new Date().toISOString().slice(0, 10)}" />
          </div>

          <div class="cc-field">
            <label class="cc-label">Session type</label>
            <select id="ccSessionType" class="cc-select">
              ${SESSION_TYPES.map(t => `<option>${t}</option>`).join('')}
            </select>
          </div>

          <div class="cc-field">
            <label class="cc-label">Athlete rating (1–5)</label>
            <div class="cc-star-row" id="ccStarRow">
              ${[1,2,3,4,5].map(n => `
                <button type="button" class="cc-star" data-val="${n}" onclick="ccSetRating(${n})">★</button>
              `).join('')}
            </div>
            <input type="hidden" id="ccRating" value="0" />
          </div>

          <div class="cc-field">
            <label class="cc-label">Energy / mood</label>
            <div class="cc-emoji-row">
              ${['😴','😕','😐','😊','🔥'].map((e, i) => `
                <button type="button" class="cc-mood-btn" data-val="${i+1}" onclick="ccSetMood(${i+1}, '${e}')">${e}</button>
              `).join('')}
            </div>
            <input type="hidden" id="ccMood" value="" />
          </div>

          <div class="cc-field">
            <label class="cc-label">Session notes</label>
            <textarea id="ccNotes" class="cc-textarea" rows="4"
              placeholder="How did the session go? Any form notes, fatigue cues, feedback…"></textarea>
          </div>

          <div class="cc-field">
            <label class="cc-label">Action items / next session</label>
            <textarea id="ccActions" class="cc-textarea" rows="2"
              placeholder="Focus for next session, adjustments to make…"></textarea>
          </div>

          <button class="cc-save-btn" onclick="saveClientCheckin()">Save Check-in</button>
          <div id="ccSaveMsg" class="cc-save-msg" hidden></div>
        </div>

        <!-- Right: history -->
        <div class="cc-history-col">
          <div class="cc-history-header">
            <h3 class="cc-heading">📋 History</h3>
            <select id="ccHistoryFilter" class="cc-select cc-filter-sel" onchange="ccFilterHistory(this.value)">
              <option value="">All athletes</option>
              ${roster.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('')}
            </select>
          </div>
          <div id="ccHistoryList" class="cc-history-list">
            <p class="cc-empty">No check-ins logged yet.</p>
          </div>
        </div>
      </div>
    `;

    _renderHistory('');
  }

  /* ── History rendering ───────────────────────────────────── */

  function _renderHistory(filterClient) {
    const host = document.getElementById('ccHistoryList');
    if (!host) return;

    const all    = _loadAll();
    const roster = _getRoster();
    const nameOf = (id) => roster.find(c => c.id === id)?.name || id;

    // Collect all entries, tagged with clientId
    let entries = [];
    for (const [clientId, list] of Object.entries(all)) {
      if (filterClient && clientId !== filterClient) continue;
      list.forEach((e, i) => entries.push({ ...e, clientId, localIdx: i }));
    }
    entries.sort((a, b) => b.createdAt - a.createdAt);

    if (!entries.length) {
      host.innerHTML = '<p class="cc-empty">No check-ins found.</p>';
      return;
    }

    host.innerHTML = entries.slice(0, 50).map(e => `
      <div class="cc-history-card">
        <div class="cc-hc-top">
          <span class="cc-hc-name">${nameOf(e.clientId)}</span>
          <span class="cc-hc-date">${e.date || '—'}</span>
          <button class="cc-hc-del" onclick="ccDeleteCheckin('${e.clientId}', ${e.localIdx})" title="Delete">✕</button>
        </div>
        <div class="cc-hc-meta">
          <span class="cc-hc-type">${e.sessionType || ''}</span>
          ${e.rating > 0 ? `<span class="cc-hc-stars">${'★'.repeat(e.rating)}${'☆'.repeat(5 - e.rating)}</span>` : ''}
          ${e.mood ? `<span class="cc-hc-mood">${e.mood}</span>` : ''}
        </div>
        ${e.notes ? `<p class="cc-hc-notes">${e.notes}</p>` : ''}
        ${e.actions ? `<p class="cc-hc-actions">→ ${e.actions}</p>` : ''}
      </div>
    `).join('');
  }

  /* ── Global handlers ─────────────────────────────────────── */

  window.ccSelectClient = function (val) {
    const manual = document.getElementById('ccManualName');
    if (manual) manual.style.display = val === '__manual__' ? 'block' : 'none';
    _activeClient = val !== '__manual__' ? val : null;
  };

  window.ccSetRating = function (n) {
    const ratingEl = document.getElementById('ccRating');
    if (ratingEl) ratingEl.value = n;
    document.querySelectorAll('.cc-star').forEach((s, i) => {
      s.classList.toggle('active', i < n);
    });
  };

  window.ccSetMood = function (val, emoji) {
    const moodEl = document.getElementById('ccMood');
    if (moodEl) moodEl.value = emoji;
    document.querySelectorAll('.cc-mood-btn').forEach((b, i) => {
      b.classList.toggle('active', i + 1 === val);
    });
  };

  window.saveClientCheckin = function () {
    const clientSelect = document.getElementById('ccClientSelect');
    const manualInput  = document.getElementById('ccManualName');
    let clientId = clientSelect?.value;
    if (clientId === '__manual__') clientId = (manualInput?.value || '').trim();
    if (!clientId) { _showMsg('Please select or enter an athlete name.', 'error'); return; }

    const date        = document.getElementById('ccDate')?.value || new Date().toISOString().slice(0, 10);
    const sessionType = document.getElementById('ccSessionType')?.value || '';
    const rating      = +document.getElementById('ccRating')?.value || 0;
    const mood        = document.getElementById('ccMood')?.value || '';
    const notes       = (document.getElementById('ccNotes')?.value || '').trim();
    const actions     = (document.getElementById('ccActions')?.value || '').trim();

    saveCheckin(clientId, { date, sessionType, rating, mood, notes, actions });

    // Clear form
    if (document.getElementById('ccNotes'))   document.getElementById('ccNotes').value = '';
    if (document.getElementById('ccActions')) document.getElementById('ccActions').value = '';
    ccSetRating(0);
    const ccMoodEl = document.getElementById('ccMood');
    if (ccMoodEl) ccMoodEl.value = '';
    document.querySelectorAll('.cc-mood-btn').forEach(b => b.classList.remove('active'));

    _showMsg('✅ Check-in saved!', 'ok');
    _renderHistory(document.getElementById('ccHistoryFilter')?.value || '');
  };

  window.ccFilterHistory = function (val) {
    _renderHistory(val);
  };

  window.ccDeleteCheckin = function (clientId, idx) {
    window.showConfirm('Delete this check-in?', { danger: true }).then(ok => {
      if (!ok) return;
      deleteCheckin(clientId, idx);
      _renderHistory(document.getElementById('ccHistoryFilter')?.value || '');
    });
  };

  function _showMsg(msg, type) {
    const el = document.getElementById('ccSaveMsg');
    if (!el) return;
    el.textContent = msg;
    el.className = `cc-save-msg ${type}`;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3000);
  }

  /* ── Inject check-in sub-tab into coaching tab ───────────── */

  function injectCheckinTab() {
    const nav = document.getElementById('coachSubtabNav');
    if (!nav || nav.querySelector('[data-coach-subtab="checkins"]')) return;

    // Add nav button
    const btn = document.createElement('button');
    btn.className = 'coach-subtab';
    btn.dataset.coachSubtab = 'checkins';
    btn.textContent = '📝 Check-ins';
    nav.appendChild(btn);

    // Add sub-view panel
    const panel = document.createElement('div');
    panel.id = 'coachSub_checkins';
    panel.className = 'coach-subview';
    panel.innerHTML = '<div id="coachCheckinPanel"></div>';

    const lastSubview = nav.parentElement?.querySelector('.coach-subview:last-of-type');
    if (lastSubview) lastSubview.after(panel);
    else if (nav.parentElement) nav.parentElement.appendChild(panel);

    // Wire nav click
    btn.addEventListener('click', () => {
      nav.querySelectorAll('.coach-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.coach-subview').forEach(v => v.classList.remove('active'));
      panel.classList.add('active');
      renderCheckinPanel();
    });
  }

  /* ── Boot ─────────────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(injectCheckinTab, 1600);
  });

  window.renderCheckinPanel = renderCheckinPanel;
  window.getClientCheckins  = getClientCheckins;

})();
