/* =============================================================
   WORKOUT LOG ARCHIVER
   Every 4 weeks, sends workout logs older than 4 weeks to Airtable
   via POST /workoutlogs/archive, then removes them from localStorage.

   Airtable table columns expected: Username, CreatedAt, Notes, Units, SetsJson, Date
   Table name is set server-side via AIRTABLE_WORKOUT_TABLE env var (default: WorkoutLogs).
   ============================================================= */

(function initWorkoutArchiver() {
  'use strict';

  const FOUR_WEEKS_MS  = 28 * 24 * 60 * 60 * 1000;
  const LAST_RUN_KEY   = 'lastWorkoutArchiveAt';
  const ARCHIVED_IDS_KEY = 'archivedWorkoutIds'; // prevent double-archiving

  /* ── Helpers ─────────────────────────────────────────────── */

  function _user() {
    return window.currentUser || localStorage.getItem('fitnessAppUser');
  }

  function _parse(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function _cutoffDate() {
    return Date.now() - FOUR_WEEKS_MS;
  }

  /* ── Should we run? ──────────────────────────────────────── */

  function _shouldRun() {
    const last = localStorage.getItem(LAST_RUN_KEY);
    if (!last) return true;
    return (Date.now() - new Date(last).getTime()) >= FOUR_WEEKS_MS;
  }

  /* ── Collect workouts older than 4 weeks ─────────────────── */

  function _collectOldWorkouts(username) {
    const storageKey = `workouts_${username}`;
    const all        = _parse(storageKey) || [];
    const archivedIds = new Set(_parse(ARCHIVED_IDS_KEY) || []);
    const cutoff     = _cutoffDate();

    const toArchive = [];
    const toKeep    = [];

    for (const w of all) {
      const ts = new Date(w.date || w.createdAt || 0).getTime();
      // Archive if: older than 4 weeks AND not already archived
      if (ts > 0 && ts < cutoff && !archivedIds.has(w.id || w.date)) {
        toArchive.push(w);
      } else {
        toKeep.push(w);
      }
    }

    return { toArchive, toKeep, storageKey };
  }

  /* ── Map a localStorage workout to Airtable fields ──────── */

  function _mapWorkout(workout, username) {
    const log = Array.isArray(workout.log) ? workout.log : [];

    // SetsJson — compact representation of every exercise + set
    const setsJson = log.map(ex => ({
      exercise: ex.exercise || ex.name || '',
      sets: (ex.repsArray || []).map((reps, i) => ({
        reps:   reps   ?? 0,
        weight: ex.weightsArray?.[i] ?? 0,
        rpe:    ex.rpeArray?.[i]     ?? null,
      })).filter(s => s.reps > 0 || s.weight > 0)
    })).filter(e => e.exercise);

    // Notes — human-readable one-liner per exercise
    const notes = log.map(ex => {
      const name = ex.exercise || ex.name || 'Exercise';
      const setStr = (ex.repsArray || [])
        .map((r, i) => `${r}×${ex.weightsArray?.[i] ?? 0}`)
        .join(', ');
      return `${name}: ${setStr}`;
    }).join(' | ');

    // Units — take from first exercise; fallback to kg
    const units = log[0]?.unit || 'kg';

    // Date — ISO date string (YYYY-MM-DD)
    const rawDate = workout.date || workout.createdAt || '';
    const date    = rawDate ? new Date(rawDate).toISOString().slice(0, 10) : '';

    return {
      Username:  username,
      Date:      date,
      CreatedAt: new Date().toISOString(),   // timestamp when archived
      Notes:     notes || workout.title || workout.name || '',
      Units:     units,
      SetsJson:  JSON.stringify(setsJson),
    };
  }

  /* ── POST to backend in batches ─────────────────────────── */

  async function _sendToBackend(records) {
    // Use a relative URL — server.js serves both the app and the API
    const response = await fetch('/workoutlogs/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Server returned ${response.status}: ${JSON.stringify(err)}`);
    }

    return response.json(); // { archived: number }
  }

  /* ── Toast notification ──────────────────────────────────── */

  function _toast(count) {
    const existing = document.getElementById('_archiveToast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = '_archiveToast';
    Object.assign(el.style, {
      position:       'fixed',
      bottom:         '80px',
      left:           '50%',
      transform:      'translateX(-50%) translateY(10px)',
      background:     'var(--card-bg, #0f1510)',
      border:         '1px solid var(--primary, #5fa87e)',
      borderRadius:   '10px',
      padding:        '10px 20px',
      fontSize:       '0.82rem',
      color:          'var(--primary, #5fa87e)',
      fontWeight:     '600',
      fontFamily:     "'Poppins', sans-serif",
      zIndex:         '1500',
      whiteSpace:     'nowrap',
      opacity:        '0',
      transition:     'opacity 0.3s, transform 0.3s',
      pointerEvents:  'none',
    });
    el.textContent = `📦 ${count} workout${count !== 1 ? 's' : ''} archived to Airtable`;
    document.body.appendChild(el);

    requestAnimationFrame(() => {
      el.style.opacity   = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      el.style.opacity   = '0';
      el.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => el.remove(), 400);
    }, 5000);
  }

  /* ── Main archiver ───────────────────────────────────────── */

  async function archiveWorkoutsToAirtable() {
    const username = _user();
    if (!username) return;
    if (!_shouldRun()) {
      console.log('[WorkoutArchiver] Not due yet — skipping.');
      return;
    }

    const { toArchive, toKeep, storageKey } = _collectOldWorkouts(username);

    if (toArchive.length === 0) {
      console.log('[WorkoutArchiver] No old workouts to archive.');
      localStorage.setItem(LAST_RUN_KEY, new Date().toISOString());
      return;
    }

    console.log(`[WorkoutArchiver] Archiving ${toArchive.length} workout(s)…`);
    const records = toArchive.map(w => _mapWorkout(w, username));

    try {
      const result = await _sendToBackend(records);
      console.log(`[WorkoutArchiver] Done — ${result.archived} archived.`);

      // Remove successfully archived workouts from localStorage
      localStorage.setItem(storageKey, JSON.stringify(toKeep));

      // Track archived IDs to prevent double-archiving on partial failures
      const archivedIds = new Set(_parse(ARCHIVED_IDS_KEY) || []);
      toArchive.forEach(w => { if (w.id || w.date) archivedIds.add(w.id || w.date); });
      localStorage.setItem(ARCHIVED_IDS_KEY, JSON.stringify([...archivedIds]));

      // Update last-run timestamp only after successful archive
      localStorage.setItem(LAST_RUN_KEY, new Date().toISOString());

      if (result.archived > 0) _toast(result.archived);

    } catch (err) {
      // Don't delete logs if the request failed — they'll be retried next time
      console.warn('[WorkoutArchiver] Failed — logs kept in localStorage:', err.message);
    }
  }

  /* ── Wire up ─────────────────────────────────────────────── */

  // Expose globally so login flow can trigger it immediately
  window.archiveWorkoutsToAirtable = archiveWorkoutsToAirtable;

  // Auto-run 4 seconds after DOM ready (gives app time to restore currentUser)
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (_user()) archiveWorkoutsToAirtable();
    }, 4000);
  });

})();
