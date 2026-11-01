/* =============================================================
   APPLE HEALTH (iOS)
   Reads steps, energy, sleep, resting heart rate, HRV, weigh-ins and
   workouts from Apple Health through the native HealthKit plugin
   (plugins/health-kit), and saves lifting sessions and bodyweight back.

   How it plugs in: the Activity Sync bridge (activity-sync-bridge.js)
   already turns synced data into the step ring, Today's Mission, the
   Sleep tab, the cardio log, recovery and the Body analysis. It fetches
   that data from /api/activity-sync/* (Google Health on the server).
   While Apple Health is connected, the bridge asks this module first
   (handles / respond), and gets the same JSON shapes, built on the
   phone from HealthKit. Nothing leaves the phone.

   Food import on iOS goes through health-nutrition.js, which talks to
   the same plugin directly.

   Everything is a no-op outside the iOS app.
   ============================================================= */
(function (global) {
  'use strict';

  const PLUGIN = 'HealthKit';
  const SAVED_WORKOUTS_KEY = 'appleHealthSavedWorkouts';
  const MIN_WORKOUT_MINUTES = 5;
  const MAX_WORKOUT_MINUTES = 4 * 60;

  // HKWorkoutActivityType raw values → the Google Health names the bridge
  // maps to cardio types (activity-sync-bridge.js EXERCISE_TYPE_MAP) or
  // skips as lifting (NON_CARDIO_TYPES).
  const HK_TYPES = {
    11: 'CIRCUIT_TRAINING',            // crossTraining
    13: 'BIKING',                      // cycling
    16: 'ELLIPTICAL',
    20: 'FUNCTIONAL_STRENGTH_TRAINING',
    24: 'HIKING',
    35: 'ROWING',
    37: 'RUNNING',
    46: 'SWIMMING',
    50: 'STRENGTH_TRAINING',           // traditionalStrengthTraining
    52: 'WALKING',
    57: 'YOGA',
    59: 'CORE_TRAINING',
    62: 'STRETCHING',                  // flexibility
    63: 'HIIT',
    73: 'INTERVAL_WORKOUT',            // mixedCardio
    74: 'HAND_CYCLING',
  };

  // ── pure helpers (tested) ─────────────────────────────────────

  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function orNull(v) {
    const n = Number(v);
    return v == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10;
  }

  /** A HealthKit day row → the bridge's activity shape. */
  function toActivity(day, date) {
    const d = day || {};
    return {
      date: d.date || date,
      steps: Math.round(num(d.steps)),
      distanceKm: Math.round(num(d.distanceKm) * 100) / 100,
      caloriesOut: Math.round(num(d.activeKcal) + num(d.basalKcal)),
      activeMinutes: Math.round(num(d.exerciseMinutes)),
      sedentaryMinutes: 0,
    };
  }

  /** Same scoring as the backend's computeSleepScore (an estimate, not Apple's). */
  function computeSleepScore({ sleepMinutes, deepMinutes, remMinutes, awakenings }, goalMinutes) {
    const goal = Number(goalMinutes) > 0 ? Number(goalMinutes) : 480;
    const durationScore = Math.min(sleepMinutes / goal, 1) * 50;
    const restorativeRatio = sleepMinutes > 0 ? (deepMinutes + remMinutes) / sleepMinutes : 0;
    const qualityScore = Math.min(restorativeRatio / 0.45, 1) * 35;
    const restfulnessScore = Math.max(15 - Math.min(awakenings, 15), 0);
    const hasStages = deepMinutes + remMinutes > 0;
    const score = Math.round(hasStages
      ? durationScore + qualityScore + restfulnessScore
      : (durationScore + restfulnessScore) * (100 / 65));
    const label = score >= 90 ? 'Excellent' : score >= 80 ? 'Good' : score >= 60 ? 'Fair' : 'Poor';
    return { score, label };
  }

  function toRecoveryDays(days) {
    return (days || [])
      .filter(d => d && (d.restingHeartRate != null || d.hrvMs != null))
      .map(d => ({ date: d.date, restingHeartRate: orNull(d.restingHeartRate), hrvMs: orNull(d.hrvMs) }));
  }

  function toBodyDays(days) {
    return (days || [])
      .filter(d => d && d.hasData !== false)
      .map(d => ({
        date: d.date,
        restingHeartRate: orNull(d.restingHeartRate),
        hrvMs: orNull(d.hrvMs),
        spo2: orNull(d.spo2),
        respiratoryRate: orNull(d.respiratoryRate),
        skinTempDelta: null,
        vo2Max: orNull(d.vo2Max),
      }));
  }

  function toWeighIns(rows) {
    return (rows || []).map(r => ({
      date: r.date,
      weightKg: r.weightKg == null ? null : Math.round(num(r.weightKg) * 100) / 100,
      bodyFatPercent: orNull(r.bodyFatPercent),
    }));
  }

  /** HealthKit workouts → the bridge's exercise shape. Skips our own. */
  function toExercises(workouts) {
    return (workouts || [])
      .filter(w => w && !w.fromThisApp)
      .map(w => ({
        syncId: 'healthkit:' + w.id,
        date: w.date,
        startTime: w.startTime,
        endTime: w.endTime || null,
        exerciseType: HK_TYPES[w.activityType] || 'EXERCISE_TYPE_UNSPECIFIED',
        displayName: '',
        durationMinutes: Math.round(num(w.durationMinutes)),
        distanceKm: Math.round(num(w.distanceKm) * 100) / 100,
        calories: Math.round(num(w.calories)),
        avgHeartRate: null,
        steps: 0,
      }));
  }

  /** Which bridge request this is, or null if it isn't one we answer. */
  function parseRequest(url) {
    const m = /\/api\/activity-sync\/(activity|daily|sleep|recovery|body|exercises)(?:\?(.*))?$/.exec(String(url || ''));
    if (!m) return null;
    const q = {};
    (m[2] || '').split('&').filter(Boolean).forEach(pair => {
      const [k, v = ''] = pair.split('=');
      q[decodeURIComponent(k)] = decodeURIComponent(v);
    });
    return { endpoint: m[1], query: q };
  }

  /** Whether a finished timer session should be saved as a workout. */
  function shouldSaveWorkout(detail, saved) {
    if (!detail || typeof detail.startTimeMs !== 'number' || typeof detail.endTimeMs !== 'number') return false;
    const minutes = (detail.endTimeMs - detail.startTimeMs) / 60000;
    if (!(minutes >= MIN_WORKOUT_MINUTES && minutes <= MAX_WORKOUT_MINUTES)) return false;
    return !(saved || []).includes(String(detail.startTimeMs));
  }

  // ── native bridge ────────────────────────────────────────────

  function _plugin() {
    const cap = global.Capacitor;
    if (!cap) return null;
    if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'ios') return null;
    if (typeof cap.isPluginAvailable === 'function' && !cap.isPluginAvailable(PLUGIN)) return null;
    return (cap.Plugins && cap.Plugins[PLUGIN]) || null;
  }

  function _user() {
    return global.currentUser || (() => {
      try { return global.localStorage.getItem('fitnessAppUser') || ''; } catch { return ''; }
    })();
  }

  function _key() { return 'appleHealthConnected_' + _user(); }

  function isConnected() {
    if (!_plugin() || !_user()) return false;
    try { return global.localStorage.getItem(_key()) === '1'; } catch { return false; }
  }

  function _today() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function handles(url) {
    return isConnected() && !!parseRequest(url);
  }

  async function _build(endpoint, q) {
    const hk = _plugin();
    const today = _today();
    const end = q.end || q.date || today;
    switch (endpoint) {
      case 'activity': {
        const date = q.date || today;
        const res = await hk.getDailyTotals({ start: date, end: date });
        return { activity: { ...toActivity((res.days || [])[0], date), syncedAt: new Date().toISOString() } };
      }
      case 'daily': {
        const start = q.start || addDays(end, -6);
        const res = await hk.getDailyTotals({ start, end });
        const days = (res.days || []).map(d => {
          const { sedentaryMinutes, ...summary } = toActivity(d, d.date);
          return { hasData: !!d.hasData, ...summary };
        });
        return { start, end, days };
      }
      case 'sleep': {
        const date = q.date || today;
        const res = await hk.getSleep({ date });
        if (!res || !res.sleep) {
          return { __error: { status: 404, code: 'activity_sync.no_sleep_data', message: 'No sleep data found for that night.' } };
        }
        const { score, label } = computeSleepScore(res.sleep, q.goalMinutes);
        return { sleep: { date, ...res.sleep, score, label, syncedAt: new Date().toISOString() } };
      }
      case 'recovery': {
        const start = q.start || addDays(end, -7);
        const res = await hk.getDailyVitals({ start, end });
        return { start, end, days: toRecoveryDays(res.days) };
      }
      case 'body': {
        const start = q.start || addDays(end, -29);
        const [vitals, weigh] = await Promise.all([
          hk.getDailyVitals({ start, end }),
          hk.getWeighIns({ start, end }),
        ]);
        return { start, end, days: toBodyDays(vitals.days), weighIns: toWeighIns(weigh.weighIns), needsReconnect: false };
      }
      case 'exercises': {
        const start = q.start || addDays(end, -6);
        const res = await hk.getWorkouts({ start, end });
        return { start, end, exercises: toExercises(res.workouts) };
      }
      default:
        return null;
    }
  }

  function _response(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  /** Answers a bridge request from HealthKit, as a fetch-like Response. */
  async function respond(url) {
    const req = parseRequest(url);
    if (!req || !_plugin()) {
      return _response(409, { success: false, error: { code: 'activity_sync.not_connected', message: 'Apple Health is not connected.' } });
    }
    try {
      const data = await _build(req.endpoint, req.query);
      if (data && data.__error) {
        return _response(data.__error.status, { success: false, error: { code: data.__error.code, message: data.__error.message } });
      }
      return _response(200, { success: true, ...data });
    } catch (err) {
      console.warn('[AppleHealth] read failed', err);
      return _response(500, { success: false, error: { code: 'activity_sync.apple_health_error', message: String(err && err.message || err) } });
    }
  }

  function _refreshBridge() {
    const b = global.activitySyncBridge;
    if (!b) return;
    ['fetchAndApplyTodayActivity', 'fetchAndApplyTodaySleep', 'fetchAndApplyCardio',
      'fetchAndApplyHistory', 'fetchAndApplyRecovery', 'fetchAndApplyBody'].forEach(fn => {
      try { b[fn] && b[fn]({ force: true }); } catch { /* one failing doesn't stop the rest */ }
    });
  }

  /** Shows Apple's permission sheet and turns syncing on. */
  async function connect() {
    const hk = _plugin();
    if (!hk || !_user()) return false;
    try {
      await hk.requestAuthorization();
    } catch (err) {
      console.warn('[AppleHealth] authorization failed', err);
      return false;
    }
    try { global.localStorage.setItem(_key(), '1'); } catch { /* storage blocked */ }
    _refreshBridge();
    return true;
  }

  /** Stops syncing. Access itself can only be removed in the Health app. */
  function disconnect() {
    try { global.localStorage.removeItem(_key()); } catch { /* storage blocked */ }
    try { global.activitySyncBridge && global.activitySyncBridge.resetConnectionState && global.activitySyncBridge.resetConnectionState(); } catch { /* ignore */ }
  }

  function openHealthApp() {
    const hk = _plugin();
    if (hk && hk.openHealthConnect) hk.openHealthConnect().catch(() => {});
  }

  function _readSaved() {
    try { return JSON.parse(global.localStorage.getItem(SAVED_WORKOUTS_KEY) || '[]'); } catch { return []; }
  }

  /** Saves a finished lifting session (from workoutTimer.js) to Apple Health. */
  async function saveWorkout(detail) {
    const hk = _plugin();
    if (!hk || !isConnected()) return false;
    const saved = _readSaved();
    if (!shouldSaveWorkout(detail, saved)) return false;
    try {
      await hk.saveWorkout({
        id: 'pocketcoach-' + detail.startTimeMs,
        start: detail.startTimeMs,
        end: detail.endTimeMs,
        title: detail.title || '',
      });
      saved.push(String(detail.startTimeMs));
      try { global.localStorage.setItem(SAVED_WORKOUTS_KEY, JSON.stringify(saved.slice(-50))); } catch { /* ignore */ }
      return true;
    } catch (err) {
      console.warn('[AppleHealth] workout save failed', err);
      return false;
    }
  }

  /** Saves a bodyweight entry (kg, YYYY-MM-DD) to Apple Health. */
  async function saveWeighIn(kg, date) {
    const hk = _plugin();
    if (!hk || !isConnected() || !(Number(kg) > 0)) return false;
    // A date-only entry is placed at local noon; today's uses the current time.
    let when = Date.now();
    if (date && date !== _today()) {
      const [y, m, d] = String(date).split('-').map(Number);
      when = new Date(y, m - 1, d, 12, 0, 0).getTime();
    }
    try {
      await hk.saveBodyMass({ kg: Number(kg), date: when });
      return true;
    } catch (err) {
      console.warn('[AppleHealth] weight save failed', err);
      return false;
    }
  }

  const api = {
    isAvailable: () => !!_plugin(),
    isConnected, connect, disconnect, openHealthApp, handles, respond, saveWorkout, saveWeighIn,
    // pure, for tests
    toActivity, computeSleepScore, toRecoveryDays, toBodyDays, toWeighIns, toExercises,
    parseRequest, shouldSaveWorkout, addDays, HK_TYPES,
  };
  global.AppleHealth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (global.document && global.document.addEventListener) {
    global.document.addEventListener('tl:workout-finished', e => { saveWorkout(e.detail); });
  }
})(typeof window !== 'undefined' ? window : globalThis);
