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
    const contestPrepToolkit = sanitizeContestPrepToolkit(state?.contestPrepToolkit);
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
      contestPrepToolkit,
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
      contestPrepToolkit,
      notes: typeof source.notes === 'string' ? source.notes : baseline.notes,
      updatedAt: new Date().toISOString()
    };
  }

  function buildDefaultPeakWeekChecklist() {
    return [
      { dayOffset: -7, label: '7 Days Out', tasks: ['Confirm peak week strategy with coach', 'Lock travel confirmations', 'Begin daily physique check-ins'], completedTasks: [] },
      { dayOffset: -6, label: '6 Days Out', tasks: ['Stage-walk posing rounds', 'Review sodium and hydration baseline', 'Finalize pump-up kit list'], completedTasks: [] },
      { dayOffset: -5, label: '5 Days Out', tasks: ['Practice mandatory poses under fatigue', 'Confirm tanning appointment windows', 'Pack non-perishable prep meals'], completedTasks: [] },
      { dayOffset: -4, label: '4 Days Out', tasks: ['Register athlete check-in documents', 'Confirm athlete meeting time', 'Review travel-day meal timing'], completedTasks: [] },
      { dayOffset: -3, label: '3 Days Out', tasks: ['Assess carb-loading response photos', 'Trim training volume per peak plan', 'Finalize show-day timeline'], completedTasks: [] },
      { dayOffset: -2, label: '2 Days Out', tasks: ['Primary tan coat + skin prep', 'Set alarms for show-day meal intervals', 'Charge and stage all electronics'], completedTasks: [] },
      { dayOffset: -1, label: '1 Day Out', tasks: ['Touch-up tan and glaze supplies', 'Lay out suit, jewelry, and number tag kit', 'Review wake-up checklist'], completedTasks: [] },
      { dayOffset: 0, label: 'Show Day', tasks: ['Morning physique check and first meal', 'Pump-up protocol timing', 'Backstage execution checklist'], completedTasks: [] }
    ];
  }

  function sanitizeChecklistDays(days) {
    const sourceDays = Array.isArray(days) && days.length ? days : buildDefaultPeakWeekChecklist();
    return sourceDays.map((day, index) => {
      const dayOffset = Number.isFinite(Number(day?.dayOffset)) ? Number(day.dayOffset) : buildDefaultPeakWeekChecklist()[index]?.dayOffset ?? 0;
      const tasks = Array.isArray(day?.tasks) ? day.tasks.filter(Boolean).map(item => String(item).trim()).filter(Boolean) : [];
      const completedSet = new Set(Array.isArray(day?.completedTasks) ? day.completedTasks.map(item => String(item).trim()) : []);
      const completedTasks = tasks.filter(task => completedSet.has(task));
      return {
        dayOffset,
        label: toStringOrEmpty(day?.label) || (dayOffset === 0 ? 'Show Day' : `${Math.abs(dayOffset)} Days Out`),
        tasks: tasks.length ? tasks : ['No tasks assigned'],
        completedTasks
      };
    }).sort((a, b) => a.dayOffset - b.dayOffset);
  }

  function sanitizeChecklistSections(sections, fallback) {
    return Object.keys(fallback).reduce((acc, key) => {
      const base = fallback[key];
      const incoming = sections && sections[key];
      const merged = {
        ...base,
        done: Boolean(incoming?.done),
        notes: toStringOrEmpty(incoming?.notes)
      };
      acc[key] = merged;
      return acc;
    }, {});
  }

  function sanitizeContestPrepToolkit(toolkit) {
    const reminderFallback = [
      { id: 'wake_assessment', time: '06:00', text: 'Wake, assess look, and log mirror check photo.' },
      { id: 'meal_window', time: '09:00', text: 'Follow first structured meal and hydration target.' },
      { id: 'check_in', time: '11:00', text: 'Attend athlete meeting / check-in with documents.' },
      { id: 'tan_touchup', time: '13:00', text: 'Run tan touch-up + glaze prep before pump-up.' },
      { id: 'stage_call', time: '15:00', text: 'Be backstage 45 min before class call.' }
    ];
    const checklistFallback = {
      travel: { label: 'Travel arranged (flight/hotel/ride)', done: false, notes: '' },
      tan: { label: 'Tan appointments + supplies secured', done: false, notes: '' },
      registration: { label: 'Registration + NPC/IFBB docs packed', done: false, notes: '' }
    };

    const source = toolkit && typeof toolkit === 'object' ? toolkit : {};
    const reminders = Array.isArray(source.showDayReminders)
      ? source.showDayReminders.map((item, idx) => ({
        id: toStringOrEmpty(item?.id) || `reminder_${idx + 1}`,
        time: toStringOrEmpty(item?.time),
        text: toStringOrEmpty(item?.text)
      })).filter(item => item.text)
      : [];
    const sanitizedReminders = reminders.length ? reminders : reminderFallback;
    const planningNotes = source.planningNotes && typeof source.planningNotes === 'object' ? source.planningNotes : {};

    return {
      peakWeekModeEnabled: source.peakWeekModeEnabled !== false,
      peakWeekChecklistByDay: sanitizeChecklistDays(source.peakWeekChecklistByDay),
      showDayReminders: sanitizedReminders,
      travelTanRegistrationChecklist: sanitizeChecklistSections(source.travelTanRegistrationChecklist, checklistFallback),
      planningNotes: {
        water: toStringOrEmpty(planningNotes.water),
        sodium: toStringOrEmpty(planningNotes.sodium),
        carbs: toStringOrEmpty(planningNotes.carbs)
      }
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
    // localStorage is the source of truth. The network sync is only attempted
    // when a real Express backend is running (localhost / custom domain).
    // On GitHub Pages (static host) there is no API, so we skip silently.
    try {
      const host = (typeof location !== 'undefined' && location.hostname) || '';
      const isStaticHost = host.includes('github.io') || host.includes('netlify.app') ||
                           host.includes('vercel.app') || host === '' || host === 'localhost' && !_hasApiBackend();
      if (isStaticHost) return false;

      const payload = sanitizeState(state);
      const resolvedUser = resolveUserId(userId);
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

  // Lightweight check: has a /api route responded recently?
  let _apiBackendConfirmed = false;
  function _hasApiBackend() { return _apiBackendConfirmed; }
  if (typeof globalScope.fetch === 'function') {
    globalScope.fetch('/api/ping', { method: 'HEAD' })
      .then(r => { if (r.ok) _apiBackendConfirmed = true; })
      .catch(() => {});
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
    if (daysUntilShow === null) {
      return `Contest Prep Week ${getSeasonWeekNumber(normalized.referenceDate, normalized.prepStartDate || normalized.startDate)}`;
    }
    if (daysUntilShow < 0) return `Post-Show Week ${getSeasonWeekNumber(normalized.referenceDate, normalized.showDate)}`;
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
    const mode = normalizeMode(normalized.mode, 'improvement');
    if (mode === 'mini_cut') return `Mini Cut Week ${week}`;
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

  function resolveEffectiveMode(state) {
    const normalized = sanitizeState(state);
    const mode = normalizeMode(normalized.mode, 'improvement');
    const showDateMode = inferModeFromShowDate(normalized.showDate, mode);

    if (mode === 'contest_prep') return showDateMode;
    if (mode === 'peak_week') {
      if (showDateMode === 'show_day' || showDateMode === 'post_show') return showDateMode;
      return 'peak_week';
    }
    if (mode === 'show_day') return showDateMode === 'post_show' ? 'post_show' : 'show_day';
    if (mode === 'post_show') return showDateMode === 'contest_prep' || showDateMode === 'peak_week' ? showDateMode : 'post_show';
    return mode;
  }

  function getCurrentPhaseLabel(state) {
    const mode = resolveEffectiveMode(state);
    return MODE_LABELS[mode] || MODE_LABELS.improvement;
  }

  function getPhaseContext(state) {
    const normalized = sanitizeState(state);
    const effectiveMode = resolveEffectiveMode(normalized);
    const daysUntilShow = getDaysUntilShow(normalized.showDate);
    const weeksOut = getWeeksOut(normalized.showDate);
    const label = getCurrentPhaseLabel(normalized);

    // Future dashboard cards can consume this object to drive phase-aware
    // recommendations (check-in prompts, cardio adjustments, posing reminders,
    // and show-week alerts) without changing existing logging workflows.
    return {
      mode: effectiveMode,
      configuredMode: normalized.mode,
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
      notes: normalized.notes,
      contestPrepToolkit: normalized.contestPrepToolkit
    };
  }

  function getPeakWeekChecklistByDay(state = {}) {
    const normalized = sanitizeState(state);
    return normalized.contestPrepToolkit.peakWeekChecklistByDay;
  }

  function getShowDayReminders(state = {}) {
    const normalized = sanitizeState(state);
    return normalized.contestPrepToolkit.showDayReminders;
  }

  function getTravelTanRegistrationChecklist(state = {}) {
    const normalized = sanitizeState(state);
    return normalized.contestPrepToolkit.travelTanRegistrationChecklist;
  }

  function getPlanningNotes(state = {}) {
    const normalized = sanitizeState(state);
    return normalized.contestPrepToolkit.planningNotes;
  }

  function getFinalWeekComplianceSummary(state = {}) {
    const normalized = sanitizeState(state);
    const checklistDays = normalized.contestPrepToolkit.peakWeekChecklistByDay;
    const dayTotals = checklistDays.reduce((acc, day) => {
      const total = Array.isArray(day.tasks) ? day.tasks.length : 0;
      const completed = Array.isArray(day.completedTasks) ? day.completedTasks.length : 0;
      return {
        total: acc.total + total,
        completed: acc.completed + Math.min(completed, total)
      };
    }, { total: 0, completed: 0 });

    const coreChecklist = Object.values(normalized.contestPrepToolkit.travelTanRegistrationChecklist || {});
    const coreCompleted = coreChecklist.filter(item => item?.done).length;
    const coreTotal = coreChecklist.length;
    const completionPercent = dayTotals.total ? Math.round((dayTotals.completed / dayTotals.total) * 100) : 0;

    return {
      peakWeekChecklistCompleted: dayTotals.completed,
      peakWeekChecklistTotal: dayTotals.total,
      peakWeekChecklistCompletionPercent: completionPercent,
      travelTanRegistrationCompleted: coreCompleted,
      travelTanRegistrationTotal: coreTotal,
      isExecutionReady: completionPercent >= 85 && coreCompleted === coreTotal
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
    getStorageKey,
    getPeakWeekChecklistByDay,
    getShowDayReminders,
    getTravelTanRegistrationChecklist,
    getPlanningNotes,
    getFinalWeekComplianceSummary
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof globalScope !== 'undefined') {
    globalScope.prepModeApi = api;
    globalScope.phaseEngineApi = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
