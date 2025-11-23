const { getMuscleGroup } = require('../exerciseMuscleMap');

describe('getMuscleGroup', () => {
  test('matches exercise names case-insensitively', () => {
    expect(getMuscleGroup('bench press')).toBe('chest');
    expect(getMuscleGroup('  BENCH PRESS  ')).toBe('chest');
  });

  test('returns other for unknown or invalid inputs', () => {
    expect(getMuscleGroup('Unknown Move')).toBe('other');
    expect(getMuscleGroup(null)).toBe('other');
  });
});
