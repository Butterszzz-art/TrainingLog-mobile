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
    // Something changed on purpose (save/delete): the next load may
    // legitimately come back empty and should replace the saved copy.
    _acceptEmptyNext.add(username || '*');
  }
  const _acceptEmptyNext = new Set();

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

  /* ── Full history for long-range screens (Insights / progress) ──
     Charts, exercise trends, milestones and goals need every workout
     the user has ever logged, not just what is still in localStorage.
     loadFullWorkoutHistory() merges local data with the backend's
     hard-saved workouts and keeps a copy of the backend part:
       - in memory, so sync readers (getFullWorkoutHistory) can use it;
       - in IndexedDB, so the history survives app restarts and offline
         use. IndexedDB rather than localStorage because the archiver
         moves old workouts off localStorage to free its small quota. */

  const _remoteSnapshot = new Map(); // username -> normalized backend workouts
  const IDB_NAME = 'traininglog-cache';
  const IDB_STORE = 'kv';

  function _idbOpen() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('No IndexedDB')); return; }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function _idbGet(key) {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function _idbSet(key, value) {
    const db = await _idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function _mirrorKey(username) {
    return `backendWorkouts_${username}`;
  }

  /** Backend item -> the same shape the app stores locally. */
  function _fromBackendItem(item) {
    const inner = item && item.workout && typeof item.workout === 'object' ? item.workout : {};
    const rawDate = String(inner.date || (item && item.date) || '');
    // Local workouts use YYYY-MM-DD; the backend stores a full ISO string.
    const date = /^\d{4}-\d{2}-\d{2}T/.test(rawDate) ? rawDate.slice(0, 10) : rawDate;
    return {
      ...inner,
      id: inner.id || (item && item.id),
      backendId: item && item.id,
      date,
      title: inner.title || inner.name || (item && item.title) || 'Workout'
    };
  }

  /** Read the on-device copy of backend workouts into memory (no network). */
  async function primeFullWorkoutHistory(username) {
    if (!username || _remoteSnapshot.has(username)) return;
    try {
      const saved = await _idbGet(_mirrorKey(username));
      if (Array.isArray(saved) && !_remoteSnapshot.has(username)) _remoteSnapshot.set(username, saved);
    } catch { /* no IndexedDB — memory only */ }
  }

  /**
   * Every workout we know about for `username`, synchronously: local
   * stores plus the last backend load (or its on-device copy).
   */
  function getFullWorkoutHistory(username) {
    if (!username) return [];
    return _mergeUnique([getAllWorkoutsForUser(username), _remoteSnapshot.get(username) || []]);
  }

  /**
   * Refresh the backend part (shared 5-minute cache) and return the full
   * merged history. Offline or signed out, falls back to the on-device copy.
   */
  async function loadFullWorkoutHistory(username, opts) {
    if (!username) return [];
    await primeFullWorkoutHistory(username);
    try {
      if (typeof window !== 'undefined' && window.SERVER_URL && _authToken()) {
        const items = await fetchBackendWorkoutItems(username, opts);
        const remote = items.map(_fromBackendItem);
        // Don't let an empty answer wipe a good copy (e.g. a server hiccup).
        const acceptEmpty = _acceptEmptyNext.delete(username) | _acceptEmptyNext.delete('*');
        if (remote.length || acceptEmpty || !(_remoteSnapshot.get(username) || []).length) {
          _remoteSnapshot.set(username, remote);
          _idbSet(_mirrorKey(username), remote).catch(() => {});
        }
      }
    } catch { /* offline — keep the copy we have */ }
    return getFullWorkoutHistory(username);
  }

  if (typeof module !== 'undefined') {
    module.exports = {
      getAllWorkoutsForUser,
      getAllWorkoutsForUserIncludingBackend,
      fetchBackendWorkouts,
      fetchBackendWorkoutItems,
      invalidateBackendWorkouts,
      getFullWorkoutHistory,
      loadFullWorkoutHistory,
      primeFullWorkoutHistory
    };
  }
  if (typeof window !== 'undefined') {
    window.getAllWorkoutsForUser = getAllWorkoutsForUser;
    window.getAllWorkoutsForUserIncludingBackend = getAllWorkoutsForUserIncludingBackend;
    window.fetchBackendWorkoutItems = fetchBackendWorkoutItems;
    window.invalidateBackendWorkouts = invalidateBackendWorkouts;
    window.getFullWorkoutHistory = getFullWorkoutHistory;
    window.loadFullWorkoutHistory = loadFullWorkoutHistory;
    window.primeFullWorkoutHistory = primeFullWorkoutHistory;
    // Load the on-device copy early (no network) so Insights has long-term
    // history from the first render, even offline.
    if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
          const u = window.currentUser || (typeof localStorage !== 'undefined' && localStorage.getItem('fitnessAppUser'));
          if (u) primeFullWorkoutHistory(u);
        }, 1500);
      });
    }
  }
})();
