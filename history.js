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

function getCurrentUserId() {
  if (typeof window === 'undefined') {
    return null;
  }

  const userId = typeof window.getActiveUsername === 'function'
    ? window.getActiveUsername()
    : (
      window.currentUser?.username ||
      window.currentUser?.userId ||
      window.currentUser ||
      localStorage.getItem('username') ||
      localStorage.getItem('Username') ||
      null
    );

  console.log('[History] Using username:', userId);
  return userId;
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

  return {
    date,
    exercises,
    title: workout?.name || workout?.title || 'Resistance Workout',
    userId: getCurrentUserId()
  };
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

export async function syncWorkoutToBackend(workout) {
  try {
    if (typeof window === 'undefined' || !window.SERVER_URL) {
      return false;
    }

    const username = workout?.userId
      || workout?.username
      || getCurrentUserId();

    const payload = {
      username,
      date: workout?.date || workout?.createdAt,
      title: workout?.title || workout?.name,
      workout
    };

    const res = await fetch(`${window.SERVER_URL}/workouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      console.warn('[History] Backend sync failed', data);
      return false;
    }

    console.log('[History] Synced workout to backend', data);
    return true;
  } catch (error) {
    console.warn('[History] Backend sync error', error);
    return false;
  }
}


async function fetchWorkoutHistoryResponse(username) {
  const encodedUsername = encodeURIComponent(username || '');
  const url = `${window.SERVER_URL}/workouts?username=${encodedUsername}`;

  let authHeaders = {};
  try {
    authHeaders = typeof getAuthHeaders === 'function' ? (getAuthHeaders() || {}) : {};
  } catch (e) {
    console.warn('[History] getAuthHeaders() threw:', e);
    authHeaders = {};
  }

  const hasAuth = !!authHeaders.Authorization;
  if (!hasAuth) {
    console.warn('[History] No Authorization header found.');
  }

  if (!username) {
    console.warn('[History] Username missing. Not calling backend.');
    throw new Error('Missing username (not logged in or username not stored)');
  }

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      ...authHeaders
    }
  });

  return { response, url, hasAuth };
}

function mapLegacyWorkoutHistoryItems(username, data) {
  const rawWorkouts = Array.isArray(data?.workouts) ? data.workouts : [];
  return rawWorkouts.map((workout, index) => ({
    id: workout?.id || `${username || 'no-user'}-${workout?.date || workout?.createdAt || index}`,
    username,
    date: workout?.date || workout?.createdAt,
    title: workout?.title || workout?.name,
    workout
  }));
}

async function fetchWorkoutHistoryFromBackend(username) {
  const { response, url, hasAuth } = await fetchWorkoutHistoryResponse(username);

  const raw = await response.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  console.log('[History] /workouts response', {
    url,
    status: response.status,
    ok: response.ok,
    hasAuth,
    bodyPreview: raw?.slice?.(0, 400)
  });

  if (typeof window !== 'undefined' && typeof window.isInvalidSignatureError === 'function' && window.isInvalidSignatureError(data || raw)) {
    if (typeof window.forceLogoutDueToInvalidToken === 'function') {
      window.forceLogoutDueToInvalidToken();
    }
    throw new Error('Invalid token signature. Please log in again.');
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Unauthorized (token missing/expired). Please log in again.');
    }
    if (response.status === 404) {
      throw new Error('Endpoint /workouts not found on backend (not deployed or wrong SERVER_URL).');
    }
    throw new Error(data?.error?.message || raw || 'Failed to load workouts');
  }

  if (!data?.success) {
    throw new Error(data?.error?.message || 'Failed to load workouts');
  }

  return data.items || [];
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
    id: generateLocalId(),
    userId: getCurrentUserId(),
    name: state?.name || 'Resistance Workout',
    title: state?.name || 'Resistance Workout',
    notes: state?.notes || '',
    units: state?.units || 'kg',
    date: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    sets,
    exercises: sets.map(set => ({
      name: set.exercise,
      sets: [{ weight: set.weight, reps: set.reps }]
    }))
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

  // Non-blocking backend sync so local completion UX is unaffected.
  syncWorkoutToBackend(workout).then(async synced => {
    if (!synced || !window.SERVER_URL) return;
    try {
      const { response } = await fetchWorkoutHistoryResponse(workout.userId || getCurrentUserId());
      if (!response.ok) return;
      const data = await response.json();
      const first = data?.items?.find(item => item?.workout?.id === workout.id || item?.id === workout.id);
      if (first) {
        await persistHistoryEntry(entry, first.workout || first);
      }
    } catch {
      // Ignore follow-up canonicalization failures.
    }
  });

  return entry;
}

export async function loadHistory() {
  const local = loadLocalHistory();

  if (typeof window === 'undefined' || !window.SERVER_URL) {
    return { items: local, source: 'local' };
  }

  try {
    const remoteItems = await fetchWorkoutHistoryFromBackend(getCurrentUserId());

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

let cachedWorkoutHistory = [];

function formatWorkoutDate(dateValue) {
  if (!dateValue) return 'Unknown date';
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? 'Unknown date' : parsed.toLocaleString();
}

function buildExerciseSummary(exercises) {
  if (!Array.isArray(exercises) || !exercises.length) return 'No exercises recorded.';
  const names = exercises.map(ex => ex?.name || 'Exercise').filter(Boolean);
  if (!names.length) return 'No exercises recorded.';
  const unique = Array.from(new Set(names));
  return unique.length > 4 ? `${unique.slice(0, 4).join(', ')} +${unique.length - 4} more` : unique.join(', ');
}

function normalizeHistoryItem(item) {
  const workout = item?.workout || item;
  const fromDetailedSets = (workout?.exercises || []).map(ex => ({
    name: ex?.name || 'Exercise',
    repsArray: Array.isArray(ex?.sets) ? ex.sets.map(set => Number(set?.reps ?? 0)) : [],
    weightsArray: Array.isArray(ex?.sets) ? ex.sets.map(set => Number(set?.weight ?? 0)) : []
  }));

  return {
    id: item?.id || workout?.id || generateLocalId(),
    title: item?.title || workout?.title || workout?.name || 'Workout',
    date: item?.date || workout?.date || workout?.createdAt,
    exercises: fromDetailedSets.length ? fromDetailedSets : mapToResistanceLog(workout).exercises,
    workout
  };
}

function renderHistoryList(containerEl) {
  containerEl.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'history-list';

  cachedWorkoutHistory.forEach((log, index) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      <div class="row">
        <strong>${log?.title || 'Workout'}</strong>
        <span>${formatWorkoutDate(log?.date)}</span>
      </div>
      <div class="meta">${buildExerciseSummary(log?.exercises)}</div>
      <button class="adv-btn primary history-open-btn" data-history-index="${index}">Open</button>
    `;
    list.appendChild(li);
  });

  containerEl.appendChild(list);
}

function renderHistoryDetail(containerEl, log) {
  const title = log?.title || 'Resistance Workout';
  const dateLabel = formatWorkoutDate(log?.date);
  const exercises = Array.isArray(log?.exercises) ? log.exercises : [];

  containerEl.innerHTML = `
    <button class="adv-btn history-back-btn" id="historyBackBtn">← Back</button>
    <h3 style="margin-top:12px;">${title}</h3>
    <div class="meta">${dateLabel}</div>
    <div class="history-detail-list">
      ${exercises.map(ex => {
        const reps = Array.isArray(ex?.repsArray) ? ex.repsArray : [];
        const weights = Array.isArray(ex?.weightsArray) ? ex.weightsArray : [];
        const length = Math.max(reps.length, weights.length);
        const sets = Array.from({ length }, (_, idx) => {
          const repValue = reps[idx] ?? 0;
          const weightValue = weights[idx] ?? 0;
          return `${weightValue} × ${repValue}`;
        });
        return `
          <div class="history-detail-card">
            <div class="history-detail-title">${ex?.name || 'Exercise'}</div>
            <div class="history-detail-sets">${sets.length ? sets.join('<br>') : 'No sets recorded.'}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export async function renderWorkoutHistory(containerEl = document.getElementById('logHistoryContainer')) {
  if (!containerEl) return;

  const username = getCurrentUserId();
  if (!username) return;

  containerEl.innerHTML = '<p style="opacity:.7;">Loading workout history…</p>';

  const currentUserId = username;
  let items = [];
  try {
    if (!window.SERVER_URL) {
      throw new Error('SERVER_URL not configured');
    }
    items = await fetchWorkoutHistoryFromBackend(currentUserId);
  } catch (error) {
    console.warn('[History] Falling back to local history:', error);
    items = loadLogsFromLocalStorage()
      .filter(log => !log?.userId || log.userId === currentUserId)
      .map(log => ({
        id: log.id || generateLocalId(),
        username: log.userId,
        date: log.date,
        title: log.title,
        workout: log
      }));
  }

  cachedWorkoutHistory = items.map(normalizeHistoryItem)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  if (!cachedWorkoutHistory.length) {
    containerEl.innerHTML = '<p style="opacity:.7;">No workouts saved yet.</p>';
    return;
  }

  renderHistoryList(containerEl);

  containerEl.onclick = event => {
    const openButton = event.target.closest('[data-history-index]');
    if (openButton) {
      const index = Number(openButton.dataset.historyIndex);
      const log = cachedWorkoutHistory[index];
      if (log) {
        renderHistoryDetail(containerEl, log);
      }
      return;
    }

    if (event.target.id === 'historyBackBtn') {
      renderHistoryList(containerEl);
    }
  };
}

const historyApi = {
  saveWorkoutToLocal,
  loadLocalHistory,
  loadHistory,
  loadWorkoutHistory,
  finalizeResistanceWorkout,
  syncWorkoutToBackend,
  renderWorkoutHistory
};

if (typeof window !== 'undefined') {
  window.historyApi = historyApi;
}

export default historyApi;
