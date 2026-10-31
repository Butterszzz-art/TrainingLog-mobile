const Core = require('../src/js/food-core.js');

const e = (id, date, meal, kcal = 100) => ({ id, date, meal, name: `Food ${id}`, kcal, protein: 1, carbs: 1, fat: 1 });
const log = [
  e('a', '2026-10-30', 'breakfast', 300),
  e('b', '2026-10-30', 'lunch', 500),
  e('c', '2026-10-28', 'dinner', 700),
  e('d', '2026-10-31', 'lunch'), // today
  e('old', '2026-10-01', 'lunch'), // too long ago
];

describe('copySourceDays', () => {
  test('days before today with foods, newest first, with counts and kcal', () => {
    expect(Core.copySourceDays(log, '2026-10-31')).toEqual([
      { date: '2026-10-30', count: 2, kcal: 800 },
      { date: '2026-10-28', count: 1, kcal: 700 },
    ]);
  });

  test('caps the number of days and ignores bad input', () => {
    const many = Array.from({ length: 10 }, (_, i) => e(`x${i}`, `2026-10-${String(20 + i).padStart(2, '0')}`, 'lunch'));
    expect(Core.copySourceDays(many, '2026-10-31', { max: 3 }).map(d => d.date)).toEqual(['2026-10-29', '2026-10-28', '2026-10-27']);
    expect(Core.copySourceDays(null, '2026-10-31')).toEqual([]);
    expect(Core.copySourceDays(log, 'nope')).toEqual([]);
  });
});

describe('dayLabel', () => {
  test('yesterday, else weekday, date and month', () => {
    expect(Core.dayLabel('2026-10-30', '2026-10-31')).toBe('Yesterday');
    expect(Core.dayLabel('2026-10-28', '2026-10-31')).toBe('Wed 28 Oct');
  });

  test('is the same in every time zone (read as a calendar day)', () => {
    // 2026-11-01 is a Sunday everywhere.
    expect(Core.dayLabel('2026-11-01', '2026-11-05')).toBe('Sun 1 Nov');
  });
});

describe('copyPicked', () => {
  const day = log.filter(x => x.date === '2026-10-30');

  test('copies only the picked foods to the new date with new ids', () => {
    const out = Core.copyPicked(day, ['b'], '2026-10-31', { now: 5, rand: 'r' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Food b', date: '2026-10-31', meal: 'lunch', kcal: 500 });
    expect(out[0].id).not.toBe('b');
  });

  test("'same' keeps each meal; a meal name moves them all there", () => {
    expect(Core.copyPicked(day, ['a', 'b'], '2026-10-31', { meal: 'same' }).map(x => x.meal)).toEqual(['breakfast', 'lunch']);
    expect(Core.copyPicked(day, ['a', 'b'], '2026-10-31', { meal: 'dinner' }).map(x => x.meal)).toEqual(['dinner', 'dinner']);
    expect(Core.copyPicked(day, ['a'], '2026-10-31', { meal: 'brunch' })[0].meal).toBe('breakfast');
  });

  test('nothing picked copies nothing', () => {
    expect(Core.copyPicked(day, [], '2026-10-31')).toEqual([]);
  });
});
