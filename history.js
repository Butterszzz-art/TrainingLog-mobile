import { stopWorkoutTimerAndSave } from './workoutTimer.js';
import { loadLogsFromLocalStorage, saveLogToLocalStorage } from './resistanceLogs.js';

const STORAGE_KEYS = {
  workouts: 'tl_workout_history_v1'
};

function getAuthHeaders() {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function generateLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readHistoryArray() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.workouts);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeHistoryArray(items) {
  localStorage.setItem(STORAGE_KEYS.workouts, JSON.stringify(items));
}

function normaliseWorkoutForStorage(workout) {
  const now = new Date().toISOString();
  const fallbackId = generateLocalId();

  const entry = {
    id: workout?.id ?? fallbackId,
    createdAt: workout?.createdAt ?? now,
    ...workout
  };

  return entry;
}

export function saveWorkoutToLocal(workout) {
  const entry = normaliseWorkoutForStorage(workout);

  const arr = readHistoryArray();

  if (entry.id && typeof entry.id === 'string') {
    const idx = arr.findIndex(item => item.id === entry.id);
    if (idx !== -1) {
      arr.splice(idx, 1);
    }
  }

  arr.unshift(entry);
  writeHistoryArray(arr);
  return entry;
}

function mapToResistanceLog(workout) {
  const date = workout?.performedAt || workout?.date || workout?.createdAt || new Date().toISOString();
  const exercises = Array.isArray(workout?.sets)
    ? workout.sets.map(set => ({
        name: set?.exercise || set?.name || 'Exercise',
        repsArray: Array.isArray(set?.repsArray)
          ? set.repsArray.map(n => Number(n) || 0)
          : [Number(set?.reps ?? set?.repsArray?.[0] ?? 0) || 0],
        weightsArray: Array.isArray(set?.weightsArray)
          ? set.weightsArray.map(n => Number(n) || 0)
          : [Number(set?.weight ?? set?.weightsArray?.[0] ?? 0) || 0],
      }))
    : [];

  return { date, exercises };
}

export function loadLocalHistory() {
  return readHistoryArray();
}

function mergeRemoteAndLocal(remoteItems, localItems) {
  const seen = new Set(remoteItems.map(x => (x && (x.id || x.createdAt)) || null).filter(Boolean));
  const merged = [
    ...remoteItems,
    ...localItems.filter(x => {
      const key = x && (x.id || x.createdAt);
      return key ? !seen.has(key) : true;
    })
  ];

  return merged;
}

async function persistHistoryEntry(entry, saved) {
  if (!saved) return entry;

  const canonicalId = saved.id || saved.recordId || entry.id;
  const canonical = {
    ...entry,
    ...saved,
    id: canonicalId
  };

  const arr = readHistoryArray();
  const idx = arr.findIndex(item =>
    (item.id && canonicalId && item.id === canonicalId) ||
    (item.createdAt && canonical.createdAt && item.createdAt === canonical.createdAt)
  );

  if (idx !== -1) {
    arr[idx] = canonical;
  } else {
    arr.unshift(canonical);
  }

  writeHistoryArray(arr);
  return canonical;
}

export async function finalizeResistanceWorkout(state) {
  const sets = Array.isArray(state?.sets)
    ? state.sets.map(s => ({
        exercise: s?.exercise,
        weight: s?.weight,
        reps: s?.reps
      }))
    : [];

  const workout = {
    name: state?.name || 'Resistance Workout',
    notes: state?.notes || '',
    units: state?.units || 'kg',
    createdAt: new Date().toISOString(),
    sets
  };

  // Persist the completed workout locally for prototyping.
  saveLogToLocalStorage(mapToResistanceLog(workout));

  try {
    await stopWorkoutTimerAndSave({
      name: workout.name,
      notes: workout.notes,
      units: workout.units
    });
  } catch (err) {
    console.warn('Failed to stop workout timer during finalize', err);
  }

  const entry = saveWorkoutToLocal(workout);

  const url = typeof window !== 'undefined' ? window.SERVER_URL : undefined;
  if (!url) return entry;

  try {
    const res = await fetch(`${url}/workouts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      credentials: 'include',
      body: JSON.stringify(workout)
    });

    if (res.ok) {
      const saved = await res.json();
      return await persistHistoryEntry(entry, saved);
    }
  } catch {
    // Ignore network errors – the local copy is already stored.
  }

  return entry;
}

export async function loadHistory() {
  const local = loadLocalHistory();

  if (!window.SERVER_URL) {
    return { items: local, source: 'local' };
  }

  try {
    const res = await fetch(`${window.SERVER_URL}/workouts`, {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remoteItems = await res.json();

    const merged = mergeRemoteAndLocal(remoteItems, local);

    writeHistoryArray(merged);
    return { items: merged, source: 'backend' };
  } catch (e) {
    return { items: local, source: 'local' };
  }
}

export async function loadWorkoutHistory() {
  const { items } = await loadHistory();
  return items;
}

export async function renderWorkoutHistory(containerEl = document.getElementById('logHistoryContainer')) {
  if (!containerEl) return;

  const logs = loadLogsFromLocalStorage().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  containerEl.innerHTML = '';

  if (!logs.length) {
    containerEl.innerHTML = `
      <div class="empty">
        No workouts yet.
        <div class="hint">Log a workout and it will appear here (local only).</div>
      </div>`;
    return;
  }

  const list = document.createElement('ul');
  list.className = 'history-list';

  logs.forEach(log => {
    const li = document.createElement('li');
    li.className = 'history-item';
    const dateLabel = new Date(log.date).toLocaleString();

    const exerciseDetails = (Array.isArray(log.exercises) ? log.exercises : []).map(ex => {
      const reps = Array.isArray(ex.repsArray) ? ex.repsArray : [];
      const weights = Array.isArray(ex.weightsArray) ? ex.weightsArray : [];
      const volume = reps.reduce((total, rep, idx) => total + (Number(rep) || 0) * (Number(weights[idx]) || 0), 0);
      const desc = `${ex.name}: ${reps.join('/')}` + ` reps @ ${weights.join('/')}` + ` (${volume} volume)`;
      return `<div class="meta">${desc}</div>`;
    }).join('');

    li.innerHTML = `
      <div class="row">
        <strong>${new Date(log.date).toDateString()}</strong>
        <span>${dateLabel}</span>
      </div>
      ${exerciseDetails || '<div class="meta">No exercise data</div>'}
    `;

    li.addEventListener('click', () => {
      if (typeof window.showWorkoutProgress === 'function') {
        const workoutPayload = {
          date: log.date.split('T')[0] || new Date(log.date).toISOString().split('T')[0],
          log: (log.exercises || []).map(ex => ({
            exercise: ex.name,
            repsArray: Array.isArray(ex.repsArray) ? ex.repsArray : [],
            weightsArray: Array.isArray(ex.weightsArray) ? ex.weightsArray : [],
          })),
        };
        window.showWorkoutProgress({ workouts: [workoutPayload] });
      }
    });

    list.appendChild(li);
  });

  containerEl.appendChild(list);
}

const historyApi = {
  saveWorkoutToLocal,
  loadLocalHistory,
  loadHistory,
  loadWorkoutHistory,
  finalizeResistanceWorkout,
  renderWorkoutHistory
};

if (typeof window !== 'undefined') {
  window.historyApi = historyApi;
}

export default historyApi;
