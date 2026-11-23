/**
 * The Log tab's weekly volume card shows the same sets and targets as
 * Insights → Recovery (both from recoveryMap.js), including the lifter's own
 * saved weekly targets.
 */
require('../exerciseMuscleMap');
const recovery = require('../recoveryMap');
const { weeklyMuscleVolume } = require('../src/js/session-queue');

describe('Log weekly volume card matches Insights', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const workouts = [
    { date: '2026-11-20', log: [
      { exercise: 'Back Squat', repsArray: [5, 5, 5, 5], weightsArray: [100, 100, 100, 100] },
      { exercise: 'Bench Press', repsArray: [8, 8, 8], weightsArray: [80, 80, 80] },
    ] },
    { date: '2026-11-18', log: [{ exercise: 'Back Squat', repsArray: [5, 5, 5], weightsArray: [100, 100, 100] }] },
    { date: '2026-11-01', log: [{ exercise: 'Back Squat', repsArray: [5, 5, 5], weightsArray: [100, 100, 100] }] },
  ];
  let store;

  beforeEach(() => {
    store = {};
    global.localStorage = {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    };
    global.computeMuscleRecoverySummary = recovery.computeMuscleRecoverySummary;
    global.readMuscleWeeklyTargets = recovery.readMuscleWeeklyTargets;
  });

  afterEach(() => {
    delete global.computeMuscleRecoverySummary;
    delete global.readMuscleWeeklyTargets;
  });

  test('same per-muscle sets and targets as the Recovery Map, saved targets included', () => {
    localStorage.setItem('muscleWeeklyTargets_lifter', JSON.stringify({ quads: 20 }));
    const card = weeklyMuscleVolume('lifter', { workouts, now });
    const insights = recovery.computeMuscleRecoverySummary(workouts, { now, weeklyTargets: recovery.readMuscleWeeklyTargets('lifter') });
    const byMuscle = Object.fromEntries(insights.map(r => [r.muscle, r]));

    expect(card.length).toBeGreaterThan(0);
    card.forEach(r => {
      expect(r.sets).toBe(byMuscle[r.muscle].sets);
      expect(r.target).toBe(byMuscle[r.muscle].target);
    });
    const quads = card.find(r => r.muscle === 'quads');
    expect(quads).toMatchObject({ sets: 7, target: 20 });
  });

  test('only muscles trained this week, most worked first', () => {
    const card = weeklyMuscleVolume('lifter', { workouts, now });
    expect(card.every(r => r.sets > 0)).toBe(true);
    for (let i = 1; i < card.length; i++) expect(card[i - 1].sets).toBeGreaterThanOrEqual(card[i].sets);
  });

  test('formatSetCount: whole numbers without a decimal', () => {
    expect(recovery.formatSetCount(7)).toBe('7');
    expect(recovery.formatSetCount(7.5)).toBe('7.5');
  });
});

describe('weekly volume follows the program week', () => {
  beforeEach(() => {
    global.computeMuscleRecoverySummary = recovery.computeMuscleRecoverySummary;
    global.readMuscleWeeklyTargets = () => null;
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  });

  test('weekStart counts from the program week, not the last 7 days', () => {
    const now = new Date(2026, 10, 21, 12);
    const workouts = [
      { date: '2026-11-20', log: [{ exercise: 'Back Squat', repsArray: [5, 5, 5], weightsArray: [100, 100, 100] }] },
      { date: '2026-11-16', log: [{ exercise: 'Back Squat', repsArray: [5, 5], weightsArray: [100, 100] }] },
    ];
    const rolling = weeklyMuscleVolume('lifter', { workouts, now, weekStart: null });
    const programWeek = weeklyMuscleVolume('lifter', { workouts, now, weekStart: new Date(2026, 10, 19) });
    expect(rolling.find(r => r.muscle === 'quads').sets).toBe(5);
    expect(programWeek.find(r => r.muscle === 'quads').sets).toBe(3);
  });
});
