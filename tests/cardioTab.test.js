const {
  resolveMET,
  estimateCardioCalories,
  computeDailyCardioExpenditure,
  applyCardioMacroAdjustment,
} = require('../cardioTab.js');

describe('cardioTab', () => {
  test('estimates calories from met and duration', () => {
    const calories = estimateCardioCalories({ type: 'running', durationMinutes: 30, weightKg: 70 });
    expect(calories).toBeGreaterThan(300);
    expect(calories).toBeLessThan(400);
    expect(resolveMET('unknown')).toBe(6);
  });

  test('uses manual calories when available for daily expenditure', () => {
    const log = [
      { date: '2024-01-01', type: 'running', duration: 20, calories: 200 },
      { date: '2024-01-01', type: 'walking', duration: 40, calories: 0 },
    ];
    const total = computeDailyCardioExpenditure(log, '2024-01-01', 70);
    expect(total).toBeGreaterThan(300);
  });

  test('applies macro adjustment from cardio calories', () => {
    const adjusted = applyCardioMacroAdjustment({ calories: 2200, protein: 150, carbs: 250, fat: 70 }, 300);
    expect(adjusted.calories).toBe(2500);
    expect(adjusted.carbs).toBeGreaterThan(250);
  });
});
