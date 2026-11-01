/**
 * calendar-sync.js
 * "Add to calendar": the active program's days in the phone's calendar app.
 *
 *  - The backend serves a calendar feed (.ics) at a secret link that Apple
 *    Calendar, Google Calendar or Outlook subscribe to once and then re-check
 *    by themselves (see traininglog-backend src/routes/calendar.js).
 *  - Which session falls on which date comes from program-schedule.js, so we
 *    upload the days from two weeks ago to twelve weeks ahead. Uploads only
 *    happen when that list changed (new program, a "Do it today" swap, a new
 *    day rolling into the window), at most about once a day otherwise.
 *  - With no active program the feed is emptied, not removed, so the
 *    subscription keeps working for the next program.
 *
 * Per-user state: calendarSync_<user> = { path, hash, syncedAt }.
 */
(function (global) {
  'use strict';

  const DEFAULT_SERVER = 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
  const DAYS_BACK = 14;
  const DAYS_AHEAD = 84;
  const MAX_LIFTS = 12;

  let _sheet = null;
  let _busy = false;
  let _syncTimer = null;
  let _inflight = null;

  // ── Basics ─────────────────────────────────────────────────────────────────

  function _user() {
    return global.currentUser
      || (typeof global.getActiveUsername === 'function' && global.getActiveUsername())
      || (global.localStorage && global.localStorage.getItem('fitnessAppUser')) || '';
  }

  function _server() {
    return String(global.SERVER_URL || DEFAULT_SERVER).replace(/\/$/, '');
  }

  function _authHeaders() {
    if (typeof global.getAuthHeaders === 'function') {
      try { return global.getAuthHeaders() || {}; } catch { /* fall through */ }
    }
    const token = global.localStorage && global.localStorage.getItem('token');
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _icon(name, fallback) {
    const set = typeof ICONS !== 'undefined' ? ICONS : global.ICONS; // eslint-disable-line no-undef
    return `<span class="ui-icon">${(set && set[name]) || fallback || ''}</span>`;
  }

  function _toast(msg, type) {
    if (typeof global.showToast === 'function') global.showToast(msg, type || 'success');
    else if (typeof global.nativeToast === 'function') global.nativeToast(msg, type || 'success');
  }

  function _stateKey(user) { return 'calendarSync_' + user; }

  function readState(user) {
    const u = user || _user();
    if (!u) return null;
    try {
      const raw = global.localStorage.getItem(_stateKey(u));
      const st = raw ? JSON.parse(raw) : null;
      return st && typeof st.path === 'string' ? st : null;
    } catch {
      return null;
    }
  }

  function _writeState(user, st) {
    try {
      if (st) global.localStorage.setItem(_stateKey(user), JSON.stringify(st));
      else global.localStorage.removeItem(_stateKey(user));
    } catch { /* storage full or blocked */ }
  }

  function isEnabled(user) { return !!readState(user); }

  async function api(method, path, body) {
    const res = await fetch(_server() + '/api/calendar' + path, {
      method,
      headers: { ..._authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    if (!res.ok || !json || json.success === false) {
      const msg = (json && json.error && json.error.message) || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return json;
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  function _repsLabel(set) {
    if (!set || set.reps == null || set.reps === '') return '';
    return set.repsMax > set.reps ? `${set.reps}–${set.repsMax}` : String(set.reps);
  }

  function _liftLine(ex) {
    const sets = Array.isArray(ex.sets) ? ex.sets.length : (Number(ex.sets) || 0);
    const reps = Array.isArray(ex.sets) ? _repsLabel(ex.sets[0]) : (ex.reps ? String(ex.reps) : '');
    const scheme = sets && reps ? `${sets} × ${reps}` : sets ? `${sets} sets` : '';
    return `• ${ex.name || 'Exercise'}${scheme ? ' — ' + scheme : ''}`;
  }

  /**
   * The training days to put in the calendar for the user's active program:
   * [{ date: 'YYYY-MM-DD', title, description }]. Empty with no program.
   */
  function buildEvents(user, now) {
    const ps = global.programSchedule;
    const u = user || _user();
    const schedule = ps && u ? ps.getActiveSchedule(u) : null;
    if (!schedule) return { programName: '', events: [] };
    const programName = schedule.program.name || schedule.program.title || 'Your program';
    const start = new Date(now || Date.now());
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - DAYS_BACK);
    const events = [];
    for (let i = 0; i <= DAYS_BACK + DAYS_AHEAD; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const d = schedule.dayFor(date);
      if (!d.isTraining || !d.day) continue;
      const name = d.day.name || d.day.title || `Day ${(d.trainingIndex % schedule.nDays) + 1}`;
      const week = schedule.weekCount > 1 ? ` · Week ${d.weekNum}` : '';
      const exercises = Array.isArray(d.day.exercises) ? d.day.exercises : [];
      const lines = exercises.slice(0, MAX_LIFTS).map(_liftLine);
      if (exercises.length > MAX_LIFTS) lines.push(`+ ${exercises.length - MAX_LIFTS} more`);
      const head = [programName + (d.phase ? ` — ${d.phase}` : '')];
      events.push({
        date: d.key,
        title: `${name}${week}`,
        description: [...head, '', ...lines, '', 'Open Pocket Coach to log it.'].join('\n').slice(0, 1000),
      });
    }
    return { programName, events };
  }

  function _hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // ── Sync ───────────────────────────────────────────────────────────────────

  /** Upload the events if they changed since the last upload (or `force`). */
  async function syncNow(opts) {
    const options = opts || {};
    const user = _user();
    const st = readState(user);
    if (!user || (!st && !options.create)) return null;
    const payload = buildEvents(user);
    const hash = _hash(JSON.stringify(payload));
    if (st && !options.force && st.hash === hash) return st;
    if (_inflight) return _inflight;
    _inflight = api('PUT', '/', payload)
      .then(res => {
        const next = { path: res.path, hash, syncedAt: new Date().toISOString() };
        _writeState(user, next);
        return next;
      })
      .finally(() => { _inflight = null; });
    return _inflight;
  }

  /** Debounced background sync; quiet on failure (it retries next time). */
  function scheduleSync() {
    if (!isEnabled()) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => { syncNow().catch(() => {}); }, 1500);
  }

  function feedUrl(st) {
    const s = st || readState();
    return s ? _server() + s.path : '';
  }

  function _webcalUrl(url) { return url.replace(/^https?:\/\//, 'webcal://'); }

  function _googleUrl(url) {
    return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(_webcalUrl(url));
  }

  /** Hand the feed to the calendar app (iPhone: Calendar's subscribe prompt). */
  function openInCalendarApp() {
    const url = feedUrl();
    if (url) global.location.href = _webcalUrl(url);
  }

  async function _copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  // ── Sheet ──────────────────────────────────────────────────────────────────

  function _bodyHtml() {
    const user = _user();
    const st = readState(user);
    const { programName, events } = buildEvents(user);
    const upcoming = events.filter(e => e.date >= (global.programSchedule ? global.programSchedule.localDateKey() : '')).length;

    if (!st) {
      return `
        <p class="mx-para">Your program days show up in your phone's calendar, with the lifts for each day in the event notes. When your plan changes, the calendar updates by itself.</p>
        ${programName
          ? `<p class="mx-note">${_esc(programName)}: ${upcoming} session${upcoming === 1 ? '' : 's'} over the next 12 weeks.</p>`
          : `<p class="mx-note">You don't have a program running yet. You can add the calendar now and your next program will fill it in.</p>`}
        <button type="button" class="mx-cta" data-cal-act="create">
          <span>Add to calendar</span><span class="mx-cta-icon">${_icon('calendar')}</span>
        </button>`;
    }

    const synced = st.syncedAt ? new Date(st.syncedAt) : null;
    const syncedLabel = synced && !isNaN(synced) ? synced.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
    return `
      <p class="mx-para">${programName
        ? `${_esc(programName)} is in your calendar feed: ${upcoming} upcoming session${upcoming === 1 ? '' : 's'}.`
        : 'Calendar sync is on. Start a program and its days will appear in your calendar.'}
        Calendar apps check for changes every few hours.</p>
      <div class="cal-actions">
        <button type="button" class="mx-cta" data-cal-act="apple">
          <span>Open in Calendar</span><span class="mx-cta-icon">${_icon('calendar')}</span>
        </button>
        <button type="button" class="mx-outline mx-outline--block" data-cal-act="google">Add to Google Calendar</button>
        <button type="button" class="mx-outline mx-outline--block" data-cal-act="copy">${_icon('copy')}<span>Copy link</span></button>
      </div>
      <p class="mx-note">Already subscribed? You're set, nothing else to do.${syncedLabel ? ` Last updated ${_esc(syncedLabel)}.` : ''}</p>
      <div class="cal-footer">
        <button type="button" class="cal-textbtn" data-cal-act="reset">New link</button>
        <button type="button" class="cal-textbtn cal-textbtn--danger" data-cal-act="off">Turn off</button>
      </div>`;
  }

  function _render() {
    if (!_sheet) return;
    const body = _sheet.querySelector('.cal-sheet-body');
    if (body) body.innerHTML = _bodyHtml();
  }

  function _onKey(e) { if (e.key === 'Escape') close(); }

  function close() {
    if (_sheet) _sheet.remove();
    _sheet = null;
    document.removeEventListener('keydown', _onKey);
  }

  async function _run(btn, fn) {
    if (_busy) return;
    _busy = true;
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      _toast((err && err.message) || 'Something went wrong. Try again.', 'error');
    } finally {
      _busy = false;
      if (btn) btn.disabled = false;
      _render();
      if (typeof global.renderTodayProgramCard === 'function') global.renderTodayProgramCard();
    }
  }

  async function _act(act, btn) {
    const user = _user();
    if (act === 'create') {
      return _run(btn, async () => {
        await syncNow({ create: true, force: true });
        _toast('Calendar feed ready.');
        // Straight to the calendar app's subscribe prompt.
        openInCalendarApp();
      });
    }
    if (act === 'apple') { openInCalendarApp(); return; }
    if (act === 'google') {
      const url = feedUrl();
      if (url) global.open(_googleUrl(url), '_blank', 'noopener');
      return;
    }
    if (act === 'copy') {
      const ok = await _copy(feedUrl());
      _toast(ok ? 'Link copied. Paste it into your calendar app as a subscription.' : 'Could not copy the link.', ok ? 'success' : 'error');
      return;
    }
    if (act === 'reset') {
      const confirmed = typeof global.showConfirm === 'function'
        ? await global.showConfirm('Make a new link? Calendars subscribed to the old one stop updating, so you will need to add the calendar again.')
        : true;
      if (!confirmed) return;
      return _run(btn, async () => {
        const res = await api('POST', '/reset');
        const st = readState(user) || {};
        _writeState(user, { ...st, path: res.path, syncedAt: new Date().toISOString() });
        _toast('New link made. Add it to your calendar again.');
      });
    }
    if (act === 'off') {
      const confirmed = typeof global.showConfirm === 'function'
        ? await global.showConfirm('Turn off calendar sync? Your program days stop updating in your calendar. You can remove the subscribed calendar in your calendar app.', { danger: true })
        : true;
      if (!confirmed) return;
      return _run(btn, async () => {
        await api('DELETE', '/');
        _writeState(user, null);
        _toast('Calendar sync is off.');
        close();
      });
    }
  }

  function open() {
    close();
    const overlay = document.createElement('div');
    overlay.id = 'calendarSyncSheet';
    overlay.className = 'mx-sheet-backdrop';
    overlay.innerHTML = `
      <div class="mx-sheet cal-sheet" role="dialog" aria-modal="true" aria-labelledby="calSheetTitle">
        <div class="mx-sheet-head">
          <h3 class="pod-title mx-h3" id="calSheetTitle">Add to your calendar</h3>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-cal-close aria-label="Close">${_icon('x', '×')}</button>
        </div>
        <div class="cal-sheet-body"></div>
      </div>`;
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-cal-close]')) { close(); return; }
      const btn = e.target.closest('[data-cal-act]');
      if (btn && !btn.disabled) _act(btn.dataset.calAct, btn);
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKey);
    _sheet = overlay;
    _render();
    // Quietly refresh the server copy when someone opens the sheet.
    if (isEnabled()) syncNow().then(_render).catch(() => {});
  }

  if (typeof document !== 'undefined') {
    // Open from anywhere with data-calendar-sync.
    document.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('[data-calendar-sync]');
      if (btn) { e.preventDefault(); open(); }
    });

    // Keep the feed current: when the app comes back to the front, and
    // shortly after start-up (once login has restored the user).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleSync();
    });
    global.addEventListener('load', () => setTimeout(scheduleSync, 4000));
  }

  const exported = { open, close, isEnabled, readState, buildEvents, syncNow, scheduleSync, feedUrl };
  global.calendarSync = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
