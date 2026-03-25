(function (globalScope) {
  'use strict';

  const STATUS_BUCKETS = [
    { min: 90, label: 'on_track' },
    { min: 75, label: 'slightly_behind' },
    { min: 50, label: 'at_risk' },
    { min: 0, label: 'off_track' }
  ];

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

  function calculateDailyCompliancePercent(missionState) {
    if (!missionState || !globalScope.dailyMissionEngine) return 0;
    const summary = globalScope.dailyMissionEngine.calculateDailyCompliance(missionState);
    return Number.isFinite(summary?.percent) ? summary.percent : 0;
  }

  function getComplianceStatus(percent) {
    const safePercent = Number.isFinite(percent) ? percent : 0;
    return STATUS_BUCKETS.find(bucket => safePercent >= bucket.min)?.label || 'off_track';
  }

  function getWeekWindow(endDate) {
    const endKey = resolveDate(endDate);
    const end = parseDate(endKey);
    const start = addDays(end, -6);
    return { start, end, endKey };
  }

  function calculateWeeklyCompliance(userId, endDate) {
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
    const { start, end } = getWeekWindow(endDate);
    const days = [];

    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
      const dateKey = toDateKey(cursor);
      const state = engine.getDailyMissionState(resolvedUser, dateKey);
      const percent = calculateDailyCompliancePercent(state);
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
      completedDays,
      activeDays,
      days
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

  function buildInsight(userId, weekly) {
    const lastDay = weekly.days.length ? weekly.days[weekly.days.length - 1].date : resolveDate();
    if (weekly.averagePercent >= 90) return 'On track';

    const cardioRate = getMetricCompletionRate(userId, 'cardioComplete', lastDay, 7);
    if (cardioRate > 0 && cardioRate < 60) return 'Cardio consistency slipping';

    const bodyweightRate = getMetricCompletionRate(userId, 'bodyweightLogged', lastDay, 7);
    if (bodyweightRate >= 75) return 'Weight logging strong this week';

    if (weekly.averagePercent >= 75) return 'Execution slightly behind target';
    if (weekly.averagePercent >= 50) return 'Urgency required to regain compliance';
    return 'Immediate course correction required';
  }

  function getComplianceTrend(userId) {
    const today = resolveDate();
    const currentWeek = calculateWeeklyCompliance(userId, today);
    const previousWeekEnd = toDateKey(addDays(parseDate(today), -7));
    const previousWeek = calculateWeeklyCompliance(userId, previousWeekEnd);
    const delta = currentWeek.averagePercent - previousWeek.averagePercent;

    const trend = delta > 3 ? 'improving' : delta < -3 ? 'declining' : 'steady';

    return {
      trend,
      delta,
      currentWeek,
      previousWeek,
      insight: buildInsight(userId, currentWeek)
    };
  }

  const api = {
    calculateDailyCompliancePercent,
    calculateWeeklyCompliance,
    getComplianceStatus,
    getComplianceTrend
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.complianceEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
