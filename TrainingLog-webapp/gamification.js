function loadGamification(user) {
  if (typeof localStorage === 'undefined') return { streak: 0, badges: [], level: 0 };
  return JSON.parse(localStorage.getItem(`game_${user}`)) || { streak: 0, badges: [], level: 0 };
}

function saveGamification(user, data) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`game_${user}`, JSON.stringify(data));
}

function updateGamification(user, workouts, dates) {
  const streak = calculateStreak(dates || []);
  const volume = totalVolume(workouts, calculateWorkoutVolume);
  const level = Math.floor(volume / 10000);
  const badges = [];
  if (streak >= 7) badges.push('7-day streak');
  if (streak >= 30) badges.push('30-day streak');
  if (volume >= 10000) badges.push('10k volume');
  const data = { streak, badges, level };
  saveGamification(user, data);
  return data;
}

if (typeof module !== 'undefined') {
  module.exports = { loadGamification, saveGamification, updateGamification };
}
if (typeof window !== 'undefined') {
  window.loadGamification = loadGamification;
  window.saveGamification = saveGamification;
  window.updateGamification = updateGamification;
}
