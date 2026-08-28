/**
 * libraries.js
 * The "Libraries" screen: a real per-exercise history list (last used +
 * last set) grouped by muscle, built from the same two stores the rest
 * of the app already writes to — no fabricated exercise database.
 *   - workouts_<user>            current/recent days (addLogEntry.js)
 *   - tl_workout_history_v1      archived days (archiveOldWorkouts.js)
 * Functional/Flexibility/Posing have no structured plan/history data
 * model in the app yet, so those pills route to the existing dedicated
 * tabs (functionalTab/mobilityTab/posingTab) instead of showing
 * fabricated content — same "launcher" pattern as the Body tab.
 */
(function (global) {
  'use strict';

  const COARSE_GROUPS = {
    chest: 'Chest',
    back: 'Back', traps: 'Back',
    shoulders: 'Delts',
    biceps: 'Arms', triceps: 'Arms', forearms: 'Arms',
    legs: 'Legs', quads: 'Legs', hamstrings: 'Legs', glutes: 'Legs', calves: 'Legs', abductors: 'Legs', adductors: 'Legs',
    abs: 'Core',
  };

  function _user() {
    return global.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser'));
  }

  function _coarseGroup(exerciseName) {
    const fine = typeof global.getMuscleGroup === 'function' ? global.getMuscleGroup(exerciseName) : 'other';
    return COARSE_GROUPS[fine] || 'Other';
  }

  /** Epley-style e1RM, matching the formula addLogEntry() already uses
   * for its own estimated1RM field — keep this consistent app-wide. */
  function _e1rm(weight, reps) {
    if (weight == null || reps == null) return 0;
    return Number(weight) * (1 + Number(reps) / 30);
  }

  /** name -> [{ date, reps:[], weights:[] }, ...] (one array entry per
   * logged session of that exercise), sorted most-recent-first, across
   * both the live (workouts_<user>) and archived (tl_workout_history_v1)
   * stores. This is the single real data source every stat below is
   * derived from — no exercise database, no fabricated numbers. */
  function _buildExerciseSessions() {
    const u = _user();
    const map = new Map();
    if (!u || typeof localStorage === 'undefined') return map;

    const record = (name, dateStr, reps, weights) => {
      if (!name || !dateStr) return;
      const list = map.get(name) || [];
      list.push({ date: dateStr, reps: reps || [], weights: weights || [] });
      map.set(name, list);
    };

    try {
      const workouts = JSON.parse(localStorage.getItem('workouts_' + u)) || [];
      workouts.forEach(w => (w.log || []).forEach(entry => {
        record(entry.exercise, w.date,
          Array.isArray(entry.repsArray) ? entry.repsArray : [],
          Array.isArray(entry.weightsArray) ? entry.weightsArray : []);
      }));
    } catch { /* ignore malformed storage */ }

    try {
      const archived = JSON.parse(localStorage.getItem('tl_workout_history_v1')) || [];
      archived.filter(w => !w.userId || w.userId === u).forEach(w => (w.exercises || []).forEach(ex => {
        record(ex.name, (w.date || '').slice(0, 10),
          Array.isArray(ex.repsArray) ? ex.repsArray : [],
          Array.isArray(ex.weightsArray) ? ex.weightsArray : []);
      }));
    } catch { /* ignore malformed storage */ }

    // Same exercise can appear as several single-set sessions on the same
    // date (quick-log) — merge same-date sessions into one before sorting,
    // so "last session" means "last day trained", not "last single set".
    map.forEach((sessions, name) => {
      const byDate = new Map();
      sessions.forEach(s => {
        const existing = byDate.get(s.date);
        if (existing) { existing.reps.push(...s.reps); existing.weights.push(...s.weights); }
        else byDate.set(s.date, { date: s.date, reps: s.reps.slice(), weights: s.weights.slice() });
      });
      map.set(name, Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date)));
    });

    return map;
  }

  /** { lastDate, lastReps, lastWeight, muscle, logCount } per exercise —
   * the flat summary Libraries' list view needs. */
  function _buildExerciseHistory() {
    const sessions = _buildExerciseSessions();
    const map = new Map();
    sessions.forEach((list, name) => {
      const last = list[0];
      const lastReps = last ? last.reps[last.reps.length - 1] : null;
      const lastWeight = last ? last.weights[last.weights.length - 1] : null;
      const logCount = list.reduce((n, s) => n + s.reps.length, 0);
      map.set(name, { name, lastDate: last ? last.date : '', lastReps, lastWeight, muscle: _coarseGroup(name), logCount });
    });
    return map;
  }

  /** Real per-exercise stats for the density the redesign spec calls
   * for: best-ever e1RM, and a week-over-week delta comparing the most
   * recent logged session's top set against the one before it. Returns
   * null if the exercise has fewer than 1 logged session. */
  function getExerciseStats(name) {
    const sessions = _buildExerciseSessions().get(name);
    if (!sessions || !sessions.length) return null;

    let bestE1rm = 0;
    sessions.forEach(s => s.reps.forEach((r, i) => {
      bestE1rm = Math.max(bestE1rm, _e1rm(s.weights[i], r));
    }));

    const topSetOf = (session) => {
      if (!session) return null;
      let top = null, topE1rm = -1;
      session.reps.forEach((r, i) => {
        const e = _e1rm(session.weights[i], r);
        if (e > topE1rm) { topE1rm = e; top = { reps: r, weight: session.weights[i], e1rm: e }; }
      });
      return top;
    };

    const last = topSetOf(sessions[0]);
    const previous = topSetOf(sessions[1]);
    const pctOf1rm = last && bestE1rm ? Math.round((last.weight / bestE1rm) * 100) : null;
    const deltaWeight = last && previous ? _round1(last.weight - previous.weight) : null;

    return {
      bestE1rm: Math.round(bestE1rm * 10) / 10,
      lastDate: sessions[0].date,
      lastTopSet: last,
      previousTopSet: previous,
      pctOf1rm,
      deltaWeight,
      sessionCount: sessions.length,
    };
  }

  function _round1(n) { return Math.round(n * 10) / 10; }

  function _formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  let _activeGroup = 'all';

  function selectLibraryGroup(group) {
    _activeGroup = group;
    renderLibraries();
  }

  function renderLibraries() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('librariesContent');
    if (!el) return;

    const history = Array.from(_buildExerciseHistory().values())
      .sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));

    const groups = ['all', 'Chest', 'Back', 'Delts', 'Arms', 'Legs', 'Core'];
    const pillRow = groups.map(g =>
      `<span class="pill${g === _activeGroup ? ' active' : ''}" onclick="selectLibraryGroup('${g}')">${g === 'all' ? 'All' : g}</span>`
    ).join('');

    const filtered = _activeGroup === 'all' ? history : history.filter(e => e.muscle === _activeGroup);

    const rows = filtered.slice(0, 40).map(e => {
      const stats = getExerciseStats(e.name);
      return `
      <div class="sq-row">
        <span class="sq-name">${e.name}</span>
        <span class="sq-summary">${_formatDate(e.lastDate)}${e.lastReps != null ? ' &middot; ' + e.lastReps + (e.lastWeight != null ? '×' + e.lastWeight : '') : ''}</span>
        <span class="sq-e1rm">${stats && stats.bestE1rm ? stats.bestE1rm + ' kg' : '—'}</span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="pod-row"><span class="pod-title" style="font-size:20px;">Libraries</span><span class="ws-header-sub">${history.length} exercises logged</span></div>
      <div class="pill-nav">${pillRow}</div>
      <div class="pod sq-card">
        <div class="pod-row"><span class="pod-kicker">${_activeGroup === 'all' ? 'All exercises' : _activeGroup}</span><span class="sq-count">e1RM &middot; last used</span></div>
        ${rows || '<p class="ws-empty-note">Nothing logged in this group yet.</p>'}
      </div>
      <div class="pill-nav" style="margin-top:12px;">
        <span class="pill" onclick="showTab('functionalTab')">Functional</span>
        <span class="pill" onclick="showTab('mobilityTab')">Flexibility</span>
        <span class="pill" onclick="showTab('posingTab')">Posing</span>
      </div>
    `;
  }

  global.renderLibraries = renderLibraries;
  global.selectLibraryGroup = selectLibraryGroup;
  global.getExerciseStats = getExerciseStats;
  global.getCoarseMuscleGroup = _coarseGroup;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderLibraries, selectLibraryGroup, getExerciseStats, getCoarseMuscleGroup: _coarseGroup };
  }
})(typeof window !== 'undefined' ? window : globalThis);
