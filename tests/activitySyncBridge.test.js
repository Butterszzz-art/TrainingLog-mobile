const {
  localDateKey,
  cardioTypeFor,
  toCardioEntry,
  mergeSyncedCardio,
  computeBurnSummary,
} = require('../src/js/activity-sync-bridge.js');

const range = { start: '2026-10-23', end: '2026-10-29' };

function workout(overrides = {}) {
  return {
    syncId: 'users/u/dataTypes/exercise/dataPoints/a1',
    date: '2026-10-28',
    startTime: '2026-10-28T07:00:00Z',
    exerciseType: 'RUNNING',
    displayName: '',
    durationMinutes: 42,
    distanceKm: 7.35,
    calories: 413,
    avgHeartRate: 151,
    steps: 6900,
    ...overrides,
  };
}

describe('activity sync bridge — cardio', () => {
  test('localDateKey uses the local calendar date', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  test('maps tracker workout types to cardio types', () => {
    expect(cardioTypeFor('TREADMILL')).toBe('run');
    expect(cardioTypeFor('OUTDOOR_BIKE')).toBe('cycle');
    expect(cardioTypeFor('SWIMMING_POOL')).toBe('swim');
    expect(cardioTypeFor('KICKBOXING')).toBe('Kickboxing');
    expect(cardioTypeFor('EXERCISE_TYPE_UNSPECIFIED')).toBe('other');
    expect(cardioTypeFor('WEIGHTLIFTING')).toBeNull();
  });

  test('builds a synced cardio entry from a workout', () => {
    const entry = toCardioEntry(workout());
    expect(entry).toMatchObject({
      date: '2026-10-28', type: 'run', duration: 42, distance: 7.35,
      calories: 413, heartRate: 151, source: 'activity-sync',
      syncId: 'users/u/dataTypes/exercise/dataPoints/a1',
    });
    expect(toCardioEntry(workout({ exerciseType: 'STRENGTH_TRAINING' }))).toBeNull();
    expect(toCardioEntry(workout({ durationMinutes: 0 }))).toBeNull();
  });

  test('replaces a matching manual entry and keeps its notes', () => {
    const log = [
      { date: '2026-10-28', type: 'run', duration: 40, calories: 350, notes: 'Felt good' },
      { date: '2026-10-28', type: 'walk', duration: 20, calories: 80, notes: '' },
    ];
    const merged = mergeSyncedCardio(log, [workout()], range);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.type === 'walk').source).toBeUndefined();
    const run = merged.find((e) => e.type === 'run');
    expect(run).toMatchObject({ source: 'activity-sync', calories: 413, notes: 'Felt good' });
  });

  test('keeps a manual entry that is clearly a different session', () => {
    const log = [{ date: '2026-10-28', type: 'run', duration: 90, calories: 900 }];
    const merged = mergeSyncedCardio(log, [workout({ durationMinutes: 20 })], range);
    expect(merged).toHaveLength(2);
  });

  test('re-syncing updates entries instead of duplicating them', () => {
    const once = mergeSyncedCardio([], [workout()], range);
    const twice = mergeSyncedCardio(once, [workout({ calories: 420 })], range);
    expect(twice).toHaveLength(1);
    expect(twice[0].calories).toBe(420);
  });

  test('removes synced entries deleted on the tracker, only inside the range', () => {
    const old = { ...toCardioEntry(workout({ syncId: 'old', date: '2026-10-01' })) };
    const current = toCardioEntry(workout());
    const merged = mergeSyncedCardio([old, current], [], range);
    expect(merged).toEqual([old]);
  });

  test('skips workouts the user removed in the app', () => {
    const merged = mergeSyncedCardio([], [workout()], {
      ...range,
      dismissed: ['users/u/dataTypes/exercise/dataPoints/a1'],
    });
    expect(merged).toEqual([]);
  });
});

describe('activity sync bridge — calories burned', () => {
  const day = (date, caloriesOut) => ({ date, caloriesOut });

  test('averages the last 7 complete days and reports today separately', () => {
    const store = {
      '2026-10-20': day('2026-10-20', 9000), // older than 7 days: ignored
      '2026-10-24': day('2026-10-24', 2400),
      '2026-10-27': day('2026-10-27', 2600),
      '2026-10-29': day('2026-10-29', 2500),
      '2026-10-30': day('2026-10-30', 1200), // today, still in progress
    };
    expect(computeBurnSummary(store, '2026-10-30')).toEqual({
      todayBurn: 1200, averageBurn: 2500, averageDays: 3,
    });
  });

  test('needs at least 3 days of data for an average', () => {
    const store = {
      '2026-10-28': day('2026-10-28', 2500),
      '2026-10-29': day('2026-10-29', 0),
    };
    expect(computeBurnSummary(store, '2026-10-30')).toEqual({
      todayBurn: 0, averageBurn: 0, averageDays: 1,
    });
  });
});
