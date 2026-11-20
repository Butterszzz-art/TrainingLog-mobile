const H = require('../src/js/habit-core.js');

const w = (date, extra = {}) => ({ date, log: [{ exercise: 'Bench Press', repsArray: [5], weightsArray: [100] }], ...extra });

describe('sessionDays', () => {
  test('splits own and imported days, ignores empty sessions', () => {
    const r = H.sessionDays([
      w('2026-11-02'), w('2026-11-02'), w('2026-10-01', { imported: true }),
      { date: '2026-11-03', log: [] }, { date: 'bad', log: [{ repsArray: [1] }] },
    ]);
    expect(r.all).toEqual(['2026-10-01', '2026-11-02']);
    expect(r.own).toEqual(['2026-11-02']);
    expect(r.imported).toBe(1);
  });
});

describe('weeklyProgress', () => {
  // 2026-11-19 is a Thursday; its week starts Monday 2026-11-16.
  const today = '2026-11-19';

  test('counts this week and lays out Mon-Sun', () => {
    const p = H.weeklyProgress(['2026-11-16', '2026-11-18'], 3, today);
    expect(p.done).toBe(2);
    expect(p.left).toBe(1);
    expect(p.hit).toBe(false);
    expect(p.week.map(d => d.date)[0]).toBe('2026-11-16');
    expect(p.week.map(d => d.trained)).toEqual([true, false, true, false, false, false, false]);
    expect(p.week[3].isToday).toBe(true);
    expect(p.week[4].future).toBe(true);
  });

  test('streak counts whole weeks and an unfinished week does not break it', () => {
    const days = [
      '2026-11-02', '2026-11-04', '2026-11-06', // week of 11-02: 3
      '2026-11-09', '2026-11-11', '2026-11-13', // week of 11-09: 3
      '2026-11-17',                             // this week: 1 so far
    ];
    const p = H.weeklyProgress(days, 3, today);
    expect(p.streakWeeks).toBe(2);
    expect(H.weeklyProgress([...days, '2026-11-18', '2026-11-19'], 3, today).streakWeeks).toBe(3);
  });

  test('a missed week resets the streak', () => {
    const p = H.weeklyProgress(['2026-10-26', '2026-10-28', '2026-11-09', '2026-11-11'], 2, today);
    expect(p.streakWeeks).toBe(1);
    expect(p.bestWeeks).toBe(1);
  });

  test('bad goals fall back to 3', () => {
    expect(H.weeklyProgress([], 0, today).goal).toBe(3);
    expect(H.weeklyProgress([], 9, today).goal).toBe(3);
  });
});

test('suggestGoal from training days or experience', () => {
  expect(H.suggestGoal([1, 3, 5])).toBe(3);
  expect(H.suggestGoal([0, 1, 2, 3, 4, 5, 6])).toBe(6);
  expect(H.suggestGoal([], 'beginner')).toBe(2);
  expect(H.suggestGoal(null, 'advanced')).toBe(4);
});

describe('isStarterMode', () => {
  test('on for the first 14 days', () => {
    const s = { startedAt: '2026-11-10' };
    expect(H.isStarterMode(s, { today: '2026-11-10' })).toBe(true);
    expect(H.isStarterMode(s, { today: '2026-11-23' })).toBe(true);
    expect(H.isStarterMode(s, { today: '2026-11-24' })).toBe(false);
    expect(H.starterDaysLeft(s, '2026-11-19')).toBe(5);
  });
  test('off when turned off, never started or history was imported', () => {
    expect(H.isStarterMode({ startedAt: '2026-11-18', starterOff: true }, { today: '2026-11-19' })).toBe(false);
    expect(H.isStarterMode({}, { today: '2026-11-19' })).toBe(false);
    expect(H.isStarterMode({ startedAt: '2026-11-18' }, { today: '2026-11-19', importedSessions: 40 })).toBe(false);
  });
});

describe('summarizeSession', () => {
  test('best set by e1RM, warm-ups excluded from sets, muscles grouped', () => {
    const s = H.summarizeSession({
      log: [
        { exercise: 'Bench Press', repsArray: [10, 5, 8], weightsArray: [40, 100, 90], setTypeArray: ['warmup', 'standard', 'standard'], unit: 'kg' },
        { exercise: 'Incline Press', repsArray: [10], weightsArray: [60] },
        { exercise: 'Mystery', repsArray: [10], weightsArray: [0] },
      ],
    }, n => (/press/i.test(n) ? 'chest' : 'other'));
    expect(s.sets).toBe(4);
    expect(s.volume).toBe(400 + 500 + 720 + 600);
    const bench = s.exercises[0];
    expect(bench.best).toEqual({ weight: 100, reps: 5 });
    expect(bench.e1rm).toBe(116.7);
    expect(s.muscles).toEqual([{ muscle: 'chest', sets: 3 }]);
  });
});

test('earlySessionNumber', () => {
  expect(H.earlySessionNumber([], '2026-11-19')).toEqual({ n: 1, show: true });
  expect(H.earlySessionNumber(['2026-11-17', '2026-11-19'], '2026-11-19')).toEqual({ n: 2, show: true });
  expect(H.earlySessionNumber(['a', 'b', 'c', 'd'], 'e')).toEqual({ n: 5, show: false });
});

describe('planLifecycle', () => {
  const now = new Date(2026, 10, 19, 9, 0).getTime(); // Thu 19 Nov, 09:00 local

  test('session 2 on the next training day after the first session', () => {
    const out = H.planLifecycle({
      state: { startedAt: '2026-11-18', trainingDays: [1, 3, 5], reminderTime: '07:30' },
      now, ownDays: ['2026-11-18'], nextHint: 'Bench Press 100 kg × 6',
    });
    const next = out.find(p => p.kind === 'nextSession');
    expect(next.date).toBe('2026-11-20'); // Friday
    expect(new Date(next.at).getHours()).toBe(7);
    expect(next.body).toMatch(/Bench Press 100 kg × 6/);
    expect(next.id).toBe(H.LIFECYCLE_ID_BASE);
  });

  test('first-week recap and comeback, nothing after the first month', () => {
    const out = H.planLifecycle({ state: { startedAt: '2026-11-16' }, now, ownDays: ['2026-11-16', '2026-11-18'], weekOne: { sessions: 2, sets: 30 } });
    expect(out.map(p => p.kind)).toEqual(['comeback', 'weekOne']);
    expect(out.find(p => p.kind === 'weekOne').date).toBe('2026-11-23');
    expect(out.find(p => p.kind === 'weekOne').body).toMatch(/2 sessions and 30 sets/);
    expect(out.find(p => p.kind === 'comeback').date).toBe('2026-11-23');
    expect(H.planLifecycle({ state: { startedAt: '2026-09-01' }, now, ownDays: [] })).toEqual([]);
    expect(H.planLifecycle({ state: {}, now })).toEqual([]);
  });

  test('ids are stable and listed', () => {
    expect(H.lifecycleIds()).toEqual([7400, 7401, 7402]);
  });
});
