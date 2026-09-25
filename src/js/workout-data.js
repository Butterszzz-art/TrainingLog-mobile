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

  /* ── Shared backend fetch ─────────────────────────────────
     Several screens want the backend's archived workouts (history,
     progressive overload, badges, exports, challenges). Each used to
     download the whole collection separately — every page load cost
     one Firestore read per archived workout, several times over.
     They now share one in-memory result per user: concurrent callers
     share the in-flight request, it's reused for CACHE_TTL_MS, and
     it's dropped whenever this device saves a workout to the backend
     (invalidateBackendWorkouts). Fetched in pages of PAGE_SIZE; a
     backend without paging support ignores `limit` and returns
     everything with no `nextCursor`, which ends the loop. */

  const CACHE_TTL_MS = 5 * 60 * 1000;
  const PAGE_SIZE = 500;
  const MAX_PAGES = 100;
  const _backendCache = new Map(); // username -> { at, promise }

  function _authToken() {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  }

  async function _fetchAllBackendPages(username) {
    const items = [];
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ username, limit: String(PAGE_SIZE) });
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(`${window.SERVER_URL}/workouts?${params.toString()}`, {
        headers: { Authorization: `Bearer ${_authToken() || ''}` },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        const err = new Error((data && data.error && data.error.message) || `Failed to load workouts (${res.status})`);
        err.status = res.status;
        err.body = data;
        throw err;
      }
      if (Array.isArray(data.items)) items.push(...data.items);
      cursor = data.nextCursor || null;
      if (!cursor) break;
    }
    return items;
  }

  /**
   * Raw `/workouts` items for `username` ({ id, date, title, workout }),
   * shared and cached as described above. Rejects on failure (with
   * `.status` / `.body` when the server answered); pass { force: true }
   * to bypass the cache.
   */
  function fetchBackendWorkoutItems(username, { force = false } = {}) {
    if (typeof window === 'undefined' || !window.SERVER_URL) return Promise.resolve([]);
    if (!username) return Promise.reject(new Error('Missing username'));
    if (!_authToken()) return Promise.reject(new Error('Missing auth token'));

    const hit = _backendCache.get(username);
    if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;

    const promise = _fetchAllBackendPages(username);
    _backendCache.set(username, { at: Date.now(), promise });
    // Never cache a failure.
    promise.catch(() => {
      if (_backendCache.get(username)?.promise === promise) _backendCache.delete(username);
    });
    return promise;
  }

  /** Drop the cached backend workouts (one user, or everyone). */
  function invalidateBackendWorkouts(username) {
    if (username) _backendCache.delete(username);
    else _backendCache.clear();
  }

  /**
   * Fetch workouts that have already been hard-saved to the backend
   * (older than 4 weeks — see workout-archiver.js) so they no longer
   * live in localStorage at all.
   */
  async function fetchBackendWorkouts(username) {
    if (typeof window === 'undefined' || !window.SERVER_URL) return [];
    if (!_authToken()) return [];

    try {
      const items = await fetchBackendWorkoutItems(username);
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
    module.exports = {
      getAllWorkoutsForUser,
      getAllWorkoutsForUserIncludingBackend,
      fetchBackendWorkouts,
      fetchBackendWorkoutItems,
      invalidateBackendWorkouts
    };
  }
  if (typeof window !== 'undefined') {
    window.getAllWorkoutsForUser = getAllWorkoutsForUser;
    window.getAllWorkoutsForUserIncludingBackend = getAllWorkoutsForUserIncludingBackend;
    window.fetchBackendWorkoutItems = fetchBackendWorkoutItems;
    window.invalidateBackendWorkouts = invalidateBackendWorkouts;
  }
})();
