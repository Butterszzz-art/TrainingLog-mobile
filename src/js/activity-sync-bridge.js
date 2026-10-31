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
  let lastHistoryFetchedAt = 0;
  let historyInFlight = null;
  const HISTORY_THROTTLE_MS = 30 * 60 * 1000; // past days rarely change
  const BURN_AVERAGE_DAYS = 7;
  const BURN_AVERAGE_MIN_DAYS = 3;
  let lastRecoveryFetchedAt = 0;
  let recoveryInFlight = null;
  const RECOVERY_BASELINE_DAYS = 7;
  const NEEDS_RECONNECT_KEY = 'activitySyncNeedsReconnect';
  let lastBodyFetchedAt = 0;
  let bodyInFlight = null;
  const BODY_SYNC_DAYS = 30;
  const BASELINE_MIN_DAYS = 5;
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

  // Renders the compact "4.2 km · 2,310 kcal burned · 38 active min" line in
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
    // caloriesOut is the tracker's total burn for the day (resting + active).
    el.textContent = `${km} km · ${kcal.toLocaleString()} kcal burned · ${activeMin} active min`;
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
    try { renderTrackerBurn(); } catch (_error) { /* ignore */ }
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

  // ── Calories burned: tracker history → nutrition ───────────────────────
  // Past days' totals are cached in activitySync_<user> next to today's, so
  // the Macros screen can show today's burn and a 7-day average burn (a
  // measured maintenance figure) beside the calorie target.

  // Today's burn so far plus the average over recent complete days. Pure, so
  // it's unit-testable. The average needs BURN_AVERAGE_MIN_DAYS days of data.
  function computeBurnSummary(store, today) {
    const todayBurn = Number(store?.[today]?.caloriesOut) || 0;
    const start = new Date(`${today}T12:00:00`);
    start.setDate(start.getDate() - BURN_AVERAGE_DAYS);
    const from = localDateKey(start);
    const past = Object.values(store || {})
      .filter((d) => d && d.date >= from && d.date < today && Number(d.caloriesOut) > 0)
      .map((d) => Number(d.caloriesOut));
    const averageBurn = past.length >= BURN_AVERAGE_MIN_DAYS
      ? Math.round(past.reduce((a, b) => a + b, 0) / past.length)
      : 0;
    return { todayBurn: Math.round(todayBurn), averageBurn, averageDays: past.length };
  }

  function getBurnSummary() {
    return computeBurnSummary(readJson(`activitySync_${getActiveUsername()}`, {}), getTodayKey());
  }

  // Fills #macroTrackerBurn on the Macros screen; hidden without synced data.
  function renderTrackerBurn() {
    const el = globalScope.document?.getElementById('macroTrackerBurn');
    if (!el) return;
    const { todayBurn, averageBurn, averageDays } = isConnected()
      ? getBurnSummary()
      : { todayBurn: 0, averageBurn: 0, averageDays: 0 };
    const parts = [];
    if (todayBurn > 0) parts.push(`${todayBurn.toLocaleString()} kcal burned so far today`);
    if (averageBurn > 0) parts.push(`${averageBurn.toLocaleString()}/day average (last ${averageDays} days)`);
    if (!parts.length) {
      el.hidden = true;
      return;
    }
    el.textContent = `Tracker: ${parts.join(' · ')}`;
    el.hidden = false;
  }

  async function fetchAndApplyHistory(options = {}) {
    const force = Boolean(options.force);
    if (!force && !isConnected()) return null;
    if (!force && Date.now() - lastHistoryFetchedAt < HISTORY_THROTTLE_MS) return null;
    if (historyInFlight) return historyInFlight;

    if (typeof globalScope.getAuthHeaders !== 'function'
      || typeof globalScope.ensureServerUrl !== 'function'
      || typeof globalScope.fetchWithTimeout !== 'function') {
      return null;
    }
    const authHeaders = globalScope.getAuthHeaders();
    if (!authHeaders.Authorization) return null;

    historyInFlight = (async () => {
      try {
        const end = getTodayKey();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - BURN_AVERAGE_DAYS);
        const start = localDateKey(startDate);
        const res = await globalScope.fetchWithTimeout(
          `${globalScope.ensureServerUrl()}/api/activity-sync/daily?start=${start}&end=${end}`,
          { headers: authHeaders },
          10000
        );
        const data = await res.json();
        lastHistoryFetchedAt = Date.now();
        if (!res.ok || !data.success) {
          const code = data?.error?.code;
          if (code && code !== 'activity_sync.disabled' && code !== 'activity_sync.not_connected') {
            console.warn('[ActivitySyncBridge] history fetch failed', code);
          }
          return null;
        }

        const key = `activitySync_${getActiveUsername()}`;
        const store = readJson(key, {});
        (data.days || []).forEach((day) => {
          if (!day?.date || !day.hasData) return;
          const { hasData, ...values } = day;
          store[day.date] = { ...(store[day.date] || {}), ...values };
        });
        globalScope.localStorage.setItem(key, JSON.stringify(store));
        renderTrackerBurn();
        return store;
      } catch (error) {
        console.warn('[ActivitySyncBridge] history fetch failed', error);
        return null;
      } finally {
        historyInFlight = null;
      }
    })();

    return historyInFlight;
  }

  // ── Recovery: resting heart rate + HRV ─────────────────────────────────
  // Daily values from the tracker, cached in activitySyncRecovery_<user>.
  // Shown on the readiness check-in next to last night's synced sleep,
  // compared with the user's own 7-day baseline, and used to complete the
  // daily "Recovery" mission and fill HRV on the weekly check-in.

  function average(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  // Pure: today's values plus 7-day baselines from earlier days.
  function computeRecoverySummary(recoveryStore, sleepStore, today) {
    const todayRow = recoveryStore?.[today] || {};
    const start = new Date(`${today}T12:00:00`);
    start.setDate(start.getDate() - RECOVERY_BASELINE_DAYS);
    const from = localDateKey(start);
    const past = Object.values(recoveryStore || {}).filter((r) => r && r.date >= from && r.date < today);
    const baseline = (key) => {
      const vals = past.map((r) => Number(r[key])).filter((n) => n > 0);
      return vals.length >= 3 ? Math.round(average(vals) * 10) / 10 : null;
    };
    const sleepMinutes = Number(sleepStore?.[today]?.sleepMinutes) || null;
    return {
      date: today,
      restingHeartRate: Number(todayRow.restingHeartRate) > 0 ? Number(todayRow.restingHeartRate) : null,
      restingHeartRateBaseline: baseline('restingHeartRate'),
      hrvMs: Number(todayRow.hrvMs) > 0 ? Number(todayRow.hrvMs) : null,
      hrvBaseline: baseline('hrvMs'),
      sleepMinutes
    };
  }

  // One line for the readiness check-in, e.g. "From your tracker: slept
  // 7h 12m · resting HR 56 bpm (usual 53) · HRV 41 ms (usual 48)". Empty
  // when there's nothing synced for today.
  function recoverySummaryText(summary) {
    if (!summary) return '';
    const parts = [];
    if (summary.sleepMinutes) {
      const h = Math.floor(summary.sleepMinutes / 60);
      const m = Math.round(summary.sleepMinutes % 60);
      parts.push(`slept ${h}h ${String(m).padStart(2, '0')}m`);
    }
    if (summary.restingHeartRate) {
      const usual = summary.restingHeartRateBaseline ? ` (usual ${Math.round(summary.restingHeartRateBaseline)})` : '';
      parts.push(`resting HR ${Math.round(summary.restingHeartRate)} bpm${usual}`);
    }
    if (summary.hrvMs) {
      const usual = summary.hrvBaseline ? ` (usual ${Math.round(summary.hrvBaseline)})` : '';
      parts.push(`HRV ${Math.round(summary.hrvMs)} ms${usual}`);
    }
    return parts.length ? `From your tracker: ${parts.join(' · ')}` : '';
  }

  function getRecoverySummary() {
    const user = getActiveUsername();
    return computeRecoverySummary(
      readJson(`activitySyncRecovery_${user}`, {}),
      readJson(`activitySyncSleep_${user}`, {}),
      getTodayKey()
    );
  }

  function getRecoverySummaryText() {
    return isConnected() ? recoverySummaryText(getRecoverySummary()) : '';
  }

  // Today's HRV for the weekly check-in (0 when not synced).
  function getTodayHrv() {
    return isConnected() ? (getRecoverySummary().hrvMs || 0) : 0;
  }

  function needsReconnect() {
    try {
      return globalScope.localStorage.getItem(NEEDS_RECONNECT_KEY) === '1';
    } catch (_error) {
      return false;
    }
  }

  function setNeedsReconnect(value) {
    try {
      globalScope.localStorage.setItem(NEEDS_RECONNECT_KEY, value ? '1' : '0');
    } catch (_error) { /* non-fatal */ }
  }

  // Ticks today's "Recovery" mission once the tracker has synced sleep or
  // heart data for today, so it doesn't wait for a manual entry.
  function applyRecoveryMission() {
    try {
      const summary = getRecoverySummary();
      if (!summary.sleepMinutes && !summary.hrvMs && !summary.restingHeartRate) return;
      globalScope.dailyMissionEngine?.syncMissionFromRecoveryEntry?.({
        sleepHours: summary.sleepMinutes ? summary.sleepMinutes / 60 : 0,
        hrv: summary.hrvMs || 0,
        // No date: the mission engine files it under its own "today".
      }, getActiveUsername());
    } catch (_error) { /* non-fatal */ }
  }

  async function fetchAndApplyRecovery(options = {}) {
    const force = Boolean(options.force);
    if (!force && !isConnected()) return null;
    if (!force && Date.now() - lastRecoveryFetchedAt < HISTORY_THROTTLE_MS) return null;
    if (recoveryInFlight) return recoveryInFlight;

    if (typeof globalScope.getAuthHeaders !== 'function'
      || typeof globalScope.ensureServerUrl !== 'function'
      || typeof globalScope.fetchWithTimeout !== 'function') {
      return null;
    }
    const authHeaders = globalScope.getAuthHeaders();
    if (!authHeaders.Authorization) return null;

    recoveryInFlight = (async () => {
      try {
        const end = getTodayKey();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - RECOVERY_BASELINE_DAYS);
        const start = localDateKey(startDate);
        const res = await globalScope.fetchWithTimeout(
          `${globalScope.ensureServerUrl()}/api/activity-sync/recovery?start=${start}&end=${end}`,
          { headers: authHeaders },
          10000
        );
        const data = await res.json();
        lastRecoveryFetchedAt = Date.now();
        if (!res.ok || !data.success) {
          const code = data?.error?.code;
          if (code === 'activity_sync.needs_reconnect') setNeedsReconnect(true);
          else if (code && code !== 'activity_sync.disabled' && code !== 'activity_sync.not_connected') {
            console.warn('[ActivitySyncBridge] recovery fetch failed', code);
          }
          applyRecoveryMission(); // synced sleep alone still counts
          return null;
        }
        setNeedsReconnect(false);

        const key = `activitySyncRecovery_${getActiveUsername()}`;
        const store = readJson(key, {});
        (data.days || []).forEach((day) => {
          if (!day?.date) return;
          store[day.date] = { ...(store[day.date] || {}), ...day };
        });
        globalScope.localStorage.setItem(key, JSON.stringify(store));
        applyRecoveryMission();
        return store;
      } catch (error) {
        console.warn('[ActivitySyncBridge] recovery fetch failed', error);
        return null;
      } finally {
        recoveryInFlight = null;
      }
    })();

    return recoveryInFlight;
  }

  // ── Body: smart-scale weigh-ins + vitals analysis ──────────────────────
  // Weigh-ins fill the weight log only on days the user didn't log weight in
  // the app (the app always wins), and add body fat to an app entry that has
  // none. Vitals are compared with the user's own last 30 days for the Body
  // tab's analysis panel (body-hub.js).
  const SCALE_SOURCE = 'activity-sync';

  function kgTo(unit, kg) {
    if (typeof globalScope.convertWeightValue === 'function') {
      return globalScope.convertWeightValue(kg, 'kg', unit, 1);
    }
    return unit === 'lb' ? Math.round(kg * 2.20462 * 10) / 10 : Math.round(kg * 10) / 10;
  }

  // Pure: the weight log after applying weigh-ins for local dates start..end.
  function mergeScaleWeighIns(log, weighIns, { start, end, unit = 'kg', dismissed = [] }) {
    const inRange = (d) => typeof d === 'string' && d >= start && d <= end;
    const dismissedDates = new Set(dismissed);
    const result = (Array.isArray(log) ? log : [])
      .filter((e) => !(e && e.source === SCALE_SOURCE && inRange(e.date)))
      .map((e) => ({ ...e }));

    (Array.isArray(weighIns) ? weighIns : []).forEach((w) => {
      if (!w || !inRange(w.date)) return;
      const appEntry = result.find((e) => e.date === w.date);
      if (appEntry) {
        // App-logged weight wins; only fill in body fat it doesn't have.
        const canFillFat = appEntry.bodyFatPercent == null || appEntry.bodyFatSource === SCALE_SOURCE;
        if (canFillFat && w.bodyFatPercent > 0) {
          appEntry.bodyFatPercent = w.bodyFatPercent;
          appEntry.bodyFatSource = SCALE_SOURCE;
        }
        return;
      }
      if (!(w.weightKg > 0) || dismissedDates.has(w.date)) return;
      const entry = {
        weight: kgTo(unit, w.weightKg),
        unit,
        weightKg: w.weightKg,
        date: w.date,
        calories: null,
        cardio: null,
        source: SCALE_SOURCE
      };
      if (w.bodyFatPercent > 0) entry.bodyFatPercent = w.bodyFatPercent;
      result.push(entry);
    });
    return result.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  }

  // Called by removeWeightEntry (index.html): a scale weigh-in the user
  // deleted stays deleted on the next sync.
  function dismissSyncedWeight(entry) {
    if (!entry || entry.source !== SCALE_SOURCE || !entry.date) return;
    try {
      const key = `weightSyncDismissed_${getActiveUsername()}`;
      const dates = readJson(key, []);
      if (!dates.includes(entry.date)) {
        dates.push(entry.date);
        globalScope.localStorage.setItem(key, JSON.stringify(dates.slice(-400)));
      }
    } catch (_error) { /* non-fatal */ }
  }

  // Profile body fat (used by the macro calculator) comes from the scale only
  // while the user hasn't entered their own.
  function applyProfileBodyFat(weighIns) {
    try {
      const latest = [...(weighIns || [])].reverse().find((w) => w?.bodyFatPercent > 0);
      if (!latest) return;
      const details = readJson('personalDetails', null);
      if (!details || typeof details !== 'object') return;
      const own = details.bodyFatPercent != null && details.bodyFatSource !== SCALE_SOURCE;
      if (own || details.bodyFatPercent === latest.bodyFatPercent) return;
      details.bodyFatPercent = latest.bodyFatPercent;
      details.bodyFatSource = SCALE_SOURCE;
      globalScope.localStorage.setItem('personalDetails', JSON.stringify(details));
    } catch (_error) { /* non-fatal */ }
  }

  const VITALS = [
    { key: 'restingHeartRate', phrase: 'resting heart rate', label: 'Resting HR', unit: 'bpm', decimals: 0, bad: 'up', minBand: 3,
      about: 'Beats per minute at rest, measured overnight. A few beats above your usual can point to fatigue, stress, illness or alcohol.' },
    { key: 'hrvMs', phrase: 'HRV', label: 'HRV', unit: 'ms', decimals: 0, bad: 'down', relBand: 0.15,
      about: 'Variation between heartbeats during sleep. Lower than your usual often means your body is under more stress.' },
    { key: 'spo2', phrase: 'blood oxygen', label: 'Blood oxygen', unit: '%', decimals: 1, bad: 'down', minBand: 1.5, floor: 94,
      about: 'Average oxygen saturation while you slept. It usually sits around 95–100%.' },
    { key: 'respiratoryRate', phrase: 'breathing rate', label: 'Breathing rate', unit: '/min', decimals: 1, bad: 'up', minBand: 1,
      about: 'Breaths per minute during sleep. It is very steady day to day, so a jump stands out.' },
    { key: 'skinTempDelta', phrase: 'skin temperature', label: 'Skin temp', unit: '°C', decimals: 1, bad: 'both', fixedBand: 0.5, signed: true,
      about: 'Overnight skin temperature compared with your own baseline. A rise can come with illness, a hard training block or a warm room.' },
    { key: 'vo2Max', phrase: 'cardio fitness', label: 'Cardio fitness', unit: 'VO₂ max', decimals: 1, bad: null,
      about: 'Estimated maximum oxygen use during exercise. Higher means fitter; it changes slowly over weeks.' }
  ];

  function stats(values) {
    const mean = average(values);
    const sd = Math.sqrt(average(values.map((v) => (v - mean) ** 2)));
    return { mean, sd };
  }

  function shiftDate(dateStr, days) {
    const d = new Date(`${dateStr}T12:00:00`);
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }

  // Pure: per-metric latest value, usual range and flag, plus an overall
  // status. daysStore is { 'YYYY-MM-DD': { restingHeartRate, hrvMs, ... } }.
  function analyzeVitals(daysStore, today) {
    const rows = Object.values(daysStore || {})
      .filter((r) => r && typeof r.date === 'string' && r.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    const freshFrom = shiftDate(today, -2);
    const sparkFrom = shiftDate(today, -13);

    const metrics = VITALS.map((def) => {
      const series = rows.filter((r) => typeof r[def.key] === 'number');
      if (!series.length) return null;
      const latest = series[series.length - 1];
      const value = latest[def.key];
      const baseFrom = shiftDate(latest.date, -30);
      const base = series.filter((r) => r.date < latest.date && r.date >= baseFrom).map((r) => r[def.key]);
      let low = null;
      let high = null;
      if (def.fixedBand != null) {
        low = -def.fixedBand;
        high = def.fixedBand;
      } else if (base.length >= BASELINE_MIN_DAYS) {
        const { mean, sd } = stats(base);
        const band = Math.max(1.5 * sd, def.minBand || 0, (def.relBand || 0) * mean);
        low = mean - band;
        high = mean + band;
      }
      const fresh = latest.date >= freshFrom;
      let flag = null;
      if (fresh && def.bad) {
        if (def.floor != null && value < def.floor) flag = 'low';
        else if (low != null && (def.bad === 'down' || def.bad === 'both') && value < low) flag = 'low';
        else if (high != null && (def.bad === 'up' || def.bad === 'both') && value > high) flag = 'high';
      }
      const monthAgo = series.find((r) => r.date >= baseFrom);
      return {
        key: def.key,
        label: def.label,
        phrase: def.phrase,
        unit: def.unit,
        decimals: def.decimals,
        signed: Boolean(def.signed),
        about: def.about,
        value,
        date: latest.date,
        fresh,
        usualLow: low,
        usualHigh: high,
        baselineDays: base.length,
        flag,
        change30: monthAgo && monthAgo !== latest ? value - monthAgo[def.key] : null,
        spark: series.filter((r) => r.date >= sparkFrom).map((r) => r[def.key]),
        month: series.filter((r) => r.date >= baseFrom).map((r) => r[def.key])
      };
    }).filter(Boolean);

    const scored = metrics.filter((m) => m.fresh && m.key !== 'vo2Max');
    const flagged = scored.filter((m) => m.flag);
    let status = null;
    if (flagged.length >= 2) {
      const names = flagged.map((m) => m.phrase);
      const list = names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join(' and ');
      status = { level: 'strained', title: 'Signs of strain', text: `${list.charAt(0).toUpperCase()}${list.slice(1)} are outside your usual range. Consider an easier day and extra sleep.` };
    } else if (flagged.length === 1) {
      const m = flagged[0];
      const what = `${m.phrase.charAt(0).toUpperCase()}${m.phrase.slice(1)}`;
      const where = m.key === 'spo2' && m.usualLow == null ? 'below the usual 95–100%' : `${m.flag === 'high' ? 'above' : 'below'} your usual range`;
      status = { level: 'watch', title: 'Worth watching', text: `${what} is ${where} today.` };
    } else if (scored.length) {
      const withRange = scored.filter((m) => m.usualLow != null && m.key !== 'skinTempDelta');
      if (withRange.length) {
        status = { level: 'good', title: 'In your usual range', text: 'Your overnight vitals look normal for you.' };
      } else {
        const have = Math.max(0, ...scored.map((m) => m.baselineDays));
        const left = Math.max(1, BASELINE_MIN_DAYS - have);
        status = { level: 'building', title: 'Learning your normal', text: `${left} more night${left === 1 ? '' : 's'} of data before your usual ranges are ready.` };
      }
    }
    return { status, metrics };
  }

  // Pure: weight + body-fat picture from the (merged) weight log. Body fat the
  // user entered in their profile wins over the scale's.
  function analyzeComposition(log, today, profileBodyFat) {
    const getKg = (e) => {
      if (typeof globalScope.getEntryWeightKg === 'function') return globalScope.getEntryWeightKg(e);
      const n = Number(e?.weightKg ?? e?.weight);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const from = shiftDate(today, -30);
    const recent = (Array.isArray(log) ? log : [])
      .filter((e) => e && e.date >= from && e.date <= today && getKg(e))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!recent.length) return null;
    const latest = recent[recent.length - 1];
    const weightKg = getKg(latest);
    const withFat = recent.filter((e) => e.bodyFatPercent > 0);
    const ownFat = profileBodyFat && profileBodyFat.value > 0 && profileBodyFat.source !== SCALE_SOURCE
      ? profileBodyFat.value : null;
    const scaleFat = withFat.length ? withFat[withFat.length - 1].bodyFatPercent : null;
    const bodyFatPercent = ownFat || scaleFat || null;
    const parts = (kg, pct) => ({ fatKg: kg * pct / 100, leanKg: kg * (1 - pct / 100) });
    const now = bodyFatPercent ? parts(weightKg, bodyFatPercent) : null;
    let change = null;
    const first = withFat[0];
    const last = withFat[withFat.length - 1];
    if (!ownFat && first && last && first !== last && shiftDate(first.date, 7) <= last.date) {
      const a = parts(getKg(first), first.bodyFatPercent);
      const b = parts(getKg(last), last.bodyFatPercent);
      change = { days: Math.round((new Date(last.date) - new Date(first.date)) / 86400000), fatKg: b.fatKg - a.fatKg, leanKg: b.leanKg - a.leanKg };
    }
    return {
      date: latest.date,
      weightKg,
      fromScale: latest.source === SCALE_SOURCE,
      bodyFatPercent,
      bodyFatFrom: ownFat ? 'profile' : (scaleFat ? 'scale' : null),
      fatKg: now ? now.fatKg : null,
      leanKg: now ? now.leanKg : null,
      change,
      weightKgChange30: recent.length > 1 ? weightKg - getKg(recent[0]) : null,
      fatSeries: withFat.map((e) => e.bodyFatPercent),
      weightSeries: recent.map(getKg)
    };
  }

  function getBodyAnalysis() {
    const user = getActiveUsername();
    const today = getTodayKey();
    const body = readJson(`activitySyncBody_${user}`, {});
    const details = readJson('personalDetails', null);
    return {
      connected: isConnected(),
      vitals: isConnected() ? analyzeVitals(body.days || {}, today) : { status: null, metrics: [] },
      composition: analyzeComposition(
        readJson(`bodyweightLog_${user}`, []),
        today,
        details ? { value: Number(details.bodyFatPercent), source: details.bodyFatSource } : null
      )
    };
  }

  function rerenderBodyConsumers() {
    try {
      const doc = globalScope.document;
      if (doc?.getElementById('bodyTab')?.classList.contains('active')) globalScope.renderBodyHub?.();
      if (doc?.getElementById('weightTab')?.classList.contains('active')) globalScope.renderWeights?.();
    } catch (_error) { /* ignore */ }
  }

  async function fetchAndApplyBody(options = {}) {
    const force = Boolean(options.force);
    if (!force && !isConnected()) return null;
    if (!force && Date.now() - lastBodyFetchedAt < HISTORY_THROTTLE_MS) return null;
    if (bodyInFlight) return bodyInFlight;

    if (typeof globalScope.getAuthHeaders !== 'function'
      || typeof globalScope.ensureServerUrl !== 'function'
      || typeof globalScope.fetchWithTimeout !== 'function') {
      return null;
    }
    const authHeaders = globalScope.getAuthHeaders();
    if (!authHeaders.Authorization) return null;

    bodyInFlight = (async () => {
      try {
        const end = getTodayKey();
        const start = shiftDate(end, -(BODY_SYNC_DAYS - 1));
        const res = await globalScope.fetchWithTimeout(
          `${globalScope.ensureServerUrl()}/api/activity-sync/body?start=${start}&end=${end}`,
          { headers: authHeaders },
          12000
        );
        const data = await res.json();
        lastBodyFetchedAt = Date.now();
        if (!res.ok || !data.success) {
          const code = data?.error?.code;
          if (code && code !== 'activity_sync.disabled' && code !== 'activity_sync.not_connected') {
            console.warn('[ActivitySyncBridge] body fetch failed', code);
          }
          return null;
        }
        if (data.needsReconnect) setNeedsReconnect(true);

        const user = getActiveUsername();
        const key = `activitySyncBody_${user}`;
        const store = readJson(key, {});
        store.days = store.days || {};
        (data.days || []).forEach((d) => { if (d?.date) store.days[d.date] = d; });
        // Keep ~60 days so the 30-day baselines have history to draw on.
        const keepFrom = shiftDate(end, -60);
        Object.keys(store.days).forEach((d) => { if (d < keepFrom) delete store.days[d]; });
        globalScope.localStorage.setItem(key, JSON.stringify(store));

        const pref = typeof globalScope.getBodyweightPreference === 'function'
          ? globalScope.getBodyweightPreference() : { unit: 'kg' };
        const logKey = `bodyweightLog_${user}`;
        const before = readJson(logKey, []);
        const merged = mergeScaleWeighIns(before, data.weighIns, {
          start,
          end,
          unit: pref?.unit === 'lb' ? 'lb' : 'kg',
          dismissed: readJson(`weightSyncDismissed_${user}`, [])
        });
        if (JSON.stringify(merged) !== JSON.stringify(before)) {
          globalScope.localStorage.setItem(logKey, JSON.stringify(merged));
        }
        applyProfileBodyFat(data.weighIns);
        rerenderBodyConsumers();
        return store;
      } catch (error) {
        console.warn('[ActivitySyncBridge] body fetch failed', error);
        return null;
      } finally {
        bodyInFlight = null;
      }
    })();

    return bodyInFlight;
  }

  if (typeof globalScope.document !== 'undefined') {
    globalScope.document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        // Workouts only after the activity fetch has confirmed a connection.
        Promise.resolve(fetchAndApplyTodayActivity()).then(() => {
          fetchAndApplyCardio();
          fetchAndApplyHistory();
          // After sleep, so the Recovery mission sees last night's sleep too.
          Promise.resolve(sleepInFlight).then(() => fetchAndApplyRecovery());
          fetchAndApplyBody();
        });
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
      } else if (e.detail?.tab === 'bodyTab' || e.detail?.tab === 'weightTab') {
        fetchAndApplyBody();
      } else if (e.detail?.tab === 'macroTab') {
        renderTrackerBurn();
        fetchAndApplyTodayActivity();
        fetchAndApplyHistory();
      }
    });
  }

  // Called right after a successful disconnect (settings.js) so the UI drops
  // out of "synced" mode immediately, instead of waiting for the next
  // throttled fetch to notice the connection is gone.
  function resetConnectionState() {
    setConnectedFlag(false);
    setNeedsReconnect(false);
    rerenderConsumers();
    rerenderSleepConsumers();
    renderTrackerBurn();
  }

  globalScope.activitySyncBridge = {
    fetchAndApplyTodayActivity,
    fetchAndApplyTodaySleep,
    fetchAndApplyCardio,
    fetchAndApplyHistory,
    dismissSyncedCardio,
    getBurnSummary,
    renderTrackerBurn,
    fetchAndApplyRecovery,
    getRecoverySummary,
    getRecoverySummaryText,
    getTodayHrv,
    needsReconnect,
    fetchAndApplyBody,
    dismissSyncedWeight,
    getBodyAnalysis,
    isConnected,
    resetConnectionState
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { localDateKey, cardioTypeFor, toCardioEntry, mergeSyncedCardio, computeBurnSummary,
      computeRecoverySummary, recoverySummaryText,
      mergeScaleWeighIns, analyzeVitals, analyzeComposition };
  }
})(typeof window !== 'undefined' ? window : globalThis);
