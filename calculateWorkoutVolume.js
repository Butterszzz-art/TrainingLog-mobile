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

// Calculate volume per muscle group
// Requires exerciseMuscleMap.js to be loaded (see getMuscleGroup)
function calculateWorkoutVolumeByMuscle(workout) {
  const volumeByMuscle = {};
  if (!workout || !Array.isArray(workout.log)) {
    return volumeByMuscle;
  }
  workout.log.forEach(entry => {
    const reps = entry.repsArray || [];
    const weights = entry.weightsArray || [];
    const muscle = (typeof getMuscleGroup === 'function')
      ? getMuscleGroup(entry.exercise)
      : 'other';
    let vol = 0;
    for (let i = 0; i < reps.length; i++) {
      const rep = reps[i];
      const weight = weights[i] || 0;
      vol += rep * weight;
    }
    volumeByMuscle[muscle] = (volumeByMuscle[muscle] || 0) + vol;
  });
  return volumeByMuscle;
}

if (typeof module !== 'undefined') {
  module.exports = { calculateWorkoutVolume };
}
if (typeof window !== 'undefined') {
  window.calculateWorkoutVolume = calculateWorkoutVolume;
}

// Export muscle-group volume function if running in browser or Node
if (typeof module !== 'undefined') {
  module.exports.calculateWorkoutVolumeByMuscle = calculateWorkoutVolumeByMuscle;
}
if (typeof window !== 'undefined') {
  window.calculateWorkoutVolumeByMuscle = calculateWorkoutVolumeByMuscle;
}
