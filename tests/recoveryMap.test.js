require('../exerciseMuscleMap');
const {
  DEFAULT_WEEKLY_MUSCLE_TARGETS,
  MUSCLE_TARGET_BOUNDS,
  clampMuscleTarget,
  fatigueToColor,
  fatigueStatus,
  computeMuscleRecoverySummary
} = require('../recoveryMap');

describe('fatigueToColor / fatigueStatus', () => {
  test('interpolates across the fresh -> overreached scale', () => {
    expect(fatigueToColor(0)).toBe('rgb(242,236,224)');
    expect(fatigueToColor(100)).toBe('rgb(220,53,69)');
    expect(fatigueToColor(-20)).toBe(fatigueToColor(0));
    expect(fatigueToColor(150)).toBe(fatigueToColor(100));
  });

  test('labels status tiers', () => {
    expect(fatigueStatus(10)).toBe('Fresh');
    expect(fatigueStatus(40)).toBe('Moderate');
    expect(fatigueStatus(70)).toBe('Fatigued');
    expect(fatigueStatus(90)).toBe('Overreached');
  });
});

describe('computeMuscleRecoverySummary', () => {
  const now = new Date('2026-07-16T12:00:00Z');

  test('counts sets in the trailing 7-day window per muscle', () => {
    const workouts = [
      {
        date: '2026-07-15',
        log: [
          { exercise: 'Bench Press', repsArray: [8, 8, 8], weightsArray: [100, 100, 100] }
        ]
      },
      {
        date: '2026-07-01', // outside the 7-day window
        log: [
          { exercise: 'Bench Press', repsArray: [8, 8], weightsArray: [90, 90] }
        ]
      }
    ];

    const summary = computeMuscleRecoverySummary(workouts, { now });
    const chest = summary.find((row) => row.muscle === 'chest');
    expect(chest.sets).toBe(3);
    expect(chest.target).toBe(DEFAULT_WEEKLY_MUSCLE_TARGETS.chest);
    expect(chest.daysSinceTrained).toBe(1);
  });

  test('gives muscles trained today a higher fatigue score than untouched ones', () => {
    const workouts = [
      {
        date: '2026-07-16',
        log: [
          { exercise: 'Back Squat', repsArray: [5, 5, 5, 5], weightsArray: [140, 140, 140, 140] }
        ]
      }
    ];

    const summary = computeMuscleRecoverySummary(workouts, { now });
    const quads = summary.find((row) => row.muscle === 'quads');
    const calves = summary.find((row) => row.muscle === 'calves');
    expect(quads.fatigueScore).toBeGreaterThan(calves.fatigueScore);
    expect(calves.daysSinceTrained).toBeNull();
  });

  test('applies whole-body soreness as a small uniform nudge', () => {
    const workouts = [];
    const sore = computeMuscleRecoverySummary(workouts, { now, soreness: 1 });
    const fresh = computeMuscleRecoverySummary(workouts, { now, soreness: 5 });
    const soreChest = sore.find((row) => row.muscle === 'chest');
    const freshChest = fresh.find((row) => row.muscle === 'chest');
    expect(soreChest.fatigueScore).toBeGreaterThan(freshChest.fatigueScore);
  });

  test('respects custom weekly targets', () => {
    const summary = computeMuscleRecoverySummary([], { now, weeklyTargets: { chest: 20 } });
    const chest = summary.find((row) => row.muscle === 'chest');
    expect(chest.target).toBe(20);
  });

  test('clamps out-of-range custom targets to the muscle bounds', () => {
    const summary = computeMuscleRecoverySummary([], {
      now,
      weeklyTargets: { chest: 999, adductors: -5 }
    });
    const chest = summary.find((row) => row.muscle === 'chest');
    const adductors = summary.find((row) => row.muscle === 'adductors');
    expect(chest.target).toBe(MUSCLE_TARGET_BOUNDS.chest.max);
    expect(adductors.target).toBe(MUSCLE_TARGET_BOUNDS.adductors.min);
  });
});

describe('MUSCLE_TARGET_BOUNDS / clampMuscleTarget', () => {
  test('every default target falls within its own bounds', () => {
    Object.entries(DEFAULT_WEEKLY_MUSCLE_TARGETS).forEach(([muscle, value]) => {
      const bounds = MUSCLE_TARGET_BOUNDS[muscle];
      expect(bounds).toBeDefined();
      expect(value).toBeGreaterThanOrEqual(bounds.min);
      expect(value).toBeLessThanOrEqual(bounds.max);
    });
  });

  test('clampMuscleTarget clamps to [min, max] and falls back for unknown muscles', () => {
    expect(clampMuscleTarget('chest', -10)).toBe(0);
    expect(clampMuscleTarget('chest', 999)).toBe(MUSCLE_TARGET_BOUNDS.chest.max);
    expect(clampMuscleTarget('chest', 12)).toBe(12);
    expect(clampMuscleTarget('unknownMuscle', 999)).toBe(30);
  });
});
