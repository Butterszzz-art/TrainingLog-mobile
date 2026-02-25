const {
  analyzeExerciseVariety,
  analyzeMonotonyAndStrain,
  buildProgramVarietyRecommendations,
} = require('../exerciseVarietyEngine');

describe('exerciseVarietyEngine', () => {
  test('builds variety suggestions and low-progress flags from 8-week history', () => {
    const history = [
      {
        date: '2026-01-01T00:00:00.000Z',
        exercises: [
          { name: 'Bench Press', repsArray: [5, 5], weightsArray: [100, 100] },
          { name: 'Incline Bench Press', repsArray: [8], weightsArray: [70] },
        ],
      },
      {
        date: '2026-01-25T00:00:00.000Z',
        exercises: [{ name: 'Bench Press', repsArray: [5, 5], weightsArray: [102.5, 102.5] }],
      },
      {
        date: '2026-02-10T00:00:00.000Z',
        exercises: [{ name: 'Bench Press', repsArray: [5, 5], weightsArray: [102.5, 102.5] }],
      },
    ];

    const result = analyzeExerciseVariety(history, '2026-02-20T00:00:00.000Z');

    expect(result.muscleHistory.chest.exercisesPerformedLast8Weeks).toEqual(
      expect.arrayContaining(['Bench Press', 'Incline Bench Press'])
    );
    expect(result.suggestedVarietyExercises.chest).toContain('Incline Bench Press');
    expect(result.lowProgressExercises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exercise: 'Incline Bench Press',
          lowProgress: true,
        }),
      ])
    );
  });

  test('recommends deload weeks when monotony/strain is high', () => {
    const history = [];
    for (let day = 0; day < 42; day += 1) {
      history.push({
        date: new Date(Date.UTC(2026, 0, 1 + day)).toISOString(),
        exercises: [{ name: 'Squat', repsArray: [10, 10, 10], weightsArray: [100, 100, 100] }],
      });
    }

    const load = analyzeMonotonyAndStrain(history, '2026-02-28T00:00:00.000Z');
    expect(load.recommendedDeloadWeeks.length).toBeGreaterThan(0);
    expect(load.weeklyMetrics.some((week) => week.shouldDeload)).toBe(true);

    const merged = buildProgramVarietyRecommendations(history, '2026-02-28T00:00:00.000Z');
    expect(merged.deloadPlan.recommendedDeloadWeeks).toEqual(load.recommendedDeloadWeeks);
  });
});
