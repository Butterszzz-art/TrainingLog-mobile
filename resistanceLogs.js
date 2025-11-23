// Local-only storage helpers for resistance workouts.
// NOTE: localStorage is per-browser and is meant to be swapped with real API calls later.

/**
 * Persist a completed resistance workout to localStorage.
 * @param {{ date: string; exercises: Array<{ name: string; repsArray: number[]; weightsArray: number[] }> }} log
 */
export function saveLogToLocalStorage(log) {
  try {
    const existing = JSON.parse(localStorage.getItem('resistanceLogs') || '[]');
    existing.push(log);
    localStorage.setItem('resistanceLogs', JSON.stringify(existing));
  } catch (err) {
    console.warn('Unable to save resistance log locally', err);
  }
}

/**
 * Load all previously saved resistance workouts from localStorage.
 * @returns {Array<{ date: string; exercises: Array<{ name: string; repsArray: number[]; weightsArray: number[] }> }>}
 */
export function loadLogsFromLocalStorage() {
  try {
    const raw = localStorage.getItem('resistanceLogs');
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Unable to read resistance logs locally', err);
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
