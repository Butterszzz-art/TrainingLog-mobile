(function (globalScope) {
  'use strict';

  const STATUS_BUCKETS = [
    { min: 90, label: 'on_track' },
    { min: 75, label: 'slightly_behind' },
    { min: 50, label: 'at_risk' },
    { min: 0, label: 'off_track' }
  ];
  const KNOWN_ARCHETYPES = ['bodybuilder', 'powerlifter', 'hybrid', 'recreational'];
  const DEFAULT_ARCHETYPE = 'hybrid';
  const COMPLIANCE_WEIGHTS = Object.freeze({
    bodybuilder: Object.freeze({
      workoutComplete: 0.06,
      cardioComplete: 0.18,
      macrosComplete: 0.24,
      bodyweightLogged: 0.18,
      posingComplete: 0.18,
      recoveryLogged: 0.14,
      stepsComplete: 0.02
    }),
    powerlifter: Object.freeze({
      workoutComplete: 0.30,
      cardioComplete: 0.06,
      macrosComplete: 0.10,
      bodyweightLogged: 0.08,
      posingComplete: 0.04,
      recoveryLogged: 0.24,
      stepsComplete: 0.08,
      topSetLogged: 0.06,
      fatigueLogged: 0.04
    }),
    hybrid: Object.freeze({
      workoutComplete: 0.24,
      cardioComplete: 0.20,
      macrosComplete: 0.14,
      bodyweightLogged: 0.10,
      posingComplete: 0.02,
      recoveryLogged: 0.20,
      stepsComplete: 0.10
    }),
    recreational: Object.freeze({
      workoutComplete: 0.22,
      cardioComplete: 0.10,
      macrosComplete: 0.10,
      bodyweightLogged: 0.16,
      posingComplete: 0.04,
      recoveryLogged: 0.14,
      stepsComplete: 0.24
    })
  });
  const STORAGE_PREFIX = 'tl_compliance_summary_v1_';

  function getStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_error) {
      // localStorage unavailable in some environments.
    }

    if (!globalScope.__complianceMemoryStore) {
      globalScope.__complianceMemoryStore = {
        _data: {},
        getItem(key) {
          return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
        },
        setItem(key, value) {
          this._data[key] = String(value);
        }
      };
    }

    return globalScope.__complianceMemoryStore;
  }

  function resolveDate(value) {
    if (!value) return new Date().toISOString().slice(0, 10);
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
    return parsed.toISOString().slice(0, 10);
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

  function getStorageKey(userId) {
    return `${STORAGE_PREFIX}${resolveUserId(userId)}`;
  }

  function loadComplianceSummaryState(userId) {
    const raw = getStorage().getItem(getStorageKey(userId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function saveComplianceSummaryState(userId, state) {
    const safe = state && typeof state === 'object' ? state : {};
    getStorage().setItem(getStorageKey(userId), JSON.stringify(safe));
    syncComplianceSummaryStateToBackend(resolveUserId(userId), safe);
    return safe;
  }

  function syncComplianceSummaryStateToBackend(userId, state) {
    const resolvedUser = resolveUserId(userId);
    try {
      // Future backend endpoint: PUT /api/bodybuilding/compliance-summary/:userId
      // This intentionally does not gate local usage on network availability.
      if (typeof globalScope.fetch !== 'function') return false;
      return globalScope.fetch(`/api/bodybuilding/compliance-summary/${encodeURIComponent(resolvedUser)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state || {}),
        signal: AbortSignal.timeout(5000)
      }).then(() => true).catch(() => false);
    } catch (_error) {
      return false;
    }
  }

  function parseDate(dateKey) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function toDateKey(dateObj) {
    return dateObj.toISOString().slice(0, 10);
  }

  function addDays(dateObj, days) {
    return new Date(dateObj.getTime() + (days * 24 * 60 * 60 * 1000));
  }

  function calculateDailyCompliancePercent(missionState, archetype) {
    if (!missionState || !globalScope.dailyMissionEngine) return 0;
    const resolvedArchetype = resolveArchetype(missionState?.userId, archetype || missionState?.archetype);
    return calculateWeightedCompliancePercent(missionState, resolvedArchetype);
  }

  function inferRequiredItems(missionState) {
    const defaults = ['workoutComplete', 'cardioComplete', 'macrosComplete', 'bodyweightLogged', 'posingComplete', 'recoveryLogged'];
    if (!missionState || !Array.isArray(missionState.requiredItems) || !missionState.requiredItems.length) return defaults;
    return missionState.requiredItems;
  }

  function getComplianceStatus(percent) {
    const safePercent = Number.isFinite(percent) ? percent : 0;
    return STATUS_BUCKETS.find(bucket => safePercent >= bucket.min)?.label || 'off_track';
  }

  function normalizeArchetype(archetype) {
    const value = typeof archetype === 'string' ? archetype.trim().toLowerCase() : '';
    return KNOWN_ARCHETYPES.includes(value) ? value : DEFAULT_ARCHETYPE;
  }

  function readArchetypeFromSettings(userId) {
    const resolvedUser = resolveUserId(userId);
    const settingsKeys = [
      `settings_${resolvedUser}`,
      `profile_${resolvedUser}`
    ];
    for (let index = 0; index < settingsKeys.length; index += 1) {
      const raw = globalScope.localStorage?.getItem?.(settingsKeys[index]);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const profile = parsed?.profile || parsed;
        if (typeof profile?.athleteArchetype === 'string') {
          return normalizeArchetype(profile.athleteArchetype);
        }
      } catch (_error) {
        // Ignore malformed local payloads and continue fallbacks.
      }
    }
    const legacy = globalScope.localStorage?.getItem?.('athleteArchetype');
    if (legacy) return normalizeArchetype(legacy);
    return DEFAULT_ARCHETYPE;
  }

  function resolveArchetype(userId, archetype) {
    if (typeof archetype === 'string' && archetype.trim()) {
      return normalizeArchetype(archetype);
    }
    return readArchetypeFromSettings(userId);
  }

  function getComplianceWeightsForArchetype(archetype) {
    return COMPLIANCE_WEIGHTS[normalizeArchetype(archetype)] || COMPLIANCE_WEIGHTS[DEFAULT_ARCHETYPE];
  }

  function calculateWeightedCompliancePercent(missionState, archetype) {
    if (!missionState) return 0;
    const requiredItems = inferRequiredItems(missionState);
    if (!requiredItems.length) return 0;

    const weights = getComplianceWeightsForArchetype(archetype);
    const defaultWeight = 1;
    let completedWeight = 0;
    let totalWeight = 0;

    requiredItems.forEach((itemKey) => {
      const weight = Number(weights[itemKey]);
      const resolvedWeight = Number.isFinite(weight) && weight > 0 ? weight : defaultWeight;
      totalWeight += resolvedWeight;
      if (missionState[itemKey]) completedWeight += resolvedWeight;
    });

    if (!totalWeight) return 0;
    return Math.round((completedWeight / totalWeight) * 100);
  }

  function getWeekWindow(endDate) {
    const endKey = resolveDate(endDate);
    const end = parseDate(endKey);
    const start = addDays(end, -6);
    return { start, end, endKey };
  }

  function calculateWeeklyCompliance(userId, endDate, archetype) {
    const engine = globalScope.dailyMissionEngine;
    if (!engine) {
      return {
        averagePercent: 0,
        status: 'off_track',
        completedDays: 0,
        activeDays: 0,
        days: []
      };
    }

    const resolvedUser = resolveUserId(userId);
    const resolvedArchetype = resolveArchetype(resolvedUser, archetype);
    const { start, end } = getWeekWindow(endDate);
    const days = [];

    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
      const dateKey = toDateKey(cursor);
      const state = engine.getDailyMissionState(resolvedUser, dateKey);
      const percent = calculateWeightedCompliancePercent(state, resolvedArchetype);
      days.push({
        date: dateKey,
        percent,
        hasMissionState: Boolean(state)
      });
    }

    const totalPercent = days.reduce((sum, day) => sum + day.percent, 0);
    const averagePercent = Math.round(totalPercent / (days.length || 1));
    const completedDays = days.filter(day => day.percent >= 90).length;
    const activeDays = days.filter(day => day.hasMissionState).length;

    return {
      averagePercent,
      status: getComplianceStatus(averagePercent),
      archetype: resolvedArchetype,
      completedDays,
      activeDays,
      days
    };
  }

  function calculateRolling7DayCompliance(userId, endDate, archetype) {
    const weekly = calculateWeeklyCompliance(userId, endDate, archetype);
    return {
      percent: weekly.averagePercent,
      status: getComplianceStatus(weekly.averagePercent),
      archetype: weekly.archetype,
      windowDays: weekly.days
    };
  }

  function getMetricCompletionRate(userId, metricKey, endDate, durationDays) {
    const engine = globalScope.dailyMissionEngine;
    if (!engine) return 0;

    const resolvedUser = resolveUserId(userId);
    const endKey = resolveDate(endDate);
    const end = parseDate(endKey);
    const start = addDays(end, -(Math.max(1, durationDays) - 1));

    let completed = 0;
    let total = 0;

    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
      const day = engine.getDailyMissionState(resolvedUser, toDateKey(cursor));
      if (!day) continue;
      total += 1;
      if (day[metricKey]) completed += 1;
    }

    if (!total) return 0;
    return Math.round((completed / total) * 100);
  }

  function analyzeMissedTasks(userId, endDate, durationDays = 7) {
    const engine = globalScope.dailyMissionEngine;
    if (!engine) {
      return {
        rangeStart: resolveDate(endDate),
        rangeEnd: resolveDate(endDate),
        activeDays: 0,
        totalMissed: 0,
        byTask: {},
        topMissedTask: null
      };
    }

    const resolvedUser = resolveUserId(userId);
    const endKey = resolveDate(endDate);
    const end = parseDate(endKey);
    const span = Math.max(1, durationDays);
    const start = addDays(end, -(span - 1));
    const byTask = {};
    let activeDays = 0;
    let totalMissed = 0;

    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
      const dateKey = toDateKey(cursor);
      const state = engine.getDailyMissionState(resolvedUser, dateKey);
      if (!state) continue;
      activeDays += 1;
      const requiredItems = inferRequiredItems(state);
      requiredItems.forEach((itemKey) => {
        if (!state[itemKey]) {
          byTask[itemKey] = (byTask[itemKey] || 0) + 1;
          totalMissed += 1;
        }
      });
    }

    const topMissedTask = Object.entries(byTask).sort((a, b) => b[1] - a[1])[0] || null;

    return {
      rangeStart: toDateKey(start),
      rangeEnd: endKey,
      activeDays,
      totalMissed,
      byTask,
      topMissedTask: topMissedTask
        ? { task: topMissedTask[0], missedDays: topMissedTask[1] }
        : null
    };
  }

  function buildInsight(userId, weekly) {
    const lastDay = weekly.days.length ? weekly.days[weekly.days.length - 1].date : resolveDate();
    if (weekly.averagePercent >= 90) return 'On track';

    const cardioRate = getMetricCompletionRate(userId, 'cardioComplete', lastDay, 7);
    if (cardioRate > 0 && cardioRate < 60) return 'Cardio consistency slipping';

    const posingRate = getMetricCompletionRate(userId, 'posingComplete', lastDay, 7);
    if (posingRate > 0 && posingRate < 60) return 'Posing behind target';
    const posingOverdue = globalScope.posingEngine?.getOverdueStatus?.(userId, lastDay);
    if (posingOverdue?.overdue) return 'Posing overdue warning';

    const bodyweightRate = getMetricCompletionRate(userId, 'bodyweightLogged', lastDay, 7);
    if (bodyweightRate >= 75) return 'Weight logging strong this week';

    if (weekly.averagePercent >= 75) return 'Execution slightly behind target';
    if (weekly.averagePercent >= 50) return 'Urgency required to regain compliance';
    return 'Immediate course correction required';
  }

  function getComplianceTrend(userId, archetype) {
    const today = resolveDate();
    const resolvedArchetype = resolveArchetype(userId, archetype);
    const currentWeek = calculateWeeklyCompliance(userId, today, resolvedArchetype);
    const previousWeekEnd = toDateKey(addDays(parseDate(today), -7));
    const previousWeek = calculateWeeklyCompliance(userId, previousWeekEnd, resolvedArchetype);
    const delta = currentWeek.averagePercent - previousWeek.averagePercent;

    const trend = delta > 3 ? 'improving' : delta < -3 ? 'declining' : 'steady';

    return {
      trend,
      delta,
      archetype: resolvedArchetype,
      currentWeek,
      previousWeek,
      insight: buildInsight(userId, currentWeek)
    };
  }

  function getComplianceInsights(userId, endDate, archetype) {
    const weekly = calculateWeeklyCompliance(userId, endDate, archetype);
    const missed = analyzeMissedTasks(userId, endDate, 7);
    const insights = [];
    const headline = buildInsight(userId, weekly);
    if (headline) insights.push(headline);

    if (missed.topMissedTask && missed.topMissedTask.task === 'cardioComplete' && !insights.includes('Cardio consistency slipping')) {
      insights.push('Cardio consistency slipping');
    }
    if (missed.topMissedTask && missed.topMissedTask.task === 'posingComplete' && !insights.includes('Posing behind target')) {
      insights.push('Posing behind target');
    }
    const posingOverdue = globalScope.posingEngine?.getOverdueStatus?.(userId, endDate);
    if (posingOverdue?.overdue && !insights.includes('Posing overdue warning')) {
      insights.push('Posing overdue warning');
    }

    if (!insights.includes('On track') && weekly.averagePercent >= 90) {
      insights.unshift('On track');
    }

    return {
      insights,
      missed
    };
  }

  const api = {
    loadComplianceSummaryState,
    saveComplianceSummaryState,
    syncComplianceSummaryStateToBackend,
    calculateDailyCompliancePercent,
    calculateWeeklyCompliance,
    calculateRolling7DayCompliance,
    getComplianceWeightsForArchetype,
    getComplianceStatus,
    getComplianceTrend,
    analyzeMissedTasks,
    getComplianceInsights,
    getStorageKey
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.complianceEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
