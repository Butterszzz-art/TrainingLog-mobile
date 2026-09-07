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

  function getTodayKey() {
    return new Date().toISOString().split('T')[0];
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
          `${globalScope.ensureServerUrl()}/api/activity-sync/sleep?goalMinutes=${goalMinutes}`,
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
          `${globalScope.ensureServerUrl()}/api/activity-sync/activity`,
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

  if (typeof globalScope.document !== 'undefined') {
    globalScope.document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        fetchAndApplyTodayActivity();
        fetchAndApplyTodaySleep();
      }, 1000);
    });
    globalScope.document.addEventListener('traininglog:tab-changed', (e) => {
      if (e.detail?.tab === 'homeTab') {
        renderSyncInfoLine(); // reflect cache immediately, even if the fetch below is throttled
        fetchAndApplyTodayActivity();
      } else if (e.detail?.tab === 'sleepTab') {
        fetchAndApplyTodaySleep();
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
    isConnected,
    resetConnectionState
  };
})(typeof window !== 'undefined' ? window : globalThis);
