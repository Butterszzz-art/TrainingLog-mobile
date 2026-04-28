(function (globalScope) {
  'use strict';

  const STORAGE_PREFIX = 'tl_daily_mission_v1_';
  const ALL_MISSION_KEYS = [
    'workoutComplete',
    'cardioComplete',
    'macrosComplete',
    'bodyweightLogged',
    'posingComplete',
    'recoveryLogged',
    'stepsComplete'
  ];

  const PHASE_MISSION_MAP = {
    contest_prep: ['workoutComplete', 'cardioComplete', 'macrosComplete', 'bodyweightLogged', 'posingComplete', 'recoveryLogged'],
    improvement: ['workoutComplete', 'macrosComplete', 'bodyweightLogged', 'recoveryLogged'],
    mini_cut: ['workoutComplete', 'cardioComplete', 'macrosComplete', 'bodyweightLogged', 'stepsComplete'],
    post_show: ['workoutComplete', 'recoveryLogged', 'bodyweightLogged', 'macrosComplete', 'stepsComplete']
  };

  function getStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_error) {
      // localStorage unavailable in some environments.
    }

    if (!globalScope.__dailyMissionMemoryStore) {
      globalScope.__dailyMissionMemoryStore = {
        _data: {},
        getItem(key) {
          return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
        },
        setItem(key, value) {
          this._data[key] = String(value);
        }
      };
    }

    return globalScope.__dailyMissionMemoryStore;
  }

  function resolveDate(date) {
    if (!date) return new Date().toISOString().slice(0, 10);
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
    return parsed.toISOString().slice(0, 10);
  }

  function resolveUserId(userId) {
    const fromArg = typeof userId === 'string' ? userId.trim() : '';
    if (fromArg) return fromArg;

    if (typeof globalScope !== 'undefined') {
      const current = globalScope.currentUser;
      if (typeof current === 'string' && current.trim()) return current.trim();
      if (current && typeof current.username === 'string' && current.username.trim()) return current.username.trim();
      const username = globalScope.localStorage?.getItem('username') || globalScope.localStorage?.getItem('Username');
      if (username && username.trim()) return username.trim();
    }

    return 'guest';
  }

  function getStorageKey(userId) {
    return `${STORAGE_PREFIX}${resolveUserId(userId)}`;
  }

  function parseStore(raw) {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function coerceBool(value) {
    return value === true;
  }

  function normalizeMissionState(date, state) {
    const source = state && typeof state === 'object' ? state : {};
    const requiredItems = Array.isArray(source.requiredItems)
      ? source.requiredItems
        .map((key) => (key === 'trainingComplete' ? 'workoutComplete' : key))
        .filter(key => ALL_MISSION_KEYS.includes(key))
      : [];
    const legacyWorkoutFlag = source.trainingComplete === true;
    const workoutComplete = coerceBool(source.workoutComplete) || legacyWorkoutFlag;

    return {
      date: resolveDate(date || source.date),
      workoutComplete,
      cardioComplete: coerceBool(source.cardioComplete),
      macrosComplete: coerceBool(source.macrosComplete),
      bodyweightLogged: coerceBool(source.bodyweightLogged),
      posingComplete: coerceBool(source.posingComplete),
      recoveryLogged: coerceBool(source.recoveryLogged),
      stepsComplete: coerceBool(source.stepsComplete),
      requiredItems
    };
  }

  function readUserStore(userId) {
    const storage = getStorage();
    return parseStore(storage.getItem(getStorageKey(userId)));
  }

  function writeUserStore(userId, payload) {
    const storage = getStorage();
    storage.setItem(getStorageKey(userId), JSON.stringify(payload));
  }

  function loadDailyMissionState(userId) {
    return readUserStore(userId);
  }

  function getDailyMissionState(userId, date) {
    const day = resolveDate(date);
    const store = readUserStore(userId);
    const existing = store[day];
    if (!existing) return null;
    return normalizeMissionState(day, existing);
  }

  function saveDailyMissionState(userId, dateOrState, maybeState) {
    if (typeof maybeState === 'undefined') {
      const incoming = dateOrState && typeof dateOrState === 'object' ? dateOrState : {};
      const normalizedStore = {};
      Object.keys(incoming).forEach((key) => {
        normalizedStore[resolveDate(key)] = normalizeMissionState(key, incoming[key]);
      });
      writeUserStore(userId, normalizedStore);
      syncDailyMissionStateToBackend(resolveUserId(userId), normalizedStore);
      return normalizedStore;
    }

    const day = resolveDate(dateOrState);
    const store = readUserStore(userId);
    const next = normalizeMissionState(day, maybeState);
    store[day] = next;
    writeUserStore(userId, store);
    syncDailyMissionStateToBackend(resolveUserId(userId), store);
    return next;
  }

  function syncDailyMissionStateToBackend(userId, state) {
    const resolvedUser = resolveUserId(userId);
    try {
      // Future backend endpoint: PUT /api/bodybuilding/daily-mission/:userId
      // Sync errors are intentionally ignored to keep the app fully usable offline.
      if (typeof globalScope.fetch !== 'function') return false;
      const _serverBase = (typeof window !== 'undefined' && window.SERVER_URL) || '';
      return globalScope.fetch(`${_serverBase}/api/bodybuilding/daily-mission/${encodeURIComponent(resolvedUser)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state || {})
      }).then(() => true).catch(() => false);
    } catch (_error) {
      return false;
    }
  }

  function normalizePhaseKey(phaseState) {
    const raw = [
      phaseState?.mode,
      phaseState?.currentPhase,
      phaseState?.phase,
      phaseState?.label
    ].find(value => typeof value === 'string' && value.trim());

    const normalized = String(raw || 'improvement')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');

    if (normalized.includes('contest')) return 'contest_prep';
    if (normalized.includes('mini')) return 'mini_cut';
    if (normalized.includes('post')) return 'post_show';
    if (normalized.includes('improvement') || normalized.includes('build')) return 'improvement';
    return PHASE_MISSION_MAP[normalized] ? normalized : 'improvement';
  }

  function generateDefaultMissionFromPhase(userId, phaseState, date) {
    const day = resolveDate(date);
    const phaseKey = normalizePhaseKey(phaseState);
    const requiredItems = PHASE_MISSION_MAP[phaseKey] || PHASE_MISSION_MAP.improvement;
    const defaultState = normalizeMissionState(day, {
      date: day,
      requiredItems
    });
    return saveDailyMissionState(userId, day, defaultState);
  }

  function markMissionItemComplete(userId, date, itemKey) {
    const normalizedKey = itemKey === 'trainingComplete' ? 'workoutComplete' : itemKey;
    if (!ALL_MISSION_KEYS.includes(normalizedKey)) return null;
    const day = resolveDate(date);
    const existing = getDailyMissionState(userId, day)
      || generateDefaultMissionFromPhase(userId, {}, day);
    existing[normalizedKey] = true;
    return saveDailyMissionState(userId, day, existing);
  }

  function inferRequiredItems(state) {
    if (Array.isArray(state?.requiredItems) && state.requiredItems.length) return state.requiredItems;
    return ['workoutComplete', 'cardioComplete', 'macrosComplete', 'bodyweightLogged', 'posingComplete', 'recoveryLogged'];
  }

  function getDateKey(value) {
    if (!value) return resolveDate();
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return resolveDate();
    return parsed.toISOString().slice(0, 10);
  }

  function updateMissionItem(userId, date, itemKey, isComplete) {
    const normalizedKey = itemKey === 'trainingComplete' ? 'workoutComplete' : itemKey;
    if (!ALL_MISSION_KEYS.includes(normalizedKey)) return null;
    const day = resolveDate(date);
    const existing = getDailyMissionState(userId, day)
      || generateDefaultMissionFromPhase(userId, {}, day);
    existing[normalizedKey] = Boolean(isComplete);
    return saveDailyMissionState(userId, day, existing);
  }

  function syncMissionFromWorkoutCompletion(workout, userId) {
    try {
      const resolvedUser = resolveUserId(userId || workout?.userId || workout?.username || workout?.user);
      const date = getDateKey(workout?.date || workout?.performedAt || workout?.createdAt);
      return updateMissionItem(resolvedUser, date, 'workoutComplete', true);
    } catch (_error) {
      return null;
    }
  }

  function syncMissionFromCardioEntry(entry, userId) {
    try {
      const resolvedUser = resolveUserId(userId || entry?.userId || entry?.username || entry?.user);
      const date = getDateKey(entry?.date || entry?.performedAt || entry?.createdAt);
      const duration = Number(entry?.duration || entry?.durationMinutes);
      const calories = Number(entry?.calories);
      const hasSignal = Boolean(String(entry?.type || '').trim()) || duration > 0 || calories > 0;
      return updateMissionItem(resolvedUser, date, 'cardioComplete', hasSignal);
    } catch (_error) {
      return null;
    }
  }

  function syncMissionFromBodyweightEntry(entry, userId) {
    try {
      const resolvedUser = resolveUserId(userId || entry?.userId || entry?.username || entry?.user);
      const date = getDateKey(entry?.date || entry?.recordedAt || entry?.createdAt);
      const weightValue = Number(entry?.weightKg ?? entry?.weight);
      return updateMissionItem(resolvedUser, date, 'bodyweightLogged', Number.isFinite(weightValue) && weightValue > 0);
    } catch (_error) {
      return null;
    }
  }

  function syncMissionFromMacroProgress(progress, userId) {
    try {
      const resolvedUser = resolveUserId(userId || progress?.userId || progress?.username || progress?.user);
      const date = getDateKey(progress?.date || progress?.recordedAt || progress?.createdAt);
      const targets = progress?.targets || {};
      const value = progress?.value || {};
      const targetCalories = Number(targets.calories);
      const targetProtein = Number(targets.protein);
      const targetCarbs = Number(targets.carbs);
      const targetFat = Number(targets.fat);
      const actualCalories = Number(value.calories);
      const actualProtein = Number(value.protein);
      const actualCarbs = Number(value.carbs);
      const actualFat = Number(value.fat);
      const minRatio = Number(progress?.minRatio) > 0 ? Number(progress.minRatio) : 0.9;
      const maxRatio = Number(progress?.maxRatio) > 0 ? Number(progress.maxRatio) : 1.1;

      const isWithin = (actual, target) => {
        if (!Number.isFinite(target) || target <= 0) return true;
        if (!Number.isFinite(actual) || actual < 0) return false;
        const ratio = actual / target;
        return ratio >= minRatio && ratio <= maxRatio;
      };

      const complete = isWithin(actualCalories, targetCalories)
        && isWithin(actualProtein, targetProtein)
        && isWithin(actualCarbs, targetCarbs)
        && isWithin(actualFat, targetFat);

      return updateMissionItem(resolvedUser, date, 'macrosComplete', complete);
    } catch (_error) {
      return null;
    }
  }

  function syncMissionFromRecoveryEntry(entry, userId) {
    try {
      const resolvedUser = resolveUserId(userId || entry?.userId || entry?.username || entry?.user);
      const date = getDateKey(entry?.date || entry?.recordedAt || entry?.createdAt);
      const sleepHours = Number(entry?.sleepHours || entry?.sleep);
      const hrv = Number(entry?.hrv);
      const hasSignal = (Number.isFinite(sleepHours) && sleepHours > 0) || (Number.isFinite(hrv) && hrv > 0);
      return updateMissionItem(resolvedUser, date, 'recoveryLogged', hasSignal);
    } catch (_error) {
      return null;
    }
  }

  function syncMissionFromPosingEntry(entry, userId) {
    try {
      const resolvedUser = resolveUserId(userId || entry?.userId || entry?.username || entry?.user);
      const date = getDateKey(entry?.date || entry?.recordedAt || entry?.createdAt);
      const complete = entry?.complete === false ? false : true;
      return updateMissionItem(resolvedUser, date, 'posingComplete', complete);
    } catch (_error) {
      return null;
    }
  }

  function calculateDailyCompliance(state) {
    const normalized = normalizeMissionState(state?.date, state);
    const requiredItems = inferRequiredItems(normalized);
    const completed = requiredItems.reduce((sum, itemKey) => sum + (normalized[itemKey] ? 1 : 0), 0);
    const total = requiredItems.length || 1;
    const percent = Math.round((completed / total) * 100);

    return {
      completed,
      total,
      percent,
      isComplete: completed === total,
      requiredItems
    };
  }

  const api = {
    loadDailyMissionState,
    getDailyMissionState,
    saveDailyMissionState,
    syncDailyMissionStateToBackend,
    generateDefaultMissionFromPhase,
    markMissionItemComplete,
    syncMissionFromWorkoutCompletion,
    syncMissionFromCardioEntry,
    syncMissionFromBodyweightEntry,
    syncMissionFromMacroProgress,
    syncMissionFromRecoveryEntry,
    syncMissionFromPosingEntry,
    calculateDailyCompliance,
    getStorageKey
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalScope !== 'undefined') {
    globalScope.dailyMissionEngine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
