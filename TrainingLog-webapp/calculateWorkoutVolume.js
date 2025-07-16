function calculateWorkoutVolume(workout) {
  let total = 0;
  if (!workout || !Array.isArray(workout.log)) {
    return total;
  }
  workout.log.forEach(entry => {
    const reps = entry.repsArray || [];
    const weights = entry.weightsArray || [];
    for (let i = 0; i < reps.length; i++) {
      const rep = reps[i];
      const weight = weights[i] || 0;
      total += rep * weight;
    }
  });
  return total;
}

if (typeof module !== 'undefined') {
  module.exports = { calculateWorkoutVolume };
}
if (typeof window !== 'undefined') {
  window.calculateWorkoutVolume = calculateWorkoutVolume;
}
