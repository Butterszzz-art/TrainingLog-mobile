(function (globalScope) {
  'use strict';

  const STORAGE_PREFIX = 'tl_daily_mission_v1_';
  const ALL_MISSION_KEYS = [
    'trainingComplete',
    'cardioComplete',
    'macrosComplete',
    'bodyweightLogged',
    'posingComplete',
    'recoveryLogged',
    'stepsComplete'
  ];

  const PHASE_MISSION_MAP = {
    contest_prep: ['trainingComplete', 'cardioComplete', 'macrosComplete', 'bodyweightLogged', 'posingComplete', 'recoveryLogged'],
    improvement: ['trainingComplete', 'macrosComplete', 'bodyweightLogged', 'recoveryLogged'],
    mini_cut: ['trainingComplete', 'cardioComplete', 'macrosComplete', 'bodyweightLogged'],
    post_show: ['trainingComplete', 'recoveryLogged', 'bodyweightLogged', 'macrosComplete']
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
      ? source.requiredItems.filter(key => ALL_MISSION_KEYS.includes(key) && key !== 'stepsComplete')
      : [];

    return {
      date: resolveDate(date || source.date),
      trainingComplete: coerceBool(source.trainingComplete),
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

  function getDailyMissionState(userId, date) {
    const day = resolveDate(date);
    const store = readUserStore(userId);
    const existing = store[day];
    if (!existing) return null;
    return normalizeMissionState(day, existing);
  }

  function saveDailyMissionState(userId, date, state) {
    const day = resolveDate(date);
    const store = readUserStore(userId);
    const next = normalizeMissionState(day, state);
    store[day] = next;
    writeUserStore(userId, store);
    return next;
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
    if (!ALL_MISSION_KEYS.includes(itemKey)) return null;
    const day = resolveDate(date);
    const existing = getDailyMissionState(userId, day)
      || generateDefaultMissionFromPhase(userId, {}, day);
    existing[itemKey] = true;
    return saveDailyMissionState(userId, day, existing);
  }

  function inferRequiredItems(state) {
    if (Array.isArray(state?.requiredItems) && state.requiredItems.length) return state.requiredItems;
    return ['trainingComplete', 'cardioComplete', 'macrosComplete', 'bodyweightLogged', 'posingComplete', 'recoveryLogged'];
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
    getDailyMissionState,
    saveDailyMissionState,
    generateDefaultMissionFromPhase,
    markMissionItemComplete,
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
