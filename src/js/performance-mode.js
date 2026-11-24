/**
 * performance-mode.js
 * "Performance mode" — a temporary, distraction-free version of the Train
 * tab's Log sub-view for use mid-workout. It is NOT a second logger: it
 * reuses the exact same quick-log card, workout timer, rest timer banner,
 * "Session so far" and "Today's plan" pods, and simply hides everything
 * else on screen (body.performance-mode, css/performance-mode.css).
 *
 * The only new behaviour it adds on top of the normal logger:
 *   - the rest timer auto-starts after every logged set, at a length the
 *     lifter picks from the existing Rest-tab presets;
 *   - the rest timer can be paused/resumed and nudged by ±15 s;
 *   - a "Rest over!" card replaces the banner when the rest ends;
 *   - "Auto" rest fits each exercise (heavy compound 2 min, isolation
 *     75 s, ~45 s between the halves of a superset) — time-budget-core.js;
 *   - a time budget (30/45/60 min) with a pace bar and, when the session
 *     is running behind, fixes in BU's order: superset non-competing
 *     exercises, myo-reps on isolations, and only then drop accessory sets;
 *   - in a superset (planned or accepted), logging a set arms the partner.
 *
 * Rest-timer state is the same wall-clock record index.html already
 * persists under tl_rest_timer_v1 ({ endTimeMs, totalSeconds }), with one
 * optional field added for pausing: pausedRemaining (seconds).
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'tl_performance_mode_v1';
  // This session's accepted time-budget changes ({ date, changes, dismissed }).
  const BUDGET_SESSION_KEY = 'tl_time_budget_session_v1';
  const PACE_REFRESH_MS = 20000;
  const REST_TIMER_KEY = 'tl_rest_timer_v1';
  const WORKOUT_TIMER_KEY = 'tl_workout_timer_v1';
  const REST_PRESETS = [60, 90, 120, 180, 300];
  const AUTO_REST = 'auto';
  const DEFAULT_REST_SECONDS = 90;
  const URGENT_SECONDS = 10;
  const REST_OVER_VISIBLE_MS = 6000;

  // ── Pure rest-timer state helpers (unit tested) ──────────────────

  /** Whole seconds left on a rest timer record, never below 0. */
  function getRestRemaining(state, now) {
    if (!state || typeof state.totalSeconds !== 'number') return 0;
    if (typeof state.pausedRemaining === 'number') return Math.max(0, Math.round(state.pausedRemaining));
    if (typeof state.endTimeMs !== 'number') return 0;
    return Math.max(0, Math.round((state.endTimeMs - now) / 1000));
  }

  function createRestState(totalSeconds, now) {
    const secs = Math.max(1, Math.round(Number(totalSeconds) || DEFAULT_REST_SECONDS));
    return { endTimeMs: now + secs * 1000, totalSeconds: secs };
  }

  /** Paused → running (end time rebuilt from what was left); running → paused. */
  function togglePausedState(state, now) {
    if (!state) return state;
    if (typeof state.pausedRemaining === 'number') {
      const next = { ...state, endTimeMs: now + state.pausedRemaining * 1000 };
      delete next.pausedRemaining;
      return next;
    }
    return { ...state, pausedRemaining: getRestRemaining(state, now) };
  }

  /** Add/remove seconds, keeping at least 1 s left. Grows totalSeconds when
   * the new remaining time exceeds it so the ring never overflows 100%. */
  function adjustRestState(state, deltaSeconds, now) {
    if (!state) return state;
    const remaining = Math.max(1, getRestRemaining(state, now) + Math.round(Number(deltaSeconds) || 0));
    const totalSeconds = Math.max(state.totalSeconds || 0, remaining);
    if (typeof state.pausedRemaining === 'number') {
      return { ...state, pausedRemaining: remaining, totalSeconds };
    }
    return { ...state, endTimeMs: now + remaining * 1000, totalSeconds };
  }

  /**
   * A rest already running switched to a new length (a rest chip tapped mid
   * rest): the time already rested counts, so 90 s picked 30 s in leaves
   * 60 s. Paused stays paused. Never under 1 s.
   */
  function retimeRestState(state, totalSeconds, now) {
    const secs = Math.max(1, Math.round(Number(totalSeconds) || DEFAULT_REST_SECONDS));
    if (!state) return createRestState(secs, now);
    const elapsed = Math.max(0, (state.totalSeconds || 0) - getRestRemaining(state, now));
    const remaining = Math.max(1, secs - elapsed);
    if (typeof state.pausedRemaining === 'number') return { ...state, pausedRemaining: remaining, totalSeconds: secs };
    return { ...state, endTimeMs: now + remaining * 1000, totalSeconds: secs };
  }

  function isRestUrgent(remaining) {
    return remaining > 0 && remaining <= URGENT_SECONDS;
  }

  /** "Bench Press · Set 4" from the quick-log button label ("Log set 4"). */
  function formatNextUp(exercise, logButtonLabel) {
    const name = String(exercise || '').trim();
    const m = /set\s+(\d+)/i.exec(String(logButtonLabel || ''));
    if (!name) return m ? `Set ${m[1]}` : '';
    return m ? `${name} · Set ${m[1]}` : name;
  }

  /** Restore performance mode on app start only while a workout is running
   * AND a session is being restored. If the app opens on the login screen,
   * restoring would hide the bottom nav behind it and strand the lifter on
   * Home (with no nav) once they sign back in. */
  function shouldRestoreOnLoad(settings, workoutTimer, savedUser) {
    return !!(settings && settings.active && workoutTimer && workoutTimer.startTimeMs && savedUser);
  }

  function _core() {
    if (global.TimeBudgetCore) return global.TimeBudgetCore;
    try { return typeof require === 'function' ? require('./time-budget-core') : null; } catch { return null; }
  }

  /** A preset in seconds, or 'auto' (rest fits each exercise). */
  function normaliseRestSeconds(value) {
    if (value === AUTO_REST) return AUTO_REST;
    const n = Number(value);
    return REST_PRESETS.includes(n) ? n : DEFAULT_REST_SECONDS;
  }

  // ── Persistence ─────────────────────────────────────────────────

  function _read(key) {
    try { return JSON.parse(global.localStorage.getItem(key)); } catch { return null; }
  }

  function _write(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full/blocked */ }
  }

  function getSettings() {
    const s = _read(STORAGE_KEY) || {};
    const core = _core();
    return {
      active: !!s.active,
      restSeconds: normaliseRestSeconds(s.restSeconds),
      budgetMin: core ? core.normaliseBudget(s.budgetMin) : null,
    };
  }

  function _saveSettings(patch) {
    _write(STORAGE_KEY, { ...getSettings(), ...patch });
  }

  function isActive() {
    return typeof document !== 'undefined' && document.body.classList.contains('performance-mode');
  }

  // ── DOM ─────────────────────────────────────────────────────────

  function _renderRestPresets() {
    if (typeof document === 'undefined') return;
    const { restSeconds } = getSettings();
    document.querySelectorAll('#pmRestPresets [data-rest-seconds]').forEach((btn) => {
      const v = btn.dataset.restSeconds;
      const on = v === AUTO_REST ? restSeconds === AUTO_REST : Number(v) === restSeconds;
      btn.classList.toggle('active-preset', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const hint = document.getElementById('pmRestHint');
    if (hint) hint.textContent = restSeconds === AUTO_REST ? 'fits each exercise' : 'tap to start · then after each set';
  }

  function _renderDayName() {
    const el = document.getElementById('pmDayName');
    if (!el) return;
    const day = typeof global.getTodaysPlannedDay === 'function' ? global.getTodaysPlannedDay() : null;
    el.textContent = day && day.name ? ` · ${day.name}` : '';
  }

  function _todayKey() {
    // Local calendar day — workouts are keyed by it, not by UTC's date.
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Today's stored log entries (one per exercise, or one per set in old data),
   * across every workout of the day. A loaded program/template day lays its
   * sets out ahead, so only its ticked sets count as done. */
  function _todaysLog() {
    const u = global.coachLoggingClient || global.currentUser || global.localStorage.getItem('fitnessAppUser');
    const workouts = (u && _read('workouts_' + u)) || [];
    const day = Array.isArray(workouts) ? workouts.filter((w) => w && w.date === _todayKey()) : [];
    const sc = global.SetComplete;
    const view = sc && typeof sc.completedWorkouts === 'function' ? sc.completedWorkouts(day) : day;
    return view.reduce((all, w) => all.concat(Array.isArray(w.log) ? w.log : []), []);
  }

  function _todaysLoggedExercises() {
    return new Set(_todaysLog().map((e) => e.exercise));
  }

  function _plannedDay() {
    return typeof global.getTodaysPlannedDay === 'function' ? global.getTodaysPlannedDay() : null;
  }

  // ── Time budget ─────────────────────────────────────────────────

  function _budgetSession() {
    const s = _read(BUDGET_SESSION_KEY);
    if (s && s.date === _todayKey()) {
      return { date: s.date, changes: s.changes || {}, dismissed: Array.isArray(s.dismissed) ? s.dismissed : [] };
    }
    return { date: _todayKey(), changes: {}, dismissed: [] };
  }

  function _saveBudgetSession(patch) {
    _write(BUDGET_SESSION_KEY, { ..._budgetSession(), ...patch });
  }

  function _suggestionId(sg) {
    return `${sg.type}:${sg.keys ? sg.keys.join('+') : sg.key}`;
  }

  function _muscleOf(name) {
    return typeof global.getMuscleGroup === 'function' ? global.getMuscleGroup(name) : 'other';
  }

  function _elapsedMs() {
    const t = _read(WORKOUT_TIMER_KEY);
    return t && typeof t.startTimeMs === 'number' ? Math.max(0, Date.now() - t.startTimeMs) : 0;
  }

  /** Everything the budget pod shows, from storage — pure apart from reads. */
  function _budgetModel() {
    const core = _core();
    if (!core) return null;
    const day = _plannedDay();
    const hasPlan = !!(day && Array.isArray(day.exercises) && day.exercises.length);
    const session = _budgetSession();
    const done = core.countDoneSets(_todaysLog());
    const { budgetMin } = getSettings();
    const pace = core.paceStatus({ day, done, changes: session.changes, elapsedMs: _elapsedMs(), budgetMin });
    const tips = hasPlan && (pace.status === 'behind')
      ? core.suggestCuts({ day, done, changes: session.changes, overMin: pace.overMin, muscleOf: _muscleOf, limit: 6 })
        .filter((sg) => !session.dismissed.includes(_suggestionId(sg))).slice(0, 3)
      : [];
    return { core, day, hasPlan, session, done, pace, tips, budgetMin };
  }

  let _lastTips = [];

  function _esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _describeChanges(changes, day) {
    const core = _core();
    const names = {};
    ((day && day.exercises) || []).forEach((ex) => { names[core.exerciseKey(ex.name)] = ex.name; });
    const n = (k) => names[k] || k;
    const parts = [];
    (changes.pairs || []).forEach(([a, b]) => parts.push(`Superset ${n(a)} + ${n(b)}`));
    (changes.myo || []).forEach((k) => parts.push(`Myo-reps on ${n(k)}`));
    Object.keys(changes.cuts || {}).forEach((k) => {
      const c = changes.cuts[k];
      if (c > 0) parts.push(`${n(k)} −${c} set${c === 1 ? '' : 's'}`);
    });
    return parts;
  }

  function _renderBudget() {
    if (typeof document === 'undefined' || !isActive()) return;
    const card = document.getElementById('pmTimeBudget');
    if (!card) return;
    const m = _budgetModel();
    if (!m) { card.hidden = true; return; }
    card.hidden = false;

    document.querySelectorAll('#pmTimeBudget [data-budget-min]').forEach((btn) => {
      const v = btn.dataset.budgetMin;
      const on = v === '' ? m.budgetMin === null : Number(v) === m.budgetMin;
      btn.classList.toggle('active-preset', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    const paceEl = document.getElementById('pmBudgetPace');
    if (paceEl) {
      paceEl.textContent = m.hasPlan || m.budgetMin ? m.core.formatPace(m.hasPlan ? m.pace : { ...m.pace, plannedSets: 0 }) : '';
      paceEl.dataset.status = m.pace.status;
    }

    const bar = document.getElementById('pmBudgetBar');
    const fill = document.getElementById('pmBudgetBarFill');
    if (bar && fill) {
      bar.hidden = !m.budgetMin;
      if (m.budgetMin) {
        fill.style.width = `${Math.min(100, Math.round((m.pace.elapsedMin / m.budgetMin) * 100))}%`;
        bar.dataset.status = m.pace.status;
      }
    }

    _lastTips = m.tips;
    const list = document.getElementById('pmBudgetTips');
    if (list) {
      list.hidden = !m.tips.length;
      list.innerHTML = m.tips.map((sg, i) => `
        <li class="pm-budget-tip">
          <span class="pm-budget-tip-text">${_esc(sg.text)}<small>saves ~${sg.savesMin} min</small></span>
          <button type="button" class="pm-budget-tip-do" onclick="applyPerformanceBudgetTip(${i})">Do it</button>
          <button type="button" class="pm-budget-tip-x" onclick="dismissPerformanceBudgetTip(${i})" aria-label="Dismiss">×</button>
        </li>`).join('') + (m.tips.length ? '<li class="pm-budget-tip-note">Heavy top sets and your warm-up ramp stay as planned.</li>' : '');
    }

    const applied = document.getElementById('pmBudgetApplied');
    if (applied) {
      const parts = m.hasPlan ? _describeChanges(m.session.changes, m.day) : [];
      const myoTip = (m.session.changes.myo || []).length
        ? ' Myo-reps: one set near failure, then mini-sets of 3–5 reps with ~15–20 s rest until reps drop.' : '';
      applied.hidden = !parts.length;
      applied.textContent = parts.length ? `Today: ${parts.join(' · ')}.${myoTip}` : '';
    }
  }

  let _paceTimer = null;
  function _startPaceRefresh() {
    clearInterval(_paceTimer);
    _paceTimer = setInterval(_renderBudget, PACE_REFRESH_MS);
  }
  function _stopPaceRefresh() {
    clearInterval(_paceTimer);
    _paceTimer = null;
  }

  function setPerformanceBudget(minutes) {
    const core = _core();
    const budgetMin = core ? core.normaliseBudget(minutes) : null;
    // A budget is a reason to let rest fit each exercise.
    const patch = { budgetMin };
    if (budgetMin && getSettings().restSeconds !== AUTO_REST) patch.restSeconds = AUTO_REST;
    _saveSettings(patch);
    _renderRestPresets();
    _renderBudget();
  }

  function applyPerformanceBudgetTip(index) {
    const core = _core();
    const sg = _lastTips[index];
    if (!core || !sg) return;
    _saveBudgetSession({ changes: core.applySuggestion(_budgetSession().changes, sg) });
    _renderBudget();
  }

  function dismissPerformanceBudgetTip(index) {
    const sg = _lastTips[index];
    if (!sg) return;
    const s = _budgetSession();
    _saveBudgetSession({ dismissed: [...s.dismissed, _suggestionId(sg)] });
    _renderBudget();
  }

  /** Rest after a set of `exercise`: the lifter's preset, or Auto. */
  function _restSecondsAfter(exercise) {
    const { restSeconds } = getSettings();
    if (restSeconds !== AUTO_REST) return restSeconds;
    const core = _core();
    if (!core) return DEFAULT_REST_SECONDS;
    return core.restSecondsFor(exercise, _plannedDay(), core.countDoneSets(_todaysLog()), _budgetSession().changes);
  }

  /** In a superset, arm the partner with its next planned set. */
  function _armPartnerAfter(exercise) {
    const core = _core();
    if (!core || !exercise || typeof global.startQuickLogFor !== 'function') return;
    const day = _plannedDay();
    const done = core.countDoneSets(_todaysLog());
    const next = core.nextInPair(exercise, day, done, _budgetSession().changes);
    if (!next) return;
    const ex = (day.exercises || []).find((e) => core.exerciseKey(e.name) === core.exerciseKey(next));
    const sets = (ex && Array.isArray(ex.sets)) ? ex.sets.filter((st) => !st || st.setType !== 'warmup') : [];
    const planned = sets[Math.min(done[core.exerciseKey(next)] || 0, Math.max(0, sets.length - 1))] || {};
    global.startQuickLogFor(ex ? ex.name : next, {
      weight: planned.weight != null && Number(planned.weight) > 0 ? Number(planned.weight) : null,
      reps: planned.reps != null && Number(planned.reps) > 0 ? Number(planned.reps) : null,
    });
  }

  /** Arm the quick-log card with the first planned exercise not yet
   * logged today — only when the lifter hasn't already picked one. */
  function _armFirstExercise() {
    const exerciseEl = document.getElementById('exercise');
    if (!exerciseEl || exerciseEl.value.trim()) return;
    const day = typeof global.getTodaysPlannedDay === 'function' ? global.getTodaysPlannedDay() : null;
    const exercises = (day && Array.isArray(day.exercises)) ? day.exercises : [];
    if (!exercises.length || typeof global.startQuickLogFor !== 'function') return;
    const done = _todaysLoggedExercises();
    const ex = exercises.find((e) => !done.has(e.name)) || exercises[0];
    const first = (ex.sets && ex.sets[0]) || {};
    global.startQuickLogFor(ex.name, {
      weight: first.weight != null ? Number(first.weight) : null,
      reps: first.reps != null ? Number(first.reps) : null,
    });
  }

  let _wakeLock = null;
  function _requestWakeLock() {
    const nav = global.navigator;
    if (!nav || !nav.wakeLock || typeof nav.wakeLock.request !== 'function') return;
    nav.wakeLock.request('screen').then((lock) => { _wakeLock = lock; }).catch(() => { /* denied / unsupported */ });
  }
  function _releaseWakeLock() {
    if (_wakeLock && typeof _wakeLock.release === 'function') _wakeLock.release().catch(() => {});
    _wakeLock = null;
  }

  function _rerunRestTimer() {
    if (typeof global.resumeRestTimer === 'function') global.resumeRestTimer();
  }

  // ── Public actions ──────────────────────────────────────────────

  function startPerformanceMode(opts = {}) {
    if (typeof document === 'undefined') return;
    _saveSettings({ active: true });
    document.body.classList.add('performance-mode');

    if (typeof global.showTab === 'function') global.showTab('logTab');
    const logSubtab = document.querySelector('#logSubtabNav [data-log-subtab="log"]');
    if (logSubtab && !logSubtab.classList.contains('active')) logSubtab.click();

    if (!opts.restore) {
      if (typeof global.startWorkoutTimer === 'function') {
        try { global.startWorkoutTimer(); } catch (err) { console.warn('Unable to start workout timer', err); }
      }
      if (typeof global.enterWorkoutFocusMode === 'function') global.enterWorkoutFocusMode();
      _armFirstExercise();
      if (typeof global.scrollTo === 'function') global.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // A new session starts with a clean slate of budget changes.
    if (!opts.restore) _write(BUDGET_SESSION_KEY, { date: _todayKey(), changes: {}, dismissed: [] });

    _renderDayName();
    _renderRestPresets();
    _renderBudget();
    _startPaceRefresh();
    _requestWakeLock();
  }

  function exitPerformanceMode() {
    if (typeof document === 'undefined') return;
    _saveSettings({ active: false });
    document.body.classList.remove('performance-mode');
    hideRestOverCard();
    _stopPaceRefresh();
    _releaseWakeLock();
  }

  /**
   * A rest chip: the rest length after each logged set from now on. A fixed
   * length also takes effect now: a rest already running switches to it,
   * otherwise a rest of that length starts (resting by hand, e.g. after a
   * set that wasn't logged). Auto only changes the setting.
   */
  function setPerformanceRestSeconds(seconds) {
    const restSeconds = normaliseRestSeconds(seconds);
    _saveSettings({ restSeconds });
    _renderRestPresets();
    if (restSeconds === AUTO_REST || !isActive()) return;
    const now = Date.now();
    const state = _read(REST_TIMER_KEY);
    const running = state && getRestRemaining(state, now) > 0;
    hideRestOverCard();
    _setNextUpText();
    _write(REST_TIMER_KEY, running ? retimeRestState(state, restSeconds, now) : createRestState(restSeconds, now));
    _rerunRestTimer();
  }

  function toggleRestTimerPause() {
    const state = _read(REST_TIMER_KEY);
    if (!state) return;
    _write(REST_TIMER_KEY, togglePausedState(state, Date.now()));
    _rerunRestTimer();
  }

  function adjustRestTimer(deltaSeconds) {
    const state = _read(REST_TIMER_KEY);
    if (!state) return;
    _write(REST_TIMER_KEY, adjustRestState(state, deltaSeconds, Date.now()));
    _rerunRestTimer();
  }

  let _restOverTimeout = null;
  function hideRestOverCard() {
    clearTimeout(_restOverTimeout);
    const card = typeof document !== 'undefined' && document.getElementById('restOverCard');
    if (card) card.hidden = true;
  }

  function _currentNextUp() {
    const exercise = document.getElementById('exercise');
    const label = document.getElementById('qlLogBtnLabel');
    return formatNextUp(exercise && exercise.value, label && label.textContent);
  }

  function _setNextUpText() {
    const text = _currentNextUp();
    ['restBannerNext', 'restOverNext'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  }

  /** addLogEntry() fires tl:set-logged once a set is saved. Wait a tick so
   * quickLogSet() has re-armed the card ("Log set N+1") before reading it. */
  function _onSetLogged(e) {
    if (!isActive()) return;
    const exercise = (e && e.detail && e.detail.exercise) || '';
    setTimeout(() => {
      hideRestOverCard();
      _armPartnerAfter(exercise);
      _setNextUpText();
      _write(REST_TIMER_KEY, createRestState(_restSecondsAfter(exercise), Date.now()));
      _rerunRestTimer();
      _renderBudget();
    }, 0);
  }

  function _onRestFinished() {
    if (!isActive()) return;
    const card = document.getElementById('restOverCard');
    if (!card) return;
    _setNextUpText();
    card.hidden = false;
    clearTimeout(_restOverTimeout);
    _restOverTimeout = setTimeout(hideRestOverCard, REST_OVER_VISIBLE_MS);
    const nav = global.navigator;
    if (nav && typeof nav.vibrate === 'function') nav.vibrate([200, 100, 200]);
  }

  function _init() {
    document.addEventListener('tl:set-logged', _onSetLogged);
    document.addEventListener('tl:rest-finished', _onRestFinished);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && isActive()) _requestWakeLock();
    });

    // Restoring after a reload is NOT done here: index.html calls
    // restorePerformanceModeIfNeeded() once the session restore / login has
    // finished navigating, otherwise that navigation (to Home) lands on top
    // of performance mode and leaves the lifter with no bottom nav.
    _renderRestPresets();
  }

  /** Survive a reload mid-workout — but only while a workout is actually
   * running and the user is signed in, so a stale flag never traps the
   * lifter in the stripped view. Call after the app has navigated to its
   * start tab. */
  function restorePerformanceModeIfNeeded() {
    if (typeof document === 'undefined') return;
    const settings = getSettings();
    if (!settings.active) return;
    const ls = global.localStorage;
    const savedUser = ls.getItem('fitnessAppUser') || ls.getItem('username') || ls.getItem('Username');
    // On the login screen: keep the flag so the post-login call restores it
    if (!savedUser) return;
    if (shouldRestoreOnLoad(settings, _read(WORKOUT_TIMER_KEY), savedUser)) startPerformanceMode({ restore: true });
    else _saveSettings({ active: false });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
    else _init();
  }

  const api = {
    REST_PRESETS, DEFAULT_REST_SECONDS, URGENT_SECONDS, AUTO_REST,
    getRestRemaining, createRestState, retimeRestState, togglePausedState, adjustRestState, isRestUrgent,
    formatNextUp, normaliseRestSeconds, shouldRestoreOnLoad, getSettings,
    startPerformanceMode, exitPerformanceMode, restorePerformanceModeIfNeeded, setPerformanceRestSeconds,
    toggleRestTimerPause, adjustRestTimer, hideRestOverCard,
    setPerformanceBudget, applyPerformanceBudgetTip, dismissPerformanceBudgetTip,
  };
  global.PerformanceMode = api;
  global.startPerformanceMode = startPerformanceMode;
  global.exitPerformanceMode = exitPerformanceMode;
  global.restorePerformanceModeIfNeeded = restorePerformanceModeIfNeeded;
  global.setPerformanceRestSeconds = setPerformanceRestSeconds;
  global.toggleRestTimerPause = toggleRestTimerPause;
  global.adjustRestTimer = adjustRestTimer;
  global.hideRestOverCard = hideRestOverCard;
  global.setPerformanceBudget = setPerformanceBudget;
  global.applyPerformanceBudgetTip = applyPerformanceBudgetTip;
  global.dismissPerformanceBudgetTip = dismissPerformanceBudgetTip;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
