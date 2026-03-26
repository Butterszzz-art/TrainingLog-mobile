const {
  mapExerciseToBodybuildingGroup,
  computeBodybuildingProgressSummary
} = require('../bodybuildingProgress');

describe('bodybuildingProgress mapping', () => {
  test('maps suggested back split and arms/delts buckets', () => {
    expect(mapExerciseToBodybuildingGroup('Wide-Grip Lat Pulldown')).toBe('back width');
    expect(mapExerciseToBodybuildingGroup('Barbell Row')).toBe('back thickness');
    expect(mapExerciseToBodybuildingGroup('Cable Triceps Pushdown', 'triceps')).toBe('arms');
    expect(mapExerciseToBodybuildingGroup('Lateral Raise', 'shoulders')).toBe('delts');
  });
});

describe('computeBodybuildingProgressSummary', () => {
  test('builds weekly planned vs actual and weak-point summaries', () => {
    const workouts = [
      {
        date: '2026-03-16',
        log: [
          {
            exercise: 'Bench Press',
            repsArray: [8, 8],
            weightsArray: [100, 100],
            setDefinitions: [
              { targetReps: 10, targetWeight: 100 },
              { targetReps: 10, targetWeight: 100 }
            ]
          },
          {
            exercise: 'Wide-Grip Lat Pulldown',
            repsArray: [10, 10],
            weightsArray: [80, 80],
            setDefinitions: [
              { targetReps: 10, targetWeight: 90 },
              { targetReps: 10, targetWeight: 90 }
            ]
          }
        ]
      }
    ];

    const summary = computeBodybuildingProgressSummary(workouts);
    const week = summary.weeklyVolumeComparison[0];
    const chest = week.muscleGroups.find((g) => g.muscleGroup === 'chest');
    const backWidth = week.muscleGroups.find((g) => g.muscleGroup === 'back width');

    expect(chest.actual).toBe(1600);
    expect(chest.planned).toBe(2000);
    expect(backWidth.actual).toBe(1600);
    expect(backWidth.planned).toBe(1800);
    expect(summary.weakPointFocus.some((item) => item.muscleGroup === 'chest')).toBe(true);
  });
});
