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
    const normalizedDate = toIsoDate(safe.date);
    const normalizedPhase = typeof safe.phase === 'string' && safe.phase.trim()
      ? safe.phase.trim()
      : (phaseState.mode || 'improvement');
    const phaseWeekLabel = typeof safe.phaseWeekLabel === 'string' && safe.phaseWeekLabel.trim()
      ? safe.phaseWeekLabel.trim()
      : getWeekLabelForCheckIn({ ...safe, date: normalizedDate, phase: normalizedPhase }, phaseState);
    const weeksOutLabel = typeof safe.weeksOutLabel === 'string' && safe.weeksOutLabel.trim()
      ? safe.weeksOutLabel.trim()
      : (getWeeksOutLabel(normalizedDate, phaseState.showDate) || phaseWeekLabel);

    const energy = safe.energy ?? safe.recoveryRatings?.energy ?? '';
    const sleep = safe.sleep ?? safe.recoveryRatings?.sleep ?? '';
    const stress = safe.stress ?? safe.recoveryRatings?.stress ?? '';
    const priorAdjustments = safe.adjustments && typeof safe.adjustments === 'object' ? safe.adjustments : {};
    const priorReview = safe.review && typeof safe.review === 'object' ? safe.review : {};
    return {
      date: normalizedDate,
      phase: normalizedPhase,
      weekLabel: typeof safe.weekLabel === 'string' && safe.weekLabel.trim()
        ? safe.weekLabel.trim()
        : phaseWeekLabel,
      phaseWeekLabel,
      weeksOutLabel,
      bodyweight: safe.bodyweight ?? '',
      waist: safe.waist ?? '',
      energy,
      hunger: safe.hunger ?? '',
      sleep,
      stress,
      recoveryRatings: {
        energy,
        sleep,
        stress
      },
      digestion: safe.digestion ?? '',
      trainingPerformance: safe.trainingPerformance ?? '',
      notes: typeof safe.notes === 'string' ? safe.notes : '',
      coachNotes: typeof safe.coachNotes === 'string' ? safe.coachNotes : '',
      adjustments: {
        macrosChanged: Boolean(priorAdjustments.macrosChanged),
        macrosNotes: typeof priorAdjustments.macrosNotes === 'string' ? priorAdjustments.macrosNotes : '',
        cardioChanged: Boolean(priorAdjustments.cardioChanged),
        cardioNotes: typeof priorAdjustments.cardioNotes === 'string' ? priorAdjustments.cardioNotes : '',
        stepsChanged: Boolean(priorAdjustments.stepsChanged),
        stepsNotes: typeof priorAdjustments.stepsNotes === 'string' ? priorAdjustments.stepsNotes : '',
        refeedAdded: Boolean(priorAdjustments.refeedAdded),
        refeedNotes: typeof priorAdjustments.refeedNotes === 'string' ? priorAdjustments.refeedNotes : ''
      },
      review: {
        status: typeof priorReview.status === 'string' && priorReview.status.trim() ? priorReview.status.trim() : 'pending',
        coachActionItems: typeof priorReview.coachActionItems === 'string' ? priorReview.coachActionItems : '',
        athleteSubmittedAt: typeof priorReview.athleteSubmittedAt === 'string' ? priorReview.athleteSubmittedAt : '',
        coachReviewedAt: typeof priorReview.coachReviewedAt === 'string' ? priorReview.coachReviewedAt : ''
      },
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

  function loadCheckInState(userId) {
    return loadCheckIns(userId);
  }

  function groupCheckInsForTimeline(checkIns) {
    const source = Array.isArray(checkIns) ? checkIns : [];
    const groups = new Map();
    source.forEach((entry) => {
      const weeksOut = entry.weeksOutLabel || 'General Timeline';
      const phaseWeek = entry.phaseWeekLabel || entry.weekLabel || 'Unlabeled Phase Week';
      if (!groups.has(weeksOut)) groups.set(weeksOut, new Map());
      const phaseMap = groups.get(weeksOut);
      if (!phaseMap.has(phaseWeek)) phaseMap.set(phaseWeek, []);
      phaseMap.get(phaseWeek).push(entry);
    });

    return Array.from(groups.entries()).map(([weeksOutLabel, phaseWeeks]) => ({
      weeksOutLabel,
      phaseWeeks: Array.from(phaseWeeks.entries()).map(([phaseWeekLabel, entries]) => ({
        phaseWeekLabel,
        entries
      }))
    }));
  }

  function toUtcStart(dateValue) {
    const parsed = toDate(dateValue);
    if (!parsed) return null;
    return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  }

  function isoFromUtcMs(utcMs) {
    if (!Number.isFinite(utcMs)) return null;
    return new Date(utcMs).toISOString().slice(0, 10);
  }

  function addDaysToIsoDate(isoDate, days) {
    const utc = toUtcStart(isoDate);
    if (!Number.isFinite(utc)) return null;
    return isoFromUtcMs(utc + (days * 86400000));
  }

  function buildSeasonMilestones(phaseState = {}) {
    const showDate = phaseState.showDate ? toIsoDate(phaseState.showDate) : null;
    const prepStartDate = phaseState.prepStartDate || phaseState.startDate || null;
    const prepStart = prepStartDate ? toIsoDate(prepStartDate) : null;
    const entries = [
      { key: 'prep_start', label: 'Prep Start', date: prepStart, phase: 'contest_prep' },
      { key: 'weeks_out_16', label: '16 Weeks Out', date: addDaysToIsoDate(showDate, -112), phase: 'contest_prep' },
      { key: 'weeks_out_12', label: '12 Weeks Out', date: addDaysToIsoDate(showDate, -84), phase: 'contest_prep' },
      { key: 'weeks_out_8', label: '8 Weeks Out', date: addDaysToIsoDate(showDate, -56), phase: 'contest_prep' },
      { key: 'peak_week', label: 'Peak Week', date: addDaysToIsoDate(showDate, -7), phase: 'peak_week' },
      { key: 'show_day', label: 'Show Day', date: showDate, phase: 'show_day' },
      { key: 'post_show_week_1', label: 'Post-Show Week 1', date: addDaysToIsoDate(showDate, 7), phase: 'post_show' }
    ];

    return entries
      .filter((entry) => Boolean(entry.date))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function findClosestCheckInForMilestone(milestone, checkIns, maxDaysDelta = 7) {
    if (!milestone?.date || !Array.isArray(checkIns) || !checkIns.length) return null;
    const milestoneUtc = toUtcStart(milestone.date);
    if (!Number.isFinite(milestoneUtc)) return null;
    let winner = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    checkIns.forEach((entry) => {
      const entryUtc = toUtcStart(entry?.date);
      if (!Number.isFinite(entryUtc)) return;
      const dayDistance = Math.abs(Math.round((entryUtc - milestoneUtc) / 86400000));
      if (dayDistance < bestDistance) {
        bestDistance = dayDistance;
        winner = entry;
      }
    });

    if (bestDistance > maxDaysDelta) return null;
    return winner;
  }

  function getPhotoProgressHooks(checkIn = {}, milestoneKey = 'general') {
    return [
      { id: `${milestoneKey}_front`, view: 'front', value: checkIn.frontPhoto || '', hasPhoto: Boolean(checkIn.frontPhoto) },
      { id: `${milestoneKey}_side`, view: 'side', value: checkIn.sidePhoto || '', hasPhoto: Boolean(checkIn.sidePhoto) },
      { id: `${milestoneKey}_back`, view: 'back', value: checkIn.backPhoto || '', hasPhoto: Boolean(checkIn.backPhoto) }
    ];
  }

  function getComparisonPlaceholders() {
    return [
      { id: 'prep_start_vs_show_day', label: 'Prep Start vs Show Day', status: 'placeholder' },
      { id: 'weeks_out_16_vs_weeks_out_8', label: '16 Weeks Out vs 8 Weeks Out', status: 'placeholder' },
      { id: 'peak_week_vs_post_show_week_1', label: 'Peak Week vs Post-Show Week 1', status: 'placeholder' }
    ];
  }

  function buildSeasonArchive(phaseState = {}, checkIns = []) {
    const normalizedCheckIns = Array.isArray(checkIns)
      ? checkIns.map((entry) => normalizeCheckIn(entry, phaseState)).sort((a, b) => a.date.localeCompare(b.date))
      : [];
    const milestones = buildSeasonMilestones(phaseState);

    const timeline = milestones.map((milestone) => {
      const linkedCheckIn = findClosestCheckInForMilestone(milestone, normalizedCheckIns);
      return {
        ...milestone,
        linkedCheckInDate: linkedCheckIn?.date || null,
        linkedCheckInWeekLabel: linkedCheckIn?.weekLabel || linkedCheckIn?.phaseWeekLabel || null,
        hasLinkedCheckIn: Boolean(linkedCheckIn),
        photoHooks: getPhotoProgressHooks(linkedCheckIn || {}, milestone.key)
      };
    });

    return {
      timeline,
      comparisons: getComparisonPlaceholders(),
      hasAnyLinkedCheckIn: timeline.some((entry) => entry.hasLinkedCheckIn),
      totalMilestones: timeline.length
    };
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function getRollingAverage(values) {
    const valid = values.filter((value) => Number.isFinite(value));
    if (!valid.length) return null;
    const sum = valid.reduce((acc, value) => acc + value, 0);
    return sum / valid.length;
  }

  function formatSigned(value, decimals = 1) {
    if (!Number.isFinite(value)) return '0';
    const rounded = Number(value.toFixed(decimals));
    if (rounded > 0) return `+${rounded}`;
    return String(rounded);
  }

  function classifyTrend(delta, stableThreshold = 0.25) {
    if (!Number.isFinite(delta)) return 'unknown';
    if (delta > stableThreshold) return 'up';
    if (delta < -stableThreshold) return 'down';
    return 'steady';
  }

  function buildInsightSnapshot(entriesDesc, indexInDesc = 0) {
    const checkIns = Array.isArray(entriesDesc) ? entriesDesc : [];
    if (!checkIns.length || indexInDesc < 0 || indexInDesc >= checkIns.length) {
      return {
        summaryShort: 'No check-in insight yet.',
        summaryFull: [],
        insightMap: {}
      };
    }

    const current = checkIns[indexInDesc];
    const previous = checkIns[indexInDesc + 1] || null;
    const olderWindow = checkIns.slice(indexInDesc + 1, indexInDesc + 4);

    const currentWeight = toFiniteNumber(current?.bodyweight);
    const previousWeight = toFiniteNumber(previous?.bodyweight);
    const olderWeights = olderWindow.map(entry => toFiniteNumber(entry?.bodyweight));
    const rollingWeight = getRollingAverage(olderWeights);
    const deltaWeight = Number.isFinite(currentWeight) && Number.isFinite(previousWeight)
      ? currentWeight - previousWeight
      : null;
    const deltaVsRolling = Number.isFinite(currentWeight) && Number.isFinite(rollingWeight)
      ? currentWeight - rollingWeight
      : null;
    const rollingDeltaRate = Number.isFinite(previousWeight) && Number.isFinite(rollingWeight)
      ? previousWeight - rollingWeight
      : null;

    const weightTrendMessage = !Number.isFinite(deltaWeight)
      ? 'Weight trend needs at least two check-ins.'
      : deltaWeight <= -0.2
        ? `Weight trend is moving down (${formatSigned(deltaWeight)} vs last check-in).`
        : deltaWeight >= 0.2
          ? `Weight trend is moving up (${formatSigned(deltaWeight)} vs last check-in).`
          : 'Weight trend is on target and holding steady.';

    const rateMessage = !Number.isFinite(deltaWeight)
      ? 'Rate of loss/gain will appear after your next check-in.'
      : Math.abs(deltaWeight) < 0.15
        ? 'Weight loss has stalled this week.'
        : deltaWeight <= -0.25 && deltaWeight >= -1.25
          ? `Rate of loss is on target (${Math.abs(Number(deltaWeight.toFixed(2)))} per check-in).`
          : deltaWeight < -1.25
            ? `Rate of loss is aggressive (${Math.abs(Number(deltaWeight.toFixed(2)))} per check-in).`
            : `Rate of gain is ${Number(deltaWeight.toFixed(2))} per check-in.`;

    const recoveryNow = getRollingAverage([
      toFiniteNumber(current?.energy),
      toFiniteNumber(current?.sleep),
      (function () {
        const stress = toFiniteNumber(current?.stress);
        return Number.isFinite(stress) ? (11 - stress) : null;
      })()
    ]);
    const recoveryPrev = getRollingAverage(olderWindow.map((entry) => getRollingAverage([
      toFiniteNumber(entry?.energy),
      toFiniteNumber(entry?.sleep),
      (function () {
        const stress = toFiniteNumber(entry?.stress);
        return Number.isFinite(stress) ? (11 - stress) : null;
      })()
    ])));
    const recoveryDelta = Number.isFinite(recoveryNow) && Number.isFinite(recoveryPrev)
      ? recoveryNow - recoveryPrev
      : null;

    const recoveryMessage = !Number.isFinite(recoveryDelta)
      ? 'Recovery trend needs more check-ins.'
      : recoveryDelta <= -0.6
        ? `Recovery is slipping (${formatSigned(recoveryDelta, 2)} vs rolling trend).`
        : recoveryDelta >= 0.6
          ? `Recovery is improving (${formatSigned(recoveryDelta, 2)} vs rolling trend).`
          : 'Recovery is stable week to week.';

    const performanceCurrent = toFiniteNumber(current?.trainingPerformance);
    const performancePrevious = toFiniteNumber(previous?.trainingPerformance);
    const performanceRolling = getRollingAverage(olderWindow.map(entry => toFiniteNumber(entry?.trainingPerformance)));
    const performanceDelta = Number.isFinite(performanceCurrent) && Number.isFinite(performancePrevious)
      ? performanceCurrent - performancePrevious
      : null;
    const performanceVsRolling = Number.isFinite(performanceCurrent) && Number.isFinite(performanceRolling)
      ? performanceCurrent - performanceRolling
      : null;
    const performanceTrend = classifyTrend(Number.isFinite(performanceVsRolling) ? performanceVsRolling : performanceDelta, 0.4);
    const performanceMessage = performanceTrend === 'up'
      ? 'Performance trend is improving.'
      : performanceTrend === 'down'
        ? 'Performance trend is softening.'
        : performanceTrend === 'steady'
          ? 'Performance is holding steady.'
          : 'Performance trend needs more check-ins.';

    const hungerCurrent = toFiniteNumber(current?.hunger);
    const hungerWindow = checkIns.slice(indexInDesc, indexInDesc + 3).map(entry => toFiniteNumber(entry?.hunger));
    const hungerOldest = hungerWindow.length >= 3 ? hungerWindow[2] : null;
    const hungerTrend = Number.isFinite(hungerCurrent) && Number.isFinite(hungerOldest)
      ? hungerCurrent - hungerOldest
      : null;
    const hungerMessage = !Number.isFinite(hungerTrend)
      ? 'Hunger trend needs three check-ins.'
      : hungerTrend >= 1
        ? 'Hunger rising over the last 3 check-ins.'
        : hungerTrend <= -1
          ? 'Hunger easing over the last 3 check-ins.'
          : 'Hunger is stable over the last 3 check-ins.';

    const summary = [
      weightTrendMessage,
      rateMessage,
      recoveryMessage,
      performanceMessage,
      hungerMessage
    ];

    if (Number.isFinite(deltaVsRolling) && Number.isFinite(rollingDeltaRate) && Math.abs(deltaVsRolling) < 0.2 && Math.abs(rollingDeltaRate) < 0.2) {
      summary[0] = 'Weight trend is on target versus your rolling baseline.';
    }

    return {
      summaryShort: [summary[0], summary[2], summary[3]].join(' '),
      summaryFull: summary,
      insightMap: {
        weightTrend: summary[0],
        rateOfChange: summary[1],
        recoveryTrend: summary[2],
        performanceTrend: summary[3],
        hungerTrend: summary[4]
      }
    };
  }

  function getCheckInInsights(checkIns) {
    const source = Array.isArray(checkIns) ? checkIns.slice() : [];
    const sorted = source.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
    return buildInsightSnapshot(sorted, 0);
  }

  function getCheckInInsightTimeline(checkIns) {
    const source = Array.isArray(checkIns) ? checkIns.slice() : [];
    const sorted = source.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
    return sorted.map((entry, index) => ({
      ...entry,
      insights: buildInsightSnapshot(sorted, index)
    }));
  }

  function saveCheckIn(userId, checkIn, phaseState = {}) {
    const storage = getStorage();
    const existing = loadCheckIns(userId);
    const normalized = normalizeCheckIn(checkIn, phaseState);
    const deduped = existing.filter((entry) => entry.date !== normalized.date);
    const updated = [normalized, ...deduped].sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
    storage.setItem(getStorageKey(userId), JSON.stringify(updated));
    syncCheckInStateToBackend(resolveUserId(userId), updated);
    return updated;
  }

  function saveCheckInState(userId, state) {
    const normalized = Array.isArray(state) ? state.map((entry) => normalizeCheckIn(entry)) : [];
    const sorted = normalized.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
    getStorage().setItem(getStorageKey(userId), JSON.stringify(sorted));
    syncCheckInStateToBackend(resolveUserId(userId), sorted);
    return sorted;
  }

  function syncCheckInStateToBackend(userId, state) {
    const resolvedUser = resolveUserId(userId);
    try {
      // Future backend endpoint: PUT /api/bodybuilding/checkins/:userId
      // Keep check-ins working from local storage if network sync fails.
      if (typeof globalScope.fetch !== 'function') return false;
      return globalScope.fetch(`/api/bodybuilding/checkins/${encodeURIComponent(resolvedUser)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.isArray(state) ? state : [])
      }).then(() => true).catch(() => false);
    } catch (_error) {
      return false;
    }
  }

  const api = {
    saveCheckIn,
    loadCheckIns,
    saveCheckInState,
    loadCheckInState,
    syncCheckInStateToBackend,
    getNextCheckInDate,
    getWeekLabelForCheckIn,
    groupCheckInsForTimeline,
    buildSeasonMilestones,
    getPhotoProgressHooks,
    getComparisonPlaceholders,
    buildSeasonArchive,
    getCheckInInsights,
    getCheckInInsightTimeline,
    getStorageKey
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.checkinEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
