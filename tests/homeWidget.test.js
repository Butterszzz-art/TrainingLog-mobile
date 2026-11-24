const HW = require('../src/js/home-widget.js');
const PS = require('../src/js/program-schedule.js');

// Mon/Wed/Fri, 3 days, started Monday 2026-11-02.
const program = {
  id: 'p1',
  name: 'Hypertrophy Block',
  frequency: ['Mon', 'Wed', 'Fri'],
  days: [
    { name: 'Push', exercises: [{ name: 'Bench Press', sets: [{ reps: 8 }] }] },
    { name: 'Pull', exercises: [{ name: 'Row', sets: [{ reps: 10 }] }] },
    { name: 'Legs', exercises: [{ name: 'Squat', sets: [{ reps: 5 }] }] },
  ],
};
const schedule = () => PS.createSchedule(program, { programId: 'p1', startDate: '2026-11-02' });

describe('programDayLabels', () => {
  test('null without an active program', () => {
    expect(HW.programDayLabels(null, new Date(2026, 10, 4))).toBeNull();
  });

  test('training day: program and week on top, day number and name as the title', () => {
    // Wednesday of week 2 is the 5th session: Day 2 of 3, Pull.
    const l = HW.programDayLabels(schedule(), new Date(2026, 10, 11));
    expect(l.eyebrow).toBe('Hypertrophy Block · Wk 2');
    expect(l.title).toBe('Day 2 · Pull');
    expect(l.isTraining).toBe(true);
  });

  test('rest day', () => {
    const l = HW.programDayLabels(schedule(), new Date(2026, 10, 3)); // Tuesday
    expect(l).toEqual({ eyebrow: 'Hypertrophy Block', title: 'Rest day', isTraining: false });
  });
});

describe('buildSnapshot', () => {
  test('macros eaten against targets, rounded, with tomorrow for the midnight roll-over', () => {
    const s = HW.buildSnapshot({
      dateKey: '2026-11-20',
      today: { eyebrow: 'Hypertrophy · Wk 3', title: 'Day 1 · Push', isTraining: true, done: true },
      tomorrow: { eyebrow: 'Hypertrophy · Wk 3', title: 'Rest day', isTraining: false },
      eaten: { protein: 112.4, carbs: 128, fats: 41, calories: 1229.6 },
      targets: { calories: 2650, protein: 190, carbs: 300, fat: 80 },
    });
    expect(s).toEqual({
      date: '2026-11-20',
      eyebrow: 'Hypertrophy · Wk 3',
      title: 'Day 1 · Push',
      isTraining: true,
      done: true,
      tomorrowEyebrow: 'Hypertrophy · Wk 3',
      tomorrowTitle: 'Rest day',
      tomorrowIsTraining: false,
      kcal: { eaten: 1230, target: 2650 },
      protein: { eaten: 112, target: 190 },
      carbs: { eaten: 128, target: 300 },
      fat: { eaten: 41, target: 80 },
      performance: null,
    });
  });

  test('performance mode summary rides along, cleaned up', () => {
    const s = HW.buildSnapshot({
      dateKey: '2026-11-20', today: null, tomorrow: null, eaten: null, targets: null,
      performance: {
        dayName: 'Push', startedAtMs: 1763650000000.4, doneSets: 7, plannedSets: 18,
        volumeKg: 4320.6, nextUp: 'Bench Press · Set 4', restEndsAtMs: 1763650090000,
        restPausedSeconds: null, budgetMin: 45, pace: 'behind', behindMin: 4,
      },
    });
    expect(s.performance).toEqual({
      dayName: 'Push', startedAtMs: 1763650000000, doneSets: 7, plannedSets: 18,
      volumeKg: 4321, nextUp: 'Bench Press · Set 4', restEndsAtMs: 1763650090000,
      restPausedSeconds: null, budgetMin: 45, pace: 'behind', behindMin: 4,
    });
  });

  test('performance: unknown pace dropped, behind minutes only when behind', () => {
    const p = HW.buildPerformance({ doneSets: 2, pace: 'weird', behindMin: 3, restPausedSeconds: 42 });
    expect(p.pace).toBeNull();
    expect(p.behindMin).toBeNull();
    expect(p.restPausedSeconds).toBe(42);
    expect(p.plannedSets).toBe(0);
    expect(HW.buildPerformance(null)).toBeNull();
  });

  test('nothing planned, nothing logged, no targets', () => {
    const s = HW.buildSnapshot({ dateKey: '2026-11-20', today: null, tomorrow: null, eaten: null, targets: null });
    expect(s.title).toBe('No session planned');
    expect(s.eyebrow).toBe('Today');
    expect(s.isTraining).toBe(false);
    expect(s.tomorrowTitle).toBeNull();
    expect(s.tomorrowIsTraining).toBeNull();
    expect(s.kcal).toEqual({ eaten: 0, target: 0 });
    expect(s.fat).toEqual({ eaten: 0, target: 0 });
  });

  test('negative or junk numbers become 0', () => {
    const s = HW.buildSnapshot({
      dateKey: 'd', today: null, tomorrow: null,
      eaten: { protein: -5, carbs: 'x', fats: NaN, calories: null },
      targets: { calories: '2000', protein: 150, carbs: 200, fats: 60 },
    });
    expect(s.protein.eaten).toBe(0);
    expect(s.carbs.eaten).toBe(0);
    expect(s.kcal).toEqual({ eaten: 0, target: 2000 });
    expect(s.fat.target).toBe(60);
  });
});

