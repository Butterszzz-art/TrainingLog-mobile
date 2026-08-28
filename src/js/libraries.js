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

  /** { name -> { lastDate, lastReps, lastWeight, muscle, logCount } } across
   * both the live and archived history stores. */
  function _buildExerciseHistory() {
    const u = _user();
    const map = new Map();
    if (!u || typeof localStorage === 'undefined') return map;

    const record = (name, dateStr, reps, weight) => {
      if (!name) return;
      const existing = map.get(name);
      if (!existing || (dateStr && dateStr > existing.lastDate)) {
        map.set(name, { name, lastDate: dateStr || '', lastReps: reps, lastWeight: weight, muscle: _coarseGroup(name), logCount: (existing?.logCount || 0) + 1 });
      } else {
        existing.logCount += 1;
      }
    };

    try {
      const workouts = JSON.parse(localStorage.getItem('workouts_' + u)) || [];
      workouts.forEach(w => (w.log || []).forEach(entry => {
        const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
        const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
        record(entry.exercise, w.date, reps[reps.length - 1], weights[weights.length - 1]);
      }));
    } catch { /* ignore malformed storage */ }

    try {
      const archived = JSON.parse(localStorage.getItem('tl_workout_history_v1')) || [];
      archived.filter(w => !w.userId || w.userId === u).forEach(w => (w.exercises || []).forEach(ex => {
        const reps = Array.isArray(ex.repsArray) ? ex.repsArray : [];
        const weights = Array.isArray(ex.weightsArray) ? ex.weightsArray : [];
        const dateStr = (w.date || '').slice(0, 10);
        record(ex.name, dateStr, reps[reps.length - 1], weights[weights.length - 1]);
      }));
    } catch { /* ignore malformed storage */ }

    return map;
  }

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

    const rows = filtered.slice(0, 40).map(e => `
      <div class="sq-row">
        <span class="sq-name">${e.name}</span>
        <span class="sq-summary">${_formatDate(e.lastDate)}${e.lastReps != null ? ' &middot; ' + e.lastReps + (e.lastWeight != null ? '×' + e.lastWeight : '') : ''}</span>
      </div>`).join('');

    el.innerHTML = `
      <div class="pod-row"><span class="pod-title" style="font-size:20px;">Libraries</span><span class="ws-header-sub">${history.length} exercises logged</span></div>
      <div class="pill-nav">${pillRow}</div>
      <div class="pod sq-card">
        <div class="pod-row"><span class="pod-kicker">${_activeGroup === 'all' ? 'All exercises' : _activeGroup}</span><span class="sq-count">last used</span></div>
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
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderLibraries, selectLibraryGroup };
  }
})(typeof window !== 'undefined' ? window : globalThis);
