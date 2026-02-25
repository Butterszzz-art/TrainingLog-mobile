function normalizeExerciseName(entry) {
  return String(entry?.exercise || '').trim().toLowerCase();
}

function getLastEntry(exerciseName, workouts) {
  if (!Array.isArray(workouts)) return null;
  const targetName = String(exerciseName || '').trim().toLowerCase();
  if (!targetName) return null;

  for (let i = workouts.length - 1; i >= 0; i--) {
    const w = workouts[i];
    if (!w || !Array.isArray(w.log)) continue;
    const entry = w.log.find(e => normalizeExerciseName(e) === targetName);
    if (entry) return entry;
  }
  return null;
}

function getExerciseHistory(exerciseName, workouts) {
  if (!Array.isArray(workouts)) return [];
  const targetName = String(exerciseName || '').trim().toLowerCase();
  if (!targetName) return [];

  const history = [];
  workouts.forEach(workout => {
    if (!Array.isArray(workout?.log)) return;
    workout.log.forEach(entry => {
      if (normalizeExerciseName(entry) === targetName) {
        history.push(entry);
      }
    });
  });
  return history;
}

function getAverageRate(history) {
  const deltas = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    const prevWeights = Array.isArray(prev?.weightsArray) ? prev.weightsArray : [];
    const curWeights = Array.isArray(cur?.weightsArray) ? cur.weightsArray : [];
    const prevReps = Array.isArray(prev?.repsArray) ? prev.repsArray : [];
    const curReps = Array.isArray(cur?.repsArray) ? cur.repsArray : [];

    const weightPairs = Math.min(prevWeights.length, curWeights.length);
    const repPairs = Math.min(prevReps.length, curReps.length);

    const prevWeightAvg = weightPairs
      ? prevWeights.slice(0, weightPairs).reduce((sum, value) => sum + (Number(value) || 0), 0) / weightPairs
      : 0;
    const curWeightAvg = weightPairs
      ? curWeights.slice(0, weightPairs).reduce((sum, value) => sum + (Number(value) || 0), 0) / weightPairs
      : 0;

    const prevRepAvg = repPairs
      ? prevReps.slice(0, repPairs).reduce((sum, value) => sum + (Number(value) || 0), 0) / repPairs
      : 0;
    const curRepAvg = repPairs
      ? curReps.slice(0, repPairs).reduce((sum, value) => sum + (Number(value) || 0), 0) / repPairs
      : 0;

    deltas.push({
      weightDelta: curWeightAvg - prevWeightAvg,
      repDelta: curRepAvg - prevRepAvg
    });
  }

  if (!deltas.length) {
    return { weightDelta: 2.5, repDelta: 1 };
  }

  const avgWeightDelta = deltas.reduce((sum, delta) => sum + delta.weightDelta, 0) / deltas.length;
  const avgRepDelta = deltas.reduce((sum, delta) => sum + delta.repDelta, 0) / deltas.length;

  return {
    weightDelta: Number.isFinite(avgWeightDelta) ? avgWeightDelta : 0,
    repDelta: Number.isFinite(avgRepDelta) ? avgRepDelta : 0
  };
}

function getRpeStatus(entry) {
  const target = Number(entry?.targetRPE ?? entry?.targetRpe ?? entry?.rpeTarget ?? entry?.goalRPE);
  const rpeArray = Array.isArray(entry?.rpeArray) ? entry.rpeArray : [];
  const validRpe = rpeArray.map(Number).filter(Number.isFinite);

  const hasTarget = Number.isFinite(target);
  const allSetsAtOrBelow = hasTarget && validRpe.length > 0 && validRpe.every(value => value <= target);
  const anyHighRpe = hasTarget && validRpe.length > 0 && validRpe.some(value => value > target);

  const completed = Array.isArray(entry?.completedArray) ? entry.completedArray : [];
  const skipped = Array.isArray(entry?.skippedArray) ? entry.skippedArray : [];
  const explicitFailures = completed.length && completed.some(v => v === true) && completed.some(v => v === false);
  const hasSkippedSet = skipped.some(Boolean);

  return {
    allSetsAtOrBelow,
    anyHighRpe,
    failedSets: explicitFailures || hasSkippedSet
  };
}

function roundToIncrement(value, increment) {
  if (!increment) return value;
  return Number((Math.round(value / increment) * increment).toFixed(2));
}

