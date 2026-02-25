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

function roundMacroTargets(targets) {
  const protein = Math.max(0, Math.round(Number(targets?.protein || 0)));
  const carbs = Math.max(0, Math.round(Number(targets?.carbs || 0)));
  const fat = Math.max(0, Math.round(Number(targets?.fat || 0)));
  return {
    protein,
    carbs,
    fat,
    calories: protein * 4 + carbs * 4 + fat * 9,
  };
}

function estimateWorkoutEnergyExpenditure(workout = {}) {
  const sets = Array.isArray(workout?.sets)
    ? workout.sets
    : Array.isArray(workout?.workout?.sets)
      ? workout.workout.sets
      : [];

  let totalVolume = 0;
  let totalIntensity = 0;
  let setCount = 0;

  sets.forEach(set => {
    const reps = Number(set?.reps) || 0;
    const load = Number(set?.weight) || 0;
    const rpe = Number(set?.rpe);
    const intensity = Number.isFinite(rpe) ? rpe / 10 : 0.7;
    totalVolume += reps * Math.max(load, 0);
    totalIntensity += intensity;
    setCount += 1;
  });

  const avgIntensity = setCount ? totalIntensity / setCount : 0;
  const hrAvg = Number(workout?.hrAvg || workout?.workout?.hrAvg || 0);
  const durationMin = Number(workout?.durationMin || workout?.workout?.durationMin || 0);
  const hrLoad = hrAvg > 0 && durationMin > 0 ? (hrAvg / 100) * durationMin * 2 : 0;

  const volumeKcal = totalVolume * 0.1;
  const intensityKcal = avgIntensity * setCount * 8;
  const estimatedCalories = Math.round(volumeKcal + intensityKcal + hrLoad);

  return {
    estimatedCalories,
    totalVolume,
    avgIntensity,
    setCount,
  };
}

function adjustTargetsByTrainingAndRecovery(baseTargets = {}, context = {}) {
  const base = roundMacroTargets(baseTargets);
  const energy = Number(context?.estimatedCalories || 0);
  const volume = Number(context?.totalVolume || 0);
  const isRestDay = Boolean(context?.isRestDay);
  const isLowVolume = volume > 0 && volume < 1500;
  const trainingFactor = Math.min(Math.max((energy + volume * 0.02) / 600, 0), 1.25);

  let carbsDelta = 0;
  let proteinDelta = 0;
  let fatDelta = 0;
  const reasons = [];

  if (!isRestDay && trainingFactor > 0.1) {
    carbsDelta += Math.round(20 + trainingFactor * 55);
    proteinDelta += Math.round(8 + trainingFactor * 20);
    reasons.push('Workout load increased carbs and protein.');
  } else {
    carbsDelta -= Math.round(Math.max(base.carbs * 0.15, 20));
    reasons.push('Rest/low-volume day reduced carbs.');
  }

  const sleepHours = Number(context?.sleepHours);
  const hrv = Number(context?.hrv);
  const poorSleep = Number.isFinite(sleepHours) && sleepHours > 0 && sleepHours < 6.5;
  const poorHrv = Number.isFinite(hrv) && hrv > 0 && hrv < 40;
  if (poorSleep || poorHrv) {
    fatDelta += Math.round(Math.max(base.fat * 0.12, 8));
    reasons.push('Recovery was poor (sleep/HRV), fat increased for hormonal support.');
  }

  if (isLowVolume && !isRestDay) {
    carbsDelta -= 15;
    reasons.push('Low training volume slightly reduced carbs.');
  }

  return {
    adjusted: roundMacroTargets({
      protein: base.protein + proteinDelta,
      carbs: base.carbs + carbsDelta,
      fat: base.fat + fatDelta,
    }),
    deltas: { protein: proteinDelta, carbs: carbsDelta, fat: fatDelta },
    reasons,
  };
}

function applyDailyMacroAdjustment({
  user,
  baseTargets,
  workout,
  recovery = {},
  date = new Date().toISOString().slice(0, 10),
  isRestDay = false,
} = {}) {
  const safeUser = user || '';
  if (!safeUser || !baseTargets) return null;
  const workoutLoad = estimateWorkoutEnergyExpenditure(workout || {});
  const computed = adjustTargetsByTrainingAndRecovery(baseTargets, {
    ...workoutLoad,
    ...recovery,
    isRestDay,
  });

  if (typeof window !== 'undefined' && window.localStorage) {
    const key = `macroAdjustments_${safeUser}`;
    const all = JSON.parse(localStorage.getItem(key) || '{}');
    all[date] = {
      date,
      workoutLoad,
      recovery,
      baseTargets: roundMacroTargets(baseTargets),
      adjustedTargets: computed.adjusted,
      deltas: computed.deltas,
      reasons: computed.reasons,
    };
    localStorage.setItem(key, JSON.stringify(all));
  }

  return {
    ...computed,
    workoutLoad,
    message: `Macros adjusted for ${date}: P ${computed.deltas.protein >= 0 ? '+' : ''}${computed.deltas.protein}g, C ${computed.deltas.carbs >= 0 ? '+' : ''}${computed.deltas.carbs}g, F ${computed.deltas.fat >= 0 ? '+' : ''}${computed.deltas.fat}g.`,
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
    estimateWorkoutEnergyExpenditure,
    adjustTargetsByTrainingAndRecovery,
    applyDailyMacroAdjustment,
  };
}
