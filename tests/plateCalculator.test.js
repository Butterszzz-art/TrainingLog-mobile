const { calculatePlateCombination } = require('../plateCalculator.js');

describe('calculatePlateCombination', () => {
  test('returns exact combination when achievable', () => {
    const result = calculatePlateCombination(100, 20, [
      { size: 20, count: 4 },
      { size: 10, count: 2 }
    ]);

    expect(result.success).toBe(true);
    expect(result.achievedWeight).toBe(100);
    expect(result.combination).toEqual([
      { size: 20, pairs: 2 }
    ]);
  });

  test('falls back to closest lower weight when exact is unavailable', () => {
    const result = calculatePlateCombination(103, 20, [
      { size: 20, count: 4 },
      { size: 1.25, count: 2 }
    ]);

    expect(result.success).toBe(false);
    expect(result.achievedWeight).toBe(102.5);
    expect(result.remainingWeight).toBeCloseTo(0.5, 5);
  });
});
