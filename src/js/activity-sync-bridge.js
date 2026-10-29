// ── Activity Sync bridge ──────────────────────────────────────────────────
// Single owner of "fetch today's synced activity/sleep and apply it
// everywhere it belongs." Existing widgets (the step ring, Today's Mission,
// the Sleep tab) read from localStorage the same way they already do for
// every other metric — this module just keeps that localStorage in sync
// with the backend, so those widgets need no changes of their own to pick
// up real data.
//
// Consumers:
//   - archetype-features.js's step ring reads localStorage['dailySteps']
//     (unchanged key/shape — this module writes the synced count there).
//   - dailyMissionEngine's `stepsComplete` mission item, via the new
//     syncMissionFromActivitySync() (dailyMissionEngine.js).
//   - Settings' own summary line (settings.js) calls fetchAndApplyTodayActivity
//     directly instead of doing its own separate fetch.
//   - index.html's initSleepTab() reads localStorage['sleepLog_' + user]
//     (this module merges synced bedtime/wakeTime/duration into it, keeping
//     any manually-entered quality/tags/notes) and
//     localStorage['activitySyncSleep_' + user] for the score/stage detail.
(function (globalScope) {
  'use strict';

  const CONNECTED_FLAG_KEY = 'activitySyncConnected';
  const THROTTLE_MS = 2 * 60 * 1000; // don't refetch more than once per 2 min
  let lastFetchedAt = 0;
  let inFlight = null;
  let lastSleepFetchedAt = 0;
  let sleepInFlight = null;
  let lastCardioFetchedAt = 0;
  let cardioInFlight = null;
  const CARDIO_SYNC_DAYS = 7; // how far back tracker workouts are merged

  // The user's own calendar date (YYYY-MM-DD). Synced data is requested and
  // stored by local date so the day rolls over at the user's midnight, not UTC's.
  function localDateKey(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function getTodayKey() {
    return localDateKey();
  }

  function getActiveUsername() {
    if (globalScope.currentUser) return globalScope.currentUser;
    try {
      return globalScope.localStorage?.getItem('fitnessAppUser') || 'guest';
    } catch (_error) {
      return 'guest';
    }
  }

  function getStepsGoal() {
    try {
      const user = getActiveUsername();
      const s = JSON.parse(globalScope.localStorage.getItem(`settings_${user}`) || '{}');
      return s?.profile?.goals?.stepsTarget || 10000;
    } catch (_error) {
      return 10000;
    }
  }

  // settings.profile.goals.sleepTarget is stored in hours (see settings.html's
  // "Sleep target (hrs)" field) — this was a dead field until now.
  function getSleepGoalMinutes() {
    try {
      const user = getActiveUsername();
      const s = JSON.parse(globalScope.localStorage.getItem(`settings_${user}`) || '{}');
      const hours = Number(s?.profile?.goals?.sleepTarget);
      return hours > 0 ? Math.round(hours * 60) : 480;
    } catch (_error) {
      return 480;
    }
  }

  function setConnectedFlag(connected) {
    try {
      globalScope.localStorage.setItem(CONNECTED_FLAG_KEY, connected ? '1' : '0');
    } catch (_error) {
      // localStorage unavailable — nothing else to do.
    }
  }

  function isConnected() {
    try {
      return globalScope.localStorage.getItem(CONNECTED_FLAG_KEY) === '1';
    } catch (_error) {
      return false;
    }
  }

  function writeStepsThrough(steps) {
    try {
      const data = JSON.parse(globalScope.localStorage.getItem('dailySteps') || '{}');
      data[getTodayKey()] = steps;
      globalScope.localStorage.setItem('dailySteps', JSON.stringify(data));
    } catch (_error) {
      // Non-fatal — the ring just won't update this cycle.
    }
  }

  function cacheActivity(activity) {
    try {
      const user = getActiveUsername();
      const key = `activitySync_${user}`;
      const store = JSON.parse(globalScope.localStorage.getItem(key) || '{}');
      store[activity.date || getTodayKey()] = activity;
      globalScope.localStorage.setItem(key, JSON.stringify(store));
    } catch (_error) {
      // Non-fatal — the info line just won't have anything to show.
    }
  }

  function getCachedTodayActivity() {
    try {
      const user = getActiveUsername();
      const store = JSON.parse(globalScope.localStorage.getItem(`activitySync_${user}`) || '{}');
      return store[getTodayKey()] || null;
    } catch (_error) {
      return null;
    }
  }

  // Renders the compact "4.2 km · 312 kcal active · 38 active min" line in
  // the step-widget pod, same format Settings already uses for its summary.
  // Re-run from cache on every homeTab visit (not just after a fresh fetch)
  // so the line survives a throttled/skipped refetch.
  function renderSyncInfoLine() {
    const el = globalScope.document?.getElementById('stepWidgetSyncInfo');
    if (!el) return;
    const activity = isConnected() ? getCachedTodayActivity() : null;
    if (!activity) {
      el.style.display = 'none';
      return;
    }
    const km = Number(activity.distanceKm || 0).toFixed(1);
    const kcal = Math.round(Number(activity.caloriesOut) || 0);
    const activeMin = Math.round(Number(activity.activeMinutes) || 0);
    el.textContent = `${km} km · ${kcal} kcal active · ${activeMin} active min`;
    el.style.display = '';
  }

  // Merges synced bedtime/wakeTime/duration into the existing sleepLog entry
  // for that date, preserving any manually-entered quality/tags/notes.
  // Creates a blank (quality:0/tags:[]/notes:'') entry if none exists yet.
  // Marks the entry `synced: true` so initSleepTab() knows to show those
  // fields as read-only instead of editable (see index.html's saveSleepEntry).
  function mergeSleepLogEntry(sleep) {
    try {
      const user = getActiveUsername();
      const key = `sleepLog_${user}`;
      const log = JSON.parse(globalScope.localStorage.getItem(key) || '[]');
      const bedtimeLocal = new Date(sleep.bedtime).toTimeString().slice(0, 5);
      const wakeTimeLocal = new Date(sleep.wakeTime).toTimeString().slice(0, 5);
      const durationHours = Math.round((sleep.sleepMinutes / 60) * 100) / 100;

      const idx = log.findIndex((e) => e.date === sleep.date);
      if (idx >= 0) {
        log[idx] = {
          ...log[idx],
          bedtime: bedtimeLocal,
          wakeTime: wakeTimeLocal,
          duration: durationHours,
          synced: true,
          ts: Date.now()
        };
      } else {
        log.push({
          date: sleep.date,
          bedtime: bedtimeLocal,
          wakeTime: wakeTimeLocal,
          duration: durationHours,
          quality: 0,
          tags: [],
          notes: '',
          synced: true,
          ts: Date.now()
        });
        log.sort((a, b) => b.date.localeCompare(a.date));
      }
      globalScope.localStorage.setItem(key, JSON.stringify(log));
    } catch (_error) {
      // Non-fatal — the Sleep tab just won't show synced data this cycle.
    }
  }

  function cacheSleepDetail(sleep) {
    try {
      const user = getActiveUsername();
      const key = `activitySyncSleep_${user}`;
      const store = JSON.parse(globalScope.localStorage.getItem(key) || '{}');
      store[sleep.date] = sleep;
      globalScope.localStorage.setItem(key, JSON.stringify(store));
    } catch (_error) {
      // Non-fatal — the sleep score card just won't have anything to show.
    }
  }

  function rerenderSleepConsumers() {
    try {
      const sleepTab = globalScope.document?.getElementById('sleepTab');
      if (sleepTab?.classList.contains('active')) {
        globalScope.renderSleepTab?.();
      }
    } catch (_error) { /* ignore */ }
  }

  async function fetchAndApplyTodaySleep(options = {}) {
    const force = Boolean(options.force);
    if (!force && Date.now() - lastSleepFetchedAt < THROTTLE_MS) return null;
    if (sleepInFlight) return sleepInFlight;

    if (typeof globalScope.getAuthHeaders !== 'function'
      || typeof globalScope.ensureServerUrl !== 'function'
      || typeof globalScope.fetchWithTimeout !== 'function') {
      return null;
    }

    const authHeaders = globalScope.getAuthHeaders();
    if (!authHeaders.Authorization) return null;

    sleepInFlight = (async () => {
      try {
        const goalMinutes = getSleepGoalMinutes();
        const res = await globalScope.fetchWithTimeout(
          `${globalScope.ensureServerUrl()}/api/activity-sync/sleep?goalMinutes=${goalMinutes}&date=${getTodayKey()}`,
          { headers: authHeaders },
          8000
        );
        const data = await res.json();
        lastSleepFetchedAt = Date.now();

        if (!res.ok || !data.success) {
          const code = data?.error?.code;
          const expected = ['activity_sync.disabled', 'activity_sync.not_connected', 'activity_sync.no_sleep_data'];
          if (code && !expected.includes(code)) {
            console.warn('[ActivitySyncBridge] sleep fetch failed', code);
          }
          return null;
        }

        const sleep = data.sleep;
        mergeSleepLogEntry(sleep);
        cacheSleepDetail(sleep);
        rerenderSleepConsumers();
        return sleep;
      } catch (error) {
        console.warn('[ActivitySyncBridge] sleep fetch failed', error);
        return null;
      } finally {
        sleepInFlight = null;
      }
    })();

    return sleepInFlight;
  }

  function applyMissionSync(activity) {
    try {
      globalScope.dailyMissionEngine?.syncMissionFromActivitySync?.(
        { date: activity.date, steps: activity.steps, stepsGoal: getStepsGoal() },
        getActiveUsername()
      );
    } catch (_error) {
      // Non-fatal — mission state just won't reflect steps this cycle.
    }
  }

  function rerenderConsumers() {
    try { globalScope.refreshStepWidget?.(); } catch (_error) { /* ignore */ }
    try { renderSyncInfoLine(); } catch (_error) { /* ignore */ }
    try {
      const homeTab = globalScope.document?.getElementById('homeTab');
      if (homeTab?.classList.contains('active')) {
        globalScope.renderHomeDashboard?.();
      }
    } catch (_error) { /* ignore */ }
  }

  async function fetchAndApplyTodayActivity(options = {}) {
    const force = Boolean(options.force);
    if (!force && Date.now() - lastFetchedAt < THROTTLE_MS) return null;
    if (inFlight) return inFlight;

    if (typeof globalScope.getAuthHeaders !== 'function'
      || typeof globalScope.ensureServerUrl !== 'function'
      || typeof globalScope.fetchWithTimeout !== 'function') {
      return null;
    }

    const authHeaders = globalScope.getAuthHeaders();
    if (!authHeaders.Authorization) {
      setConnectedFlag(false);
      return null;
    }

    inFlight = (async () => {
      try {
        const res = await globalScope.fetchWithTimeout(
          `${globalScope.ensureServerUrl()}/api/activity-sync/activity?date=${getTodayKey()}`,
          { headers: authHeaders },
          8000
        );
        const data = await res.json();
        lastFetchedAt = Date.now();

        if (!res.ok || !data.success) {
          // activity_sync.disabled / activity_sync.not_connected are expected
          // no-ops — anything else is worth a quiet console note, not a throw.
          const code = data?.error?.code;
          setConnectedFlag(false);
          if (code && code !== 'activity_sync.disabled' && code !== 'activity_sync.not_connected') {
            console.warn('[ActivitySyncBridge] activity fetch failed', code);
          }
          return null;
        }

        setConnectedFlag(true);
        const activity = data.activity;
        writeStepsThrough(Number(activity.steps) || 0);
        cacheActivity(activity);
        applyMissionSync(activity);
        rerenderConsumers();
        return activity;
      } catch (error) {
        console.warn('[ActivitySyncBridge] fetch failed', error);
        return null;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  // ── Cardio: tracker workouts → cardio log ──────────────────────────────
  // Workouts from the tracker are merged into cardioLog_<user> as entries
  // marked source: 'activity-sync'. They replace a manual entry of the same
  // type, day and roughly the same length (the tracker's numbers win), and
  // are re-synced each time so edits/deletions on the tracker carry over.
  // Removing one in the app records its syncId so it isn't added back.
  const CARDIO_SOURCE = 'activity-sync';

  const EXERCISE_TYPE_MAP = {
    run: ['RUNNING', 'TRAIL_RUN', 'TREADMILL', 'INCLINE_RUN', 'TRACK_AND_FIELD', 'WATER_JOGGING'],
    walk: ['WALKING', 'POWER_WALKING', 'TREADMILL_WALK', 'INCLINE_WALK', 'NORDIC_WALKING',
      'STROLLER_WALK', 'WALK_WITH_WEIGHTS', 'RUCKING'],
    cycle: ['BIKING', 'OUTDOOR_BIKE', 'MOUNTAIN_BIKE', 'STATIONARY_BIKE', 'SPINNING',
      'ASSAULT_BIKE', 'HAND_CYCLING', 'ELECTRIC_BIKE'],
    swim: ['SWIMMING', 'SWIMMING_POOL', 'SWIMMING_OPEN_WATER'],
    row: ['ROWING', 'ROWING_MACHINE'],
    hiit: ['HIIT', 'INTERVAL_WORKOUT', 'TABATA_WORKOUT', 'CIRCUIT_TRAINING', 'BOOTCAMP', 'CROSSFIT'],
    hike: ['HIKING', 'BACKPACKING'],
    yoga: ['YOGA', 'YOGA_BIKRAM', 'YOGA_HATHA', 'YOGA_POWER', 'YOGA_VINYASA'],
    elliptical: ['ELLIPTICAL']
  };
  const EXERCISE_TO_CARDIO = Object.entries(EXERCISE_TYPE_MAP).reduce((acc, [type, list]) => {
    list.forEach((g) => { acc[g] = type; });
    return acc;
  }, {});
  // Lifting and non-cardio sessions belong in the workout log, not cardio.
  const NON_CARDIO_TYPES = new Set([
    'STRENGTH_TRAINING', 'WEIGHTLIFTING', 'WEIGHTS', 'FREE_WEIGHTS', 'WEIGHT_MACHINES',
    'POWERLIFTING', 'FUNCTIONAL_STRENGTH_TRAINING', 'BODY_WEIGHT', 'CALISTHENICS',
    'CORE_TRAINING', 'RESISTANCE_BANDS', 'TRX', 'STRETCHING', 'MEDITATE'
  ]);

  function prettyExerciseType(googleType) {
    const words = String(googleType || '').toLowerCase().split('_').filter(Boolean);
    if (!words.length || googleType === 'EXERCISE_TYPE_UNSPECIFIED') return 'other';
    const text = words.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // App cardio type for a Google exercise type, or null when it isn't cardio.
  function cardioTypeFor(googleType) {
    if (NON_CARDIO_TYPES.has(googleType)) return null;
    return EXERCISE_TO_CARDIO[googleType] || prettyExerciseType(googleType);
  }

  function toCardioEntry(exercise) {
    const type = cardioTypeFor(exercise?.exerciseType);
    if (!type || !exercise?.date || !(exercise.durationMinutes > 0)) return null;
    const tab = globalScope.cardioTab;
    const distance = exercise.distanceKm > 0 ? exercise.distanceKm : null;
    return {
      date: exercise.date,
      type,
      duration: exercise.durationMinutes,
      distance,
      calories: exercise.calories > 0 ? exercise.calories : 0,
      estimatedCalories: null,
      met: tab?.resolveMET ? tab.resolveMET(type) : null,
      paceOrSpeed: distance && tab?.computePaceOrSpeed
        ? tab.computePaceOrSpeed({ type, durationMinutes: exercise.durationMinutes, distanceKm: distance })
        : null,
      notes: exercise.displayName || '',
      intensity: 'moderate',
      heartRate: exercise.avgHeartRate > 0 ? exercise.avgHeartRate : null,
      source: CARDIO_SOURCE,
      syncId: exercise.syncId,
      startTime: exercise.startTime || null
    };
  }

  // Same session logged by hand: same day and type, similar length.
  function isLikelySameSession(manual, synced) {
    if (manual.date !== synced.date) return false;
    if (String(manual.type || '').toLowerCase() !== String(synced.type).toLowerCase()) return false;
    const a = Number(manual.duration) || 0;
    const b = Number(synced.duration) || 0;
    return Math.abs(a - b) <= Math.max(10, 0.5 * Math.max(a, b));
  }

  // Returns the new cardio log after merging tracker workouts for local
  // dates start..end. Pure: no storage access, so it's unit-testable.
  function mergeSyncedCardio(log, exercises, { start, end, dismissed = [] }) {
    const inRange = (d) => typeof d === 'string' && d >= start && d <= end;
    const dismissedIds = new Set(dismissed);
    // Drop previous synced entries in range; the fresh list replaces them.
    const result = (Array.isArray(log) ? log : [])
      .filter((e) => !(e && e.source === CARDIO_SOURCE && inRange(e.date)));

    (Array.isArray(exercises) ? exercises : []).forEach((exercise) => {
      const entry = toCardioEntry(exercise);
      if (!entry || !inRange(entry.date) || dismissedIds.has(entry.syncId)) return;
      const dupIdx = result.findIndex((e) => e && e.source !== CARDIO_SOURCE && isLikelySameSession(e, entry));
      if (dupIdx >= 0) {
        if (!entry.notes && result[dupIdx].notes) entry.notes = result[dupIdx].notes;
        result.splice(dupIdx, 1);
      }
      result.push(entry);
    });
    return result;
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(globalScope.localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  }

  // Called by removeCardioEntry (index.html) so a synced workout the user
  // deleted stays deleted on the next sync.
  function dismissSyncedCardio(entry) {
    if (!entry || entry.source !== CARDIO_SOURCE || !entry.syncId) return;
    try {
      const key = `cardioSyncDismissed_${getActiveUsername()}`;
      const ids = readJson(key, []);
      if (!ids.includes(entry.syncId)) {
        ids.push(entry.syncId);
        globalScope.localStorage.setItem(key, JSON.stringify(ids.slice(-500)));
      }
    } catch (_error) { /* non-fatal */ }
  }

  function rerenderCardioConsumers() {
    try {
      if (globalScope.document?.getElementById('cardioTab')?.classList.contains('active')) {
        globalScope.renderCardio?.();
      }
    } catch (_error) { /* ignore */ }
    try { globalScope.updateMacroUI?.(); } catch (_error) { /* ignore */ }
  }

  async function fetchAndApplyCardio(options = {}) {
    const force = Boolean(options.force);
    if (!force && !isConnected()) return null;
    if (!force && Date.now() - lastCardioFetchedAt < THROTTLE_MS) return null;
    if (cardioInFlight) return cardioInFlight;

    if (typeof globalScope.getAuthHeaders !== 'function'
      || typeof globalScope.ensureServerUrl !== 'function'
      || typeof globalScope.fetchWithTimeout !== 'function') {
      return null;
    }
    const authHeaders = globalScope.getAuthHeaders();
    if (!authHeaders.Authorization) return null;

    cardioInFlight = (async () => {
      try {
        const end = getTodayKey();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (CARDIO_SYNC_DAYS - 1));
        const start = localDateKey(startDate);
        const res = await globalScope.fetchWithTimeout(
          `${globalScope.ensureServerUrl()}/api/activity-sync/exercises?start=${start}&end=${end}`,
          { headers: authHeaders },
          10000
        );
        const data = await res.json();
        lastCardioFetchedAt = Date.now();

        if (!res.ok || !data.success) {
          const code = data?.error?.code;
          if (code && code !== 'activity_sync.disabled' && code !== 'activity_sync.not_connected') {
            console.warn('[ActivitySyncBridge] workout fetch failed', code);
          }
          return null;
        }

        const user = getActiveUsername();
        const logKey = `cardioLog_${user}`;
        const before = readJson(logKey, []);
        const merged = mergeSyncedCardio(before, data.exercises, {
          start,
          end,
          dismissed: readJson(`cardioSyncDismissed_${user}`, [])
        });
        if (JSON.stringify(merged) !== JSON.stringify(before)) {
          globalScope.localStorage.setItem(logKey, JSON.stringify(merged));
          merged
            .filter((e) => e.source === CARDIO_SOURCE && e.date === end)
            .forEach((e) => {
              try { globalScope.dailyMissionEngine?.syncMissionFromCardioEntry?.(e, user); } catch (_error) { /* ignore */ }
            });
          rerenderCardioConsumers();
        }
        return merged;
      } catch (error) {
        console.warn('[ActivitySyncBridge] workout fetch failed', error);
        return null;
      } finally {
        cardioInFlight = null;
      }
    })();

    return cardioInFlight;
  }

  if (typeof globalScope.document !== 'undefined') {
    globalScope.document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        // Workouts only after the activity fetch has confirmed a connection.
        Promise.resolve(fetchAndApplyTodayActivity()).then(() => fetchAndApplyCardio());
        fetchAndApplyTodaySleep();
      }, 1000);
    });
    globalScope.document.addEventListener('traininglog:tab-changed', (e) => {
      if (e.detail?.tab === 'homeTab') {
        renderSyncInfoLine(); // reflect cache immediately, even if the fetch below is throttled
        fetchAndApplyTodayActivity();
      } else if (e.detail?.tab === 'sleepTab') {
        fetchAndApplyTodaySleep();
      } else if (e.detail?.tab === 'cardioTab') {
        fetchAndApplyCardio();
      }
    });
  }

  // Called right after a successful disconnect (settings.js) so the UI drops
  // out of "synced" mode immediately, instead of waiting for the next
  // throttled fetch to notice the connection is gone.
  function resetConnectionState() {
    setConnectedFlag(false);
    rerenderConsumers();
    rerenderSleepConsumers();
  }

  globalScope.activitySyncBridge = {
    fetchAndApplyTodayActivity,
    fetchAndApplyTodaySleep,
    fetchAndApplyCardio,
    dismissSyncedCardio,
    isConnected,
    resetConnectionState
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { localDateKey, cardioTypeFor, toCardioEntry, mergeSyncedCardio };
  }
})(typeof window !== 'undefined' ? window : globalThis);
