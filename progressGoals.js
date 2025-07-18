function loadGoals(user) {
  if (typeof localStorage === 'undefined') return {};
  return JSON.parse(localStorage.getItem(`goals_${user}`)) || {};
}

function saveGoals(user, goals) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(`goals_${user}`, JSON.stringify(goals));
}

function setGoal(user, type, target) {
  const goals = loadGoals(user);
  goals[type] = { target, progress: 0 };
  saveGoals(user, goals);
  return goals[type];
}

function updateGoalProgress(user, type, amount) {
  const goals = loadGoals(user);
  if (!goals[type]) return null;
  goals[type].progress = (goals[type].progress || 0) + amount;
  saveGoals(user, goals);
  return goals[type];
}

function checkMissedWorkouts(user, threshold, days) {
  const dates = JSON.parse(localStorage.getItem(`workoutDates_${user}`)) || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const recent = dates.filter(d => new Date(d) >= cutoff);
  return recent.length < threshold;
}

if (typeof module !== 'undefined') {
  module.exports = { loadGoals, saveGoals, setGoal, updateGoalProgress, checkMissedWorkouts };
}
if (typeof window !== 'undefined') {
  window.loadGoals = loadGoals;
  window.saveGoals = saveGoals;
  window.setGoal = setGoal;
  window.updateGoalProgress = updateGoalProgress;
  window.checkMissedWorkouts = checkMissedWorkouts;
}
