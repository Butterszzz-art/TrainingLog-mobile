const W = require('../src/js/weekly-budget-core');

const T = { kcal: 2000, protein: 150, carbs: 200, fat: 60 };
// Thursday 26 November 2026: Mon 23 – Sun 29.
const TODAY = '2026-11-26';

function week(eaten, { targets = {}, today = TODAY } = {}) {
  return W.computeWeek({
    today,
    eatenOn: d => (d in eaten ? eaten[d] : null),
    targetFor: d => targets[d] || T,
  });
}

describe('week dates', () => {
  test('Monday to Sunday around the day', () => {
    expect(W.weekDays('2026-11-26')).toEqual([
      '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29',
    ]);
    expect(W.weekStart('2026-11-23')).toBe('2026-11-23');
    expect(W.weekStart('2026-11-29')).toBe('2026-11-23');
  });
});

describe('computeWeek', () => {
  test('every day on target: on track at the usual daily number', () => {
    const w = week({ '2026-11-23': T, '2026-11-24': T, '2026-11-25': T });
    expect(w.budget.kcal).toBe(14000);
    expect(w.eaten.kcal).toBe(6000);
    expect(w.left.kcal).toBe(8000);
    expect(w.banked.kcal).toBe(0);
    expect(w.perDay.kcal).toBe(2000);
    expect(w.daysRemaining).toBe(4);
    expect(w.paceKcal).toBe(8000);
    expect(w.status).toBe('on_track');
  });

  test('days under target bank calories for a bigger meal', () => {
    const under = { ...T, kcal: 1600 };
    const w = week({ '2026-11-23': under, '2026-11-24': under, '2026-11-25': T });
    expect(w.banked.kcal).toBe(800);
    expect(w.perDay.kcal).toBe(2200); // 2000 + 800 / 4 days
    expect(w.status).toBe('under');
    expect(W.headline(w)).toMatch(/800 kcal banked/);
  });

  test('a big day over pulls the remaining days down', () => {
    const w = week({ '2026-11-23': T, '2026-11-24': { ...T, kcal: 3600 }, '2026-11-25': T });
    expect(w.banked.kcal).toBe(-1600);
    expect(w.perDay.kcal).toBe(1600);
    expect(w.status).toBe('over');
    expect(W.headline(w)).toMatch(/1,600 kcal over so far/);
  });

  test('an earlier day with nothing logged is left out, target and all', () => {
    const w = week({ '2026-11-23': T, '2026-11-25': T });
    expect(w.daysSkipped).toBe(1);
    expect(w.budget.kcal).toBe(12000);
    expect(w.left.kcal).toBe(8000);
    expect(w.banked.kcal).toBe(0);
  });

  test("today's intake counts toward eaten but not toward banked", () => {
    const w = week({ '2026-11-26': { kcal: 900, protein: 60, carbs: 90, fat: 30 } });
    expect(w.eaten.kcal).toBe(900);
    expect(w.banked.kcal).toBe(0);
    expect(w.perDay.kcal).toBe(2000);
  });

  test("each day's own target adds into the budget (rest days, refeeds)", () => {
    const rest = { kcal: 1700, protein: 150, carbs: 120, fat: 60 };
    const w = week({ '2026-11-23': rest, '2026-11-24': T, '2026-11-25': T }, { targets: { '2026-11-23': rest } });
    expect(w.budget.kcal).toBe(13700);
    expect(w.banked.kcal).toBe(0);
  });

  test('over the whole week already', () => {
    const big = { ...T, kcal: 5000 };
    const w = week({ '2026-11-23': big, '2026-11-24': big, '2026-11-25': big, '2026-11-26': { ...T, kcal: 1000 } });
    expect(w.left.kcal).toBeLessThan(0);
    expect(w.perDay.kcal).toBe(0);
    expect(w.status).toBe('over_week');
    expect(W.headline(w)).toMatch(/Over the week's budget/);
  });

  test('macros are summed too; kcal fills in from grams when missing', () => {
    const w = week({ '2026-11-23': { protein: 100, carbs: 100, fat: 50 } }, { today: '2026-11-24' });
    expect(w.eaten.kcal).toBe(100 * 4 + 100 * 4 + 50 * 9);
    expect(w.left.protein).toBe(150 * 7 - 100);
    expect(w.banked.protein).toBe(50);
  });

  test('Sunday: one day left, headline says today', () => {
    const w = week({}, { today: '2026-11-29' });
    expect(w.daysRemaining).toBe(1);
    expect(w.budget.kcal).toBe(2000);
    expect(W.headline(w)).toMatch(/for today/);
  });
});
