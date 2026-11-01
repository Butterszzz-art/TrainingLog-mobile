/* =============================================================
   LIVE ACTIVITY (iOS)
   Mirrors the workout in progress onto the Lock Screen and Dynamic
   Island: workout time, the last exercise, sets so far, and the rest
   countdown while resting.

   It reads the state the app already keeps, so no timer code calls it:
   - tl_workout_timer_v1 (workoutTimer.js): a workout is running
   - tl_rest_timer_v1 (index.html rest timer, performance-mode.js pause)
   - today's workouts_<user> log: exercise and set counts
   and pushes it to the native WorkoutActivity plugin
   (plugins/workout-activity) only when something changed. iOS draws
   the clocks itself, so nothing needs to run while the app is suspended.

   Everything is a no-op outside the iOS app.
   ============================================================= */
(function (global) {
  'use strict';

  const WORKOUT_TIMER_KEY = 'tl_workout_timer_v1';
  const REST_TIMER_KEY = 'tl_rest_timer_v1';
  const POLL_MS = 2000;
  const PLUGIN = 'WorkoutActivity';

  function _readJSON(storage, key) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function _setsLogged(entry) {
    const sets = Number(entry && entry.sets) || 0;
    const skipped = Array.isArray(entry && entry.skippedArray)
      ? entry.skippedArray.filter(Boolean).length
      : 0;
    return Math.max(0, sets - skipped);
  }

  function _title(workout) {
    const t = workout && (workout.title || workout.name);
    // Untitled sessions are stored as "Workout on 2026-11-01".
    if (!t || /^Workout on \d{4}-\d{2}-\d{2}$/.test(t)) return 'Workout';
    return String(t);
  }

  /**
   * What the Live Activity should show, or null when no workout is running.
   * Pure: timer / rest are the stored objects, workout is today's session.
   * Never includes the current time, so the result only changes when the
   * workout does (callers compare it to skip redundant native calls).
   */
  function buildActivityState({ timer, rest, workout }) {
    if (!timer || typeof timer.startTimeMs !== 'number') return null;

    const log = Array.isArray(workout && workout.log) ? workout.log.filter(Boolean) : [];
    const last = log.length ? log[log.length - 1] : null;
    const names = new Set(log.map(e => String(e.exercise || '').trim().toLowerCase()).filter(Boolean));

    const state = {
      title: _title(workout),
      startedAt: timer.startTimeMs,
      exercise: last && last.exercise ? String(last.exercise) : null,
      setsDone: log.reduce((sum, e) => sum + _setsLogged(e), 0),
      exercisesDone: names.size,
      restEndsAt: null,
      restTotalSeconds: null,
      restPausedRemaining: null
    };

    if (rest && typeof rest.endTimeMs === 'number' && Number(rest.totalSeconds) > 0) {
      state.restTotalSeconds = Math.round(Number(rest.totalSeconds));
      if (typeof rest.pausedRemaining === 'number') {
        state.restPausedRemaining = Math.max(1, Math.round(rest.pausedRemaining));
      } else {
        state.restEndsAt = rest.endTimeMs;
      }
    }
    return state;
  }

  function _activeUser() {
    return global.coachLoggingClient ||
      (typeof global.getActiveUsername === 'function' && global.getActiveUsername()) ||
      global.currentUser ||
      null;
  }

  function _dateKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function _currentWorkout(storage, timer) {
    const user = _activeUser();
    if (!user || !timer) return null;
    const workouts = _readJSON(storage, `workouts_${user}`);
    if (!Array.isArray(workouts)) return null;
    const date = timer.startDateKey || _dateKey(timer.startTimeMs);
    return workouts.find(w => w && w.date === date) || null;
  }

  function readCurrentState(storage = global.localStorage) {
    if (!storage) return null;
    const timer = _readJSON(storage, WORKOUT_TIMER_KEY);
    return buildActivityState({
      timer,
      rest: _readJSON(storage, REST_TIMER_KEY),
      workout: _currentWorkout(storage, timer)
    });
  }

  // ── native bridge ────────────────────────────────────────────

  function _isAvailable() {
    const cap = global.Capacitor;
    if (!cap || typeof cap.nativePromise !== 'function') return false;
    if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'ios') return false;
    if (typeof cap.isPluginAvailable === 'function' && !cap.isPluginAvailable(PLUGIN)) return false;
    return true;
  }

  let _lastKey = null;
  let _inFlight = null;
  let _timer = null;

  /** Pushes the current state to the Live Activity if it changed. */
  async function sync() {
    if (!_isAvailable()) return;
    if (_inFlight) return _inFlight;
    const state = readCurrentState();
    const key = state ? JSON.stringify(state) : 'none';
    if (key === _lastKey) return;

    _inFlight = (async () => {
      try {
        if (state) {
          await global.Capacitor.nativePromise(PLUGIN, 'update', state);
        } else {
          await global.Capacitor.nativePromise(PLUGIN, 'end', {});
        }
        _lastKey = key;
      } catch (err) {
        // Leave _lastKey alone so the next tick retries.
        console.warn('Live Activity update failed', err);
      } finally {
        _inFlight = null;
      }
    })();
    return _inFlight;
  }

  function start() {
    if (!_isAvailable() || _timer) return;
    // The first sync also ends a Live Activity left over from a session
    // the app was killed during.
    sync();
    _timer = setInterval(() => { if (!global.document || !global.document.hidden) sync(); }, POLL_MS);
    if (global.document) {
      // Last update before iOS suspends the app, so the Lock Screen is current.
      global.document.addEventListener('visibilitychange', () => sync());
      global.document.addEventListener('tl:rest-finished', () => sync());
    }
    global.addEventListener && global.addEventListener('pagehide', () => sync());
  }

  const api = { buildActivityState, readCurrentState, sync, start };
  global.LiveActivity = api;

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
