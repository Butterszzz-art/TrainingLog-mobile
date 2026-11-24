/**
 * TestFlight build 8 feedback: a loaded program day's sets are laid out
 * ahead and only count once ticked. Unticked planned sets used to read as
 * lifted (next-set advice, PR card), and next-set advice only looked at the
 * last workout of the day.
 */
const po = require('../progressiveOverload');
const pm = require('../src/js/performance-mode');

const TODAY = '2026-11-24';
const planned = (exercise, sets, done) => ({
  exercise,
  templateExerciseId: exercise.toLowerCase(),
  repsArray: sets.map(s => s[1]),
  weightsArray: sets.map(s => s[0]),
  setTypeArray: sets.map(() => 'standard'),
  completedArray: sets.map((_, i) => !!(done && done[i])),
  skippedArray: sets.map(() => false),
  unit: 'kg',
});

describe('next-set advice in a loaded program day', () => {
  test('judges the set just lifted, not the planned sets still to do', () => {
    const day = { date: TODAY, metadata: { source: 'program', planned: true },
      log: [planned('Leg Curl', [[68, 6], [65, 6], [65, 6]], [true])] };
    const next = po.suggestNextSet('Leg Curl', [day], { date: TODAY, gymKey: '' });
    expect(next.weight).toBe(68);
  });

  test('no advice before any planned set is ticked', () => {
    const day = { date: TODAY, metadata: { source: 'program', planned: true },
      log: [planned('Leg Curl', [[65, 6], [65, 6]])] };
    expect(po.suggestNextSet('Leg Curl', [day], { date: TODAY, gymKey: '' })).toBeNull();
  });

  test('finds the exercise when the program day is not the last workout of the day', () => {
    const programDay = { date: TODAY, metadata: { source: 'program', planned: true },
      log: [planned('Leg Extension', [[85, 5], [85, 5]], [true])] };
    const freeform = { date: TODAY, log: [planned('Curl', [[14, 10]], [true])] };
    const next = po.suggestNextSet('Leg Extension', [programDay, freeform], { date: TODAY, gymKey: '' });
    expect(next).not.toBeNull();
    expect(next.weight).toBe(85);
  });

  test('a planned top set followed by planned back-offs gives back-off advice', () => {
    const e = planned('Squat', [[100, 5], [90, 8]], [true]);
    e.setTypeArray = ['top-set', 'backoff'];
    const day = { date: TODAY, metadata: { source: 'program', planned: true }, log: [e] };
    expect(po.suggestNextSet('Squat', [day], { date: TODAY, gymKey: '' }).kind).toBe('backoff');
  });

  test('history: unticked sets of an older program day are ignored', () => {
    const old = { date: '2026-11-19', metadata: { source: 'program', planned: true },
      log: [planned('Leg Curl', [[65, 6], [90, 6]], [true, false])] };
    const sessions = po.collectSessions('Leg Curl', [old], '');
    expect(sessions[0].sets.map(s => s.weight)).toEqual([65]);
  });
});

describe('rest chip mid-rest', () => {
  test('switching length keeps the time already rested', () => {
    const now = 1_000_000;
    const state = pm.createRestState(120, now - 30_000); // 30 s in
    const next = pm.retimeRestState(state, 90, now);
    expect(next.totalSeconds).toBe(90);
    expect(Math.round((next.endTimeMs - now) / 1000)).toBe(60);
  });

  test('a shorter length than already rested ends it almost at once', () => {
    const now = 1_000_000;
    const next = pm.retimeRestState(pm.createRestState(180, now - 120_000), 60, now);
    expect(Math.round((next.endTimeMs - now) / 1000)).toBe(1);
  });

  test('paused stays paused', () => {
    const now = 1_000_000;
    const paused = pm.togglePausedState(pm.createRestState(120, now - 20_000), now);
    const next = pm.retimeRestState(paused, 90, now);
    expect(next.pausedRemaining).toBe(70);
  });
});
