(function (globalScope) {
  'use strict';

  const STORAGE_PREFIX = 'tl_phase_state_v1_';
  const MODE_LABELS = {
    improvement: 'Improvement Season',
    mini_cut: 'Mini Cut',
    contest_prep: 'Contest Prep',
    peak_week: 'Peak Week',
    show_day: 'Show Day',
    post_show: 'Post-Show Recovery'
  };

  const MODE_ALIASES = {
    'improvement season': 'improvement',
    improvement_season: 'improvement',
    'mini cut': 'mini_cut',
    minicut: 'mini_cut',
    'contest prep': 'contest_prep',
    contestprep: 'contest_prep',
    'post-show': 'post_show',
    postshow: 'post_show'
  };

  const VALID_MODES = new Set(Object.keys(MODE_LABELS));

  function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
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

  function getStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_error) {
      // localStorage may be blocked by privacy mode; fallback to in-memory storage.
    }

    if (!globalScope.__prepModeMemoryStore) {
      globalScope.__prepModeMemoryStore = {
        _data: {},
        getItem(key) {
          return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
        },
        setItem(key, value) {
          this._data[key] = String(value);
        }
      };
    }

    return globalScope.__prepModeMemoryStore;
  }

  function toISODateOrNull(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  function normalizeMode(mode, fallbackMode) {
    if (typeof mode !== 'string') return fallbackMode;
    const normalized = mode.trim().toLowerCase().replace(/\s+/g, '_');
    const aliasLookup = MODE_ALIASES[normalized] || MODE_ALIASES[normalized.replace(/_/g, ' ')] || normalized;
    return VALID_MODES.has(aliasLookup) ? aliasLookup : fallbackMode;
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function toStringOrEmpty(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function sanitizeState(state) {
    const baseline = {
      mode: 'improvement',
      athleteName: '',
      showDate: null,
      startDate: getTodayDateString(),
      targetStageWeight: null,
      currentWeight: null,
      division: '',
      checkInDay: 'Sunday',
      cardioBaseline: '',
      posingFrequency: '',
      prepStartDate: null,
      reverseDietStartDate: null,
      weightGoalDirection: '',
      targetRateOfLoss: null,
      notes: '',
      updatedAt: new Date().toISOString()
    };

    const source = state && typeof state === 'object' ? state : {};

    return {
      ...baseline,
      ...source,
      mode: normalizeMode(source.mode, baseline.mode),
      athleteName: toStringOrEmpty(source.athleteName),
      showDate: toISODateOrNull(source.showDate),
      startDate: toISODateOrNull(source.startDate) || baseline.startDate,
      targetStageWeight: toNumberOrNull(source.targetStageWeight),
      currentWeight: toNumberOrNull(source.currentWeight),
      division: toStringOrEmpty(source.division),
      checkInDay: toStringOrEmpty(source.checkInDay) || baseline.checkInDay,
      cardioBaseline: toStringOrEmpty(source.cardioBaseline),
      posingFrequency: toStringOrEmpty(source.posingFrequency),
      prepStartDate: toISODateOrNull(source.prepStartDate),
      reverseDietStartDate: toISODateOrNull(source.reverseDietStartDate),
      weightGoalDirection: toStringOrEmpty(source.weightGoalDirection),
      targetRateOfLoss: toNumberOrNull(source.targetRateOfLoss),
      notes: typeof source.notes === 'string' ? source.notes : baseline.notes,
      updatedAt: new Date().toISOString()
    };
  }

  function initializeDefaultPhaseState(userId) {
    const existing = getCurrentPhaseState(userId);
    if (existing) return existing;

    const initial = sanitizeState({});
    saveCurrentPhaseState(userId, initial);
    return initial;
  }

  function getCurrentPhaseState(userId) {
    const storage = getStorage();
    const raw = storage.getItem(getStorageKey(userId));
    if (!raw) return null;

    try {
      return sanitizeState(JSON.parse(raw));
    } catch (_error) {
      return null;
    }
  }

  function saveCurrentPhaseState(userId, state) {
    const storage = getStorage();
    const next = sanitizeState(state);
    storage.setItem(getStorageKey(userId), JSON.stringify(next));
    syncPhaseStateToBackend(resolveUserId(userId), next);
    return next;
  }

  function loadPhaseState(userId) {
    return getCurrentPhaseState(userId);
  }

  function savePhaseState(userId, state) {
    return saveCurrentPhaseState(userId, state);
  }

  function syncPhaseStateToBackend(userId, state) {
    const payload = sanitizeState(state);
    const resolvedUser = resolveUserId(userId);
    try {
      // Future backend endpoint: PUT /api/bodybuilding/phase-state/:userId
      // Keep local storage as the source of truth even when this sync fails.
      if (typeof globalScope.fetch !== 'function') return false;
      return globalScope.fetch(`/api/bodybuilding/phase-state/${encodeURIComponent(resolvedUser)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(() => true).catch(() => false);
    } catch (_error) {
      return false;
    }
  }

  function getDaysUntilShow(showDate) {
    const parsed = new Date(showDate);
    if (!showDate || Number.isNaN(parsed.getTime())) return null;

    const today = new Date();
    const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const showDay = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));

    const diffMs = showDay.getTime() - startOfToday.getTime();
    return Math.round(diffMs / 86400000);
  }

  function getWeeksOut(showDate) {
    const days = getDaysUntilShow(showDate);
    if (days === null) return null;
    return days >= 0 ? Math.ceil(days / 7) : Math.floor(days / 7);
  }

  function getSeasonWeekNumber(referenceDate, startDate) {
    const ref = toISODateOrNull(referenceDate) || getTodayDateString();
    const start = toISODateOrNull(startDate);
    if (!start) return 1;
    const refDate = new Date(ref);
    const startDateObj = new Date(start);
    const refUtc = Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate());
    const startUtc = Date.UTC(startDateObj.getUTCFullYear(), startDateObj.getUTCMonth(), startDateObj.getUTCDate());
    const dayDiff = Math.floor((refUtc - startUtc) / 86400000);
    return Math.max(1, Math.floor(dayDiff / 7) + 1);
  }

  function getPrepWeekLabel(state = {}) {
    const normalized = sanitizeState(state);
    const daysUntilShow = getDaysUntilShow(normalized.showDate);
    if (daysUntilShow === null) return `Prep Week ${getSeasonWeekNumber(normalized.referenceDate, normalized.prepStartDate || normalized.startDate)}`;
    if (daysUntilShow < 0) return 'Show Complete';
    if (daysUntilShow === 0) return 'Show Day';
    if (daysUntilShow <= 7) return 'Peak Week';
    return `${Math.ceil(daysUntilShow / 7)} Weeks Out`;
  }

  function getPostShowLabel(state = {}) {
    const normalized = sanitizeState(state);
    const startDate = normalized.reverseDietStartDate || normalized.showDate || normalized.startDate;
    const week = getSeasonWeekNumber(normalized.referenceDate, startDate);
    return `Post-Show Week ${week}`;
  }

  function getImprovementSeasonLabel(state = {}) {
    const normalized = sanitizeState(state);
    const week = getSeasonWeekNumber(normalized.referenceDate, normalized.startDate);
    return `Improvement Season Week ${week}`;
  }

  function inferModeFromShowDate(showDate, fallbackMode) {
    const days = getDaysUntilShow(showDate);
    if (days === null) return fallbackMode;
    if (days < 0) return 'post_show';
    if (days === 0) return 'show_day';
    if (days <= 7) return 'peak_week';
    return 'contest_prep';
  }

  function getCurrentPhaseLabel(state) {
    const normalized = sanitizeState(state);
    const derivedMode = normalizeMode(normalized.mode, 'improvement');
    const mode = derivedMode === 'improvement' && normalized.showDate
      ? inferModeFromShowDate(normalized.showDate, derivedMode)
      : derivedMode;

    return MODE_LABELS[mode] || MODE_LABELS.improvement;
  }

  function getPhaseContext(state) {
    const normalized = sanitizeState(state);
    const daysUntilShow = getDaysUntilShow(normalized.showDate);
    const weeksOut = getWeeksOut(normalized.showDate);
    const label = getCurrentPhaseLabel(normalized);

    // Future dashboard cards can consume this object to drive phase-aware
    // recommendations (check-in prompts, cardio adjustments, posing reminders,
    // and show-week alerts) without changing existing logging workflows.
    return {
      mode: normalized.mode,
      label,
      athleteName: normalized.athleteName,
      daysUntilShow,
      weeksOut,
      isShowDay: daysUntilShow === 0,
      isPeakWeek: typeof daysUntilShow === 'number' && daysUntilShow >= 0 && daysUntilShow <= 7,
      isPostShow: typeof daysUntilShow === 'number' && daysUntilShow < 0,
      checkInDay: normalized.checkInDay,
      division: normalized.division,
      targetStageWeight: normalized.targetStageWeight,
      currentWeight: normalized.currentWeight,
      cardioBaseline: normalized.cardioBaseline,
      posingFrequency: normalized.posingFrequency,
      prepStartDate: normalized.prepStartDate,
      startDate: normalized.startDate,
      weightGoalDirection: normalized.weightGoalDirection,
      targetRateOfLoss: normalized.targetRateOfLoss,
      reverseDietStartDate: normalized.reverseDietStartDate,
      notes: normalized.notes
    };
  }

  const api = {
    loadPhaseState,
    savePhaseState,
    syncPhaseStateToBackend,
    getCurrentPhaseState,
    saveCurrentPhaseState,
    initializeDefaultPhaseState,
    getDaysUntilShow,
    getWeeksOut,
    getPrepWeekLabel,
    getPostShowLabel,
    getImprovementSeasonLabel,
    getCurrentPhaseLabel,
    getPhaseContext,
    getStorageKey
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalScope !== 'undefined') {
    globalScope.prepModeApi = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
