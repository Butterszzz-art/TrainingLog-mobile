const {
  computeWeightChangeRate,
  suggestCalorieAdjustment,
  applyWeightTrendAdjustment,
  buildWeightVolumeIntakeInsight,
} = require('../weightTab.js');

describe('weightTab', () => {
  test('computes weekly rate', () => {
    const entries = [
      { date: '2024-01-01', weightKg: 80 },
      { date: '2024-01-08', weightKg: 79.3 },
      { date: '2024-01-15', weightKg: 78.9 },
    ];
    const trend = computeWeightChangeRate(entries, 30);
    expect(trend.kgPerWeek).toBeLessThan(0);
  });

  test('suggests calorie increase when cutting too fast', () => {
    const suggestion = suggestCalorieAdjustment({ kgPerWeek: -0.9, goal: 'cut', rate: 'moderate' });
    expect(suggestion.caloriesDelta).toBeGreaterThan(0);
  });

  test('adjusts macro targets from trend suggestion', () => {
    const adjusted = applyWeightTrendAdjustment({ calories: 2400, protein: 160, carbs: 280, fat: 70 }, { caloriesDelta: -200 });
    expect(adjusted.calories).toBe(2200);
    expect(adjusted.carbs).toBeLessThan(280);
  });

  test('returns plateau interpretation', () => {
    const insight = buildWeightVolumeIntakeInsight({ weightTrend: 0.01, volumeTrend: 0.2, intakeTrend: -0.02 });
    expect(insight.toLowerCase()).toContain('plateaued');
  });
});
