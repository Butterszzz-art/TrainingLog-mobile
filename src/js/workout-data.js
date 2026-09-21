/* =============================================================
   WORKOUT DATA — shared read helpers
   `workouts_{user}` only holds the trailing ~7 days of raw logs:
   archiveOldWorkouts.js moves anything older into
   `workoutHistory_{user}`, and workout-archiver.js hard-saves
   anything in there older than 4 weeks to the backend and removes
   it locally. Any feature that needs more than a rolling 7-day
   window (progress reports, lifetime badges, CSV/JSON exports, AI
   context) must read *all* of these sources or it silently loses
   everything older than a week.
   ============================================================= */

(function () {
  'use strict';

  function _parseArray(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  function _workoutKey(w) {
    return (w && w.id) || `${(w && w.date) || ''}|${(w && (w.title || w.name)) || ''}`;
  }

  function _mergeUnique(lists) {
    const seen = new Set();
    const merged = [];
    lists.forEach(list => {
      list.forEach(w => {
        const key = _workoutKey(w);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(w);
      });
    });
    merged.sort((a, b) => new Date((a && a.date) || 0) - new Date((b && b.date) || 0));
    return merged;
  }

  /**
   * All workouts for `username` still available in localStorage —
   * the rolling 7-day `workouts_{user}` store plus the 7-day-to-4-week
   * `workoutHistory_{user}` archive. Synchronous, no network call.
   */
  function getAllWorkoutsForUser(username) {
    if (!username) return [];
    const archived = _parseArray(`workoutHistory_${username}`);
    const active = _parseArray(`workouts_${username}`);
    return _mergeUnique([archived, active]);
  }

  /**
   * Fetch workouts that have already been hard-saved to the backend
   * (older than 4 weeks — see workout-archiver.js) so they no longer
   * live in localStorage at all.
   */
  async function fetchBackendWorkouts(username) {
    if (typeof window === 'undefined' || !window.SERVER_URL) return [];
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return [];

    try {
      const res = await fetch(`${window.SERVER_URL}/workouts?username=${encodeURIComponent(username)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      if (!data || !data.success) return [];

      const items = Array.isArray(data.items) ? data.items : [];
      return items.map(item => ({
        ...(item && item.workout),
        id: item && item.id,
        date: (item && item.date) || (item && item.workout && item.workout.date) || '',
        title: (item && item.title) || (item && item.workout && (item.workout.title || item.workout.name)) || 'Workout',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Full history for `username`: local (recent + archived) merged with
   * whatever has already been hard-saved to the backend. Use this for
   * anything that claims to cover "all time" or "full history" (lifetime
   * badges, full data exports) rather than just a recent window.
   */
  async function getAllWorkoutsForUserIncludingBackend(username) {
    if (!username) return [];
    const local = getAllWorkoutsForUser(username);
    const remote = await fetchBackendWorkouts(username);
    return _mergeUnique([local, remote]);
  }

  if (typeof module !== 'undefined') {
    module.exports = { getAllWorkoutsForUser, getAllWorkoutsForUserIncludingBackend, fetchBackendWorkouts };
  }
  if (typeof window !== 'undefined') {
    window.getAllWorkoutsForUser = getAllWorkoutsForUser;
    window.getAllWorkoutsForUserIncludingBackend = getAllWorkoutsForUserIncludingBackend;
  }
})();
