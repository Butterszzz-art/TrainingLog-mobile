/**
 * @jest-environment node
 */
const { summariseWorkout, dayBucket } = require('../src/js/community-feed');
const { groupActivity7d } = require('../community');

describe('feed card helpers', () => {
  test('summarises volume, sets and the heaviest top set', () => {
    const s = summariseWorkout({
      log: [
        { name: 'Bench Press', weightsArray: [80, 82.5], repsArray: [5, 5] },
        { exercise: 'Row', weightsArray: [60], repsArray: [10] },
        { name: 'Plank', sets: 3 },
      ],
    });
    expect(s).toEqual({
      exercises: 3,
      names: ['Bench Press', 'Row', 'Plank'],
      sets: 6,
      volume: 1413,
      top: { name: 'Bench Press', kg: 82.5, reps: 5 },
    });
    expect(summariseWorkout({}).top).toBeNull();
  });

  test('buckets dates into Today / Yesterday / This week / Earlier', () => {
    const now = new Date(2026, 8, 26, 10);
    expect(dayBucket('2026-09-26', now)).toBe('Today');
    expect(dayBucket('2026-09-25', now)).toBe('Yesterday');
    expect(dayBucket('2026-09-21', now)).toBe('This week');
    expect(dayBucket('2026-09-10', now)).toBe('Earlier');
    expect(dayBucket('', now)).toBe('Earlier');
  });
});

describe('group activity bars', () => {
  test('counts posts per day for the last seven days', () => {
    const now = new Date(2026, 8, 26, 12);
    const posts = [
      { date: new Date(2026, 8, 26, 8).toISOString() },
      { date: new Date(2026, 8, 24, 9).toISOString() },
      { date: new Date(2026, 8, 24, 19).toISOString() },
      { date: new Date(2026, 8, 20, 8).toISOString() },
      { date: new Date(2026, 8, 19, 8).toISOString() }, // 8 days ago
      { date: 'not a date' },
    ];
    expect(groupActivity7d(posts, now)).toEqual([1, 0, 0, 0, 2, 0, 1]);
    expect(groupActivity7d(undefined, now)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
