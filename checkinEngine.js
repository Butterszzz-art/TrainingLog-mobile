(function (globalScope) {
  'use strict';

  const STORAGE_PREFIX = 'tl_checkins_v1_';
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MODE_LABELS = {
    improvement: 'Improvement Season',
    mini_cut: 'Mini Cut',
    contest_prep: 'Contest Prep',
    peak_week: 'Peak Week',
    show_day: 'Show Day',
    post_show: 'Post-Show'
  };

  function resolveUserId(userId) {
    const fromArg = typeof userId === 'string' ? userId.trim() : '';
    if (fromArg) return fromArg;
    const fromGlobal = globalScope.currentUser || globalScope.localStorage?.getItem('username') || globalScope.localStorage?.getItem('Username');
    return typeof fromGlobal === 'string' && fromGlobal.trim() ? fromGlobal.trim() : 'guest';
  }

  function getStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_error) {
      // localStorage may be disabled in private mode.
    }

    if (!globalScope.__checkInMemoryStore) {
      globalScope.__checkInMemoryStore = {
        _data: {},
        getItem(key) {
          return Object.prototype.hasOwnProperty.call(this._data, key) ? this._data[key] : null;
        },
        setItem(key, value) {
          this._data[key] = String(value);
        }
      };
    }

    return globalScope.__checkInMemoryStore;
  }

  function getStorageKey(userId) {
    return `${STORAGE_PREFIX}${resolveUserId(userId)}`;
  }

  function toDate(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function toIsoDate(value) {
    const date = toDate(value);
    return date ? date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  }

  function normalizeCheckIn(checkIn, phaseState = {}) {
    const safe = checkIn && typeof checkIn === 'object' ? checkIn : {};
    return {
      date: toIsoDate(safe.date),
      phase: typeof safe.phase === 'string' && safe.phase.trim()
        ? safe.phase.trim()
        : (phaseState.mode || 'improvement'),
      weekLabel: typeof safe.weekLabel === 'string' && safe.weekLabel.trim()
        ? safe.weekLabel.trim()
        : getWeekLabelForCheckIn({ ...safe, date: toIsoDate(safe.date) }, phaseState),
      bodyweight: safe.bodyweight ?? '',
      waist: safe.waist ?? '',
      energy: safe.energy ?? '',
      hunger: safe.hunger ?? '',
      sleep: safe.sleep ?? '',
      stress: safe.stress ?? '',
      digestion: safe.digestion ?? '',
      trainingPerformance: safe.trainingPerformance ?? '',
      notes: typeof safe.notes === 'string' ? safe.notes : '',
      frontPhoto: safe.frontPhoto ?? '',
      sidePhoto: safe.sidePhoto ?? '',
      backPhoto: safe.backPhoto ?? ''
    };
  }

  function dayNameToIndex(dayName) {
    if (!dayName || typeof dayName !== 'string') return 0;
    const idx = DAY_NAMES.findIndex((name) => name.toLowerCase() === dayName.trim().toLowerCase());
    return idx >= 0 ? idx : 0;
  }

  function getNextCheckInDate(phaseState = {}) {
    const now = new Date();
    const currentDow = now.getDay();
    const targetDow = dayNameToIndex(phaseState.checkInDay || 'Sunday');
    let offset = (targetDow - currentDow + 7) % 7;
    if (offset === 0) offset = 7;
    const next = new Date(now);
    next.setDate(now.getDate() + offset);
    return next.toISOString().slice(0, 10);
  }

  function getWeeksOutLabel(date, showDate) {
    const checkInDate = toDate(date);
    const show = toDate(showDate);
    if (!checkInDate || !show) return null;
    const startOfCheckIn = Date.UTC(checkInDate.getUTCFullYear(), checkInDate.getUTCMonth(), checkInDate.getUTCDate());
    const startOfShow = Date.UTC(show.getUTCFullYear(), show.getUTCMonth(), show.getUTCDate());
    const daysOut = Math.round((startOfShow - startOfCheckIn) / 86400000);
    if (daysOut <= 0) return daysOut === 0 ? 'Show Day' : 'Post-Show';
    if (daysOut <= 7) return 'Peak Week';
    return `${Math.ceil(daysOut / 7)} Weeks Out`;
  }

  function getSeasonWeekLabel(date, startDate, modeLabel) {
    const checkInDate = toDate(date);
    const start = toDate(startDate);
    if (!checkInDate || !start) return `${modeLabel} Week 1`;
    const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const checkUtc = Date.UTC(checkInDate.getUTCFullYear(), checkInDate.getUTCMonth(), checkInDate.getUTCDate());
    const dayDiff = Math.floor((checkUtc - startUtc) / 86400000);
    const week = Math.max(1, Math.floor(dayDiff / 7) + 1);
    return `${modeLabel} Week ${week}`;
  }

  function getWeekLabelForCheckIn(checkIn, phaseState = {}) {
    const entryDate = checkIn?.date || new Date().toISOString().slice(0, 10);
    const rawPhase = typeof checkIn?.phase === 'string' && checkIn.phase.trim()
      ? checkIn.phase.trim().toLowerCase().replace(/\s+/g, '_')
      : String(phaseState.mode || 'improvement').toLowerCase();

    const prepHelpers = globalScope.prepModeApi;

    if (rawPhase === 'contest_prep' || rawPhase === 'peak_week' || rawPhase === 'show_day') {
      if (prepHelpers?.getPrepWeekLabel) {
        return prepHelpers.getPrepWeekLabel({ ...phaseState, referenceDate: entryDate });
      }
      const weeksOut = getWeeksOutLabel(entryDate, phaseState.showDate);
      if (weeksOut) return weeksOut;
    }

    if (rawPhase === 'post_show') {
      if (prepHelpers?.getPostShowLabel) {
        return prepHelpers.getPostShowLabel({ ...phaseState, referenceDate: entryDate });
      }
      return getSeasonWeekLabel(entryDate, phaseState.reverseDietStartDate || phaseState.showDate || phaseState.startDate, MODE_LABELS.post_show);
    }

    if (rawPhase === 'improvement' && prepHelpers?.getImprovementSeasonLabel) {
      return prepHelpers.getImprovementSeasonLabel({ ...phaseState, referenceDate: entryDate });
    }

    const phaseKey = MODE_LABELS[rawPhase] ? rawPhase : 'improvement';
    const label = MODE_LABELS[phaseKey];
    return getSeasonWeekLabel(entryDate, phaseState.startDate, label);
  }

  function loadCheckIns(userId) {
    const raw = getStorage().getItem(getStorageKey(userId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => normalizeCheckIn(entry))
        .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
    } catch (_error) {
      return [];
    }
  }

  function saveCheckIn(userId, checkIn, phaseState = {}) {
    const storage = getStorage();
    const existing = loadCheckIns(userId);
    const normalized = normalizeCheckIn(checkIn, phaseState);
    const deduped = existing.filter((entry) => entry.date !== normalized.date);
    const updated = [normalized, ...deduped].sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
    storage.setItem(getStorageKey(userId), JSON.stringify(updated));
    return updated;
  }

  const api = {
    saveCheckIn,
    loadCheckIns,
    getNextCheckInDate,
    getWeekLabelForCheckIn,
    getStorageKey
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.checkinEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
