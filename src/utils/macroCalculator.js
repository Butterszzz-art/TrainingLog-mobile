/**
 * Estimate daily caloric needs based on goal.
 * Uses body weight (lbs) * goal multiplier:
 * Lose weight: 10-12; maintenance: 14-16; gain: 16-18.
 * @param {number} weightLb - body weight in pounds.
 * @param {'lose' | 'maintain' | 'gain'} goal - nutrition goal.
 * @returns {number} estimated calories.
 */
export function calculateDailyCalories(weightLb, goal = 'maintain') {
  const multipliers = {
    lose: [10, 12],
    maintain: [14, 16],
    gain: [16, 18],
  };
  const [low, high] = multipliers[goal] || multipliers.maintain;
  const avg = (low + high) / 2;
  return weightLb * avg;
}

/**
 * Calculate daily protein intake (grams).
 * General recommendation: 0.8-1 g/lb for maintenance/gain, 1-1.5 g/lb for weight loss.
 * @param {number} weightLb - body weight in pounds.
 * @param {'lose' | 'maintain' | 'gain'} goal - nutrition goal.
 * @returns {number} grams of protein.
 */
export function calculateProteinGrams(weightLb, goal = 'maintain') {
  const ranges = {
    lose: [1.0, 1.5],
    maintain: [0.8, 1.0],
    gain: [0.8, 1.0],
  };
  const [low, high] = ranges[goal] || ranges.maintain;
  const avg = (low + high) / 2;
  return weightLb * avg;
}

/**
 * Calculate daily fat intake (grams).
 * Set fats to ~20% of total calories with a minimum of 0.25 g/lb body weight.
 * @param {number} totalCalories - daily calories.
 * @param {number} weightLb - body weight in pounds.
 * @returns {number} grams of fat.
 */
export function calculateFatGrams(totalCalories, weightLb) {
  const fatFromCalories = (totalCalories * 0.2) / 9; // 20% of calories, 9 cal/g
  const minFat = weightLb * 0.25; // 0.25 g/lb
  return Math.max(fatFromCalories, minFat);
}

/**
 * Calculate daily carbohydrate intake (grams).
 * Carbs fill the remaining calories after protein and fat are accounted for.
 * @param {number} totalCalories - daily calories.
 * @param {number} proteinGrams - grams of protein.
 * @param {number} fatGrams - grams of fat.
 * @returns {number} grams of carbohydrates.
 */
export function calculateCarbGrams(totalCalories, proteinGrams, fatGrams) {
  const caloriesFromProtein = proteinGrams * 4; // 4 cal/g
  const caloriesFromFat = fatGrams * 9; // 9 cal/g
  const remaining = totalCalories - caloriesFromProtein - caloriesFromFat;
  return Math.max(remaining / 4, 0); // 4 cal/g for carbs
}

/**
 * Calculate daily fiber goal (grams) at 14 g per 1000 calories.
 * @param {number} totalCalories - daily calories.
 * @returns {number} grams of dietary fiber.
 */
export function calculateFiberGoal(totalCalories) {
  return (totalCalories / 1000) * 14;
}