describe('readSnapshot', () => {
  const store = (data) => ({ getItem: k => (k in data ? data[k] : null) });

  afterEach(() => {
    delete global.currentUser;
    delete global.programSchedule;
    delete global.todaySession;
    delete global.getTodayDateString;
    delete global.getAdaptiveMacroTargets;
    delete global.PerformanceMode;
  });

  test('carries performance mode\'s summary while it is on', () => {
    global.currentUser = 'ana';
    let summary = { dayName: 'Push', doneSets: 3, plannedSets: 12, volumeKg: 1800, nextUp: 'Row · Set 1' };
    global.PerformanceMode = { getWidgetSummary: () => summary };
    const on = HW.readSnapshot(store({}), new Date(2026, 10, 11));
    expect(on.performance.doneSets).toBe(3);
    expect(on.performance.nextUp).toBe('Row · Set 1');
    summary = null;
    expect(HW.readSnapshot(store({}), new Date(2026, 10, 11)).performance).toBeNull();
  });

  test('null when nobody is signed in', () => {
    expect(HW.readSnapshot(store({}), new Date(2026, 10, 11))).toBeNull();
  });

  test('reads the program day and today\'s macros', () => {
    global.currentUser = 'ana';
    global.programSchedule = { ...PS, getActiveSchedule: () => schedule(), workoutsOn: () => [] };
    global.getTodayDateString = () => '2026-11-11';
    global.getAdaptiveMacroTargets = () => ({ calories: 2500, protein: 180, carbs: 250, fat: 70 });
    const s = HW.readSnapshot(store({
      dailyMacroDate: '2026-11-11',
      dailyMacroProgress: JSON.stringify({ protein: 100, carbs: 50, fats: 20, cals: 0, calories: 780 }),
    }), new Date(2026, 10, 11, 14));
    expect(s.title).toBe('Day 2 · Pull');
    expect(s.tomorrowTitle).toBe('Rest day');
    expect(s.tomorrowIsTraining).toBe(false);
    expect(s.done).toBe(false);
    expect(s.kcal).toEqual({ eaten: 780, target: 2500 });
    expect(s.protein).toEqual({ eaten: 100, target: 180 });
  });

  test('yesterday\'s macro log counts as nothing eaten today', () => {
    global.currentUser = 'ana';
    global.getTodayDateString = () => '2026-11-11';
    const s = HW.readSnapshot(store({
      dailyMacroDate: '2026-11-10',
      dailyMacroProgress: JSON.stringify({ protein: 100, carbs: 50, fats: 20, calories: 780 }),
    }), new Date(2026, 10, 11));
    expect(s.kcal.eaten).toBe(0);
    expect(s.protein.eaten).toBe(0);
  });

  test('without a program, today\'s picked session; "Not today" wins', () => {
    global.currentUser = 'ana';
    let declined = false;
    global.todaySession = {
      getTodaysSession: () => ({ name: 'Upper A', exercises: [] }),
      readDecline: () => declined,
    };
    expect(HW.readSnapshot(store({}), new Date(2026, 10, 11)).title).toBe('Upper A');
    declined = true;
    const s = HW.readSnapshot(store({}), new Date(2026, 10, 11));
    expect(s.title).toBe('Not today');
    expect(s.isTraining).toBe(false);
  });
});
