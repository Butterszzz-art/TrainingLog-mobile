// Both modules are browser scripts; a bare `window` is enough for their
// pure helpers (neither touches the DOM until it's rendered).
global.window = global;
const { buildShareSnapshot, weeklySessionCounts, compliancePercent } = require('../src/js/client-coaching.js');
const { _parseScheme, _formatScheme, _toExercise } = require('../src/js/coaching-enhanced.js');

function memoryStore(data) {
  const map = new Map(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

// Thursday 24 Sep 2026, local time. Weeks start on Monday 21 Sep.
const NOW = new Date(2026, 8, 24, 12, 0, 0);

describe('buildShareSnapshot', () => {
  const store = memoryStore({
    tl_checkins_v1_ana: [
      { date: '2026-09-10', energy: 6, sleep: 7 },
      { date: '2026-09-20', energy: 8, stress: 3, notes: '  felt strong ', insights: { summaryShort: 'Recovery up' }, bodyweight: '71.2' },
    ],
    bodyweightLog_ana: [
      { date: '2026-01-01', weight: 75 },            // older than 120 days: dropped
      { date: '2026-09-01', weight: 160, unit: 'lb', weightKg: 72.6 },
      { date: '2026-09-20', weight: 71.2 },
      { date: '2026-09-21', weight: '' },            // empty: dropped
    ],
    workoutHistory_ana: [
      { id: 'a', date: '2026-09-14', log: [] },
      { id: 'b', date: '2026-09-16', log: [] },
    ],
    workouts_ana: [
      { id: 'c', date: '2026-09-22', log: [] },
      { id: 'd', date: '2026-09-22', title: 'PM cardio', log: [] }, // same day: one session
      { id: 'b', date: '2026-09-16', log: [] },                    // duplicate of archived entry
    ],
    programs_ana: [{ id: 'p1', name: 'Upper/Lower', frequency: ['Mon', 'Tue', 'Thu', 'Fri'] }],
    activeProgram_ana: { programId: 'p1', programName: 'Upper/Lower' },
  });

  const snap = buildShareSnapshot(store, 'ana', NOW);

  test('check-ins are newest first with only known fields', () => {
    expect(snap.checkIns.map(c => c.date)).toEqual(['2026-09-20', '2026-09-10']);
    expect(snap.checkIns[0]).toEqual({ date: '2026-09-20', energy: 8, stress: 3, bodyweight: 71.2, notes: 'felt strong', summary: 'Recovery up' });
  });

  test('bodyweight uses kg, keeps 120 days, skips blanks', () => {
    expect(snap.bodyweight).toEqual([{ date: '2026-09-01', weight: 72.6 }, { date: '2026-09-20', weight: 71.2 }]);
  });

  test('workouts count distinct training days per week across live + archived logs', () => {
    expect(snap.workouts.weekStart).toBe('2026-09-21');
    expect(snap.workouts.thisWeek).toBe(1);
    const lastWeek = snap.workouts.weekly.find(w => w.weekStart === '2026-09-14');
    expect(lastWeek.count).toBe(2);
    expect(snap.workouts.weekly).toHaveLength(8);
  });

  test('compliance is measured against the active program and excludes the current week', () => {
    expect(snap.activeProgramName).toBe('Upper/Lower');
    // Last 4 completed weeks: 0, 0, 0, 2 sessions of 4 planned → 12.5% → 13
    expect(snap.compliancePercent).toBe(13);
  });
});

test('no active program means no compliance number (never a fake 0%)', () => {
  const store = memoryStore({ workouts_bo: [{ date: '2026-09-22' }] });
  expect(buildShareSnapshot(store, 'bo', NOW).compliancePercent).toBeNull();
  expect(compliancePercent([{ count: 3 }, { count: 1 }], null)).toBeNull();
});

test('compliance only counts full weeks since the program started', () => {
  const weekly = [
    { weekStart: '2026-08-31', count: 0 }, { weekStart: '2026-09-07', count: 0 },
    { weekStart: '2026-09-14', count: 3 }, { weekStart: '2026-09-21', count: 1 },
  ];
  expect(compliancePercent(weekly, 4, '2026-09-16')).toBe(75);     // only the week of 14 Sep counts
  expect(compliancePercent(weekly, 4, '2026-09-24')).toBeNull();   // started this week: no full week yet
  expect(compliancePercent(weekly, 4, '')).toBe(25);                // unknown start: last 3 completed weeks
});

test('weeklySessionCounts buckets by Monday-start weeks', () => {
  const store = memoryStore({ workouts_cy: [{ date: '2026-09-20' }, { date: '2026-09-21' }] });
  const weeks = weeklySessionCounts(store, 'cy', NOW, 2);
  expect(weeks).toEqual([{ weekStart: '2026-09-14', count: 1 }, { weekStart: '2026-09-21', count: 1 }]);
});

describe('coach program sets×reps', () => {
  test('parses common spellings', () => {
    expect(_parseScheme('4x8')).toEqual({ sets: 4, reps: 8 });
    expect(_parseScheme('3 × 8-12')).toEqual({ sets: 3, reps: 8, repsMax: 12 });
    expect(_parseScheme('5X5')).toEqual({ sets: 5, reps: 5 });
    expect(_parseScheme('3x12-8')).toEqual({ sets: 3, reps: 12 });
    expect(_parseScheme('lots')).toBeNull();
    expect(_parseScheme('0x5')).toBeNull();
  });

  test('old plain-name programs get a default scheme', () => {
    expect(_toExercise('Squat')).toEqual({ name: 'Squat', sets: 3, reps: 10 });
    expect(_formatScheme({ sets: 4, reps: 8, repsMax: 10 })).toBe('4×8-10');
  });
});
