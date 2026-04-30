(function (globalScope) {
  const STORAGE_PREFIX = 'tl_gamification_v2_';
  const MAX_RECENT_EVENTS = 30;
  const MAX_TRACKED_IDS = 600;
  const DAILY_XP_CAP = 500;

  const XP_SOURCES = Object.freeze({
    completed_workout: 60,
    completed_cardio: 35,
    macros_complete: 25,
    bodyweight_logged: 15,
    checkin_submitted: 35,
    posing_complete: 20,
    pr_hit: 45,
    full_daily_compliance: 70,
    full_weekly_compliance: 220
  });

  const LEVEL_CURVE = Object.freeze({
    base: 120,
    growth: 1.2,
    flatPerLevel: 22
  });

  const BADGE_DEFINITIONS = Object.freeze({
    first_workout: {
      title: 'First Session Logged',
      description: 'Complete your first workout.',
      predicate: state => state.metrics.workoutsCompleted >= 1
    },
    first_full_compliance_day: {
      title: 'Complete Day',
      description: 'Hit full daily compliance once.',
      predicate: state => state.metrics.fullComplianceDays >= 1
    },
    seven_day_compliance_streak: {
      title: 'Seven-Day Discipline',
      description: 'Reach a 7-day adherence streak.',
      predicate: state => state.streak >= 7
    },
    ten_workouts: {
      title: 'Ten Sessions Deep',
      description: 'Log 10 completed workouts.',
      predicate: state => state.metrics.workoutsCompleted >= 10
    },
    first_checkin: {
      title: 'First Check-In',
      description: 'Submit your first check-in update.',
      predicate: state => state.metrics.checkinsSubmitted >= 1
    },
    single_digit_weeks_out: {
      title: 'Single-Digit Weeks Out',
      description: 'Log prep status in single-digit weeks out.',
      predicate: state => state.metrics.singleDigitWeeksOutUnlocked === true
    },
    perfect_week: {
      title: 'Perfect Week',
      description: 'Complete full weekly compliance.',
      predicate: state => state.metrics.perfectWeeks >= 1
    },
    posing_streak_builder: {
      title: 'Posing Technician',
      description: 'Log 7 posing sessions.',
      predicate: state => state.metrics.posingSessions >= 7
    },
    locked_in: {
      title: 'Locked In',
      description: 'Hold a 21-day streak.',
      predicate: state => state.streak >= 21
    }
  });

  function ensureArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getTodayIsoDate(dateLike) {
    const d = dateLike ? new Date(dateLike) : new Date();
    if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  function getWeekKey(dateLike) {
    const d = new Date(dateLike || Date.now());
    if (Number.isNaN(d.getTime())) return 'unknown';
    const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const dayOfYear = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - jan1.getTime()) / 86400000) + 1;
    const week = Math.ceil(dayOfYear / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  function getStorageKey(userId) {
    return `${STORAGE_PREFIX}${userId || 'guest'}`;
  }

  function xpNeededForLevel(level) {
    const safeLevel = Math.max(1, Number(level) || 1);
    return Math.round((LEVEL_CURVE.base * Math.pow(safeLevel, LEVEL_CURVE.growth)) + (safeLevel * LEVEL_CURVE.flatPerLevel));
  }

  function resolveLevelState(totalXp) {
    const xp = Math.max(0, Number(totalXp) || 0);
    let level = 1;
    let spent = 0;
    let next = xpNeededForLevel(level);

    while (xp >= spent + next && level < 500) {
      spent += next;
      level += 1;
      next = xpNeededForLevel(level);
    }

    return {
      level,
      currentLevelXp: xp - spent,
      nextLevelXp: next
    };
  }

  function defaultState(userId) {
    const levelState = resolveLevelState(0);
    return {
      userId: userId || 'guest',
      totalXp: 0,
      level: levelState.level,
      currentLevelXp: levelState.currentLevelXp,
      nextLevelXp: levelState.nextLevelXp,
      streak: 0,
      longestStreak: 0,
      badges: [],
      recentEvents: [],
      rewardedWorkoutIds: [],
      rewardedPrIds: [],
      rewardedActionIds: [],
      weeklyXp: { weekKey: getWeekKey(), amount: 0 },
      todaysXp: { dayKey: getTodayIsoDate(), amount: 0 },
      lastActiveDate: null,
      metrics: {
        workoutsCompleted: 0,
        cardioCompleted: 0,
        macrosCompleteDays: 0,
        bodyweightLogs: 0,
        checkinsSubmitted: 0,
        posingSessions: 0,
        posingMinutes: 0,
        prHits: 0,
        fullComplianceDays: 0,
        perfectWeeks: 0,
        singleDigitWeeksOutUnlocked: false,
        peakWeekUnlocked: false
      }
    };
  }

  function normalizeState(userId, rawState) {
    const seed = defaultState(userId);
    const merged = { ...seed, ...(rawState || {}) };
    merged.badges = ensureArray(merged.badges);
    merged.recentEvents = ensureArray(merged.recentEvents).slice(-MAX_RECENT_EVENTS);
    merged.rewardedWorkoutIds = ensureArray(merged.rewardedWorkoutIds).slice(-MAX_TRACKED_IDS);
    merged.rewardedPrIds = ensureArray(merged.rewardedPrIds).slice(-MAX_TRACKED_IDS);
    merged.rewardedActionIds = ensureArray(merged.rewardedActionIds).slice(-MAX_TRACKED_IDS);
    merged.metrics = { ...seed.metrics, ...((rawState && rawState.metrics) || {}) };

    if (!merged.weeklyXp || typeof merged.weeklyXp !== 'object') {
      merged.weeklyXp = { weekKey: getWeekKey(), amount: 0 };
    }
    if (!merged.todaysXp || typeof merged.todaysXp !== 'object') {
      merged.todaysXp = { dayKey: getTodayIsoDate(), amount: 0 };
    }

    const levelState = resolveLevelState(merged.totalXp);
    merged.level = levelState.level;
    merged.currentLevelXp = levelState.currentLevelXp;
    merged.nextLevelXp = levelState.nextLevelXp;
    return merged;
  }

  function getGamificationState(userId) {
    if (typeof localStorage === 'undefined') return defaultState(userId);
    try {
      const raw = localStorage.getItem(getStorageKey(userId));
      if (!raw) return defaultState(userId);
      return normalizeState(userId, JSON.parse(raw));
    } catch (err) {
      console.warn('Failed loading gamification state.', err);
      return defaultState(userId);
    }
  }

  function saveGamificationState(userId, state) {
    const normalized = normalizeState(userId, state);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(getStorageKey(userId), JSON.stringify(normalized));
      } catch (err) {
        console.warn('Failed persisting gamification state.', err);
      }
    }
    syncGamificationStateToBackend(userId, normalized);
    return normalized;
  }

  function syncGamificationStateToBackend(userId, state) {
    const resolvedUser = userId || 'guest';
    try {
      // Future backend endpoint: PUT /api/bodybuilding/gamification/:userId
      // Failures here should never block local progression updates.
      if (typeof globalScope.fetch !== 'function') return false;
      return globalScope.fetch(`/api/bodybuilding/gamification/${encodeURIComponent(resolvedUser)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state || defaultState(resolvedUser)),
        signal: AbortSignal.timeout(5000)
      }).then(() => true).catch(() => false);
    } catch (_error) {
      return false;
    }
  }

  function pushEvent(state, event) {
    state.recentEvents = [...ensureArray(state.recentEvents), {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      type: event.type || 'xp',
      message: event.message || 'Progress updated',
      xp: Number(event.xp) || 0,
      metadata: event.metadata || null
    }].slice(-MAX_RECENT_EVENTS);
  }

  function ensureCelebrationContainer() {
    if (typeof document === 'undefined') return null;
    let root = document.getElementById('gamificationCelebrationStack');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'gamificationCelebrationStack';
    root.style.position = 'fixed';
    root.style.right = '16px';
    root.style.bottom = '16px';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '8px';
    root.style.zIndex = '3000';
    root.style.maxWidth = '280px';
    document.body?.appendChild(root);
    return root;
  }

  function showCelebration(type, message) {
    if (typeof document === 'undefined' || !message) return;
    const root = ensureCelebrationContainer();
    if (!root) return;

    const palette = {
      badge: '#5b21b6',
      level_up: '#166534',
      pr_bonus: '#1d4ed8'
    };

    const card = document.createElement('div');
    card.textContent = message;
    card.style.background = palette[type] || '#334155';
    card.style.color = '#f8fafc';
    card.style.padding = '10px 12px';
    card.style.borderRadius = '10px';
    card.style.fontSize = '0.86rem';
    card.style.border = '1px solid rgba(255,255,255,0.15)';
    card.style.boxShadow = '0 8px 20px rgba(2,6,23,0.35)';
    card.style.opacity = '0';
    card.style.transform = 'translateY(6px)';
    card.style.transition = 'all 160ms ease';
    root.appendChild(card);

    requestAnimationFrame(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(6px)';
      setTimeout(() => card.remove(), 180);
    }, 2000);
  }

  function normalizeXpBuckets(state, dateLike) {
    const dayKey = getTodayIsoDate(dateLike);
    const weekKey = getWeekKey(dateLike);
    if (!state.todaysXp || state.todaysXp.dayKey !== dayKey) {
      state.todaysXp = { dayKey, amount: 0 };
    }
    if (!state.weeklyXp || state.weeklyXp.weekKey !== weekKey) {
      state.weeklyXp = { weekKey, amount: 0 };
    }
  }

  function evaluateLevelUp(state) {
    const prior = Number(state.level) || 1;
    const levelState = resolveLevelState(state.totalXp);
    state.level = levelState.level;
    state.currentLevelXp = levelState.currentLevelXp;
    state.nextLevelXp = levelState.nextLevelXp;

    if (state.level > prior) {
      for (let i = prior + 1; i <= state.level; i += 1) {
        pushEvent(state, { type: 'level_up', message: `Level up: ${i}`, xp: 0, metadata: { level: i } });
      }
      showCelebration('level_up', `Level ${state.level} reached`);
    }

    return state;
  }

  function updateStreak(state, dateLike) {
    const dayKey = getTodayIsoDate(dateLike);
    const previous = state.lastActiveDate ? getTodayIsoDate(state.lastActiveDate) : null;
    if (!previous) {
      state.streak = 1;
    } else {
      const diff = Math.round((new Date(dayKey).getTime() - new Date(previous).getTime()) / 86400000);
      if (diff === 1) state.streak += 1;
      else if (diff > 1) state.streak = 1;
    }
    state.lastActiveDate = dayKey;
    state.longestStreak = Math.max(Number(state.longestStreak) || 0, state.streak);
  }

  function evaluateBadges(state) {
    Object.entries(BADGE_DEFINITIONS).forEach(([key, definition]) => {
      if (state.badges.some(b => b.key === key)) return;
      if (!definition.predicate(state)) return;
      const badge = {
        key,
        title: definition.title,
        description: definition.description,
        unlockedAt: new Date().toISOString()
      };
      state.badges.push(badge);
      pushEvent(state, { type: 'badge', message: `Badge unlocked: ${definition.title}`, xp: 0, metadata: { badge: key } });
      showCelebration('badge', `${definition.title} unlocked`);
    });
    return state;
  }

  function baseAward(state, xpAmount, source, metadata) {
    const safeXp = Math.max(0, Number(xpAmount) || 0);
    if (!safeXp) return false;

    normalizeXpBuckets(state, metadata?.date);
    const availableToday = Math.max(0, DAILY_XP_CAP - (Number(state.todaysXp.amount) || 0));
    const awardedXp = Math.min(safeXp, availableToday);
    if (!awardedXp) return false;

    state.totalXp += awardedXp;
    state.todaysXp.amount += awardedXp;
    state.weeklyXp.amount += awardedXp;

    pushEvent(state, {
      type: 'xp',
      message: `+${awardedXp} XP • ${source}`,
      xp: awardedXp,
      metadata: metadata || null
    });

    return awardedXp === safeXp;
  }

  function awardXp(userId, source, metadata = {}) {
    const state = getGamificationState(userId);
    const sourceKey = String(source || '').toLowerCase();
    const xpValue = XP_SOURCES[sourceKey];
    if (!xpValue) return saveGamificationState(userId, state);

    if (sourceKey === 'completed_workout') {
      const rewardId = metadata.workoutId || `workout:${getTodayIsoDate(metadata.date)}:${metadata.name || 'session'}`;
      if (state.rewardedWorkoutIds.includes(rewardId)) return state;
      state.rewardedWorkoutIds.push(rewardId);
      state.rewardedWorkoutIds = state.rewardedWorkoutIds.slice(-MAX_TRACKED_IDS);
      state.metrics.workoutsCompleted += 1;
      updateStreak(state, metadata.date);
    }

    if (sourceKey === 'pr_hit') {
      const prId = metadata.prId || `pr:${metadata.workoutId || 'session'}:${metadata.exercise || 'lift'}:${metadata.value || Date.now()}`;
      if (state.rewardedPrIds.includes(prId)) return state;
      state.rewardedPrIds.push(prId);
      state.rewardedPrIds = state.rewardedPrIds.slice(-MAX_TRACKED_IDS);
      state.metrics.prHits += 1;
      showCelebration('pr_bonus', 'PR bonus awarded');
    }

    if (sourceKey !== 'completed_workout' && sourceKey !== 'pr_hit') {
      const rewardId = metadata.rewardId
        || (sourceKey === 'full_weekly_compliance'
          ? `${sourceKey}:${getWeekKey(metadata.date)}`
          : `${sourceKey}:${getTodayIsoDate(metadata.date)}`);
      if (state.rewardedActionIds.includes(rewardId)) return state;
      state.rewardedActionIds.push(rewardId);
      state.rewardedActionIds = state.rewardedActionIds.slice(-MAX_TRACKED_IDS);
    }

    if (sourceKey === 'completed_cardio') state.metrics.cardioCompleted += 1;
    if (sourceKey === 'macros_complete') state.metrics.macrosCompleteDays += 1;
    if (sourceKey === 'bodyweight_logged') state.metrics.bodyweightLogs += 1;
    if (sourceKey === 'checkin_submitted') state.metrics.checkinsSubmitted += 1;
    if (sourceKey === 'posing_complete') state.metrics.posingSessions += 1;
    if (sourceKey === 'posing_complete') state.metrics.posingMinutes += Math.max(0, Number(metadata.minutes) || 0);
    if (sourceKey === 'full_daily_compliance') {
      state.metrics.fullComplianceDays += 1;
      updateStreak(state, metadata.date);
    }
    if (sourceKey === 'full_weekly_compliance') state.metrics.perfectWeeks += 1;
    if (metadata.weeksOut != null && Number(metadata.weeksOut) <= 9) state.metrics.singleDigitWeeksOutUnlocked = true;
    if (metadata.peakWeek === true) state.metrics.peakWeekUnlocked = true;

    baseAward(state, xpValue, sourceKey.replaceAll('_', ' '), metadata);
    evaluateLevelUp(state);
    evaluateBadges(state);

    const saved = saveGamificationState(userId, state);
    renderGamificationUI(userId, saved);
    return saved;
  }

  function getGamificationSummary(userId, providedState) {
    const state = providedState || getGamificationState(userId);
    const latestBadge = state.badges[state.badges.length - 1] || null;
    const progressPercent = state.nextLevelXp > 0
      ? Math.min(100, Math.round((state.currentLevelXp / state.nextLevelXp) * 100))
      : 0;

    return {
      level: state.level,
      totalXp: state.totalXp,
      streak: state.streak,
      longestStreak: state.longestStreak,
      badges: state.badges,
      latestBadge,
      recentEvents: state.recentEvents,
      rewardedWorkoutIds: state.rewardedWorkoutIds,
      rewardedPrIds: state.rewardedPrIds,
      rewardedActionIds: state.rewardedActionIds,
      weeklyXp: state.weeklyXp,
      todaysXp: state.todaysXp,
      currentLevelXp: state.currentLevelXp,
      nextLevelXp: state.nextLevelXp,
      progressPercent,
      metrics: state.metrics
    };
  }

  function renderGamificationSummary(summary) {
    const latestBadge = summary.latestBadge ? summary.latestBadge.title : '—';
    return `
      <div class="gamification-card gamification-card--compact">
        <div class="gamification-card-head">
          <span class="gamification-label">Level</span>
          <strong class="gamification-level">${summary.level}</strong>
        </div>
        <div class="gamification-xp-track" role="progressbar" aria-valuemin="0" aria-valuemax="${summary.nextLevelXp}" aria-valuenow="${summary.currentLevelXp}">
          <div class="gamification-xp-fill" style="width:${summary.progressPercent}%;"></div>
        </div>
        <div class="gamification-muted-row">${summary.currentLevelXp} / ${summary.nextLevelXp} XP</div>
        <div class="gamification-meta-row">
          <span>Streak: <strong>${summary.streak}</strong></span>
          <span>Today: <strong>${summary.todaysXp?.amount || 0} XP</strong></span>
        </div>
        <div class="gamification-meta-row">
          <span>Week: <strong>${summary.weeklyXp?.amount || 0} XP</strong></span>
          <span>Latest badge: <strong>${latestBadge}</strong></span>
        </div>
      </div>
    `;
  }

  function renderGamificationEvents(summary) {
    const events = ensureArray(summary.recentEvents).slice().reverse().slice(0, 8);
    if (!events.length) return '<p class="gamification-empty">No events yet.</p>';
    return events.map(evt => `
      <div class="gamification-event-item">
        <span>${evt.message}</span>
        <small>${evt.createdAt ? new Date(evt.createdAt).toLocaleString() : ''}</small>
      </div>
    `).join('');
  }

  function renderBadgeGallery(state) {
    const badges = ensureArray(state.badges);
    if (!badges.length) return '<p class="gamification-empty">No badges unlocked yet.</p>';
    return badges.slice().reverse().map(badge => `<div class="gamification-badge-pill" title="${badge.description || ''}">${badge.title}</div>`).join('');
  }

  function renderGamificationUI(userId, optionalState) {
    if (typeof document === 'undefined') return;
    const state = optionalState || getGamificationState(userId);
    const summary = getGamificationSummary(userId, state);

    const cardEl = document.getElementById('gamificationCard');
    if (cardEl) cardEl.innerHTML = renderGamificationSummary(summary);

    const progressCardEl = document.getElementById('progressGamificationCard');
    if (progressCardEl) progressCardEl.innerHTML = renderGamificationSummary(summary);

    const galleryEl = document.getElementById('gamificationBadgeGallery');
    if (galleryEl) galleryEl.innerHTML = renderBadgeGallery(state);

    const eventsEl = document.getElementById('gamificationEventsFeed');
    if (eventsEl) eventsEl.innerHTML = renderGamificationEvents(summary);
  }

  function evaluateWorkoutAchievements(userId, workout) {
    const date = workout?.date;
    const state = awardXp(userId, 'completed_workout', {
      date,
      workoutId: workout?.id,
      name: workout?.name || workout?.title
    });
    return state;
  }

  function evaluatePRAchievements(userId, workout) {
    const prEvents = ensureArray(workout?.prEvents);
    let state = getGamificationState(userId);
    prEvents.forEach((event, index) => {
      state = awardXp(userId, 'pr_hit', {
        date: workout?.date,
        workoutId: workout?.id,
        exercise: String(event || 'lift'),
        prId: `pr:${workout?.id || getTodayIsoDate(workout?.date)}:${index}:${event}`
      });
    });
    return state;
  }

  const api = {
    XP_SOURCES,
    BADGE_DEFINITIONS,
    getGamificationState,
    saveGamificationState,
    awardXp,
    evaluateLevelUp,
    evaluateBadges,
    resolveLevelState,
    xpNeededForLevel,
    evaluateWorkoutAchievements,
    evaluatePRAchievements,
    getGamificationSummary,
    renderGamificationSummary,
    renderGamificationEvents,
    renderBadgeGallery,
    renderGamificationUI,
    // compatibility aliases
    renderGamificationCard: renderGamificationSummary,
    loadGamificationState: getGamificationState,
    syncGamificationStateToBackend,
    persistGamificationState: saveGamificationState,
    loadGamification: getGamificationState,
    saveGamification: saveGamificationState,
    updateGamification: function updateGamification(userId, workouts) {
      let latest = getGamificationState(userId);
      ensureArray(workouts).forEach(workout => {
        latest = evaluateWorkoutAchievements(userId, workout);
      });
      return latest;
    }
  };

  if (typeof module !== 'undefined') module.exports = api;
  Object.assign(globalScope, api);
})(typeof window !== 'undefined' ? window : globalThis);
