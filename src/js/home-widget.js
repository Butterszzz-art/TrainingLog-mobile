/* =============================================================
   HOME SCREEN WIDGET (iOS)
   Feeds the "Today" widget (native/ios/PocketCoachLiveActivity/
   TodayWidget.swift): the active program and week, today's session,
   and calories / protein / carbs / fat left.

   A widget can't run the app's code, so this writes a small snapshot
   through the WorkoutActivity plugin (updateWidget) into the App
   Group both share, only when it changed. The snapshot also carries
   tomorrow's session, so at midnight the widget moves on by itself
   (macros back to zero) even if the app isn't opened.

   Sources, all already kept by the app:
   - programSchedule / todaySession: program, week, today's day
   - dailyMacroProgress + dailyMacroDate: what's been eaten today
   - getAdaptiveMacroTargets(): today's targets

   Everything is a no-op outside the iOS app.
   ============================================================= */
(function (global) {
  'use strict';

  const PLUGIN = 'WorkoutActivity';
  const POLL_MS = 10000;

  function _localDateKey(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function _num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  /**
   * Labels for one calendar day of the active program, or null without one.
   * `schedule` is programSchedule.createSchedule(...) output.
   */
  function programDayLabels(schedule, date) {
    if (!schedule) return null;
    const d = schedule.dayFor(date);
    const name = schedule.program && schedule.program.name ? String(schedule.program.name) : 'Program';
    const eyebrow = schedule.weekCount > 1 || d.weekNum > 1 ? `${name} · Wk ${d.weekNum}` : name;
    if (!d.isTraining || !d.day) {
      return { eyebrow, title: d.pause ? 'Pause week' : 'Rest day', isTraining: false };
    }
    const dayNum = (d.trainingIndex % schedule.nDays) + 1;
    const dayName = d.day.name ? String(d.day.name) : '';
    return {
      eyebrow,
      title: dayName ? `Day ${dayNum} · ${dayName}` : `Day ${dayNum}`,
      isTraining: true,
      day: d.day,
    };
  }

  /**
   * The widget's snapshot. Pure: everything comes in as arguments.
   *   today:    { eyebrow, title, isTraining, done } (labels for today)
   *   tomorrow: { eyebrow, title, isTraining } or null (unknown without a program)
   *   eaten:    { protein, carbs, fats, calories } logged today, or null
   *   targets:  { calories, protein, carbs, fat } or null
   * Never includes the current time, so callers can compare results to skip
   * redundant native calls.
   */
  function buildSnapshot({ dateKey, today, tomorrow, eaten, targets }) {
    const e = eaten || {};
    const t = targets || {};
    const macro = (have, target) => ({ eaten: _num(have), target: _num(target) });
    return {
      date: dateKey,
      eyebrow: (today && today.eyebrow) || 'Today',
      title: (today && today.title) || 'No session planned',
      isTraining: !!(today && today.isTraining),
      done: !!(today && today.done),
      tomorrowEyebrow: tomorrow ? tomorrow.eyebrow || 'Today' : null,
      tomorrowTitle: tomorrow ? tomorrow.title || null : null,
      tomorrowIsTraining: tomorrow ? !!tomorrow.isTraining : null,
      kcal: macro(e.calories, t.calories),
      protein: macro(e.protein, t.protein),
      carbs: macro(e.carbs, t.carbs),
      fat: macro(e.fats ?? e.fat, t.fat ?? t.fats),
    };
  }

  // ── reading the app's state ───────────────────────────────────

  function _user() {
    return global.coachLoggingClient ||
      (typeof global.getActiveUsername === 'function' && global.getActiveUsername()) ||
      global.currentUser ||
      null;
  }

  function _readJSON(storage, key) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function _todayLabels(user, now) {
    const ps = global.programSchedule;
    const ts = global.todaySession;
    const schedule = ps && typeof ps.getActiveSchedule === 'function' ? ps.getActiveSchedule(user) : null;
    let today = programDayLabels(schedule, now);
    let tomorrow = null;

    if (schedule) {
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      const t = programDayLabels(schedule, next);
      tomorrow = t && { eyebrow: t.eyebrow, title: t.title, isTraining: t.isTraining };
    } else if (ts && typeof ts.getTodaysSession === 'function') {
      // No program: a template picked for today or the lifter's usual next.
      const s = ts.getTodaysSession(user, now);
      if (s && s.name) today = { eyebrow: 'Today', title: String(s.name), isTraining: true, day: s };
    }

    if (today && today.isTraining && ts && typeof ts.readDecline === 'function' && ts.readDecline(user, now)) {
      today = { eyebrow: today.eyebrow, title: 'Not today', isTraining: false };
    }

    if (today && today.isTraining && today.day && ps && typeof ps.dayProgress === 'function') {
      try {
        const progress = ps.dayProgress(today.day, ps.workoutsOn(_localDateKey(now), user));
        today.done = !!progress.complete;
      } catch { /* no workouts yet */ }
    }
    return { today, tomorrow };
  }

  function _macros(storage) {
    const todayKey = typeof global.getTodayDateString === 'function' ? global.getTodayDateString() : null;
    let eaten = null;
    if (todayKey && storage.getItem('dailyMacroDate') === todayKey) {
      const p = _readJSON(storage, 'dailyMacroProgress');
      if (p) {
        const calories = Number(p.calories) ||
          (Number(p.protein) || 0) * 4 + (Number(p.carbs) || 0) * 4 + (Number(p.fats) || 0) * 9 + (Number(p.cals) || 0);
        eaten = { ...p, calories };
      }
    }
    let targets = null;
    try {
      if (typeof global.getAdaptiveMacroTargets === 'function') targets = global.getAdaptiveMacroTargets();
    } catch { /* macro targets not ready */ }
    return { eaten, targets };
  }

  /** The snapshot for whoever is signed in, or null when nobody is. */
  function readSnapshot(storage = global.localStorage, now = new Date()) {
    if (!storage) return null;
    const user = _user();
    if (!user) return null;
    const { today, tomorrow } = _todayLabels(user, now);
    const { eaten, targets } = _macros(storage);
    return buildSnapshot({ dateKey: _localDateKey(now), today, tomorrow, eaten, targets });
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

  /** Pushes the current snapshot to the widget if it changed. */
  async function sync() {
    if (!_isAvailable()) return;
    if (_inFlight) return _inFlight;
    let snapshot;
    try {
      snapshot = readSnapshot();
    } catch (err) {
      console.warn('Widget snapshot failed', err);
      return;
    }
    const key = snapshot ? JSON.stringify(snapshot) : 'none';
    if (key === _lastKey) return;

    _inFlight = (async () => {
      try {
        // An empty snapshot clears the widget (signed out).
        await global.Capacitor.nativePromise(PLUGIN, 'updateWidget', snapshot || {});
        _lastKey = key;
      } catch (err) {
        // Leave _lastKey alone so the next tick retries.
        console.warn('Widget update failed', err);
      } finally {
        _inFlight = null;
      }
    })();
    return _inFlight;
  }

  function start() {
    if (!_isAvailable() || _timer) return;
    sync();
    _timer = setInterval(() => { if (!global.document || !global.document.hidden) sync(); }, POLL_MS);
    if (global.document) {
      // Last update before iOS suspends the app.
      global.document.addEventListener('visibilitychange', () => sync());
    }
    global.addEventListener && global.addEventListener('pagehide', () => sync());
  }

  const api = { programDayLabels, buildSnapshot, readSnapshot, sync, start };
  global.HomeWidget = api;

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
