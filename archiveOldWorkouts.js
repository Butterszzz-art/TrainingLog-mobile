function archiveOldWorkouts(currentUser, now = Date.now()) {
  if (!currentUser) return;
  const workoutsKey = `workouts_${currentUser}`;
  const historyKey = `workoutHistory_${currentUser}`;

  const workouts = JSON.parse(localStorage.getItem(workoutsKey)) || [];
  const archivedWorkouts = JSON.parse(localStorage.getItem(historyKey)) || [];
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  const recent = [];
  workouts.forEach(w => {
    const wDate = new Date(w.date);
    const isOld = w.log && w.log.length > 0 && !isNaN(wDate) && (now - wDate.getTime() > sevenDays);
    if (isOld) {
      archivedWorkouts.push(w);
    } else {
      recent.push(w);
    }
  });

  if (recent.length !== workouts.length) {
    localStorage.setItem(workoutsKey, JSON.stringify(recent));
    localStorage.setItem(historyKey, JSON.stringify(archivedWorkouts));
  }
}

if (typeof module !== 'undefined') {
  module.exports = { archiveOldWorkouts };
}
if (typeof window !== 'undefined') {
  window.archiveOldWorkouts = archiveOldWorkouts;
}
