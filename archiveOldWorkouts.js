function toResistanceLog(workout, currentUser) {
  const dateIso = workout && workout.date
    ? new Date(workout.date).toISOString()
    : new Date().toISOString();

  const exercises = Array.isArray(workout && workout.log)
    ? workout.log.map(entry => ({
        name: (entry && entry.exercise) || (entry && entry.name) || 'Exercise',
        repsArray: Array.isArray(entry && entry.repsArray)
          ? entry.repsArray.map(n => Number(n) || 0)
          : (entry && entry.reps !== undefined ? [Number(entry.reps) || 0] : []),
        weightsArray: Array.isArray(entry && entry.weightsArray)
          ? entry.weightsArray.map(n => Number(n) || 0)
          : (entry && entry.weight !== undefined ? [Number(entry.weight) || 0] : []),
      }))
    : [];

  return {
    id: (workout && workout.id) || null,
    date: dateIso,
    title: (workout && (workout.title || workout.name)) || 'Resistance Workout',
    userId: (workout && (workout.userId || workout.username || workout.user)) || currentUser || null,
    exercises,
    prEvents: Array.isArray(workout && workout.prEvents) ? workout.prEvents.slice() : []
  };
}

function appendToHistoryStore(key, log) {
  let existing = [];
  try {
    const raw = localStorage.getItem(key);
    existing = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(existing)) existing = [];
  } catch (_err) {
    existing = [];
  }

  // Avoid duplicates when archive runs multiple times.
  const alreadyPresent = log.id && existing.some(item => item && item.id && item.id === log.id);
  if (!alreadyPresent) {
    existing.push(log);
    localStorage.setItem(key, JSON.stringify(existing));
  }
}

function appendToLegacyHistoryStore(key, workout, log) {
  let existing = [];
  try {
    const raw = localStorage.getItem(key);
    existing = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(existing)) existing = [];
  } catch (_err) {
    existing = [];
  }

  const entry = {
    id: (workout && workout.id) || log.id || `archived-${log.date}`,
    createdAt: log.date,
    date: log.date,
    title: log.title,
    name: log.title,
    userId: log.userId,
    username: log.userId,
    workout: {
      id: (workout && workout.id) || log.id || `archived-${log.date}`,
      date: log.date,
      title: log.title,
      name: log.title,
      userId: log.userId,
      exercises: log.exercises.map(ex => ({
        name: ex.name,
        sets: Array.from(
          { length: Math.max(ex.repsArray.length, ex.weightsArray.length) },
          (_unused, i) => ({
            reps: ex.repsArray[i] || 0,
            weight: ex.weightsArray[i] || 0
          })
        )
      })),
      sets: log.exercises.flatMap(ex =>
        Array.from(
          { length: Math.max(ex.repsArray.length, ex.weightsArray.length) },
          (_unused, i) => ({
            exercise: ex.name,
            reps: ex.repsArray[i] || 0,
            weight: ex.weightsArray[i] || 0
          })
        )
      )
    }
  };

  const alreadyPresent = existing.some(item =>
    item && entry.id && item.id === entry.id
  );
  if (!alreadyPresent) {
    existing.unshift(entry);
    localStorage.setItem(key, JSON.stringify(existing));
  }
}

function archiveOldWorkouts(currentUser, now = Date.now()) {
  if (!currentUser) return;
  const workoutsKey = `workouts_${currentUser}`;
  const historyKey = `workoutHistory_${currentUser}`;

  const workouts = JSON.parse(localStorage.getItem(workoutsKey)) || [];
  const archivedWorkouts = JSON.parse(localStorage.getItem(historyKey)) || [];
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  const recent = [];
  const newlyArchived = [];
  workouts.forEach(w => {
    const wDate = new Date(w.date);
    const isOld = w.log && w.log.length > 0 && !isNaN(wDate) && (now - wDate.getTime() > sevenDays);
    if (isOld) {
      archivedWorkouts.push(w);
      newlyArchived.push(w);
    } else {
      recent.push(w);
    }
  });

  if (recent.length !== workouts.length) {
    localStorage.setItem(workoutsKey, JSON.stringify(recent));
    localStorage.setItem(historyKey, JSON.stringify(archivedWorkouts));

    // BUGFIX: Also push expired workouts into the stores that the
    // Log History tab actually reads from. Without this, archived
    // workouts were orphaned under `workoutHistory_${user}` and
    // never appeared in the history view.
    newlyArchived.forEach(w => {
      const log = toResistanceLog(w, currentUser);

      // Used by resistanceLogs.js -> loadLogsFromLocalStorage()
      appendToHistoryStore('workoutHistory', log);

      // Used by history.js -> readHistoryArray() / renderWorkoutHistory()
      appendToLegacyHistoryStore('tl_workout_history_v1', w, log);
    });
  }
}

if (typeof module !== 'undefined') {
  module.exports = { archiveOldWorkouts };
}
if (typeof window !== 'undefined') {
  window.archiveOldWorkouts = archiveOldWorkouts;
}
