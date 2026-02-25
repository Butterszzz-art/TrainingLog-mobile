function computeOneRepMax(weightsArray, repsArray) {
  if (!Array.isArray(weightsArray) || !Array.isArray(repsArray)) return 0;
  let best = 0;
  for (let i = 0; i < weightsArray.length; i++) {
    const w = +weightsArray[i];
    const r = +repsArray[i];
    if (!w || !r) continue;
    const est = w * (1 + r / 30);
    if (est > best) best = est;
  }
  return best;
}

function calculate1RM(reps, weight, method = 'epley') {
  const r = Number(reps);
  const w = Number(weight);
  if (!Number.isFinite(r) || !Number.isFinite(w) || r <= 0 || w <= 0) return 0;

  if (method === 'brzycki') {
    const denominator = 37 - r;
    if (denominator <= 0) return 0;
    return w * (36 / denominator);
  }

  return w * (1 + r / 30);
}

function calculateWorkoutMetrics(workout, method = 'epley') {
  const log = Array.isArray(workout?.log) ? workout.log : [];
  let sessionVolume = 0;
  let weightedIntensityTotal = 0;
  let totalValidSets = 0;
  let estimated1RM = 0;

  log.forEach(entry => {
    const repsArray = Array.isArray(entry?.repsArray) ? entry.repsArray : [];
    const weightsArray = Array.isArray(entry?.weightsArray) ? entry.weightsArray : [];
    const rpeArray = Array.isArray(entry?.rpeArray) ? entry.rpeArray : [];

    for (let i = 0; i < Math.max(repsArray.length, weightsArray.length); i++) {
      const reps = Number(repsArray[i]);
      const weight = Number(weightsArray[i]);
      if (!Number.isFinite(reps) || !Number.isFinite(weight) || reps <= 0 || weight <= 0) continue;

      const volume = reps * weight;
      sessionVolume += volume;

      const hasRpe = Number.isFinite(Number(rpeArray[i]));
      const set1RM = calculate1RM(reps, weight, hasRpe ? 'epley' : method);
      if (set1RM > estimated1RM) estimated1RM = set1RM;

      if (set1RM > 0) {
        weightedIntensityTotal += (weight / set1RM) * 100;
        totalValidSets += 1;
      }
    }
  });

  const averageIntensity = totalValidSets > 0 ? weightedIntensityTotal / totalValidSets : 0;
  return {
    sessionVolume,
    averageIntensity,
    estimated1RM
  };
}

function loadPRs(user) {
  if (typeof localStorage === 'undefined') return {};
  return JSON.parse(localStorage.getItem(`prs_${user}`)) || {};
}

function savePRs(user, prs) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`prs_${user}`, JSON.stringify(prs));
}

function updatePRs(user, workout, volumeCalc) {
  if (!workout || !Array.isArray(workout.log)) return null;
  const prs = loadPRs(user);
  let updated = false;
  workout.log.forEach(e => {
    const vol = volumeCalc ? volumeCalc({ log: [e] }) : 0;
    const orm = computeOneRepMax(e.weightsArray, e.repsArray);
    const pr = prs[e.exercise] || { oneRM: 0, volume: 0, history: [] };
    if (orm > pr.oneRM) {
      pr.oneRM = orm;
      updated = true;
    }
    if (vol > pr.volume) {
      pr.volume = vol;
      updated = true;
    }
    pr.history.push({ date: Date.now(), oneRM: orm });
    if (pr.history.length > 10) pr.history.shift();
    prs[e.exercise] = pr;
  });
  if (updated) savePRs(user, prs);
  return updated ? prs : null;
}

function calculateMonotony(dailyLoads) {
  if (!Array.isArray(dailyLoads) || dailyLoads.length === 0) return 0;
  const loads = dailyLoads
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v >= 0);
  if (!loads.length) return 0;
  const mean = loads.reduce((sum, value) => sum + value, 0) / loads.length;
  const variance = loads.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / loads.length;
  const standardDeviation = Math.sqrt(variance);
  if (!standardDeviation) return 0;
  return mean / standardDeviation;
}

function calculateStrain(weeklyMonotony, weeklyLoad) {
  const monotony = Number(weeklyMonotony);
  const load = Number(weeklyLoad);
  if (!Number.isFinite(monotony) || !Number.isFinite(load)) return 0;
  return monotony * load;
}

if (typeof module !== 'undefined') {
  module.exports = {
    computeOneRepMax,
    calculate1RM,
    calculateWorkoutMetrics,
    loadPRs,
    savePRs,
    updatePRs,
    calculateMonotony,
    calculateStrain
  };
}
if (typeof window !== 'undefined') {
  window.computeOneRepMax = computeOneRepMax;
  window.calculate1RM = calculate1RM;
  window.calculateWorkoutMetrics = calculateWorkoutMetrics;
  window.loadPRs = loadPRs;
  window.savePRs = savePRs;
  window.updatePRs = updatePRs;
  window.calculateMonotony = calculateMonotony;
  window.calculateStrain = calculateStrain;
}

export {
  computeOneRepMax,
  calculate1RM,
  calculateWorkoutMetrics,
  loadPRs,
  savePRs,
  updatePRs,
  calculateMonotony,
  calculateStrain
};
