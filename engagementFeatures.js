/**
 * engagementFeatures.js
 *
 * Shared logic for the check-in engagement features: Daily Pulse (Home),
 * weigh-in cadence (feeds the Due Now Rail), Flow Capture (post-log micro
 * check-in), and Macro favorites (Macro Nudge). Pure storage/calculation
 * helpers only — index.html owns all DOM rendering and wires these in,
 * mirroring the checkinEngine.js / dailyMissionEngine.js pattern.
 */
(function (globalScope) {
  'use strict';

  function resolveUserId(userId) {
    const fromArg = typeof userId === 'string' ? userId.trim() : '';
    if (fromArg) return fromArg;
    const fromGlobal = globalScope.currentUser || globalScope.localStorage?.getItem('username') || globalScope.localStorage?.getItem('currentUser');
    return typeof fromGlobal === 'string' && fromGlobal.trim() ? fromGlobal.trim() : 'guest';
  }

  function getStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_error) {
      // localStorage may be disabled in private mode.
    }
    if (!globalScope.__engagementMemoryStore) {
      globalScope.__engagementMemoryStore = {
        _data: {},
        getItem(key) { return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null; },
        setItem(key, value) { this._data[key] = String(value); },
      };
    }
    return globalScope.__engagementMemoryStore;
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_error) {
      return fallback;
    }
  }

  // ── Daily Pulse ────────────────────────────────────────────────────────

  const PULSE_QUESTIONS = [
    { key: 'energy', label: "How's your energy today?" },
    { key: 'soreness', label: 'Anything feeling sore today?' },
    { key: 'motivation', label: "How's your motivation today?" },
    { key: 'sleep', label: 'How did last night\'s sleep feel?' },
  ];

  function getPulseStorageKey(userId) {
    return `dailyPulse_${resolveUserId(userId)}`;
  }

  function loadPulseLog(userId) {
    const raw = getStorage().getItem(getPulseStorageKey(userId));
    const list = safeParse(raw, []);
    return Array.isArray(list) ? list : [];
  }

  function savePulseLog(userId, log) {
    getStorage().setItem(getPulseStorageKey(userId), JSON.stringify(log));
  }

  /** Rotates deterministically through PULSE_QUESTIONS by day-of-year, so every user sees the same question on a given date but a different one each day. */
  function getTodayPulseQuestion(dateStr) {
    const date = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
    const start = new Date(date.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((date - start) / 86400000);
    return PULSE_QUESTIONS[dayOfYear % PULSE_QUESTIONS.length];
  }

  function getTodayPulseEntry(userId) {
    const date = todayKey();
    return loadPulseLog(userId).find((entry) => entry.date === date) || null;
  }

  function savePulseAnswer(userId, questionKey, value) {
    const date = todayKey();
    const log = loadPulseLog(userId).filter((entry) => entry.date !== date);
    const entry = { date, question: questionKey, value };
    log.unshift(entry);
    savePulseLog(userId, log);
    return entry;
  }

  /** Consecutive days (ending today or yesterday) with a pulse answer logged. */
  function getPulseStreak(userId) {
    const log = loadPulseLog(userId);
    if (!log.length) return 0;
    const dates = new Set(log.map((entry) => entry.date));
    let streak = 0;
    const cursor = new Date();
    // Allow the streak to still show yesterday's count before today is answered.
    if (!dates.has(todayKey())) cursor.setDate(cursor.getDate() - 1);
    while (dates.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  // ── Weigh-in cadence (no existing helper covers this) ───────────────────

  function getWeighInStatus(userId, cadenceDays) {
    const cadence = Number.isFinite(cadenceDays) && cadenceDays > 0 ? cadenceDays : 7;
    const raw = getStorage().getItem(`bodyweightLog_${resolveUserId(userId)}`);
    const log = safeParse(raw, []);
    if (!Array.isArray(log) || !log.length) {
      return { hasEntries: false, lastDate: null, daysSince: null, cadence, daysUntilDue: 0, overdue: false };
    }
    const lastEntry = log[log.length - 1];
    const lastDate = lastEntry?.date || null;
    if (!lastDate) {
      return { hasEntries: false, lastDate: null, daysSince: null, cadence, daysUntilDue: 0, overdue: false };
    }
    const daysSince = Math.round((new Date(new Date().toDateString()) - new Date(`${lastDate}T00:00:00`)) / 86400000);
    const daysUntilDue = cadence - daysSince;
    return { hasEntries: true, lastDate, daysSince, cadence, daysUntilDue, overdue: daysUntilDue < 0 };
  }

  // ── Flow Capture (post-log micro check-in) ──────────────────────────────
  // Kept separate from checkinEngine's weekly check-in store so a same-day
  // save there never clobbers (or is clobbered by) this per-log ping.

  function getFlowCaptureKey(userId) {
    return `flowCaptureLog_${resolveUserId(userId)}`;
  }

  function saveFlowCaptureEntry(userId, entry) {
    const key = getFlowCaptureKey(userId);
    const log = safeParse(getStorage().getItem(key), []);
    const list = Array.isArray(log) ? log : [];
    list.unshift({ date: todayKey(), ts: Date.now(), ...entry });
    getStorage().setItem(key, JSON.stringify(list.slice(0, 200)));
    return list[0];
  }

  // ── Macro favorites (Macro Nudge) ────────────────────────────────────────

  const DEFAULT_MACRO_FAVORITES = [
    { id: 'chicken', name: 'Grilled chicken breast', protein: 38, carbs: 0, fat: 4, cals: 165 },
    { id: 'shake', name: 'Whey protein shake', protein: 27, carbs: 3, fat: 2, cals: 130 },
    { id: 'yogurt', name: 'Greek yogurt, plain', protein: 18, carbs: 6, fat: 0, cals: 100 },
  ];

  function getMacroFavoritesKey(userId) {
    return `macroFavorites_${resolveUserId(userId)}`;
  }

  function loadMacroFavorites(userId) {
    const key = getMacroFavoritesKey(userId);
    const raw = getStorage().getItem(key);
    if (raw == null) {
      getStorage().setItem(key, JSON.stringify(DEFAULT_MACRO_FAVORITES));
      return DEFAULT_MACRO_FAVORITES.slice();
    }
    const list = safeParse(raw, DEFAULT_MACRO_FAVORITES);
    return Array.isArray(list) && list.length ? list : DEFAULT_MACRO_FAVORITES.slice();
  }

  // ── Macro pace nudge text ─────────────────────────────────────────────

  /**
   * Compares protein consumed so far against the expected pace for this
   * time of day (linear over a 6am–10pm eating window) and returns a short
   * nudge message, or null when on pace / day just starting / target hit.
   */
  function getMacroPaceNudge(consumedProtein, targetProtein) {
    const target = Number(targetProtein) || 0;
    if (target <= 0) return null;
    const consumed = Number(consumedProtein) || 0;
    if (consumed >= target) return null;

    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const windowStart = 6;
    const windowEnd = 22;
    if (hour <= windowStart) return null;
    const elapsedFraction = Math.min(1, (hour - windowStart) / (windowEnd - windowStart));
    if (elapsedFraction <= 0.15) return null;

    const expectedPercent = elapsedFraction * 100;
    const actualPercent = (consumed / target) * 100;
    const behindBy = expectedPercent - actualPercent;
    if (behindBy < 15) return null;

    const hoursLeft = Math.max(0, Math.round(windowEnd - hour));
    const projectedPercent = Math.max(0, Math.round(actualPercent / Math.max(elapsedFraction, 0.05)));
    return {
      percent: Math.min(99, projectedPercent),
      hoursLeft,
      message: `Protein's behind pace. At this rate you'll land around ${Math.min(99, projectedPercent)}% of target${hoursLeft ? ` with ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} left today` : ' today'}.`,
    };
  }

  const api = {
    PULSE_QUESTIONS,
    getTodayPulseQuestion,
    getTodayPulseEntry,
    savePulseAnswer,
    getPulseStreak,
    getWeighInStatus,
    saveFlowCaptureEntry,
    loadMacroFavorites,
    getMacroPaceNudge,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.engagementFeatures = api;
})(typeof window !== 'undefined' ? window : globalThis);
