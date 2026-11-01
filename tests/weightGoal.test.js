const {
  weightGoalDirection,
  weightTrendTone,
  weightGoalProgress,
  weeksToGoal,
} = require('../weightTab.js');

describe('weight goal helpers', () => {
  test('direction from start to target', () => {
    expect(weightGoalDirection(85, 78)).toBe('lose');
    expect(weightGoalDirection(70, 76)).toBe('gain');
    expect(weightGoalDirection(80, 80.3)).toBe('maintain');
  });

  test('trend tone follows the goal', () => {
    expect(weightTrendTone(-0.4, 'lose')).toBe('good');
    expect(weightTrendTone(0.4, 'lose')).toBe('bad');
    expect(weightTrendTone(0.4, 'gain')).toBe('good');
    expect(weightTrendTone(-0.4, 'gain')).toBe('bad');
    expect(weightTrendTone(0.01, 'lose')).toBe('flat');
    expect(weightTrendTone(0.1, 'maintain', { holdKg: 0.15 })).toBe('good');
    expect(weightTrendTone(-0.5, 'maintain', { holdKg: 0.15 })).toBe('bad');
  });

  test('progress percent and reached', () => {
    const half = weightGoalProgress({ startKg: 90, currentKg: 85, targetKg: 80 });
    expect(half.percent).toBeCloseTo(50);
    expect(half.remainingKg).toBeCloseTo(-5);
    expect(half.reached).toBe(false);

    const wrongWay = weightGoalProgress({ startKg: 90, currentKg: 92, targetKg: 80 });
    expect(wrongWay.percent).toBe(0);

    const done = weightGoalProgress({ startKg: 70, currentKg: 76.2, targetKg: 76 });
    expect(done.reached).toBe(true);
    expect(done.percent).toBe(100);
  });

  test('weeks to goal only when heading the right way', () => {
    expect(weeksToGoal({ currentKg: 84, targetKg: 80, kgPerWeek: -0.5 })).toBeCloseTo(8);
    expect(weeksToGoal({ currentKg: 84, targetKg: 80, kgPerWeek: 0.3 })).toBeNull();
    expect(weeksToGoal({ currentKg: 84, targetKg: 80, kgPerWeek: 0 })).toBeNull();
  });
});
