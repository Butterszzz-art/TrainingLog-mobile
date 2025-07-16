function getLastEntry(exerciseName, workouts) {
  if (!Array.isArray(workouts)) return null;
  for (let i = workouts.length - 1; i >= 0; i--) {
    const w = workouts[i];
    if (!w || !Array.isArray(w.log)) continue;
    const entry = w.log.find(e => e.exercise === exerciseName);
    if (entry) return entry;
  }
  return null;
}

function getProgressiveOverloadSuggestion(exerciseName, workouts) {
  const last = getLastEntry(exerciseName, workouts);
  if (!last) return null;

  const unit = last.unit || 'kg';
  const weights = last.weightsArray || [];
  const reps = last.repsArray || [];
  const goal = typeof last.goal === 'number' ? last.goal : null;
  const repGoal = typeof last.repGoal === 'number' ? last.repGoal : null;

  let metWeight = true;
  if (goal !== null) {
    metWeight = weights.every(w => w >= goal);
  }

  let metReps = true;
  if (repGoal !== null) {
    metReps = reps.every(r => r >= repGoal);
  }

  if (metWeight && metReps) {
    return `Add around 2.5 ${unit} or 1-2 reps`;
  } else if (metWeight) {
    return 'Add 1-2 reps';
  } else if (metReps) {
    return `Add around 2.5 ${unit}`;
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { getProgressiveOverloadSuggestion };
}
if (typeof window !== 'undefined') {
  window.getProgressiveOverloadSuggestion = getProgressiveOverloadSuggestion;
}
