/* =============================================================
   WORKOUT LOG ARCHIVER
   Every 4 weeks, hard-saves workout logs older than 4 weeks to the
   real backend (POST /workouts on window.SERVER_URL — Firestore-backed),
   then removes them from localStorage.

   Pipeline: workouts_{user} --(7 days, archiveOldWorkouts.js)-->
   workoutHistory_{user} --(4 weeks, this file)--> backend.

   Source of truth for "due" items is `workoutHistory_{user}`, since
   archiveOldWorkouts.js already empties `workouts_{user}` of anything
   past 7 days — checking `workouts_{user}` here would never find
   anything older than 4 weeks.
   ============================================================= */

// Wrapped in an IIFE — index.html has several other inline <script> blocks
// that declare their own top-level consts (e.g. a bodyweight archiver also
// named FOUR_WEEKS_MS). Classic <script> tags share one lexical scope for
// top-level `const`/`let`/`function`, so without this wrapper those names
// collide and silently abort this whole file's execution.
(function () {

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;
const LAST_RUN_KEY = 'lastWorkoutArchiveAt';
const ARCHIVED_IDS_KEY = 'archivedWorkoutIds'; // prevent double-archiving
const HISTORY_KEY_PREFIX = 'workoutHistory_';

/* ── Helpers ─────────────────────────────────────────────── */

function _archiverUser() {
  if (typeof window !== 'undefined' && window.currentUser) return window.currentUser;
  if (typeof localStorage !== 'undefined') return localStorage.getItem('fitnessAppUser');
  return null;
}

function _archiverParse(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function _archiverCutoff(now) {
  return now - FOUR_WEEKS_MS;
}

function _archiverShouldRun(now) {
  const last = localStorage.getItem(LAST_RUN_KEY);
  if (!last) return true;
  return (now - new Date(last).getTime()) >= FOUR_WEEKS_MS;
}

function _authHeaders() {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* ── Collect workouts older than 4 weeks from Log History ─── */

function collectWorkoutsDueForBackendArchive(username, now = Date.now()) {
  const storageKey = `${HISTORY_KEY_PREFIX}${username}`;
  const all = _archiverParse(storageKey) || [];
  const archivedIds = new Set(_archiverParse(ARCHIVED_IDS_KEY) || []);
  const cutoff = _archiverCutoff(now);

  const toArchive = [];
  const toKeep = [];

  for (const w of all) {
    const ts = new Date(w?.date || w?.createdAt || 0).getTime();
    const key = w?.id || w?.date;
    if (ts > 0 && ts < cutoff && !archivedIds.has(key)) {
      toArchive.push(w);
    } else {
      toKeep.push(w);
    }
  }

  return { toArchive, toKeep, storageKey };
}

/* ── Map a localStorage workout to the /workouts payload ──── */

function buildWorkoutBackendPayload(workout) {
  const rawDate = workout?.date || workout?.createdAt || '';
  const date = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();
  return {
    date,
    title: workout?.title || workout?.name || 'Workout',
    workout
  };
}

/* ── POST a single workout to the real backend ──────────────── */

async function _postWorkoutToBackend(fetchImpl, serverUrl, payload) {
  const res = await fetchImpl(`${serverUrl}/workouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify(payload),
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error(data?.error?.message || `Server returned ${res.status}`);
  }
  return data;
}

/* ── Toast notification ──────────────────────────────────── */

function _toast(count) {
  if (typeof document === 'undefined') return;
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
  el.textContent = `📦 ${count} workout${count !== 1 ? 's' : ''} saved to your account`;
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

async function archiveWorkoutsToBackend(now = Date.now()) {
  const username = _archiverUser();
  if (!username) return;
  if (typeof window === 'undefined' || !window.SERVER_URL) return;
  if (typeof localStorage === 'undefined' || !localStorage.getItem('token')) {
    console.log('[WorkoutArchiver] No auth token yet — skipping.');
    return;
  }
  if (!_archiverShouldRun(now)) {
    console.log('[WorkoutArchiver] Not due yet — skipping.');
    return;
  }

  const { toArchive, toKeep, storageKey } = collectWorkoutsDueForBackendArchive(username, now);

  if (toArchive.length === 0) {
    console.log('[WorkoutArchiver] No old workouts to hard-save.');
    localStorage.setItem(LAST_RUN_KEY, new Date(now).toISOString());
    return;
  }

  console.log(`[WorkoutArchiver] Hard-saving ${toArchive.length} workout(s) to backend…`);

  const archivedIds = new Set(_archiverParse(ARCHIVED_IDS_KEY) || []);
  const stillPending = [];
  let successCount = 0;

  for (const w of toArchive) {
    try {
      await _postWorkoutToBackend(fetch, window.SERVER_URL, buildWorkoutBackendPayload(w));
      archivedIds.add(w?.id || w?.date);
      successCount++;
    } catch (err) {
      console.warn('[WorkoutArchiver] Failed to hard-save a workout — keeping it locally:', err.message);
      stillPending.push(w);
    }
  }

  // Only drop from localStorage the ones that actually made it to the backend.
  localStorage.setItem(storageKey, JSON.stringify([...toKeep, ...stillPending]));
  localStorage.setItem(ARCHIVED_IDS_KEY, JSON.stringify([...archivedIds]));
  localStorage.setItem(LAST_RUN_KEY, new Date(now).toISOString());

  console.log(`[WorkoutArchiver] Done — ${successCount} hard-saved, ${stillPending.length} retrying next time.`);

  if (successCount > 0) {
    _toast(successCount);
    // The "last time" progressive-overload lookup reads workoutHistory_{user}
    // directly; refresh its remote fallback cache so entries we just removed
    // locally don't momentarily disappear from that comparison.
    if (typeof window.refreshRemoteOverloadCache === 'function') {
      window.refreshRemoteOverloadCache(username);
    }
  }
}

/* ── Wire up ─────────────────────────────────────────────── */

if (typeof module !== 'undefined') {
  module.exports = {
    archiveWorkoutsToBackend,
    collectWorkoutsDueForBackendArchive,
    buildWorkoutBackendPayload
  };
}

if (typeof window !== 'undefined') {
  window.archiveWorkoutsToBackend = archiveWorkoutsToBackend;

  // Auto-run 4 seconds after DOM ready (gives app time to restore currentUser).
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (_archiverUser()) archiveWorkoutsToBackend();
    }, 4000);
  });
}

})();
