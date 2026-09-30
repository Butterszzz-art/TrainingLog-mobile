/* =============================================================
   RECENT WORKOUT SYNC
   Keeps the last 4 weeks of workouts the same on every device:

   push  — workouts logged or edited here go to the backend
           (POST /workouts), so the Leaderboard and Exercise
           Leaderboard reflect this week; workouts deleted here are
           deleted there (DELETE /workouts/:id).
   pull  — workouts from the last 4 weeks that another device (or a
           coach) saved come down into workouts_{user} (last 7 days)
           or workoutHistory_{user} (7 days to 4 weeks), and ones
           deleted elsewhere are removed here.

   Older workouts live only on the backend (workout-archiver.js hard-
   saves them after 4 weeks) and screens read them from there.

   Both sides use the workout's own `id`, which the backend uses as
   the doc id, so a re-post overwrites instead of duplicating.

   workoutSyncFp_{user} remembers, per workout id, a fingerprint of
   what was last synced and the workout's date ({ f, d }). A workout
   whose fingerprint still matches hasn't been edited here, so a
   newer copy from the server may replace it; a remembered workout
   that is gone from this device (and not old enough to have been
   archived) was deleted here.
   ============================================================= */

(function () {
  'use strict';

  const WINDOW_DAYS = 28;
  const LOCAL_ACTIVE_DAYS = 7; // archiveOldWorkouts.js moves older ones to workoutHistory_
  const DELETE_MARGIN_DAYS = 2; // don't mistake archiving at the window edge for a delete
  const INTERVAL_MS = 60 * 1000;
  const FP_PREFIX = 'workoutSyncFp_';
  let _running = false;

  function _user() {
    if (typeof window !== 'undefined' && window.currentUser) return window.currentUser;
    return localStorage.getItem('fitnessAppUser');
  }

  function _read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  // Small, stable string hash (FNV-1a) of the workout's JSON.
  function fingerprint(workout) {
    const str = JSON.stringify(workout);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36) + ':' + str.length;
  }

  function _hasSets(w) {
    if (Array.isArray(w?.log)) return w.log.some(e => Array.isArray(e?.repsArray) && e.repsArray.length);
    return Array.isArray(w?.sets) && w.sets.length > 0;
  }

  const _day = v => String(v || '').slice(0, 10);
  const _daysAgo = (days, now) => new Date(now - days * 86400000).toISOString().slice(0, 10);

  // Older versions stored just the fingerprint string.
  function _entry(v) {
    if (typeof v === 'string') return { f: v, d: null };
    return v && typeof v === 'object' ? v : null;
  }

  // Workouts from the last WINDOW_DAYS that have an id and at least one set.
  function collectRecentWorkouts(username, now = Date.now()) {
    const cutoff = _daysAgo(WINDOW_DAYS, now);
    const seen = new Set();
    const out = [];
    [...(_read(`workouts_${username}`) || []), ...(_read(`workoutHistory_${username}`) || [])].forEach(w => {
      if (!w || !w.id || seen.has(String(w.id))) return;
      if (_day(w.date) < cutoff || !_hasSets(w)) return;
      seen.add(String(w.id));
      out.push(w);
    });
    return out;
  }

  // Every workout id still on this device, whatever its date.
  function _localIds(username) {
    const ids = new Set();
    [...(_read(`workouts_${username}`) || []), ...(_read(`workoutHistory_${username}`) || [])]
      .forEach(w => { if (w && w.id) ids.add(String(w.id)); });
    return ids;
  }

  function _api(path, init = {}) {
    const token = localStorage.getItem('token');
    return fetch(`${window.SERVER_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    }).then(async res => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => null) }));
  }

  async function _pushChanges(username, synced, now) {
    let sent = 0;
    const recent = collectRecentWorkouts(username, now);
    for (const w of recent) {
      const fp = fingerprint(w);
      if (_entry(synced[w.id])?.f === fp) continue;
      const rawDate = w.date || w.createdAt;
      const res = await _api('/workouts', {
        method: 'POST',
        body: JSON.stringify({
          date: rawDate ? new Date(rawDate).toISOString() : new Date().toISOString(),
          title: w.title || w.name || 'Workout',
          workout: w,
        }),
      });
      if (!res.ok || !res.data?.success) return { sent, ok: false }; // try again next round
      synced[w.id] = { f: fp, d: _day(rawDate) };
      sent++;
    }

    // Deleted here: remembered, gone from every local store, and recent
    // enough that the archiver can't have moved it off the device.
    const local = _localIds(username);
    const deleteAfter = _daysAgo(WINDOW_DAYS - DELETE_MARGIN_DAYS, now);
    for (const id of Object.keys(synced)) {
      const e = _entry(synced[id]);
      if (local.has(id) || !e || !e.d || e.d < deleteAfter) continue;
      const res = await _api(`/workouts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      // 409: legacy account that can't delete; 422: id the server can't
      // hold. Stop trying for those. Anything else (e.g. a backend without
      // this route yet) is retried next round.
      if (res.ok || res.status === 409 || res.status === 422) {
        delete synced[id];
        sent++;
      } else {
        return { sent, ok: false };
      }
    }
    return { sent, ok: true };
  }

  async function _fetchRecent(since) {
    const items = [];
    let cursor = null;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ since, limit: '200' });
      if (cursor) params.set('cursor', cursor);
      const res = await _api(`/workouts?${params.toString()}`, { method: 'GET' });
      if (!res.ok || !res.data?.success) return null;
      (res.data.items || []).forEach(it => items.push(it));
      cursor = res.data.nextCursor || null;
      if (!cursor) return items;
    }
    return items;
  }

  function _removeFromDerivedHistory(ids) {
    ['workoutHistory', 'tl_workout_history_v1'].forEach(key => {
      const list = _read(key);
      if (!Array.isArray(list)) return;
      const kept = list.filter(item => !(item && item.id && ids.has(String(item.id))));
      if (kept.length !== list.length) localStorage.setItem(key, JSON.stringify(kept));
    });
  }

  async function _pullChanges(username, synced, now) {
    const since = _daysAgo(WINDOW_DAYS, now);
    const items = await _fetchRecent(since);
    if (!items) return 0;

    const activeKey = `workouts_${username}`;
    const historyKey = `workoutHistory_${username}`;
    const active = _read(activeKey) || [];
    const history = _read(historyKey) || [];
    const activeSince = _daysAgo(LOCAL_ACTIVE_DAYS, now);
    let changed = 0;

    const server = new Map();
    items.forEach(it => {
      const w = it && it.workout;
      const id = w && (w.id || it.id);
      if (id && _day(w.date || it.date) >= since) server.set(String(id), { ...w, id: w.id || id });
    });

    const locate = id => {
      let i = active.findIndex(w => w && String(w.id) === id);
      if (i >= 0) return [active, i];
      i = history.findIndex(w => w && String(w.id) === id);
      return i >= 0 ? [history, i] : null;
    };

    server.forEach((w, id) => {
      const fp = fingerprint(w);
      const known = _entry(synced[id]);
      const at = locate(id);
      if (at) {
        const mine = fingerprint(at[0][at[1]]);
        if (mine === fp) { synced[id] = { f: fp, d: _day(w.date) }; return; }
        if (known && known.f !== mine) return; // edited here, not pushed yet: ours wins
        at[0][at[1]] = w;
      } else {
        if (known) return; // deleted here; the delete goes out next push
        (_day(w.date) >= activeSince ? active : history).push(w);
      }
      synced[id] = { f: fp, d: _day(w.date) };
      changed++;
    });

    // Deleted elsewhere: synced before, unchanged here, gone from the server.
    const deleteAfter = _daysAgo(WINDOW_DAYS - DELETE_MARGIN_DAYS, now);
    const removed = new Set();
    Object.keys(synced).forEach(id => {
      const known = _entry(synced[id]);
      if (server.has(id) || !known || !known.d || known.d < deleteAfter) return;
      const at = locate(id);
      if (!at || fingerprint(at[0][at[1]]) !== known.f) return;
      at[0].splice(at[1], 1);
      delete synced[id];
      removed.add(id);
      changed++;
    });

    if (changed) {
      const byDate = (a, b) => String(a?.date || '').localeCompare(String(b?.date || ''));
      localStorage.setItem(activeKey, JSON.stringify(active.sort(byDate)));
      localStorage.setItem(historyKey, JSON.stringify(history.sort(byDate)));
      if (removed.size) _removeFromDerivedHistory(removed);
    }
    return changed;
  }

  function _refreshScreens() {
    try { window.invalidateBackendWorkouts?.(); } catch { /* optional */ }
    ['renderWorkouts', 'renderWorkoutHistoryTab'].forEach(name => {
      try { if (typeof window[name] === 'function') window[name](); } catch (err) { console.warn(`[WorkoutSync] ${name} failed:`, err.message); }
    });
  }

  /**
   * One round: push local changes, then (unless { pull: false }) pull
   * changes from other devices. Returns how many workouts were sent.
   */
  async function syncRecentWorkouts({ pull = true } = {}) {
    if (_running) return 0;
    const username = _user();
    const token = localStorage.getItem('token');
    if (!username || !token || !window.SERVER_URL) return 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;

    _running = true;
    let sent = 0;
    const fpKey = FP_PREFIX + username;
    const synced = _read(fpKey) || {};
    try {
      const now = Date.now();
      const pushed = await _pushChanges(username, synced, now);
      sent = pushed.sent;
      // Forget workouts that aged out of the window (archived by now).
      const cutoff = _daysAgo(WINDOW_DAYS + DELETE_MARGIN_DAYS, now);
      Object.keys(synced).forEach(id => {
        const e = _entry(synced[id]);
        if (e && e.d && e.d < cutoff) delete synced[id];
      });
      if (pushed.ok && pull && localStorage.getItem('cloudSyncDisabled') !== '1') {
        const pulled = await _pullChanges(username, synced, now);
        if (pulled) _refreshScreens();
      }
    } catch (err) {
      console.warn('[WorkoutSync] failed:', err.message);
    } finally {
      localStorage.setItem(fpKey, JSON.stringify(synced));
      _running = false;
    }
    return sent;
  }

  function _tick() {
    if (document.visibilityState === 'hidden') return;
    syncRecentWorkouts();
  }

  if (typeof window !== 'undefined') {
    window.syncRecentWorkouts = syncRecentWorkouts;
    if (!window.__WORKOUT_SYNC_NO_TIMER) {
      setInterval(_tick, INTERVAL_MS);
      setTimeout(_tick, 8000);
      // Catch the workout just logged when the app goes to the background.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') syncRecentWorkouts({ pull: false });
        else syncRecentWorkouts();
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { syncRecentWorkouts, collectRecentWorkouts, fingerprint };
  }
})();
