/**
 * Calculate lean body mass (kg) given weight (kg) and body-fat percentage.
 * Katch uses this to compute BMR.
 */
function calculateLeanMass(weightKg, bodyFatPercent) {
  return weightKg * (1 - bodyFatPercent / 100);
}

/**
 * Katch–McArdle BMR formula: BMR = 370 + 21.6 * leanMass (kg).
 * Only valid when body-fat % is between 5–60%.
 */
function katchMcardleBMR(weightKg, bodyFatPercent) {
  const leanMass = calculateLeanMass(weightKg, bodyFatPercent);
  return 370 + 21.6 * leanMass;
}

/**
 * Mifflin–St. Jeor BMR formula.
 * @param {number} weightKg
 * @param {number} heightCm
 * @param {number} ageYears
 * @param {'male' | 'female'} sex
 */
function mifflinStJeorBMR(weightKg, heightCm, ageYears, sex = 'male') {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === 'male' ? base + 5 : base - 161;
}

/**
 * Calculate Total Daily Energy Expenditure (TDEE) given BMR and activity factor.
 * Activity factors can be 1.2 (sedentary), 1.375 (light), etc.
 */
function calculateTDEE(bmr, activityFactor) {
  return bmr * activityFactor;
}

/**
 * Adjust calories based on goal and rate.
 * @param {number} tdee
 * @param {'cut' | 'maintain' | 'bulk'} goal
 * @param {'slow' | 'moderate' | 'aggressive'} rate
 */
function calculateTargetCalories(tdee, goal, rate) {
  const cutRates = { slow: -0.10, moderate: -0.15, aggressive: -0.20 };
  const bulkRates = { slow: 0.05, moderate: 0.08, aggressive: 0.12 };
  if (goal === 'cut') {
    return tdee * (1 + (cutRates[rate] || cutRates.moderate));
  }
  if (goal === 'bulk') {
    return tdee * (1 + (bulkRates[rate] || bulkRates.moderate));
  }
  return tdee; // maintain
}

/**
 * Calculate macro targets (grams) based on weight, total calories, goal, and body-fat.
 * Uses NSCA defaults: protein 2.0 g/kg (cut), 1.8 g/kg (maintain/bulk);
 * fat ≥ 0.6 g/kg and 25–30 % of calories; carbs fill remainder.
 */
function calculateMacros(weightKg, totalCalories, goal) {
  // Protein
  const proteinPerKg = goal === 'cut' ? 2.0 : 1.8;
  const proteinGrams = proteinPerKg * weightKg;
  const proteinCals = proteinGrams * 4;

  // Fat
  const minFatGrams = weightKg * 0.6;
  const fatRatio = goal === 'cut' ? 0.25 : 0.30;
  const fatCals = totalCalories * fatRatio;
  const fatGrams = Math.max(minFatGrams, fatCals / 9);

  // Carbs
  const remainingCals = totalCalories - (proteinCals + fatGrams * 9);
  const carbGrams = Math.max(remainingCals / 4, 0);

  return {
    proteinGrams: Math.round(proteinGrams),
    fatGrams: Math.round(fatGrams),
    carbGrams: Math.round(carbGrams),
  };
}

/**
 * Master function to compute macro targets from user inputs.
 */
function computeMacroPlan({
  weightKg,
  heightCm,
  ageYears,
  bodyFatPercent,
  sex,
  activityFactor,
  goal,
  rate,
  formula = 'mifflin',
}) {
  // Determine BMR using selected formula
  let bmr;
  if (formula === 'katch' && bodyFatPercent != null) {
    bmr = katchMcardleBMR(weightKg, bodyFatPercent);
  } else {
    bmr = mifflinStJeorBMR(weightKg, heightCm, ageYears, sex);
  }
  const tdee = calculateTDEE(bmr, activityFactor);
  const targetCalories = calculateTargetCalories(tdee, goal, rate);
  const macros = calculateMacros(weightKg, targetCalories, goal);
  return {
    energy: { bmr, tdee, targetCalories },
    macros,
  };
}

if (typeof window !== 'undefined') {
  window.macroEngine = {
    calculateLeanMass,
    katchMcardleBMR,
    mifflinStJeorBMR,
    calculateTDEE,
    calculateTargetCalories,
    calculateMacros,
    computeMacroPlan,
  };
}
