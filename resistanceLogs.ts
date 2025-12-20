// Prototype-only local workout history. Replace with real API-backed persistence once available.

export interface WorkoutExercise {
  name: string;
  repsArray: number[];
  weightsArray: number[];
}

export interface WorkoutLog {
  date: string; // ISO string
  exercises: WorkoutExercise[];
}

const STORAGE_KEY = 'workoutHistory';

function normalizeExercise(exercise: any): WorkoutExercise {
  return {
    name: typeof exercise?.name === 'string' && exercise.name.trim() ? exercise.name : 'Exercise',
    repsArray: Array.isArray(exercise?.repsArray) ? exercise.repsArray.map(n => Number(n) || 0) : [],
    weightsArray: Array.isArray(exercise?.weightsArray) ? exercise.weightsArray.map(n => Number(n) || 0) : [],
  };
}

function normalizeLog(log: WorkoutLog): WorkoutLog {
  const date = log?.date || new Date().toISOString();
  const exercises = Array.isArray(log?.exercises) ? log.exercises.map(normalizeExercise) : [];
  return { date, exercises };
}

export function saveLogToLocalStorage(log: WorkoutLog): void {
  try {
    const existing = loadLogsFromLocalStorage();
    existing.push(normalizeLog(log));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch (err) {
    console.warn('Unable to save workout log locally (prototype storage only)', err);
  }
}

export function loadLogsFromLocalStorage(): WorkoutLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('resistanceLogs');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((entry: any) => {
      const date = typeof entry?.date === 'string'
        ? entry.date
        : typeof entry?.performedAt === 'string'
          ? entry.performedAt
          : typeof entry?.createdAt === 'string'
            ? entry.createdAt
            : new Date().toISOString();

      return normalizeLog({ date, exercises: entry?.exercises || [] });
    });
  } catch (err) {
    console.warn('Unable to read workout logs locally (prototype storage only)', err);
    return [];
  }
}

declare global {
  interface Window {
    saveLogToLocalStorage?: typeof saveLogToLocalStorage;
    loadLogsFromLocalStorage?: typeof loadLogsFromLocalStorage;
  }
}

if (typeof window !== 'undefined') {
  window.saveLogToLocalStorage = saveLogToLocalStorage;
  window.loadLogsFromLocalStorage = loadLogsFromLocalStorage;
}
