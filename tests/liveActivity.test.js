const LA = require('../src/js/live-activity.js');

const START = Date.UTC(2026, 10, 1, 9, 0, 0);
const timer = { startTimeMs: START, startDateKey: '2026-11-01' };

describe('buildActivityState', () => {
  test('null when no workout timer is running', () => {
    expect(LA.buildActivityState({ timer: null, rest: null, workout: null })).toBeNull();
    // A rest timer on its own doesn't start a Live Activity.
    expect(LA.buildActivityState({ timer: null, rest: { endTimeMs: START, totalSeconds: 90 }, workout: null })).toBeNull();
  });

  test('workout just started: no exercise yet, generic title', () => {
    const s = LA.buildActivityState({ timer, rest: null, workout: { title: 'Workout on 2026-11-01', log: [] } });
    expect(s).toEqual({
      title: 'Workout',
      startedAt: START,
      exercise: null,
      setsDone: 0,
      exercisesDone: 0,
      restEndsAt: null,
      restTotalSeconds: null,
      restPausedRemaining: null
    });
  });

  test('counts logged sets minus skipped ones, and distinct exercises', () => {
    const workout = {
      title: 'Push day',
      log: [
        { exercise: 'Bench Press', sets: 4, skippedArray: [false, false, false, true] },
        { exercise: 'bench press', sets: 2 },
        { exercise: 'Lateral Raise', sets: 3 }
      ]
    };
    const s = LA.buildActivityState({ timer, rest: null, workout });
    expect(s.title).toBe('Push day');
    expect(s.exercise).toBe('Lateral Raise');
    expect(s.setsDone).toBe(3 + 2 + 3);
    expect(s.exercisesDone).toBe(2);
  });

  test('running rest gives its end time and length', () => {
    const rest = { endTimeMs: START + 600000, totalSeconds: 90 };
    const s = LA.buildActivityState({ timer, rest, workout: null });
    expect(s.restEndsAt).toBe(START + 600000);
    expect(s.restTotalSeconds).toBe(90);
    expect(s.restPausedRemaining).toBeNull();
  });

  test('paused rest holds its remaining seconds instead of an end time', () => {
    const rest = { endTimeMs: START + 600000, totalSeconds: 120, pausedRemaining: 47.4 };
    const s = LA.buildActivityState({ timer, rest, workout: null });
    expect(s.restEndsAt).toBeNull();
    expect(s.restPausedRemaining).toBe(47);
    expect(s.restTotalSeconds).toBe(120);
  });

  test('ignores a rest with no length', () => {
    const s = LA.buildActivityState({ timer, rest: { endTimeMs: START, totalSeconds: 0 }, workout: null });
    expect(s.restEndsAt).toBeNull();
  });
});

describe('sync', () => {
  let store;
  let calls;

  beforeEach(() => {
    store = {};
    calls = [];
    globalThis.localStorage = {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    };
    globalThis.currentUser = 'lifter';
    globalThis.Capacitor = {
      getPlatform: () => 'ios',
      isPluginAvailable: name => name === 'WorkoutActivity',
      nativePromise: jest.fn(async (plugin, method, opts) => { calls.push([method, opts]); })
    };
  });

  afterEach(() => {
    delete globalThis.Capacitor;
    delete globalThis.localStorage;
    delete globalThis.currentUser;
  });

  test('starts, skips unchanged state, updates on change, ends when the workout stops', async () => {
    store.tl_workout_timer_v1 = JSON.stringify(timer);
    store.workouts_lifter = JSON.stringify([{ date: '2026-11-01', title: 'Legs', log: [{ exercise: 'Squat', sets: 3 }] }]);

    await LA.sync();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('update');
    expect(calls[0][1]).toMatchObject({ title: 'Legs', exercise: 'Squat', setsDone: 3 });

    await LA.sync();
    expect(calls).toHaveLength(1);

    store.tl_rest_timer_v1 = JSON.stringify({ endTimeMs: START + 90000, totalSeconds: 90 });
    await LA.sync();
    expect(calls).toHaveLength(2);
    expect(calls[1][1].restEndsAt).toBe(START + 90000);

    delete store.tl_workout_timer_v1;
    await LA.sync();
    expect(calls[2]).toEqual(['end', {}]);
  });

  test('does nothing outside iOS', async () => {
    globalThis.Capacitor.getPlatform = () => 'android';
    store.tl_workout_timer_v1 = JSON.stringify(timer);
    await LA.sync();
    expect(calls).toHaveLength(0);
  });

  test('retries after a failed native call', async () => {
    store.tl_workout_timer_v1 = JSON.stringify({ ...timer, startTimeMs: START + 1 });
    globalThis.Capacitor.nativePromise
      .mockImplementationOnce(async () => { throw new Error('boom'); });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await LA.sync();
    await LA.sync();
    expect(globalThis.Capacitor.nativePromise).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(1);
    warn.mockRestore();
  });
});
