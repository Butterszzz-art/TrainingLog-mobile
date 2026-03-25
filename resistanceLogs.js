// Prototype-only local storage for workout history. Replace with API-backed calls when the backend is ready.

const STORAGE_KEY = 'workoutHistory';

function getCurrentUserId() {
  if (typeof window !== 'undefined') {
    if (typeof window.getActiveUsername === 'function') {
      return window.getActiveUsername();
    }
    return window.currentUser || localStorage.getItem('username') || localStorage.getItem('Username') || null;
  }
  return null;
}

function normalizeExercise(exercise) {
  return {
    name: exercise && exercise.name ? exercise.name : 'Exercise',
    repsArray: Array.isArray(exercise?.repsArray) ? exercise.repsArray.map(n => Number(n) || 0) : [],
    weightsArray: Array.isArray(exercise?.weightsArray) ? exercise.weightsArray.map(n => Number(n) || 0) : [],
  };
}

function normalizeLog(log) {
  const date = log?.date || log?.performedAt || log?.createdAt || new Date().toISOString();
  const exercises = Array.isArray(log?.exercises) ? log.exercises.map(normalizeExercise) : [];
  const title = log?.title || log?.name || log?.workoutTitle || 'Resistance Workout';
  const userId = log?.userId || log?.username || log?.user || getCurrentUserId();
  const id = log?.id || null;
  const prEvents = Array.isArray(log?.prEvents) ? log.prEvents.map(item => String(item || '').trim()).filter(Boolean) : [];
  return { date, exercises, title, userId, id, prEvents };
}

function readExistingLogs() {
  try {
    // Read current logs from 'workoutHistory' or the fallback 'resistanceLogs'
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('resistanceLogs');
    const parsed = raw ? JSON.parse(raw) : [];
    const logs = Array.isArray(parsed) ? parsed.slice() : [];
    // Also read legacy logs stored by saveWorkoutToLocal under 'tl_workout_history_v1'
    const legacyRaw = localStorage.getItem('tl_workout_history_v1');
    if (legacyRaw) {
      try {
        const legacyParsed = JSON.parse(legacyRaw);
        if (Array.isArray(legacyParsed)) {
          legacyParsed.forEach(item => {
            // Convert sets into the normalized { date, exercises } format
            if (item && item.date && Array.isArray(item.sets)) {
              const exercises = item.sets.map(set => ({
                name: set?.exercise || set?.name || 'Exercise',
                repsArray: Array.isArray(set?.repsArray)
                  ? set.repsArray.map(n => Number(n) || 0)
                  : [Number(set?.reps ?? set?.repsArray?.[0] ?? 0) || 0],
                weightsArray: Array.isArray(set?.weightsArray)
                  ? set.weightsArray.map(n => Number(n) || 0)
                  : [Number(set?.weight ?? set?.weightsArray?.[0] ?? 0) || 0],
              }));
              logs.push({
                date: item.date,
                exercises,
                title: item?.name || item?.title || 'Resistance Workout',
                userId: item?.userId || item?.username || item?.user || getCurrentUserId(),
                id: item?.id || null
              });
            }
          });
        }
      } catch {
        // ignore parse errors in legacy data
      }
    }
    return logs;
  } catch (err) {
    console.warn('Unable to read existing workout history locally', err);
    return [];
  }
}

/**
 * Persist a completed resistance workout to localStorage.
 * @param {{ date: string; exercises: Array<{ name: string; repsArray: number[]; weightsArray: number[] }> }} log
 */
export function saveLogToLocalStorage(log) {
  try {
    const normalizedLog = normalizeLog(log);
    const existing = readExistingLogs();
    existing.push(normalizedLog);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    // Non-blocking gamification hook at final save point.
    // If gamification fails, workout logging must still succeed.
    if (typeof window !== 'undefined') {
      const activeUser = normalizedLog.userId || getCurrentUserId();
      if (activeUser) {
        try {
          if (typeof window.evaluateWorkoutAchievements === 'function') {
            window.evaluateWorkoutAchievements(activeUser, normalizedLog);
          }
          if (typeof window.evaluatePRAchievements === 'function' && Array.isArray(normalizedLog.prEvents) && normalizedLog.prEvents.length) {
            window.evaluatePRAchievements(activeUser, normalizedLog);
          }
        } catch (gamificationErr) {
          console.warn('Gamification workout evaluation failed; continuing normally.', gamificationErr);
        }
      }
    }
  } catch (err) {
    console.warn('Unable to save resistance log locally (prototype)', err);
  }
}

/**
 * Load all previously saved resistance workouts from localStorage.
 * @returns {Array<{ date: string; exercises: Array<{ name: string; repsArray: number[]; weightsArray: number[] }> }>}
 */
export function loadLogsFromLocalStorage() {
  try {
    return readExistingLogs().map(normalizeLog);
  } catch (err) {
    console.warn('Unable to read resistance logs locally (prototype)', err);
    return [];
  }
}

if (typeof window !== 'undefined') {
  window.saveResistanceLogToLocalStorage = saveLogToLocalStorage;
  window.loadResistanceLogsFromLocalStorage = loadLogsFromLocalStorage;
  // Provide direct bindings for convenience in non-module scripts.
  window.saveLogToLocalStorage = saveLogToLocalStorage;
  window.loadLogsFromLocalStorage = loadLogsFromLocalStorage;
}
