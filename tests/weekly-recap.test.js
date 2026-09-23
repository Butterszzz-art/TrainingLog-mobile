const { buildWeeklyRecap, mondayOf } = require('../src/js/weekly-recap');
const { getMuscleGroup } = require('../exerciseMuscleMap');

// Week under test: Mon 2026-09-14 → Sun 2026-09-20. Previous: 7th → 13th.
const WEEK = '2026-09-14';
const TODAY = '2026-09-23';

function entry(exercise, reps, weights, extra = {}) {
  return { exercise, repsArray: reps, weightsArray: weights, unit: 'kg', ...extra };
}

function recap(data, opts = {}) {
  return buildWeeklyRecap(data, { weekStart: WEEK, today: TODAY, getMuscleGroup, ...opts });
}

describe('mondayOf', () => {
  test('returns the Monday of the containing week, including on Sundays', () => {
    expect(mondayOf(new Date(2026, 8, 20))).toBe('2026-09-14'); // Sunday
    expect(mondayOf(new Date(2026, 8, 14))).toBe('2026-09-14'); // Monday
    expect(mondayOf(new Date(2026, 8, 23))).toBe('2026-09-21'); // Wednesday
  });
});

describe('buildWeeklyRecap — training', () => {
  const workouts = [
    // previous week
    { date: '2026-09-08', log: [entry('Bench Press', [5, 5], [100, 100])] },
    // this week
    { date: '2026-09-14', log: [
      entry('Bench Press', [5, 5, 5], [105, 105, 100]),
      entry('Barbell Row', [8, 8], [80, 80])
    ] },
    { date: '2026-09-17', log: [
      entry('Bench Press', [8], [90]),
      entry('Back Squat', [5, 5], [140, 140], { skippedArray: [false, true] })
    ] },
    // next week — must be ignored
    { date: '2026-09-21', log: [entry('Bench Press', [5], [200])] }
  ];

  test('counts sessions, sets and volume only inside the week, excluding skipped sets', () => {
    const r = recap({ workouts });
    expect(r.training.sessions).toBe(2);
    expect(r.training.sets).toBe(7); // 3 bench + 2 row + 1 bench + 1 squat (1 skipped)
    expect(r.training.volumeKg).toBe(105 * 5 * 2 + 100 * 5 + 80 * 8 * 2 + 90 * 8 + 140 * 5);
    expect(r.prevTraining.sets).toBe(2);
    expect(r.days.filter(d => d.lifted).map(d => d.name)).toEqual(['Mon', 'Thu']);
  });

  test('builds per-muscle sets and training frequency, and lists untouched muscles', () => {
    const r = recap({ workouts });
    const chest = r.muscles.find(m => m.muscle === 'chest');
    expect(chest).toMatchObject({ sets: 4, frequency: 2, target: 14 });
    expect(r.muscles.find(m => m.muscle === 'back')).toMatchObject({ sets: 2, frequency: 1 });
    expect(r.missedMuscles).toContain('hamstrings');
    expect(r.missedMuscles).not.toContain('chest');
  });

  test('user muscle targets override the defaults', () => {
    const r = recap({ workouts, muscleTargets: { chest: 4, calves: 0 } });
    expect(r.muscles.find(m => m.muscle === 'chest').target).toBe(4);
    expect(r.missedMuscles).not.toContain('calves');
  });

  test('flags a PR when the best e1RM beats anything logged before the week', () => {
    const r = recap({ workouts });
    const bench = r.topLifts.find(l => l.exercise === 'Bench Press');
    expect(bench.isPR).toBe(true);
    expect(bench.kg).toBe(105);
    expect(bench.reps).toBe(5);
    expect(bench.changePct).toBeCloseTo(5, 5);
    const row = r.topLifts.find(l => l.exercise === 'Barbell Row');
    expect(row.isPR).toBe(false);
    expect(row.priorE1rmKg).toBeNull();
    expect(r.topLifts[0].exercise).toBe('Bench Press');
  });

  test('normalises lb entries to kg', () => {
    const r = recap({ workouts: [{ date: '2026-09-15', log: [entry('Bench Press', [10], [100], { unit: 'lb' })] }] });
    expect(r.training.volumeKg).toBeCloseTo(1000 * 0.45359237, 5);
  });
});

