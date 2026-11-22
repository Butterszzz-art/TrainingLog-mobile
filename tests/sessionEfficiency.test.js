const tb = require('../src/js/time-budget-core');

describe('sessionEfficiency (phase 2)', () => {
  const log = [
    { exercise: 'Hack Squat', repsArray: [5, 8, 8, 8], setTypeArray: ['warmup', 'standard', 'standard', 'standard'] },
    { exercise: 'Lateral Raise', repsArray: [12, 12, 12] },
  ];

  test('splits the session into sets, timed rest and other time', () => {
    const e = tb.sessionEfficiency({ log, durationMin: 30, restBreaks: [2, 2, 2, 1.25, 1.25], budgetMin: 30, plannedMin: 28 });
    expect(e).toEqual({ durationMin: 30, workingSets: 6, minPerSet: 5, workMin: 4, restMin: 9, otherMin: 18, budgetMin: 30, plannedMin: 28 });
  });

  test('null without a duration or working sets; no budget/plan fields when unknown', () => {
    expect(tb.sessionEfficiency({ log, durationMin: 0 })).toBeNull();
    expect(tb.sessionEfficiency({ log: [{ exercise: 'Squat', repsArray: [5], setTypeArray: ['warmup'] }], durationMin: 20 })).toBeNull();
    const e = tb.sessionEfficiency({ log, durationMin: 20, budgetMin: 40 });
    expect(e.budgetMin).toBeUndefined(); // 40 isn't an offered budget
    expect(e.plannedMin).toBeUndefined();
  });

  test('describeEfficiency: verdict against the budget, tip only when other time is large', () => {
    const over = tb.describeEfficiency({ durationMin: 41, workingSets: 12, minPerSet: 3.4, otherMin: 14, budgetMin: 30 });
    expect(over.head).toBe('41 min · 12 sets · 3.4 min/set');
    expect(over.verdict).toBe('11 min over your budget');
    expect(over.tip).toMatch(/About 14 min/);
    const tidy = tb.describeEfficiency({ durationMin: 44, workingSets: 16, minPerSet: 2.8, otherMin: 4, plannedMin: 45 });
    expect(tidy.verdict).toBe('on your plan');
    expect(tidy.tip).toBe('');
    expect(tb.describeEfficiency(null)).toBeNull();
  });
});

describe('SessionEfficiency.stampEfficiency', () => {
  beforeEach(() => {
    const store = {};
    global.localStorage = {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    };
    global.TimeBudgetCore = tb;
    global.currentUser = 'ana';
    global.localStorage.setItem('workouts_ana', JSON.stringify([
      { date: '2026-11-22', log: [{ exercise: 'Bench Press', repsArray: [8, 8, 8] }], restBreaks: [2, 2] },
    ]));
    global.getTodaysPlannedDay = () => ({ exercises: [{ name: 'Bench Press', sets: [{}, {}, {}] }] });
    global.PerformanceMode = { getSettings: () => ({ active: true, budgetMin: 30 }) };
    jest.resetModules();
  });

  afterEach(() => {
    delete global.TimeBudgetCore; delete global.currentUser; delete global.getTodaysPlannedDay; delete global.PerformanceMode;
  });

  test('saves efficiency on the day\'s workout with budget and plan estimate', () => {
    const se = require('../src/js/session-efficiency');
    const e = se.stampEfficiency({ date: '2026-11-22', durationMin: 25 });
    expect(e).toMatchObject({ durationMin: 25, workingSets: 3, restMin: 4, budgetMin: 30 });
    expect(e.plannedMin).toBeGreaterThan(0);
    const saved = JSON.parse(global.localStorage.getItem('workouts_ana'))[0];
    expect(saved.efficiency).toEqual(e);
  });

  test('does nothing for a day with no workout', () => {
    const se = require('../src/js/session-efficiency');
    expect(se.stampEfficiency({ date: '2026-11-21', durationMin: 25 })).toBeNull();
  });
});
