(function (globalScope) {
  'use strict';

  const STORAGE_PREFIX = 'tl_posing_log_v1_';
  const TARGET_PREFIX = 'tl_posing_target_v1_';
  const DEFAULT_TARGET_SESSIONS = 5;
  const DEFAULT_TARGET_MINUTES = 100;

  function getStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_error) {
      // localStorage may be blocked.
    }

    if (!globalScope.__posingMemoryStore) {
      globalScope.__posingMemoryStore = {
        _data: {},
        getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
        setItem(key, value) { this._data[key] = String(value); }
      };
    }
    return globalScope.__posingMemoryStore;
  }

  function resolveUserId(userId) {
    const fromArg = typeof userId === 'string' ? userId.trim() : '';
    if (fromArg) return fromArg;
    const fallback = globalScope.currentUser
      || globalScope.localStorage?.getItem('fitnessAppUser')
      || globalScope.localStorage?.getItem('currentUser')
      || globalScope.localStorage?.getItem('username');
    return typeof fallback === 'string' && fallback.trim() ? fallback.trim() : 'guest';
  }

  function resolveDate(value) {
    if (!value) return new Date().toISOString().slice(0, 10);
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
    return parsed.toISOString().slice(0, 10);
  }

  function parseStore(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function toDateObj(dateKey) {
    const [y, m, d] = String(dateKey).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function toDateKey(dateObj) {
    return dateObj.toISOString().slice(0, 10);
  }

  function addDays(dateObj, days) {
    return new Date(dateObj.getTime() + (days * 86400000));
  }

  function getStorageKey(userId) {
    return `${STORAGE_PREFIX}${resolveUserId(userId)}`;
  }

  function getTargetKey(userId) {
    return `${TARGET_PREFIX}${resolveUserId(userId)}`;
  }

  function loadSessions(userId) {
    const storage = getStorage();
    return parseStore(storage.getItem(getStorageKey(userId)));
  }

  function saveSessions(userId, sessions) {
    const safe = Array.isArray(sessions) ? sessions : [];
    const storage = getStorage();
    storage.setItem(getStorageKey(userId), JSON.stringify(safe));
    return safe;
  }

  function parseTargetFromFrequency(text) {
    const match = String(text || '').match(/(\d+)/);
    const sessions = match ? Math.max(1, Number(match[1])) : DEFAULT_TARGET_SESSIONS;
    return {
      sessions,
      minutes: sessions * 20
    };
  }

  function getWeeklyTarget(userId, options = {}) {
    const storage = getStorage();
    const raw = storage.getItem(getTargetKey(userId));
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const sessions = Math.max(1, Number(parsed?.sessions) || DEFAULT_TARGET_SESSIONS);
        const minutes = Math.max(10, Number(parsed?.minutes) || (sessions * 20));
        return { sessions, minutes };
      } catch (_error) {
        // ignore parse failure
      }
    }

    const frequency = options.posingFrequency
      || globalScope.prepModeApi?.getCurrentPhaseState?.(resolveUserId(userId))?.posingFrequency
      || '';
    return parseTargetFromFrequency(frequency);
  }

  function setWeeklyTarget(userId, target) {
    const sessions = Math.max(1, Number(target?.sessions) || DEFAULT_TARGET_SESSIONS);
    const minutes = Math.max(10, Number(target?.minutes) || (sessions * 20));
    const normalized = { sessions, minutes };
    getStorage().setItem(getTargetKey(userId), JSON.stringify(normalized));
    return normalized;
  }

  function normalizeSession(entry = {}) {
    const date = resolveDate(entry.date || entry.recordedAt || entry.createdAt);
    const minutes = Math.max(1, Math.round(Number(entry.minutes || entry.durationMinutes || 0)));
    return {
      id: entry.id || `posing_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      date,
      minutes,
      notes: typeof entry.notes === 'string' ? entry.notes.trim() : '',
      createdAt: entry.createdAt || new Date().toISOString()
    };
  }

  function logPosingSession(userId, entry) {
    const normalized = normalizeSession(entry);
    if (!Number.isFinite(normalized.minutes) || normalized.minutes <= 0) return null;

    const sessions = loadSessions(userId);
    sessions.push(normalized);
    sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveSessions(userId, sessions);

    try {
      globalScope.dailyMissionEngine?.syncMissionFromPosingEntry?.({ date: normalized.date, complete: true }, userId);
    } catch (_error) {
      // non-blocking
    }

    try {
      globalScope.gamification?.awardXp?.(resolveUserId(userId), 'posing_complete', {
        date: `${normalized.date}T12:00:00.000Z`,
        rewardId: `posing:${normalized.id}`,
        minutes: normalized.minutes
      });
    } catch (_error) {
      // non-blocking
    }

    return normalized;
  }

  function removePosingSession(userId, sessionId) {
    const sessions = loadSessions(userId);
    const filtered = sessions.filter(item => item.id !== sessionId);
    saveSessions(userId, filtered);
    return filtered.length !== sessions.length;
  }

  function getPosingHistory(userId, options = {}) {
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 60;
    return loadSessions(userId)
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, limit);
  }

  function calculateStreak(userId, referenceDate) {
    const dateKey = resolveDate(referenceDate);
    const sessions = loadSessions(userId);
    const daySet = new Set(sessions.map(s => resolveDate(s.date)));
    let streak = 0;
    let cursor = toDateObj(dateKey);

    while (daySet.has(toDateKey(cursor))) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }

    return streak;
  }

  function getOverdueStatus(userId, referenceDate) {
    const dateKey = resolveDate(referenceDate);
    const sessions = loadSessions(userId)
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const latest = sessions[0] || null;
    if (!latest) {
      return { overdue: true, daysSinceLastSession: null, message: 'No posing sessions logged yet.' };
    }

    const diffDays = Math.max(0, Math.round((toDateObj(dateKey).getTime() - toDateObj(resolveDate(latest.date)).getTime()) / 86400000));
    const overdue = diffDays >= 2;
    return {
      overdue,
      daysSinceLastSession: diffDays,
      message: overdue ? `Posing overdue: ${diffDays} days since last session.` : 'Posing cadence on track.'
    };
  }

  function getWeeklySummary(userId, referenceDate) {
    const day = toDateObj(resolveDate(referenceDate));
    const dayIndex = day.getUTCDay();
    const start = addDays(day, -dayIndex);
    const end = addDays(start, 6);
    const sessions = loadSessions(userId).filter((entry) => {
      const d = toDateObj(resolveDate(entry.date));
      return d >= start && d <= end;
    });

    const totalMinutes = sessions.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
    const target = getWeeklyTarget(userId);

    return {
      rangeStart: toDateKey(start),
      rangeEnd: toDateKey(end),
      sessions: sessions.length,
      totalMinutes,
      targetSessions: target.sessions,
      targetMinutes: target.minutes,
      sessionsPercent: Math.min(100, Math.round((sessions.length / (target.sessions || 1)) * 100)),
      minutesPercent: Math.min(100, Math.round((totalMinutes / (target.minutes || 1)) * 100))
    };
  }

  const api = {
    getStorageKey,
    loadSessions,
    saveSessions,
    logPosingSession,
    removePosingSession,
    getPosingHistory,
    getWeeklyTarget,
    setWeeklyTarget,
    getWeeklySummary,
    calculateStreak,
    getOverdueStatus
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.posingEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
