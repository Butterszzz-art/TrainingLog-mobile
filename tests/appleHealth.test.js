// Apple Health adapter (src/js/apple-health.js). Runs in Jest's node
// environment: the module uses globalThis as `window`.
const memory = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: k => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: k => memory.delete(k),
    clear: () => memory.clear(),
  },
});

function load({ platform = 'ios', hk = {} } = {}) {
  jest.resetModules();
  memory.clear();
  globalThis.currentUser = 'sam';
  globalThis.Capacitor = {
    getPlatform: () => platform,
    isPluginAvailable: name => name === 'HealthKit',
    Plugins: { HealthKit: { requestAuthorization: jest.fn(async () => ({ granted: true })), ...hk } },
  };
  return require('../src/js/apple-health.js');
}

afterEach(() => {
  delete globalThis.Capacitor;
  delete globalThis.activitySyncBridge;
  delete globalThis.currentUser;
});

describe('shapes match the Activity Sync backend', () => {
  const AH = load();

  test('activity: calories out is active + resting energy', () => {
    expect(AH.toActivity({ date: '2026-11-01', steps: 8123.6, distanceKm: 5.4567, activeKcal: 512.2, basalKcal: 1700.4, exerciseMinutes: 41.6 }))
      .toEqual({ date: '2026-11-01', steps: 8124, distanceKm: 5.46, caloriesOut: 2213, activeMinutes: 42, sedentaryMinutes: 0 });
    expect(AH.toActivity(undefined, '2026-11-01')).toEqual({ date: '2026-11-01', steps: 0, distanceKm: 0, caloriesOut: 0, activeMinutes: 0, sedentaryMinutes: 0 });
  });

  test('sleep score mirrors the backend formula', () => {
    expect(AH.computeSleepScore({ sleepMinutes: 480, deepMinutes: 100, remMinutes: 116, awakenings: 0 }, 480))
      .toEqual({ score: 100, label: 'Excellent' });
    // No stages (iPhone-only "asleep"): scored on duration + restfulness.
    expect(AH.computeSleepScore({ sleepMinutes: 240, deepMinutes: 0, remMinutes: 0, awakenings: 3 }, 480).score)
      .toBe(Math.round((25 + 12) * (100 / 65)));
  });

  test('recovery keeps only days with heart data', () => {
    expect(AH.toRecoveryDays([
      { date: '2026-10-31', restingHeartRate: 52.44, hrvMs: 61.26 },
      { date: '2026-11-01', restingHeartRate: null, hrvMs: null },
    ])).toEqual([{ date: '2026-10-31', restingHeartRate: 52.4, hrvMs: 61.3 }]);
  });

  test('body days and weigh-ins', () => {
    expect(AH.toBodyDays([{ date: '2026-11-01', hasData: true, restingHeartRate: 50, hrvMs: null, spo2: 97.2, respiratoryRate: 14, vo2Max: 48.31 }]))
      .toEqual([{ date: '2026-11-01', restingHeartRate: 50, hrvMs: null, spo2: 97.2, respiratoryRate: 14, skinTempDelta: null, vo2Max: 48.3 }]);
    expect(AH.toWeighIns([{ date: '2026-11-01', weightKg: 81.234, bodyFatPercent: 14.56 }]))
      .toEqual([{ date: '2026-11-01', weightKg: 81.23, bodyFatPercent: 14.6 }]);
  });

  test('workouts become cardio entries; our own lifting sessions are skipped', () => {
    const out = AH.toExercises([
      { id: 'A', date: '2026-11-01', startTime: 's', endTime: 'e', activityType: 37, durationMinutes: 30, distanceKm: 5.123, calories: 301.6 },
      { id: 'B', date: '2026-11-01', startTime: 's', endTime: 'e', activityType: 50, durationMinutes: 60, fromThisApp: true },
      { id: 'C', date: '2026-11-01', startTime: 's', endTime: 'e', activityType: 999, durationMinutes: 10 },
    ]);
    expect(out.map(e => e.syncId)).toEqual(['healthkit:A', 'healthkit:C']);
    expect(out[0]).toMatchObject({ exerciseType: 'RUNNING', distanceKm: 5.12, calories: 302, durationMinutes: 30 });
    expect(out[1].exerciseType).toBe('EXERCISE_TYPE_UNSPECIFIED');
  });

  test('parseRequest reads the bridge URLs', () => {
    expect(AH.parseRequest('https://x/api/activity-sync/sleep?goalMinutes=450&date=2026-11-01'))
      .toEqual({ endpoint: 'sleep', query: { goalMinutes: '450', date: '2026-11-01' } });
    expect(AH.parseRequest('https://x/api/activity-sync/status')).toBeNull();
    expect(AH.parseRequest('https://x/api/other')).toBeNull();
  });

  test('shouldSaveWorkout: 5 min to 4 h, once per session', () => {
    const d = { startTimeMs: 0, endTimeMs: 45 * 60000 };
    expect(AH.shouldSaveWorkout(d, [])).toBe(true);
    expect(AH.shouldSaveWorkout(d, ['0'])).toBe(false);
    expect(AH.shouldSaveWorkout({ startTimeMs: 0, endTimeMs: 2 * 60000 }, [])).toBe(false);
    expect(AH.shouldSaveWorkout({ startTimeMs: 0, endTimeMs: 5 * 3600000 }, [])).toBe(false);
    expect(AH.shouldSaveWorkout(null, [])).toBe(false);
  });

  test('addDays crosses month ends', () => {
    expect(AH.addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(AH.addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('connection', () => {
  test('nothing outside iOS', async () => {
    const AH = load({ platform: 'android' });
    expect(AH.isAvailable()).toBe(false);
    expect(await AH.connect()).toBe(false);
    expect(AH.handles('https://x/api/activity-sync/activity')).toBe(false);
  });

  test('connect asks once, then the bridge requests are answered on the phone', async () => {
    const AH = load();
    globalThis.activitySyncBridge = { fetchAndApplyTodayActivity: jest.fn(), fetchAndApplyBody: jest.fn() };
    expect(AH.handles('https://x/api/activity-sync/activity')).toBe(false);
    expect(await AH.connect()).toBe(true);
    expect(globalThis.Capacitor.Plugins.HealthKit.requestAuthorization).toHaveBeenCalled();
    expect(AH.handles('https://x/api/activity-sync/activity?date=2026-11-01')).toBe(true);
    expect(globalThis.activitySyncBridge.fetchAndApplyTodayActivity).toHaveBeenCalledWith({ force: true });
    AH.disconnect();
    expect(AH.handles('https://x/api/activity-sync/activity')).toBe(false);
  });
});

describe('respond', () => {
  async function connected(hk) {
    const AH = load({ hk });
    await AH.connect();
    return AH;
  }

  test('activity', async () => {
    const AH = await connected({
      getDailyTotals: jest.fn(async () => ({ days: [{ date: '2026-11-01', steps: 9000, distanceKm: 6, activeKcal: 400, basalKcal: 1600, exerciseMinutes: 30, hasData: true }] })),
    });
    const res = await AH.respond('https://x/api/activity-sync/activity?date=2026-11-01');
    const body = await res.json();
    expect(res.ok).toBe(true);
    expect(body.success).toBe(true);
    expect(body.activity).toMatchObject({ date: '2026-11-01', steps: 9000, caloriesOut: 2000, activeMinutes: 30 });
  });

  test('daily history drops sedentaryMinutes like the backend', async () => {
    const getDailyTotals = jest.fn(async () => ({ days: [{ date: '2026-10-26', steps: 1, hasData: true }, { date: '2026-10-27', hasData: false }] }));
    const AH = await connected({ getDailyTotals });
    const body = await (await AH.respond('https://x/api/activity-sync/daily?start=2026-10-26&end=2026-11-01')).json();
    expect(getDailyTotals).toHaveBeenCalledWith({ start: '2026-10-26', end: '2026-11-01' });
    expect(body.days[0]).toEqual({ hasData: true, date: '2026-10-26', steps: 1, distanceKm: 0, caloriesOut: 0, activeMinutes: 0 });
    expect(body.days[1].hasData).toBe(false);
  });

  test('sleep: scored, and a missing night is the backend 404 code', async () => {
    const sleep = { bedtime: '2026-10-31T23:00:00Z', wakeTime: '2026-11-01T07:00:00Z', sleepMinutes: 450, timeInBedMinutes: 480, lightMinutes: 250, deepMinutes: 90, remMinutes: 110, awakeMinutes: 30, awakenings: 2 };
    let AH = await connected({ getSleep: jest.fn(async () => ({ sleep })) });
    let body = await (await AH.respond('https://x/api/activity-sync/sleep?goalMinutes=480&date=2026-11-01')).json();
    expect(body.sleep).toMatchObject({ date: '2026-11-01', sleepMinutes: 450, label: expect.any(String) });
    expect(typeof body.sleep.score).toBe('number');

    AH = await connected({ getSleep: jest.fn(async () => ({ sleep: null })) });
    const res = await AH.respond('https://x/api/activity-sync/sleep?date=2026-11-01');
    body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error.code).toBe('activity_sync.no_sleep_data');
  });

  test('body combines vitals and weigh-ins', async () => {
    const AH = await connected({
      getDailyVitals: jest.fn(async () => ({ days: [{ date: '2026-11-01', hasData: true, restingHeartRate: 55 }] })),
      getWeighIns: jest.fn(async () => ({ weighIns: [{ date: '2026-11-01', weightKg: 80, bodyFatPercent: null }] })),
    });
    const body = await (await AH.respond('https://x/api/activity-sync/body?start=2026-10-03&end=2026-11-01')).json();
    expect(body.days[0].restingHeartRate).toBe(55);
    expect(body.weighIns).toEqual([{ date: '2026-11-01', weightKg: 80, bodyFatPercent: null }]);
    expect(body.needsReconnect).toBe(false);
  });

  test('a native error becomes a failed response, not a throw', async () => {
    const AH = await connected({ getWorkouts: jest.fn(async () => { throw new Error('nope'); }) });
    const res = await AH.respond('https://x/api/activity-sync/exercises?start=2026-10-26&end=2026-11-01');
    expect(res.ok).toBe(false);
    expect((await res.json()).success).toBe(false);
  });
});

describe('writing to Apple Health', () => {
  test('saves a finished workout once, and only when connected', async () => {
    const saveWorkout = jest.fn(async () => ({ id: 'x' }));
    const AH = load({ hk: { saveWorkout } });
    const detail = { startTimeMs: 1000, endTimeMs: 1000 + 50 * 60000, title: 'Push' };
    expect(await AH.saveWorkout(detail)).toBe(false);
    await AH.connect();
    expect(await AH.saveWorkout(detail)).toBe(true);
    expect(await AH.saveWorkout(detail)).toBe(false);
    expect(saveWorkout).toHaveBeenCalledTimes(1);
    expect(saveWorkout.mock.calls[0][0]).toEqual({ id: 'pocketcoach-1000', start: 1000, end: 1000 + 50 * 60000, title: 'Push' });
  });

  test('saves a weigh-in; past dates go at local noon', async () => {
    const saveBodyMass = jest.fn(async () => ({}));
    const AH = load({ hk: { saveBodyMass } });
    await AH.connect();
    expect(await AH.saveWeighIn(80.5, '2026-10-30')).toBe(true);
    const { kg, date } = saveBodyMass.mock.calls[0][0];
    expect(kg).toBe(80.5);
    expect(new Date(date).getHours()).toBe(12);
    expect(await AH.saveWeighIn(0, '2026-10-30')).toBe(false);
  });
});
