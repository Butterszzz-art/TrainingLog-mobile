function loadWorkoutDates(user) {
  if (typeof localStorage === 'undefined') return [];
  return JSON.parse(localStorage.getItem(`workoutDates_${user}`)) || [];
}

function calculateStreak(dates) {
  const sorted = dates.slice().sort();
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = new Date(sorted[i]);
    const compare = new Date();
    compare.setDate(compare.getDate() - streak);
    if (d.toISOString().split('T')[0] === compare.toISOString().split('T')[0]) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function totalVolume(workouts, volumeCalc) {
  if (!Array.isArray(workouts)) return 0;
  return workouts.reduce((t, w) => t + volumeCalc(w), 0);
}

function checkMilestones(user, workouts, volumeCalc) {
  const dates = loadWorkoutDates(user);
  const streak = calculateStreak(dates);
  const volume = totalVolume(workouts, volumeCalc);
  const milestones = [];
  if (streak >= 30) milestones.push('🏅 30-day streak');
  if (volume >= 1000) milestones.push('💪 1,000 kg total volume');
  return milestones;
}

if (typeof module !== 'undefined') {
  module.exports = { calculateStreak, totalVolume, checkMilestones };
}
if (typeof window !== 'undefined') {
  window.calculateStreak = calculateStreak;
  window.totalVolume = totalVolume;
  window.checkMilestones = checkMilestones;
}
