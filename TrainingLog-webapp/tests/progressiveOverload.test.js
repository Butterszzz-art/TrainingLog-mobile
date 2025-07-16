const { getProgressiveOverloadSuggestion } = require('../progressiveOverload');

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
            unit: 'kg'
          }
        ]
      }
    ];
    const msg = getProgressiveOverloadSuggestion('Bench', workouts);
    expect(msg).toMatch(/2\.5 .*kg/i);
    expect(msg).toMatch(/1-2 reps/);
  });

  test('returns null when goals not met', () => {
    const workouts = [
      {
        log: [
          {
            exercise: 'Squat',
            weightsArray: [60],
            repsArray: [5],
            goal: 80,
            repGoal: 8,
            unit: 'kg'
          }
        ]
      }
    ];
    const msg = getProgressiveOverloadSuggestion('Squat', workouts);
    expect(msg).toBeNull();
  });
});
