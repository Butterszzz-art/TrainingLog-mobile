import { stopWorkoutTimerAndSave } from './workoutTimer.js';

const STORAGE_KEYS = {
  workouts: 'tl_workout_history_v1'
};

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
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`${window.SERVER_URL}/workouts`, { credentials: 'include' });
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

  const { items, source } = await loadHistory();
  containerEl.innerHTML = '';

  if (!items.length) {
    containerEl.innerHTML = `
      <div class="empty">
        No workouts yet.
        <div class="hint">Log a workout and it will appear here (${source}).</div>
      </div>`;
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'history-list';

  items.forEach(workout => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const performedAt = workout.performedAt || workout.date;
    const timestamp = workout.createdAt || (performedAt ? new Date(performedAt).toISOString() : null);
    const dateLabel = timestamp ? new Date(timestamp).toLocaleString() : 'Unknown date';

    const sets = Array.isArray(workout.sets) && workout.sets.length
      ? workout.sets
      : Array.isArray(workout.log)
        ? workout.log.map(entry => ({
            exercise: entry.exercise,
            weight: Array.isArray(entry.weightsArray) ? entry.weightsArray.filter(v => v !== null && v !== undefined && v !== '').map(String).join('/') : '',
            reps: Array.isArray(entry.repsArray) ? entry.repsArray.filter(v => v !== null && v !== undefined && v !== '').map(String).join('/') : ''
          }))
        : [];

    const meta = sets
      .filter(set => set && set.exercise)
      .map(set => {
        const weight = set.weight ?? '';
        const reps = set.reps ?? '';
        const units = workout.units || '';
        const weightLabel = weight ? `${weight}${units}` : '';
        const repsLabel = reps ? ` × ${reps}` : '';
        const detail = weightLabel || repsLabel
          ? `${set.exercise}: ${weightLabel}${repsLabel}`.trim()
          : set.exercise;
        return detail;
      })
      .filter(Boolean)
      .join(' · ');

    li.innerHTML = `
      <div class="row">
        <strong>${workout.name || workout.title || 'Workout'}</strong>
        <span>${dateLabel}</span>
      </div>
      <div class="meta">${meta || 'No set data logged'}</div>
      ${workout.notes ? `<div class="notes">${workout.notes}</div>` : ''}
    `;

    ul.appendChild(li);
  });

  containerEl.appendChild(ul);
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
