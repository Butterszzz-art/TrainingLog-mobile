/**
 * calendar-sync.js
 * "Add to calendar": the user's plan in the phone's calendar app.
 *
 *  - The backend serves a calendar feed (.ics) at a secret link that Apple
 *    Calendar, Google Calendar or Outlook subscribe to once and then re-check
 *    by themselves (see traininglog-backend src/routes/calendar.js).
 *  - Three kinds of events, each can be switched off in the sheet:
 *      training  program days (program-schedule.js), all-day, two weeks back
 *                to twelve weeks ahead.
 *      meals     the coach's meal plan (coach-meals.js) at the coach's meal
 *                times, else the user's own planned meal times (Food → Your
 *                meals); timed, four weeks ahead. With no coach plan only the
 *                planned times show.
 *      checkins  when check-ins are due: every N days per the coach's
 *                check-in settings, counted from the last check-in; without a
 *                coach, weekly on the chosen check-in day once the user has
 *                checked in in the last six weeks. All-day, twelve weeks ahead.
 *  - Uploads only happen when the events changed, at most about once a day
 *    otherwise. With nothing to show the feed is emptied, not removed, so the
 *    subscription keeps working.
 *  - The on/off state lives in localStorage, which iOS can clear; when it's
 *    missing we ask the server once per session so a feed the user already
 *    subscribed to keeps updating.
 *
 * Per-user state: calendarSync_<user> = { path, hash, syncedAt, include? }.
 */
