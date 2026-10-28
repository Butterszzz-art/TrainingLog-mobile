const {
  computeOneRepMax,
  calculate1RM,
  calculateWorkoutMetrics,
  updatePRs,
  calculateMonotony,
  calculateStrain
} = require('../progressUtils');
const { calculateWorkoutVolume } = require('../calculateWorkoutVolume');

test('computeOneRepMax calculates epley estimate', () => {
  const orm = computeOneRepMax([100], [5]);
  expect(orm).toBeCloseTo(100 * (1 + 5 / 30));
});

test('calculate1RM supports brzycki method', () => {
  const orm = calculate1RM(5, 100, 'brzycki');
  expect(orm).toBeCloseTo(100 * (36 / (37 - 5)));
});

test('calculateWorkoutMetrics returns volume, intensity, and estimated 1RM', () => {
  const metrics = calculateWorkoutMetrics({
    log: [{ repsArray: [5, 8], weightsArray: [100, 80] }]
  });
  expect(metrics.sessionVolume).toBe(1140);
  expect(metrics.averageIntensity).toBeGreaterThan(0);
  expect(metrics.estimated1RM).toBeGreaterThan(100);
});

test('updatePRs tracks heaviest set, reps by weight, and highest volume session', () => {
  const user = 'testUser';
  global.localStorage = { getItem: jest.fn(() => null), setItem: jest.fn() };
  const workout = {
    date: '2026-01-02',
    log: [{ exercise: 'Bench', weightsArray: [100, 100, 110], repsArray: [5, 8, 2] }]
  };

  const prs = updatePRs(user, workout, calculateWorkoutVolume);

  expect(prs.Bench.heaviestSet.weight).toBe(110);
  expect(prs.Bench.repPRsByWeight['100'].reps).toBe(8);
  expect(prs.Bench.highestVolumeSession.volume).toBe(1520);
  expect(global.localStorage.setItem).toHaveBeenCalledTimes(1);
});

test('calculateMonotony returns mean divided by standard deviation', () => {
  const dailyLoads = [100, 200, 100, 200, 100, 200, 100];
  const monotony = calculateMonotony(dailyLoads);
  expect(monotony).toBeCloseTo(2.8868, 3);
});

test('calculateStrain multiplies monotony and weekly load', () => {
  expect(calculateStrain(2, 1500)).toBe(3000);
});