function suggestNextSession(exercise, workouts = []) {
  const exerciseName = typeof exercise === 'string' ? exercise : exercise?.exercise;
  const targetName = String(exerciseName || '').trim();
  if (!targetName) return null;

  const history = getExerciseHistory(targetName, workouts);
  const lastEntry = (typeof exercise === 'object' && exercise)
    ? exercise
    : (history.length ? history[history.length - 1] : null);

  if (!lastEntry) return null;

  const unit = lastEntry.unit || 'kg';
  const lastWeights = Array.isArray(lastEntry.weightsArray) ? lastEntry.weightsArray.map(v => Number(v) || 0) : [];
  const lastReps = Array.isArray(lastEntry.repsArray) ? lastEntry.repsArray.map(v => Number(v) || 0) : [];

  if (!lastWeights.length && !lastReps.length) return null;

  const averageRate = getAverageRate(history);
  const rpeStatus = getRpeStatus(lastEntry);

  const suggestedSets = lastReps.map((rep, index) => ({
    reps: rep,
    weight: Number(lastWeights[index]) || 0
  }));

  let strategy = 'maintain';
  let message = 'Maintain current load and reps next session.';

  const hasRepGoal = Number.isFinite(Number(lastEntry.repGoal));
  const repGoal = Number(lastEntry.repGoal);
  const achievedRepGoal = hasRepGoal && suggestedSets.length
    ? suggestedSets.every(set => set.reps >= repGoal)
    : false;

  const baselineWeightStep = Math.max(1.25, Math.abs(averageRate.weightDelta) || 2.5);
  const baselineRepStep = Math.max(1, Math.round(Math.abs(averageRate.repDelta) || 1));

  if (rpeStatus.failedSets || rpeStatus.anyHighRpe) {
    strategy = 'reduce';
    const dropAmount = roundToIncrement(Math.max(1.25, baselineWeightStep * 0.5), 0.5);
    suggestedSets.forEach(set => {
      set.weight = Number(Math.max(0, (set.weight || 0) - dropAmount).toFixed(2));
    });
    message = `RPE/fatigue was high or sets were missed. Reduce load by ~${dropAmount} ${unit} or keep weight steady.`;
  } else if (rpeStatus.allSetsAtOrBelow) {
    strategy = 'increase';
    if (achievedRepGoal) {
      const increaseAmount = roundToIncrement(baselineWeightStep, 0.5);
      suggestedSets.forEach(set => {
        set.weight = Number((set.weight + increaseAmount).toFixed(2));
      });
      message = `All sets were at/under target RPE. Increase load by ~${increaseAmount} ${unit} (linear progression).`;
    } else {
      suggestedSets.forEach(set => {
        set.reps += baselineRepStep;
      });
      message = `All sets were at/under target RPE. Add ${baselineRepStep} rep(s) per set before increasing weight (double progression).`;
    }
  } else if (averageRate.weightDelta > 0.25) {
    strategy = 'increase';
    const increaseAmount = roundToIncrement(Math.max(1.25, averageRate.weightDelta), 0.5);
    suggestedSets.forEach(set => {
      set.weight = Number((set.weight + increaseAmount).toFixed(2));
    });
    message = `Trend suggests +${increaseAmount} ${unit} per session on average. Continue a linear increase.`;
  } else if (averageRate.repDelta > 0.25) {
    strategy = 'increase-reps';
    const repIncrease = Math.max(1, Math.round(averageRate.repDelta));
    suggestedSets.forEach(set => {
      set.reps += repIncrease;
    });
    message = `Trend suggests +${repIncrease} rep(s) per session. Continue double progression.`;
  }

  return {
    exercise: targetName,
    unit,
    strategy,
    averageRate,
    basedOnSessions: history.length,
    sets: suggestedSets,
    message
  };
}

function getProgressiveOverloadSuggestion(exerciseName, workouts) {
  const next = suggestNextSession(exerciseName, workouts);
  return next ? next.message : null;
}

if (typeof module !== 'undefined') {
  module.exports = { getProgressiveOverloadSuggestion, suggestNextSession };
}
if (typeof window !== 'undefined') {
  window.getProgressiveOverloadSuggestion = getProgressiveOverloadSuggestion;
  window.suggestNextSession = suggestNextSession;
}
