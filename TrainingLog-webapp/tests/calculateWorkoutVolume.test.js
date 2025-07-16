const { calculateWorkoutVolume } = require('../calculateWorkoutVolume');

describe('calculateWorkoutVolume', () => {
  test('calculates total volume correctly', () => {
    const workout = {
      log: [
        { repsArray: [10, 8], weightsArray: [50, 60] },
        { repsArray: [5], weightsArray: [70] }
      ]
    };

    const total = calculateWorkoutVolume(workout);
    expect(total).toBe(10 * 50 + 8 * 60 + 5 * 70);
  });
});