describe('Alt Gym / Alt Machine and PRs', () => {
  const { recalculatePRs } = require('../progressUtils');
  let store;
  beforeEach(() => {
    store = {};
    global.localStorage = {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    };
  });
  const put = (k, v) => { store[k] = JSON.stringify(v); };
  const get = k => JSON.parse(store[k]);
  const set = (w, r, ctx) => ({ exercise: 'Bench', weightsArray: [w], repsArray: [r], ...(ctx ? { sessionCtx: ctx } : {}) });
  const MACHINE = { altMachine: true, altGym: false, gymName: '' };

  test('updatePRs ignores tagged sets', () => {
    const prs = updatePRs('u', { date: '2026-01-02', log: [set(100, 5), set(140, 5, MACHINE)] }, calculateWorkoutVolume);
    expect(prs.Bench.heaviestSet.weight).toBe(100);
    expect(prs.Bench.repPRsByWeight['140']).toBeUndefined();
    expect(prs.Bench.highestVolumeSession.volume).toBe(500);
  });

  test('tagging the set behind a PR rolls both stores back to the best untagged set', () => {
    const workouts = [
      { date: '2026-01-01', log: [set(100, 5)] },
      { date: '2026-01-08', log: [set(140, 5)] },
    ];
    put('workouts_u', workouts);
    updatePRs('u', workouts[0], calculateWorkoutVolume);
    updatePRs('u', workouts[1], calculateWorkoutVolume);
    put('prBoard_u', { Bench: { weight: 140, weightReps: 5, weightDate: '2026-01-08', e1rm: 163.3, e1rmReps: 5, e1rmWeight: 140, e1rmDate: '2026-01-08', volume: 700, volumeDate: '2026-01-08' } });

    // Mark the 140 kg set as a different machine.
    workouts[1].log[0].sessionCtx = MACHINE;
    put('workouts_u', workouts);
    expect(recalculatePRs('u', ['Bench'])).toBe(true);

    expect(get('prBoard_u').Bench).toMatchObject({ weight: 100, weightReps: 5, weightDate: '2026-01-01', e1rm: 116.7, volume: 500 });
    const prs = get('prs_u').Bench;
    expect(prs.heaviestSet).toMatchObject({ weight: 100, reps: 5 });
    expect(prs.repPRsByWeight).toEqual({ 100: { reps: 5, date: new Date('2026-01-01').getTime() } });
    expect(prs.highestVolumeSession.volume).toBe(500);

    // Un-mark it again: the PR comes back.
    delete workouts[1].log[0].sessionCtx;
    put('workouts_u', workouts);
    recalculatePRs('u', ['bench']);
    expect(get('prBoard_u').Bench).toMatchObject({ weight: 140, weightDate: '2026-01-08' });
    expect(get('prs_u').Bench.heaviestSet.weight).toBe(140);
  });

  test('a record from a workout no longer on the device is kept', () => {
    put('workouts_u', [{ date: '2026-03-01', log: [set(100, 5), set(90, 5, MACHINE)] }]);
    put('prBoard_u', { Bench: { weight: 150, weightReps: 3, weightDate: '2025-06-01', e1rm: 165, volume: 450 } });
    put('prs_u', { Bench: { heaviestSet: { weight: 150, reps: 3, date: 1 }, repPRsByWeight: { 150: { reps: 3, date: 1 } }, highestVolumeSession: { volume: 9000, date: 1 }, history: [] } });
    recalculatePRs('u', ['Bench']);
    expect(get('prBoard_u').Bench).toMatchObject({ weight: 150, e1rm: 165, volume: 500 });
    const prs = get('prs_u').Bench;
    expect(prs.heaviestSet.weight).toBe(150);
    expect(prs.repPRsByWeight['150'].reps).toBe(3);
    expect(prs.repPRsByWeight['100'].reps).toBe(5);
    expect(prs.repPRsByWeight['90']).toBeUndefined();
    expect(prs.highestVolumeSession.volume).toBe(9000);
  });

  test('an exercise with only tagged sets loses its PR entry', () => {
    put('workoutHistory_u', [{ date: '2026-01-01', log: [set(100, 5, { altMachine: false, altGym: true, gymName: 'Hotel' })] }]);
    put('prBoard_u', { Bench: { weight: 100, weightReps: 5, e1rm: 116.7, volume: 500 }, Squat: { weight: 140, e1rm: 150, volume: 700 } });
    put('prs_u', { Bench: { heaviestSet: { weight: 100, reps: 5, date: 1 }, repPRsByWeight: { 100: { reps: 5, date: 1 } }, highestVolumeSession: { volume: 500, date: 1 }, history: [] } });
    recalculatePRs('u', ['Bench']);
    expect(get('prBoard_u').Bench).toBeUndefined();
    expect(get('prBoard_u').Squat.weight).toBe(140); // other exercises untouched
    expect(get('prs_u').Bench).toBeUndefined();
  });

  test('back-off sets and other exercises are ignored; no change → nothing written', () => {
    put('workouts_u', [{ date: '2026-01-01', log: [{ exercise: 'Bench', weightsArray: [100, 120], repsArray: [5, 5], setTypeArray: ['standard', 'backoff'] }] }]);
    recalculatePRs('u', ['Bench']);
    expect(get('prBoard_u').Bench.weight).toBe(100);
    const before = store['prBoard_u'];
    expect(recalculatePRs('u', ['Bench'])).toBe(false);
    expect(store['prBoard_u']).toBe(before);
    expect(recalculatePRs('u', ['Deadlift'])).toBe(false);
  });
});
