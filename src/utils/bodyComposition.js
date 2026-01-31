/**
 * Compute lean (fat-free) mass from total weight and body-fat percentage.
 * @param {number} weightKg - body weight in kilograms.
 * @param {number} bodyFatPercent - body fat percentage (0-100).
 * @returns {number} lean mass (kg).
 */
export function calculateLeanMass(weightKg, bodyFatPercent) {
  return weightKg * (1 - bodyFatPercent / 100);
}

/**
 * Fat-Free Mass Index (FFMI) = FFM (kg) / height (m)^2.
 * @param {number} leanMassKg - fat-free mass in kilograms.
 * @param {number} heightM - height in meters.
 * @returns {number} FFMI value.
 */
export function calculateFFMI(leanMassKg, heightM) {
  return leanMassKg / (heightM * heightM);
}

/**
 * Adjusted FFMI for height differences: FFMI + 6.3 * (1.8 - height).
 * @param {number} leanMassKg - fat-free mass in kilograms.
 * @param {number} heightM - height in meters.
 * @returns {number} Adjusted FFMI.
 */
export function calculateAdjustedFFMI(leanMassKg, heightM) {
  const ffmi = calculateFFMI(leanMassKg, heightM);
  return ffmi + 6.3 * (1.8 - heightM);
}

/**
 * Fat-Mass Index (FMI) = FM (kg) / height (m)^2.
 * @param {number} weightKg - total body weight in kilograms.
 * @param {number} bodyFatPercent - body fat percentage (0-100).
 * @param {number} heightM - height in meters.
 * @returns {number} FMI value.
 */
export function calculateFMI(weightKg, bodyFatPercent, heightM) {
  const fatMassKg = weightKg * (bodyFatPercent / 100);
  return fatMassKg / (heightM * heightM);
}

/**
 * Categorize FFMI by sex using typical ranges.
 * These categories are illustrative; adjust ranges as needed.
 * @param {number} ffmi - the calculated FFMI.
 * @param {'male' | 'female'} sex - sex of the user.
 * @returns {string} category label.
 */
export function ffmiCategory(ffmi, sex = 'male') {
  if (sex === 'male') {
    if (ffmi < 18) return 'Below Average';
    if (ffmi < 20) return 'Average';
    if (ffmi < 22) return 'Intermediate';
    if (ffmi < 24) return 'Advanced';
    return 'Very High';
  }

  if (ffmi < 15) return 'Below Average';
  if (ffmi < 17) return 'Average';
  if (ffmi < 19) return 'Intermediate';
  if (ffmi < 21) return 'Advanced';
  return 'Very High';
}