describe('buildWeeklyRecap — body, cardio, nutrition, recovery', () => {
  test('bodyweight change is measured from the last weigh-in before the week', () => {
    const r = recap({ bodyweightLog: [
      { date: '2026-09-10', weightKg: 82 },
      { date: '2026-09-15', weightKg: 81.6 },
      { date: '2026-09-19', weightKg: 81.2 }
    ] });
    expect(r.bodyweight.entries).toBe(2);
    expect(r.bodyweight.avgKg).toBeCloseTo(81.4, 5);
    expect(r.bodyweight.changeKg).toBeCloseTo(-0.8, 5);
  });

  test('cardio totals, per-type minutes and week-over-week comparison', () => {
    const r = recap({ cardioLog: [
      { date: '2026-09-09', type: 'Running', duration: '20' },
      { date: '2026-09-14', type: 'Running', duration: '30', distance: '5', calories: '300' },
      { date: '2026-09-16', type: 'Cycling', duration: '45', estimatedCalories: 400 },
      { date: '2026-09-18', type: 'Running', duration: '25', distance: '4.2' }
    ] });
    expect(r.cardio).toMatchObject({ sessions: 3, minutes: 100, calories: 700 });
    expect(r.cardio.distanceKm).toBeCloseTo(9.2, 5);
    expect(r.cardio.types).toEqual([
      { type: 'Running', minutes: 55 },
      { type: 'Cycling', minutes: 45 }
    ]);
    expect(r.prevCardio.minutes).toBe(20);
    expect(r.days.filter(d => d.cardio).map(d => d.name)).toEqual(['Mon', 'Wed', 'Fri']);
  });

  test('nutrition uses the last save per day and counts days within 10% of target', () => {
    const r = recap({
      macroTargets: { calories: 2500, protein: 180 },
      macroHistory: [
        { date: '2026-09-14', totals: { calories: 1800, protein: 120 } },
        { date: '2026-09-14', totals: { calories: 2450, protein: 175 } },
        { date: '2026-09-15', totals: { calories: 3200, protein: 150 } },
        { date: '2026-09-22', totals: { calories: 2500, protein: 180 } }
      ]
    });
    expect(r.nutrition.daysLogged).toBe(2);
    expect(r.nutrition.avgCalories).toBe((2450 + 3200) / 2);
    expect(r.nutrition.daysOnTarget).toBe(1);
  });

  test('counts mobility and CrossFit sessions and averages readiness and steps', () => {
    const r = recap({
      mobilitySessions: [{ completedAt: new Date(2026, 8, 16, 18).toISOString() }],
      crossfitLog: [{ date: '2026-09-19' }, { date: '2026-09-12' }],
      readiness: {
        [new Date(2026, 8, 14).toDateString()]: { score: 80 },
        [new Date(2026, 8, 15).toDateString()]: { score: 60 },
        [new Date(2026, 8, 16).toDateString()]: { skipped: true }
      },
      steps: { '2026-09-14': 8000, '2026-09-15': 12000 }
    });
    expect(r.conditioning).toEqual({ crossfit: 1, mobility: 1 });
    expect(r.recovery.avgReadiness).toBe(70);
    expect(r.recovery.avgSteps).toBe(10000);
  });

  test('hasData is false for an empty week and inProgress tracks the current week', () => {
    expect(recap({}).hasData).toBe(false);
    expect(recap({}).inProgress).toBe(false);
    expect(recap({}, { weekStart: '2026-09-21' }).inProgress).toBe(true);
    expect(recap({}, { weekStart: '2026-09-21' }).days.filter(d => d.future).length).toBe(4);
  });
});
