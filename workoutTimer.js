const TIMER_KEY = 'tl_workout_timer_v1';
const DAYS_STORAGE_KEY = 'tl_days_v1';
const LAST_TIMING_KEY = 'tl_last_workout_timing';
let _interval = null;

export function startWorkoutTimer() {
  const active = _readTimer();
  if (active && typeof active.startTimeMs === 'number') {
    return active;
  }

  const startTimeMs = Date.now();
  _writeTimer({ startTimeMs });

  if (typeof document !== 'undefined') {
    attachWorkoutTimerUI();
  }

  return { startTimeMs };
}

export function getWorkoutElapsedMs() {
  const active = _readTimer();
  if (!active || typeof active.startTimeMs !== 'number') {
    return 0;
  }
  return Math.max(0, Date.now() - active.startTimeMs);
}

export async function stopWorkoutTimerAndSave(optionalMeta = {}) {
  const active = _readTimer();
  if (!active || typeof active.startTimeMs !== 'number') {
    return null;
  }

  const endTimeMs = Date.now();
  const startTimeISO = new Date(active.startTimeMs).toISOString();
  const endTimeISO = new Date(endTimeMs).toISOString();
  const durationMin = Math.max(0, Math.round((endTimeMs - active.startTimeMs) / 60000));

  _clearTimer();
  _stopInterval();

  if (typeof document !== 'undefined') {
    const el = document.getElementById('workoutElapsed');
    if (el) {
      el.textContent = _formatHHMMSS(0);
    }
  }

  if (typeof window !== 'undefined' && typeof window._tlWorkoutTimerCleanup === 'function') {
    try {
      window._tlWorkoutTimerCleanup();
    } catch (e) {
      console.warn('Failed to cleanup workout timer UI', e);
    }
  }

  const date = getLocalDateKey();
  const timing = { startTimeISO, endTimeISO, durationMin };
  const cleanedMeta = _cleanMeta(optionalMeta);
  const payload = {
    date,
    workout: { ...timing, ...cleanedMeta }
  };

  try {
    await upsertDayLocallyAndRemotely(payload);
  } catch (err) {
    console.warn('Failed to persist workout timing', err);
    _persistLastTiming({ date, workout: payload.workout });
  }

  return timing;
}

export function attachWorkoutTimerUI(elapsedElId = 'workoutElapsed') {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(elapsedElId);
  if (!el) return;

  const render = () => {
    el.textContent = _formatHHMMSS(getWorkoutElapsedMs());
  };

  render();
  _stopInterval();
  _interval = setInterval(render, 1000);

  if (typeof window !== 'undefined') {
    window._tlWorkoutTimerCleanup = () => {
      _stopInterval();
    };
  }
}

export function getLocalDateKey(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function upsertDayLocallyAndRemotely(partialDay) {
  if (!partialDay || !partialDay.date) {
    return null;
  }

  const days = _readDays();
  const existing = days[partialDay.date] || {};
  const incomingWorkout = _cleanMeta(partialDay.workout || {});
  const mergedWorkout = { ...(existing.workout || {}), ...incomingWorkout };
  const merged = { ...existing, ...partialDay, workout: mergedWorkout };

  days[partialDay.date] = merged;
  _writeDays(days);

  await _syncDayRemote(merged);

  return merged;
}

function _readTimer() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TIMER_KEY) : null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function _writeTimer(value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TIMER_KEY, JSON.stringify(value));
    }
  } catch (e) {
    console.warn('Failed to write workout timer state', e);
  }
}

function _clearTimer() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TIMER_KEY);
    }
  } catch (e) {
    console.warn('Failed to clear workout timer state', e);
  }
}

function _stopInterval() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

function _formatHHMMSS(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function _cleanMeta(meta = {}) {
  const cleaned = {};
  Object.keys(meta || {}).forEach((key) => {
    const value = meta[key];
    if (value !== undefined) {
      cleaned[key] = value;
    }
  });
  return cleaned;
}

function _readDays() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(DAYS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function _writeDays(days) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DAYS_STORAGE_KEY, JSON.stringify(days));
    }
  } catch (e) {
    console.warn('Failed to persist day data locally', e);
  }
}

async function _syncDayRemote(day) {
  if (typeof window === 'undefined' || !window.SERVER_URL || typeof fetch !== 'function') {
    return;
  }

  const action = {
    url: `${window.SERVER_URL}/days`,
    options: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(day)
    }
  };

  try {
    const res = await fetch(action.url, { ...action.options, credentials: 'include' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    if (typeof window.queueAction === 'function') {
      window.queueAction(action);
      return;
    }
    console.warn('Remote day sync failed', err);
  }
}

function _persistLastTiming(entry) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_TIMING_KEY, JSON.stringify(entry));
    }
  } catch {
    // ignore
  }
}

if (typeof window !== 'undefined') {
  window.startWorkoutTimer = startWorkoutTimer;
  window.getWorkoutElapsedMs = getWorkoutElapsedMs;
  window.stopWorkoutTimerAndSave = stopWorkoutTimerAndSave;
  window.attachWorkoutTimerUI = attachWorkoutTimerUI;
}
