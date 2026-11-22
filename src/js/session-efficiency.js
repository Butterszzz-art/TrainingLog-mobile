/* =============================================================
   SESSION EFFICIENCY — how a finished session used its minutes
   (Butters University "Time-efficient training", phase 2).

   When a workout ends (tl:workout-finished, workoutTimer.js) this
   saves `efficiency` on today's workout in workouts_<user>:
     { durationMin, workingSets, minPerSet, workMin, restMin, otherMin,
       budgetMin?, plannedMin? }
   (rules: TimeBudgetCore.sessionEfficiency). The "How did it go?"
   sheet shows it (index.html openSessionRatingModal) and the coach
   share snapshot sends recent sessions to a linked coach
   (client-coaching.js buildShareSnapshot).

   The event fires synchronously, before the End button opens the
   rating sheet, so the sheet already sees the saved record.
   ============================================================= */
(function (global) {
  'use strict';

  const core = () => global.TimeBudgetCore || null;

  function _read(key) {
    try { return JSON.parse(global.localStorage.getItem(key)); } catch { return null; }
  }

  function _user() {
    return global.coachLoggingClient || global.currentUser || global.localStorage.getItem('fitnessAppUser') || '';
  }

  /** Minutes the planned day should take, from its plan (and today's accepted budget changes). */
  function _plannedMin(c) {
    const day = typeof global.getTodaysPlannedDay === 'function' ? global.getTodaysPlannedDay() : null;
    if (!day || !Array.isArray(day.exercises) || !day.exercises.length) return null;
    const session = _read('tl_time_budget_session_v1');
    const changes = session && session.changes ? session.changes : {};
    return c.estimateSessionMinutes(day, changes);
  }

  function _budgetMin() {
    const pm = global.PerformanceMode;
    if (!pm || typeof pm.getSettings !== 'function') return null;
    const s = pm.getSettings();
    return s.active ? s.budgetMin : null;
  }

  function stampEfficiency(detail) {
    const c = core();
    const u = _user();
    if (!c || !u || !detail || !detail.date) return null;
    const key = `workouts_${u}`;
    const workouts = _read(key);
    if (!Array.isArray(workouts)) return null;
    const workout = workouts.find((w) => w && w.date === detail.date);
    if (!workout) return null;
    let plannedMin = null;
    try { plannedMin = _plannedMin(c); } catch { /* no plan */ }
    const efficiency = c.sessionEfficiency({
      log: workout.log,
      durationMin: detail.durationMin,
      restBreaks: workout.restBreaks,
      budgetMin: _budgetMin(),
      plannedMin,
    });
    if (!efficiency) return null;
    workout.efficiency = efficiency;
    try { global.localStorage.setItem(key, JSON.stringify(workouts)); } catch { /* storage full */ }
    return efficiency;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('tl:workout-finished', (e) => { stampEfficiency(e && e.detail); });
  }

  const api = { stampEfficiency };
  global.SessionEfficiency = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
