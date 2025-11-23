export interface ResistanceLog {
  date: string; // ISO string
  exercises: Array<{ name: string; repsArray: number[]; weightsArray: number[] }>;
}

// Runtime implementations live in resistanceLogs.js – this file provides types for TypeScript usage.
// localStorage is per-browser and will be replaced by real API calls later on.

export { saveLogToLocalStorage, loadLogsFromLocalStorage } from './resistanceLogs.js';
