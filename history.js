const STORAGE_KEYS = {
  workouts: 'tl_workout_history_v1'
};

export function saveWorkoutToLocal(workout) {
  const now = new Date().toISOString();
  const entry = {
    id: crypto.randomUUID(),
    createdAt: now,
    ...workout
  };

  const raw = localStorage.getItem(STORAGE_KEYS.workouts);
  const arr = raw ? JSON.parse(raw) : [];

  if (entry.id && typeof entry.id === 'string') {
    const idx = arr.findIndex(item => item.id === entry.id);
    if (idx !== -1) {
      arr.splice(idx, 1);
    }
  }

  arr.unshift(entry);
  localStorage.setItem(STORAGE_KEYS.workouts, JSON.stringify(arr));
  return entry;
}

export function loadLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.workouts)) || [];
  } catch {
    return [];
  }
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

    const seen = new Set(remoteItems.map(x => x.id));
    const merged = [...remoteItems, ...local.filter(x => !seen.has(x.id))];

    localStorage.setItem(STORAGE_KEYS.workouts, JSON.stringify(merged));
    return { items: merged, source: 'backend' };
  } catch (e) {
    return { items: local, source: 'local' };
  }
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
  renderWorkoutHistory
};

if (typeof window !== 'undefined') {
  window.historyApi = historyApi;
}

export default historyApi;
