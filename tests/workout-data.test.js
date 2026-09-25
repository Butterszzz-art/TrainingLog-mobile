const {
  getAllWorkoutsForUser,
  getAllWorkoutsForUserIncludingBackend,
  fetchBackendWorkoutItems,
  invalidateBackendWorkouts
} = require('../src/js/workout-data');

function makeLocalStorage() {
  return {
    store: {},
    getItem(key) { return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null; },
    setItem(key, val) { this.store[key] = String(val); },
    clear() { this.store = {}; }
  };
}

describe('getAllWorkoutsForUser', () => {
  beforeEach(() => {
    global.localStorage = makeLocalStorage();
  });

  test('merges workouts_{user} (recent) with workoutHistory_{user} (archived)', () => {
    const user = 'u1';
    const archived = { id: 'w-old', date: '2026-01-01', log: [{}] };
    const recent = { id: 'w-new', date: '2026-02-01', log: [{}] };

    localStorage.setItem(`workoutHistory_${user}`, JSON.stringify([archived]));
    localStorage.setItem(`workouts_${user}`, JSON.stringify([recent]));

    const all = getAllWorkoutsForUser(user);

    expect(all.map(w => w.id)).toEqual(['w-old', 'w-new']);
  });

  test('de-duplicates a workout present in both stores', () => {
    const user = 'u1';
    const w = { id: 'w-1', date: '2026-01-01', log: [{}] };

    localStorage.setItem(`workoutHistory_${user}`, JSON.stringify([w]));
    localStorage.setItem(`workouts_${user}`, JSON.stringify([w]));

    expect(getAllWorkoutsForUser(user)).toHaveLength(1);
  });

  test('returns [] for a missing username or missing stores', () => {
    expect(getAllWorkoutsForUser(null)).toEqual([]);
    expect(getAllWorkoutsForUser('nobody')).toEqual([]);
  });
});

describe('getAllWorkoutsForUserIncludingBackend', () => {
  beforeEach(() => {
    global.localStorage = makeLocalStorage();
    global.window = { SERVER_URL: 'https://backend.example' };
    global.localStorage.setItem('token', 'jwt-token');
    global.fetch = jest.fn();
    global.AbortSignal = { timeout: () => undefined };
    invalidateBackendWorkouts();
  });

  afterEach(() => {
    delete global.window;
    delete global.fetch;
    delete global.AbortSignal;
  });

  test('merges local history with workouts already hard-saved to the backend', async () => {
    const user = 'u1';
    const local = { id: 'w-local', date: '2026-02-01', log: [{}] };
    localStorage.setItem(`workouts_${user}`, JSON.stringify([local]));

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        items: [
          { id: 'w-backend', date: '2026-01-01', title: 'Old Push Day', workout: { log: [{ exercise: 'Bench' }] } }
        ]
      })
    });

    const all = await getAllWorkoutsForUserIncludingBackend(user);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://backend.example/workouts?username=u1&limit=500',
      expect.objectContaining({ headers: { Authorization: 'Bearer jwt-token' } })
    );
    expect(all.map(w => w.id)).toEqual(['w-backend', 'w-local']);
    expect(all[0].log).toEqual([{ exercise: 'Bench' }]);
  });

  test('falls back to local-only data when there is no auth token', async () => {
    const user = 'u1';
    localStorage.clear();
    localStorage.setItem(`workouts_${user}`, JSON.stringify([{ id: 'w-local', date: '2026-02-01', log: [{}] }]));

    const all = await getAllWorkoutsForUserIncludingBackend(user);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(all.map(w => w.id)).toEqual(['w-local']);
  });

  test('falls back to local-only data when the backend request fails', async () => {
    const user = 'u1';
    localStorage.setItem(`workouts_${user}`, JSON.stringify([{ id: 'w-local', date: '2026-02-01', log: [{}] }]));
    global.fetch.mockRejectedValue(new Error('network down'));

    const all = await getAllWorkoutsForUserIncludingBackend(user);

    expect(all.map(w => w.id)).toEqual(['w-local']);
  });
});

describe('fetchBackendWorkoutItems (shared cache + paging)', () => {
  const page = (items, nextCursor) => ({ ok: true, status: 200, json: async () => ({ success: true, items, nextCursor }) });

  beforeEach(() => {
    global.localStorage = makeLocalStorage();
    global.localStorage.setItem('token', 'jwt-token');
    global.window = { SERVER_URL: 'https://backend.example' };
    global.fetch = jest.fn();
    global.AbortSignal = { timeout: () => undefined };
    invalidateBackendWorkouts();
  });

  afterEach(() => {
    delete global.window;
    delete global.fetch;
    delete global.AbortSignal;
  });

  test('follows nextCursor until the last page', async () => {
    global.fetch
      .mockResolvedValueOnce(page([{ id: 'a' }, { id: 'b' }], 'b'))
      .mockResolvedValueOnce(page([{ id: 'c' }], null));

    const items = await fetchBackendWorkoutItems('u1');

    expect(items.map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toBe('https://backend.example/workouts?username=u1&limit=500&cursor=b');
  });

  test('works with a backend that ignores paging (no nextCursor)', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, items: [{ id: 'a' }] }) });
    expect((await fetchBackendWorkoutItems('u1')).map(i => i.id)).toEqual(['a']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('concurrent and repeat callers share one request until invalidated', async () => {
    global.fetch.mockResolvedValue(page([{ id: 'a' }], null));

    const [first, second] = await Promise.all([fetchBackendWorkoutItems('u1'), fetchBackendWorkoutItems('u1')]);
    await fetchBackendWorkoutItems('u1');
    expect(first).toBe(second);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    invalidateBackendWorkouts();
    await fetchBackendWorkoutItems('u1');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('does not cache failures, and exposes the status', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ success: false }) })
      .mockResolvedValueOnce(page([{ id: 'a' }], null));

    await expect(fetchBackendWorkoutItems('u1')).rejects.toMatchObject({ status: 401 });
    expect((await fetchBackendWorkoutItems('u1')).map(i => i.id)).toEqual(['a']);
  });

  test('rejects without calling the backend when there is no token', async () => {
    localStorage.clear();
    await expect(fetchBackendWorkoutItems('u1')).rejects.toThrow('Missing auth token');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
