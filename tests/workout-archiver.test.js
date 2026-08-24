const {
  archiveWorkoutsToBackend,
  collectWorkoutsDueForBackendArchive,
  buildWorkoutBackendPayload
} = require('../src/js/workout-archiver');

function makeLocalStorage() {
  return {
    store: {},
    getItem(key) { return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null; },
    setItem(key, val) { this.store[key] = String(val); },
    clear() { this.store = {}; }
  };
}

describe('collectWorkoutsDueForBackendArchive', () => {
  beforeEach(() => {
    global.localStorage = makeLocalStorage();
  });

  test('reads from workoutHistory_{user}, not workouts_{user}', () => {
    const user = 'u1';
    const now = Date.now();
    const veryOldDate = new Date(now - 40 * 86400000).toISOString();
    const recentDate = new Date(now - 10 * 86400000).toISOString();

    // Simulate the state after archiveOldWorkouts.js has already run:
    // workouts_{user} only has recent stuff, workoutHistory_{user} has the aged-out logs.
    localStorage.setItem(`workouts_${user}`, JSON.stringify([{ id: 'w-recent', date: recentDate, log: [{}] }]));
    localStorage.setItem(`workoutHistory_${user}`, JSON.stringify([
      { id: 'w-old', date: veryOldDate, log: [{}] },
      { id: 'w-mid', date: recentDate, log: [{}] }
    ]));

    const { toArchive, toKeep, storageKey } = collectWorkoutsDueForBackendArchive(user, now);

    expect(storageKey).toBe(`workoutHistory_${user}`);
    expect(toArchive).toHaveLength(1);
    expect(toArchive[0].id).toBe('w-old');
    expect(toKeep).toHaveLength(1);
    expect(toKeep[0].id).toBe('w-mid');
  });

  test('skips workouts already marked as archived', () => {
    const user = 'u1';
    const now = Date.now();
    const veryOldDate = new Date(now - 40 * 86400000).toISOString();

    localStorage.setItem(`workoutHistory_${user}`, JSON.stringify([
      { id: 'w-old', date: veryOldDate, log: [{}] }
    ]));
    localStorage.setItem('archivedWorkoutIds', JSON.stringify(['w-old']));

    const { toArchive, toKeep } = collectWorkoutsDueForBackendArchive(user, now);

    expect(toArchive).toHaveLength(0);
    expect(toKeep).toHaveLength(1);
  });
});

describe('buildWorkoutBackendPayload', () => {
  test('maps a raw workout log entry to the /workouts contract', () => {
    const workout = { id: 'w1', date: '2026-06-01T00:00:00.000Z', title: 'Push Day', log: [{ exercise: 'Bench' }] };
    const payload = buildWorkoutBackendPayload(workout);

    expect(payload).toEqual({
      date: '2026-06-01T00:00:00.000Z',
      title: 'Push Day',
      workout
    });
  });

  test('falls back to a default title', () => {
    const payload = buildWorkoutBackendPayload({ date: '2026-06-01T00:00:00.000Z', log: [] });
    expect(payload.title).toBe('Workout');
  });
});

describe('archiveWorkoutsToBackend', () => {
  beforeEach(() => {
    global.localStorage = makeLocalStorage();
    global.window = { currentUser: 'u1', SERVER_URL: 'https://backend.example' };
    global.localStorage.setItem('token', 'jwt-token');
    global.fetch = jest.fn();
    global.AbortSignal = { timeout: () => undefined };
  });

  afterEach(() => {
    delete global.window;
    delete global.fetch;
    delete global.AbortSignal;
  });

  test('posts old workouts to /workouts and removes only the successful ones locally', async () => {
    const user = 'u1';
    const now = Date.now();
    const oldOk = { id: 'ok-1', date: new Date(now - 40 * 86400000).toISOString(), log: [{}] };
    const oldFail = { id: 'fail-1', date: new Date(now - 35 * 86400000).toISOString(), log: [{}] };
    const recent = { id: 'recent-1', date: new Date(now - 10 * 86400000).toISOString(), log: [{}] };

    localStorage.setItem(`workoutHistory_${user}`, JSON.stringify([oldOk, oldFail, recent]));

    global.fetch.mockImplementation((url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.workout.id === 'fail-1') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ success: false }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, recordId: 'r1' }) });
    });

    await archiveWorkoutsToBackend(now);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toBe('https://backend.example/workouts');
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-token');

    const remaining = JSON.parse(localStorage.getItem(`workoutHistory_${user}`));
    const remainingIds = remaining.map(w => w.id).sort();
    // ok-1 was archived and removed; fail-1 and recent-1 stay local.
    expect(remainingIds).toEqual(['fail-1', 'recent-1']);

    const archivedIds = JSON.parse(localStorage.getItem('archivedWorkoutIds'));
    expect(archivedIds).toEqual(['ok-1']);
  });

  test('does nothing without an auth token', async () => {
    localStorage.clear();
    localStorage.setItem(`workoutHistory_u1`, JSON.stringify([
      { id: 'old', date: new Date(Date.now() - 40 * 86400000).toISOString(), log: [{}] }
    ]));

    await archiveWorkoutsToBackend();

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
