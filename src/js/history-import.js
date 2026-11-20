/* =============================================================
   HISTORY IMPORT — "Bring your history" sheet
   A new user who already trained with another app picks that app's
   CSV export here; history-import-core.js parses it on the phone and
   the sessions go to the backend in chunks (POST /workouts/import).
   They come back through loadFullWorkoutHistory like any archived
   workout, so Insights, PRs, History and "last time" suggestions have
   months of data on day one.

   Imported sessions are kept off the leaderboard (backend
   src/workoutImport.js). Re-importing the same file overwrites.

   Opened from onboarding ("Bring your history"), the Home starter
   card and Settings › Data (window.openHistoryImport()).
   Styles: css/history-import.css (.hi-*), on the mx-sheet kit.
   ============================================================= */
(function (global) {
  'use strict';

  const Core = () => global.HistoryImportCore;
  const DONE_KEY = u => `historyImport_${u}`;
  const CHUNK = 100;

  const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  const HOW = {
    strong: 'In Strong: Profile › Settings › Export Strong Data. Save the CSV to Files, then pick it below.',
    hevy: 'In Hevy: Profile › Settings › Export & Import Data › Export Workouts. Save the CSV, then pick it below.',
    fitbod: 'In Fitbod: Log › the share icon › Export workout data. Save the CSV, then pick it below.',
    sheet: 'Any CSV with a date, exercise, reps and weight column works (sets and unit columns are optional). In Google Sheets or Excel: File › Download › CSV.',
  };

  function user() {
    return (typeof global.getActiveUsername === 'function' && global.getActiveUsername())
      || global.currentUser || localStorage.getItem('fitnessAppUser') || '';
  }

  function unit() {
    const u = localStorage.getItem('defaultWeightUnit') || '';
    return /lb/i.test(u) ? 'lbs' : 'kg';
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function fmtMonth(day) {
    const d = new Date(`${day}T12:00:00`);
    return isNaN(d) ? day : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }

  function toast(msg, kind) {
    const t = global.nativeToast || global.showToast;
    if (typeof t === 'function') t(msg, kind);
  }

  /** Last import summary for this user, or null. */
  function lastImport(u = user()) {
    try { return JSON.parse(localStorage.getItem(DONE_KEY(u))) || null; } catch { return null; }
  }

  /* ── Upload ──────────────────────────────────────────────── */

  async function upload(parsed, onProgress) {
    const C = Core();
    const chunks = C.toImportChunks(parsed.workouts, parsed.format, CHUNK);
    const headers = { 'Content-Type': 'application/json', ...(typeof global.getAuthHeaders === 'function' ? global.getAuthHeaders() : {}) };
    let saved = 0;
    let skipped = 0;
    for (let i = 0; i < chunks.length; i++) {
      const res = await fetch(`${global.SERVER_URL}/workouts/import`, { method: 'POST', headers, body: JSON.stringify(chunks[i]) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        const err = new Error((data && data.error && data.error.message) || `Import failed (${res.status})`);
        err.status = res.status;
        err.saved = saved;
        throw err;
      }
      saved += Number(data.saved) || 0;
      skipped += Number(data.skipped) || 0;
      onProgress(Math.min(parsed.workouts.length, (i + 1) * CHUNK), parsed.workouts.length);
    }
    return { saved, skipped };
  }

  async function refreshEverything(u) {
    try {
      if (typeof global.invalidateBackendWorkouts === 'function') global.invalidateBackendWorkouts(u);
      if (typeof global.loadFullWorkoutHistory === 'function') await global.loadFullWorkoutHistory(u, { force: true });
      if (typeof global.refreshRemoteOverloadCache === 'function') global.refreshRemoteOverloadCache(u);
    } catch { /* offline: the next launch picks them up */ }
    ['renderSessionHistory', 'renderWorkoutHistory', 'renderPRs', 'renderHomeDashboard'].forEach(fn => {
      try { if (typeof global[fn] === 'function') global[fn](); } catch { /* ignore */ }
    });
    document.dispatchEvent(new CustomEvent('tl:history-imported', { detail: { user: u } }));
  }

  /* ── Sheet ───────────────────────────────────────────────── */

  function close() {
    document.querySelectorAll('.hi-backdrop').forEach(n => n.remove());
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(opts) {
    const o = opts || {};
    close();
    const prev = lastImport();
    const overlay = document.createElement('div');
    overlay.className = 'mx-sheet-backdrop hi-backdrop';
    overlay.innerHTML = `
      <div class="mx-sheet hi-sheet" role="dialog" aria-modal="true" aria-labelledby="hiTitle">
        <div class="mx-sheet-head">
          <h3 class="pod-title mx-h3" id="hiTitle">Bring your training history</h3>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-hi-close aria-label="Close">${CLOSE}</button>
        </div>
        <div class="hi-body" data-hi-step="pick">
          <p class="mx-sub hi-lead">Logged with another app before? Import it and your charts, PRs and next-session suggestions start from where you are, not from zero.</p>
          ${prev ? `<p class="hi-note">Last import: ${esc(prev.sessions)} sessions from ${esc(prev.source)}. Importing the same file again won’t duplicate anything.</p>` : ''}
          <div class="hi-sources" role="radiogroup" aria-label="Where is your history?">
            <button type="button" class="hi-source" role="radio" aria-checked="false" data-hi-src="strong">Strong</button>
            <button type="button" class="hi-source" role="radio" aria-checked="false" data-hi-src="hevy">Hevy</button>
            <button type="button" class="hi-source" role="radio" aria-checked="false" data-hi-src="fitbod">Fitbod</button>
            <button type="button" class="hi-source" role="radio" aria-checked="false" data-hi-src="sheet">Spreadsheet</button>
          </div>
          <p class="hi-how" data-hi-how hidden></p>
          <label class="gd-go hi-file">
            <input type="file" accept=".csv,text/csv,text/comma-separated-values,text/plain" data-hi-file>
            Choose CSV file
          </label>
          <p class="hi-error" data-hi-error role="alert" hidden></p>
          <p class="hi-fine">Imported sessions show in your history and charts but don’t count towards leaderboards.</p>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);

    const body = overlay.querySelector('.hi-body');
    const showError = msg => {
      const el = overlay.querySelector('[data-hi-error]');
      if (!el) return;
      el.textContent = msg;
      el.hidden = !msg;
    };

    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-hi-close]')) { close(); if (typeof o.onClose === 'function') o.onClose(false); return; }
      const src = e.target.closest('[data-hi-src]');
      if (src) {
        overlay.querySelectorAll('[data-hi-src]').forEach(b => {
          const on = b === src;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        const how = overlay.querySelector('[data-hi-how]');
        how.textContent = HOW[src.dataset.hiSrc] || '';
        how.hidden = false;
      }
    });

    overlay.querySelector('[data-hi-file]').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      showError('');
      if (file.size > 15 * 1024 * 1024) { showError('That file is over 15 MB. Export a shorter date range and try again.'); return; }
      let text;
      try { text = await file.text(); } catch { showError('Couldn’t read that file.'); return; }
      const parsed = Core().parseExport(text, { unit: unit() });
      if (!parsed.ok) { showError(parsed.error); return; }
      showPreview(body, parsed, o);
    });
  }

  function showPreview(body, parsed, o) {
    const range = parsed.firstDate === parsed.lastDate ? fmtMonth(parsed.firstDate) : `${fmtMonth(parsed.firstDate)} – ${fmtMonth(parsed.lastDate)}`;
    body.dataset.hiStep = 'preview';
    body.innerHTML = `
      <p class="mx-sub hi-lead">Found in your ${esc(parsed.source)} export:</p>
      <div class="hi-stats">
        <div class="hi-stat"><b>${parsed.workouts.length.toLocaleString()}</b><span>sessions</span></div>
        <div class="hi-stat"><b>${parsed.sets.toLocaleString()}</b><span>sets</span></div>
        <div class="hi-stat"><b>${parsed.exercises.toLocaleString()}</b><span>exercises</span></div>
      </div>
      <p class="hi-note">${esc(range)}${parsed.skippedRows ? ` · ${parsed.skippedRows.toLocaleString()} cardio or empty rows skipped` : ''}</p>
      <div class="hi-bar" hidden><i style="width:0%"></i></div>
      <p class="hi-error" data-hi-error role="alert" hidden></p>
      <div class="hi-actions">
        <button type="button" class="gd-textbtn gd-dim" data-hi-back>Pick another file</button>
        <button type="button" class="gd-go" data-hi-go>Import ${parsed.workouts.length.toLocaleString()} sessions</button>
      </div>`;

    body.querySelector('[data-hi-back]').addEventListener('click', () => { close(); open(o); });
    body.querySelector('[data-hi-go]').addEventListener('click', async ev => {
      const btn = ev.currentTarget;
      const u = user();
      const err = body.querySelector('[data-hi-error]');
      if (!u || !localStorage.getItem('token') || !global.SERVER_URL) {
        err.textContent = 'Sign in first, then import.';
        err.hidden = false;
        return;
      }
      btn.disabled = true;
      body.querySelector('[data-hi-back]').disabled = true;
      const bar = body.querySelector('.hi-bar');
      bar.hidden = false;
      btn.textContent = 'Importing…';
      try {
        const result = await upload(parsed, (done, total) => {
          bar.firstElementChild.style.width = `${Math.round((done / total) * 100)}%`;
          btn.textContent = `Importing… ${done.toLocaleString()} / ${total.toLocaleString()}`;
        });
        try {
          localStorage.setItem(DONE_KEY(u), JSON.stringify({ at: new Date().toISOString(), sessions: result.saved, source: parsed.source, first: parsed.firstDate, last: parsed.lastDate }));
        } catch { /* storage full */ }
        await refreshEverything(u);
        showDone(body, parsed, result, o);
      } catch (e) {
        btn.disabled = false;
        body.querySelector('[data-hi-back]').disabled = false;
        btn.textContent = 'Try again';
        err.textContent = e.status === 409
          ? 'Your account can’t import yet. Log one workout so it syncs, then try again.'
          : e.status === 429 ? 'Too many imports in a row. Try again in an hour.'
          : `${e.saved ? `${e.saved} sessions saved, then it stopped. ` : ''}Check your connection and tap Try again: nothing will be duplicated.`;
        err.hidden = false;
      }
    });
  }

  function showDone(body, parsed, result, o) {
    body.dataset.hiStep = 'done';
    body.innerHTML = `
      <div class="hi-done">
        <b>${result.saved.toLocaleString()} sessions imported</b>
        <p class="mx-sub">Your PRs, strength trends and “last time” weights now go back to ${esc(fmtMonth(parsed.firstDate))}.</p>
      </div>
      <div class="hi-actions">
        <button type="button" class="gd-textbtn gd-dim" data-hi-close>Done</button>
        <button type="button" class="gd-go" data-hi-insights>See my trends</button>
      </div>`;
    toast(`${result.saved.toLocaleString()} sessions imported`, 'success');
    body.querySelector('[data-hi-insights]').addEventListener('click', () => {
      close();
      if (typeof o.onClose === 'function') o.onClose(true);
      if (typeof global.showTab === 'function') global.showTab('progressTab');
    });
    body.querySelector('[data-hi-close]').addEventListener('click', () => {
      close();
      if (typeof o.onClose === 'function') o.onClose(true);
    });
  }

  global.openHistoryImport = open;
  global.HistoryImport = { open, close, lastImport };
})(typeof window !== 'undefined' ? window : globalThis);
