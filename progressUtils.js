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

function formatDateStamp(value) {
  if (!value) return null;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp : null;
}

function getSessionDateStamp(workout, fallback = Date.now()) {
  const workoutDate = formatDateStamp(workout?.date);
  if (workoutDate) return workoutDate;
  const firstLogDate = Array.isArray(workout?.log)
    ? workout.log.map(entry => formatDateStamp(entry?.date)).find(Boolean)
    : null;
  return firstLogDate || fallback;
}

function notifyPR(message) {
  if (typeof window === 'undefined' || !message) return;
  if (typeof window.showToast === 'function') {
    window.showToast(message);
    return;
  }
  if (typeof window.alert === 'function') {
    window.alert(message);
  }
}

function updatePRs(user, workout, volumeCalc) {
  if (!workout || !Array.isArray(workout.log)) return null;
  const prs = loadPRs(user);
  let updated = false;
  const sessionDate = getSessionDateStamp(workout);
  const groupedByExercise = {};
  const allPREvents = [];

  workout.log.forEach(entry => {
    const name = entry?.exercise;
    if (!name) return;
    if (!groupedByExercise[name]) groupedByExercise[name] = [];
    groupedByExercise[name].push(entry);
  });

  Object.entries(groupedByExercise).forEach(([exercise, entries]) => {
    const existing = prs[exercise] || {
      heaviestSet: null,
      repPRsByWeight: {},
      highestVolumeSession: null,
      history: []
    };
    const repPRsByWeight = { ...(existing.repPRsByWeight || {}) };
    let heaviestSet = existing.heaviestSet || null;
    const exerciseVolume = volumeCalc ? volumeCalc({ log: entries }) : 0;
    const prEvents = [];

    entries.forEach(entry => {
      const repsArray = Array.isArray(entry?.repsArray) ? entry.repsArray : [];
      const weightsArray = Array.isArray(entry?.weightsArray) ? entry.weightsArray : [];
      const size = Math.max(repsArray.length, weightsArray.length);

      for (let i = 0; i < size; i++) {
        const reps = Number(repsArray[i]);
        const weight = Number(weightsArray[i]);
        if (!Number.isFinite(reps) || !Number.isFinite(weight) || reps <= 0 || weight <= 0) continue;

        if (!heaviestSet || weight > Number(heaviestSet.weight || 0)) {
          heaviestSet = { weight, reps, date: sessionDate };
          updated = true;
          prEvents.push(`${exercise}: New heaviest set ${weight} × ${reps}`);
        }

        const weightKey = String(weight);
        const existingAtWeight = repPRsByWeight[weightKey];
        if (!existingAtWeight || reps > Number(existingAtWeight.reps || 0)) {
          repPRsByWeight[weightKey] = { reps, date: sessionDate };
          updated = true;
          prEvents.push(`${exercise}: New rep PR ${weight} × ${reps}`);
        }
      }
    });

    let highestVolumeSession = existing.highestVolumeSession || null;
    if (!highestVolumeSession || exerciseVolume > Number(highestVolumeSession.volume || 0)) {
      highestVolumeSession = { volume: exerciseVolume, date: sessionDate };
      updated = true;
      prEvents.push(`${exercise}: New volume PR ${exerciseVolume.toFixed(1)}`);
    }

    const history = Array.isArray(existing.history) ? existing.history.slice(-29) : [];
    if (prEvents.length) {
      history.push({ date: sessionDate, events: prEvents });
      prEvents.forEach(notifyPR);
      allPREvents.push(...prEvents);
    }

    prs[exercise] = {
      heaviestSet,
      repPRsByWeight,
      highestVolumeSession,
      history
    };
  });

  if (updated) {
    savePRs(user, prs);
  }

  if (workout && typeof workout === 'object') {
    workout.prEvents = allPREvents.slice();
  }

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