(function (global) {
  'use strict';

  const DEFAULT_SERVER = 'https://us-central1-pocketcoach-280c4.cloudfunctions.net/api';
  const DAYS_BACK = 14;
  const DAYS_AHEAD = 84;
  const MEAL_DAYS_AHEAD = 28;
  const MEAL_MINUTES = 30;
  const CHECKIN_RECENT_DAYS = 42;
  const MAX_LIFTS = 12;
  const MAX_EVENTS = 400;
  const KINDS = ['training', 'meals', 'checkins'];
  const COACH_SLOTS = ['breakfast', 'lunch', 'dinner', 'snacks'];
  const SLOT_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };
  const OWN_SLOTS = ['breakfast', 'lunch', 'dinner', 'snacks', 'meal5', 'meal6'];
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  let _sheet = null;
  let _busy = false;
  let _syncTimer = null;
  let _inflight = null;
  let _restoreTried = '';
  let _pendingInclude = {}; // choices made in the sheet before the feed exists

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

  /** Which kinds go in the feed: { training, meals, checkins } (all on by default). */
  function readInclude(user) {
    const st = readState(user);
    const inc = (st && st.include) || (st ? {} : _pendingInclude);
    const out = {};
    KINDS.forEach(k => { out[k] = inc[k] !== false; });
    return out;
  }

  function _readJSON(key, fallback) {
    try {
      const raw = global.localStorage.getItem(key);
      const v = raw ? JSON.parse(raw) : null;
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function _timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
  }

  function _dateKey(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function _parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  function _addDays(d, n) {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  }

  function _validTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return '';
    return `${m[1].padStart(2, '0')}:${m[2]}`;
  }

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

  /** Program days: [{ date, title, description }] and the program's name. */
  function trainingEvents(user, now) {
    const ps = global.programSchedule;
    const schedule = ps && user ? ps.getActiveSchedule(user) : null;
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

  function _mealTotals(meal) {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    (meal && Array.isArray(meal.items) ? meal.items : []).forEach(it => {
      const per = (it && it.food && it.food.per100) || {};
      Object.keys(t).forEach(k => { t[k] += ((Number(per[k]) || 0) * (Number(it.grams) || 0)) / 100; });
    });
    return t;
  }

  function _mealDescription(meal, alternatives, note) {
    const items = (meal.items || []).slice(0, 15).map(it => `• ${(it.food && it.food.name) || 'Food'} — ${Math.round(Number(it.grams) || 0)} g`);
    const t = _mealTotals(meal);
    const lines = [...items];
    if (t.kcal) lines.push('', `${Math.round(t.kcal)} kcal · P ${Math.round(t.protein)} g · C ${Math.round(t.carbs)} g · F ${Math.round(t.fat)} g`);
    if (meal.note) lines.push('', meal.note);
    if (alternatives.length) lines.push('', `Or: ${alternatives.join(', ')}`);
    if (note) lines.push('', `From your coach: ${note}`);
    lines.push('', 'Open Pocket Coach to confirm it.');
    return lines.join('\n').slice(0, 1000);
  }

  /** Training or rest day for the coach's meal plan, as coach-meals.js decides. */
  function _dayType(user, iso) {
    const CM = global.CoachMeals;
    if (!CM || typeof CM.dayTypeFor !== 'function') return 'training';
    const nutrition = typeof global.getAssignedNutritionPlan === 'function' ? (global.getAssignedNutritionPlan(user) || {}) : {};
    return CM.dayTypeFor(iso, { plan: _readJSON(`coachPlan_${user}`, null), macroSchedule: nutrition.schedule || null });
  }

  /**
   * Meals with a time: the coach's meal plan at the coach's times (else the
   * user's planned time for that slot), or with no coach plan the user's own
   * planned meal times.
   */
  function mealEvents(user, now) {
    const setup = _readJSON(`mealSetup_${user}`, {}) || {};
    const ownTimes = setup.times && typeof setup.times === 'object' ? setup.times : {};
    const names = setup.names && typeof setup.names === 'object' ? setup.names : {};
    const plan = _readJSON(`coachMealPlan_${user}`, null);
    const coachTimes = (plan && plan.times && typeof plan.times === 'object') ? plan.times : {};
    const today = new Date(now || Date.now());
    today.setHours(0, 0, 0, 0);
    const events = [];
    for (let i = 0; i < MEAL_DAYS_AHEAD; i++) {
      const date = _dateKey(_addDays(today, i));
      if (plan && plan.days) {
        const dayType = _dayType(user, date);
        const day = plan.days[dayType] || plan.days.training || {};
        COACH_SLOTS.forEach(slot => {
          const options = Array.isArray(day[slot]) ? day[slot] : [];
          const meal = options[0];
          const time = _validTime(coachTimes[slot]) || _validTime(ownTimes[slot]);
          if (!meal || !time) return;
          const label = (typeof names[slot] === 'string' && names[slot].trim()) || SLOT_LABELS[slot];
          events.push({
            date, kind: 'meal', key: slot, time, minutes: MEAL_MINUTES,
            title: `${label} · ${meal.name || 'Meal'}`,
            description: _mealDescription(meal, options.slice(1).map(m => m && m.name).filter(Boolean), plan.note),
          });
        });
      } else {
        const count = Math.max(1, Math.min(OWN_SLOTS.length, Number(setup.count) || 3));
        OWN_SLOTS.slice(0, count).forEach((slot, n) => {
          const time = _validTime(ownTimes[slot]);
          if (!time) return;
          const label = (typeof names[slot] === 'string' && names[slot].trim()) || `Meal ${n + 1}`;
          events.push({ date, kind: 'meal', key: slot, time, minutes: MEAL_MINUTES, title: label, description: 'Planned meal. Open Pocket Coach to log it.' });
        });
      }
    }
    return events;
  }

  /** The user's check-in dates, newest first. */
  function _checkInDates(user) {
    let list = [];
    const ce = global.checkinEngine;
    try { list = ce && typeof ce.loadCheckIns === 'function' ? ce.loadCheckIns(user) : []; } catch { list = []; }
    return (Array.isArray(list) ? list : []).map(c => c && String(c.date || '').slice(0, 10)).filter(d => _parseDate(d)).sort().reverse();
  }

  function _ownCheckInDay(user) {
    let st = null;
    try {
      const api = global.prepModeApi;
      st = api && typeof api.getCurrentPhaseState === 'function' ? api.getCurrentPhaseState(user) : null;
    } catch { st = null; }
    const name = String((st && st.checkInDay) || 'Sunday').trim().toLowerCase();
    const i = WEEKDAYS.indexOf(name);
    return i >= 0 ? i : 0;
  }

  /** When check-ins are due, from today to twelve weeks ahead. */
  function checkInEvents(user, now) {
    const today = new Date(now || Date.now());
    today.setHours(0, 0, 0, 0);
    const end = _addDays(today, DAYS_AHEAD);
    const dates = _checkInDates(user);
    const last = dates.length ? _parseDate(dates[0]) : null;
    const coachEvery = Number(global.localStorage.getItem(`coachCheckInEvery_${user}`));
    const coached = Number.isInteger(coachEvery) && coachEvery >= 1 && coachEvery <= 28;
    let every;
    let next;
    if (coached) {
      every = coachEvery;
      next = last ? _addDays(last, every) : new Date(today);
      if (next < today) next = new Date(today); // overdue: due today
    } else {
      // Only for people who actually do check-ins.
      if (!last || (today - last) / 86400000 > CHECKIN_RECENT_DAYS) return [];
      every = 7;
      const dow = _ownCheckInDay(user);
      next = _addDays(today, (dow - today.getDay() + 7) % 7);
      if (dates[0] === _dateKey(next)) next = _addDays(next, 7); // already done today
    }
    const description = coached
      ? `Your coach expects a check-in ${every === 1 ? 'every day' : every === 7 ? 'every week' : `every ${every} days`}. Open Pocket Coach to send it.`
      : 'Your weekly check-in. Open Pocket Coach to fill it in.';
    const events = [];
    for (let d = next; d <= end && events.length < 90; d = _addDays(d, every)) {
      events.push({ date: _dateKey(d), kind: 'checkin', title: coached ? 'Check-in for your coach' : 'Weekly check-in', description });
    }
    return events;
  }

  /**
   * Everything that goes in the feed: { programName, timeZone, events }.
   * `include` picks the kinds (default: the user's choice in the sheet).
   */
  function buildEvents(user, now, include) {
    const u = user || _user();
    if (!u) return { programName: '', timeZone: _timeZone(), events: [] };
    const inc = include || readInclude(u);
    const training = trainingEvents(u, now);
    const events = [];
    if (inc.training) events.push(...training.events);
    if (inc.checkins) events.push(...checkInEvents(u, now));
    if (inc.meals) events.push(...mealEvents(u, now));
    return { programName: training.programName, timeZone: _timeZone(), events: events.slice(0, MAX_EVENTS) };
  }

  /** Counts per kind, upcoming only (for the sheet). */
  function _upcoming(events, now) {
    const today = _dateKey(new Date(now || Date.now()));
    const out = { training: 0, meals: 0, checkins: 0 };
    events.forEach(e => {
      if (e.date < today) return;
      if (e.kind === 'meal') out.meals++;
      else if (e.kind === 'checkin') out.checkins++;
      else out.training++;
    });
    return out;
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
    const include = (st && st.include) || (!st && options.create ? readInclude(user) : null);
    if (st && !options.force && st.hash === hash) return st;
    if (_inflight) return _inflight;
    _inflight = api('PUT', '/', payload)
      .then(res => {
        const next = { path: res.path, hash, syncedAt: new Date().toISOString(), ...(include ? { include } : {}) };
        _writeState(user, next);
        return next;
      })
      .finally(() => { _inflight = null; });
    return _inflight;
  }

  /**
   * No local state but the server has a feed (reinstall, cleared storage, a
   * new phone): take it back so the subscribed calendar keeps updating.
   * Asks at most once per user per session.
   */
  async function restore() {
    const user = _user();
    if (!user || readState(user) || _restoreTried === user) return readState(user);
    const auth = _authHeaders();
    if (!auth || !auth.Authorization) return null;
    _restoreTried = user;
    const res = await api('GET', '/');
    if (res && res.enabled && typeof res.path === 'string' && _user() === user && !readState(user)) {
      _writeState(user, { path: res.path, hash: '', syncedAt: '' });
    }
    return readState(user);
  }

  /** Debounced background sync; quiet on failure (it retries next time). */
  function scheduleSync() {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => {
      const run = isEnabled() ? Promise.resolve(true) : restore().then(st => !!st);
      run.then(on => (on ? syncNow() : null)).then(refreshStatus).catch(() => {});
    }, 1500);
  }

  /** Switch one kind of event on or off and re-upload. */
  async function setInclude(kind, on) {
    const user = _user();
    const st = readState(user);
    if (!KINDS.includes(kind)) return null;
    if (!st) { _pendingInclude = { ...readInclude(user), [kind]: !!on }; return null; }
    _writeState(user, { ...st, include: { ...readInclude(user), [kind]: !!on } });
    return syncNow({ force: true });
  }

  function feedUrl(st) {
    const s = st || readState();
    return s ? _server() + s.path : '';
  }

  function _webcalUrl(url) { return url.replace(/^https?:\/\//, 'webcal://'); }

  function _googleUrl(url) {
    return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(_webcalUrl(url));
  }

  /** Android has no app for webcal:// links, so it goes to Google Calendar. */
  function _isAndroid() {
    const cap = global.Capacitor;
    if (cap && typeof cap.getPlatform === 'function') {
      try { if (cap.getPlatform() === 'android') return true; } catch { /* fall through */ }
    }
    return /Android/i.test((global.navigator && global.navigator.userAgent) || '');
  }

  function _openExternal(url) {
    const w = global.open(url, '_blank', 'noopener');
    if (!w) global.location.href = url;
  }

  /** Hand the feed to the calendar app (iPhone: Calendar's subscribe prompt). */
  function openInCalendarApp() {
    const url = feedUrl();
    if (!url) return;
    if (_isAndroid()) _openExternal(_googleUrl(url));
    else global.location.href = _webcalUrl(url);
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

  function _summary(c) {
    const parts = [];
    if (c.training) parts.push(`${c.training} session${c.training === 1 ? '' : 's'}`);
    if (c.meals) parts.push(`${c.meals} meal${c.meals === 1 ? '' : 's'}`);
    if (c.checkins) parts.push(`${c.checkins} check-in${c.checkins === 1 ? '' : 's'}`);
    return parts.join(', ');
  }

  function _toggleRow(kind, label, sub, on) {
    return `<label class="cal-toggle">
        <span class="cal-toggle-text"><span class="cal-toggle-label">${_esc(label)}</span><span class="cal-toggle-sub">${_esc(sub)}</span></span>
        <input type="checkbox" data-cal-include="${kind}"${on ? ' checked' : ''}>
      </label>`;
  }

  function _bodyHtml() {
    const user = _user();
    const st = readState(user);
    const all = { training: true, meals: true, checkins: true };
    const { programName, events } = buildEvents(user, null, all);
    const avail = _upcoming(events);
    const inc = readInclude(user);
    const coachPlan = !!_readJSON(`coachMealPlan_${user}`, null);
    const coachEvery = Number(global.localStorage.getItem(`coachCheckInEvery_${user}`)) || 0;

    const toggles = `<div class="cal-toggles">
        ${_toggleRow('training', 'Training', programName
          ? `${programName}: ${avail.training} upcoming session${avail.training === 1 ? '' : 's'}`
          : 'Start a program and its days show up here.', inc.training)}
        ${_toggleRow('meals', 'Meals', avail.meals
          ? `${coachPlan ? "Your coach's meal plan" : 'Your planned meal times'}, next 4 weeks`
          : coachPlan
            ? "Your coach hasn't set meal times yet. You can set them under Food → Your meals."
            : 'Set meal times under Food → Your meals.', inc.meals)}
        ${_toggleRow('checkins', 'Check-ins', avail.checkins
          ? (coachEvery ? `Due ${coachEvery === 1 ? 'every day' : coachEvery === 7 ? 'every week' : `every ${coachEvery} days`}, as your coach set` : 'Weekly, on your check-in day')
          : 'Shows once you have a coach or check in weekly.', inc.checkins)}
      </div>`;

    if (!st) {
      const summary = _summary({
        training: inc.training ? avail.training : 0,
        meals: inc.meals ? avail.meals : 0,
        checkins: inc.checkins ? avail.checkins : 0,
      });
      return `
        <p class="mx-para">Your training days, your coach's meal times and your check-ins show up in your phone's calendar. When your plan changes, the calendar updates by itself.</p>
        ${toggles}
        <p class="mx-note">${summary
          ? `Coming up: ${_esc(summary)}.`
          : "Nothing planned yet. You can add the calendar now and it fills in as your plan does."}</p>
        <button type="button" class="mx-cta" data-cal-act="create">
          <span>Add to calendar</span><span class="mx-cta-icon">${_icon('calendar')}</span>
        </button>`;
    }

    const synced = st.syncedAt ? new Date(st.syncedAt) : null;
    const syncedLabel = synced && !isNaN(synced) ? synced.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
    const android = _isAndroid();
    return `
      <p class="mx-para">Calendar sync is on. Choose what shows in your calendar; apps check for changes every few hours.</p>
      ${toggles}
      <div class="cal-actions">
        <button type="button" class="mx-cta" data-cal-act="apple">
          <span>${android ? 'Add to Google Calendar' : 'Open in Calendar'}</span><span class="mx-cta-icon">${_icon('calendar')}</span>
        </button>
        ${android ? '' : '<button type="button" class="mx-outline mx-outline--block" data-cal-act="google">Add to Google Calendar</button>'}
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

  /** "On" / "Off" wherever the app shows it (Settings → Calendar & devices). */
  function refreshStatus() {
    if (typeof document === 'undefined') return;
    const on = isEnabled();
    document.querySelectorAll('[data-calendar-status]').forEach(el => { el.textContent = on ? 'On' : 'Off'; });
  }

  function close() {
    refreshStatus();
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
      refreshStatus();
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
      if (url) _openExternal(_googleUrl(url));
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
    overlay.addEventListener('change', e => {
      const box = e.target.closest && e.target.closest('[data-cal-include]');
      if (!box) return;
      _run(null, async () => {
        const synced = await setInclude(box.dataset.calInclude, box.checked);
        if (synced) _toast('Calendar updated.');
      });
    });
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-cal-close]')) { close(); return; }
      const btn = e.target.closest('[data-cal-act]');
      if (btn && !btn.disabled) _act(btn.dataset.calAct, btn);
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKey);
    _sheet = overlay;
    _render();
    // Quietly refresh the server copy when someone opens the sheet (and pick
    // up a feed this phone forgot about).
    (isEnabled() ? Promise.resolve(true) : restore().then(st => !!st))
      .then(on => (on ? syncNow() : null))
      .then(() => { _render(); refreshStatus(); })
      .catch(() => {});
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
    // A new meal plan, meal times or check-in frequency from the coach.
    document.addEventListener('pc:coach-sharing-changed', scheduleSync);
  }

  const exported = {
    open, close, refreshStatus, isEnabled, readState, readInclude, setInclude, restore,
    buildEvents, trainingEvents, mealEvents, checkInEvents,
    syncNow, scheduleSync, feedUrl,
  };
  global.calendarSync = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
