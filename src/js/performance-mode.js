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
 *   - a "Rest over!" card replaces the banner when the rest ends.
 *
 * Rest-timer state is the same wall-clock record index.html already
 * persists under tl_rest_timer_v1 ({ endTimeMs, totalSeconds }), with one
 * optional field added for pausing: pausedRemaining (seconds).
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'tl_performance_mode_v1';
  const REST_TIMER_KEY = 'tl_rest_timer_v1';
  const WORKOUT_TIMER_KEY = 'tl_workout_timer_v1';
  const REST_PRESETS = [60, 90, 120, 180, 300];
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

  function normaliseRestSeconds(value) {
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
    return { active: !!s.active, restSeconds: normaliseRestSeconds(s.restSeconds) };
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
      const on = Number(btn.dataset.restSeconds) === restSeconds;
      btn.classList.toggle('active-preset', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function _renderDayName() {
    const el = document.getElementById('pmDayName');
    if (!el) return;
    const day = typeof global.getTodaysPlannedDay === 'function' ? global.getTodaysPlannedDay() : null;
    el.textContent = day && day.name ? ` · ${day.name}` : '';
  }

  function _todaysLoggedExercises() {
    const u = global.coachLoggingClient || global.currentUser || global.localStorage.getItem('fitnessAppUser');
    const todayStr = new Date().toISOString().slice(0, 10);
    const workouts = (u && _read('workouts_' + u)) || [];
    const today = Array.isArray(workouts) ? workouts.find((w) => w.date === todayStr) : null;
    return new Set(((today && today.log) || []).map((e) => e.exercise));
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

    _renderDayName();
    _renderRestPresets();
    _requestWakeLock();
  }

  function exitPerformanceMode() {
    if (typeof document === 'undefined') return;
    _saveSettings({ active: false });
    document.body.classList.remove('performance-mode');
    hideRestOverCard();
    _releaseWakeLock();
  }

  function setPerformanceRestSeconds(seconds) {
    _saveSettings({ restSeconds: normaliseRestSeconds(seconds) });
    _renderRestPresets();
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
  function _onSetLogged() {
    if (!isActive()) return;
    setTimeout(() => {
      hideRestOverCard();
      _setNextUpText();
      _write(REST_TIMER_KEY, createRestState(getSettings().restSeconds, Date.now()));
      _rerunRestTimer();
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
    REST_PRESETS, DEFAULT_REST_SECONDS, URGENT_SECONDS,
    getRestRemaining, createRestState, togglePausedState, adjustRestState, isRestUrgent,
    formatNextUp, normaliseRestSeconds, shouldRestoreOnLoad, getSettings,
    startPerformanceMode, exitPerformanceMode, restorePerformanceModeIfNeeded, setPerformanceRestSeconds,
    toggleRestTimerPause, adjustRestTimer, hideRestOverCard,
  };
  global.PerformanceMode = api;
  global.startPerformanceMode = startPerformanceMode;
  global.exitPerformanceMode = exitPerformanceMode;
  global.restorePerformanceModeIfNeeded = restorePerformanceModeIfNeeded;
  global.setPerformanceRestSeconds = setPerformanceRestSeconds;
  global.toggleRestTimerPause = toggleRestTimerPause;
  global.adjustRestTimer = adjustRestTimer;
  global.hideRestOverCard = hideRestOverCard;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
