const { getProgressiveOverloadSuggestion, suggestNextSession } = require('../progressiveOverload');

describe('getProgressiveOverloadSuggestion', () => {
  test('suggests weight and rep increase when goals met', () => {
    const workouts = [
      {
        log: [
          {
            exercise: 'Bench',
            weightsArray: [100, 100],
            repsArray: [8, 8],
            goal: 100,
            repGoal: 8,
            unit: 'kg',
            targetRPE: 8,
            rpeArray: [7.5, 8]
          }
        ]
      }
    ];
    const msg = getProgressiveOverloadSuggestion('Bench', workouts);
    expect(msg).toMatch(/target RPE/i);
    expect(msg).toMatch(/linear progression/i);
  });

  test('returns maintain/reduce signal when sets are failed', () => {
    const workouts = [
      {
        log: [
          {
            exercise: 'Squat',
            weightsArray: [100, 100],
            repsArray: [5, 5],
            completedArray: [true, false],
            unit: 'kg',
            targetRPE: 8,
            rpeArray: [8.5, 9]
          }
        ]
      }
    ];

    const recommendation = suggestNextSession('Squat', workouts);
    expect(recommendation.strategy).toBe('reduce');
    expect(recommendation.sets[0].weight).toBeLessThan(100);
  });

  test('uses average historical trend for progression rate', () => {
    const workouts = [
      { log: [{ exercise: 'Press', weightsArray: [50], repsArray: [8], unit: 'kg' }] },
      { log: [{ exercise: 'Press', weightsArray: [52.5], repsArray: [8], unit: 'kg' }] },
      { log: [{ exercise: 'Press', weightsArray: [55], repsArray: [8], unit: 'kg' }] }
    ];

    const recommendation = suggestNextSession('Press', workouts);
    expect(recommendation.averageRate.weightDelta).toBeGreaterThan(2);
    expect(recommendation.sets[0].weight).toBeGreaterThan(55);
  });
});
