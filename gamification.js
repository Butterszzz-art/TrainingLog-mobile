(function (globalScope) {
  const STORAGE_PREFIX = 'tl_gamification_v1_';
  const MAX_RECENT_EVENTS = 30;
  const MAX_TRACKED_IDS = 600;

  const XP_RULES = Object.freeze({
    WORKOUT_COMPLETE: 40,
    EXERCISE_COMPLETE: 10,
    SET_COMPLETE: 2,
    PR_HIT: 25,
    STREAK_BONUS_3: 15,
    STREAK_BONUS_7: 30,
    STREAK_BONUS_30: 100
  });

  const LEVEL_FORMULA = Object.freeze({
    BASE: 100,
    EXPONENT: 1.25
  });

  const BADGE_REGISTRY = Object.freeze({
    first_workout: {
      title: 'First Workout',
      description: 'Finish your first resistance workout.',
      icon: '🎯',
      xp: 50,
      metric: 'total_workouts_completed',
      target: 1,
      unit: 'workouts'
    },
    ten_workouts: {
      title: '10 Workouts',
      description: 'Complete 10 resistance sessions.',
      icon: '🔟',
      xp: 75,
      metric: 'total_workouts_completed',
      target: 10,
      unit: 'workouts'
    },
    fifty_workouts: {
      title: '50 Workouts',
      description: 'Complete 50 resistance sessions.',
      icon: '💯',
      xp: 150,
      metric: 'total_workouts_completed',
      target: 50,
      unit: 'workouts'
    },
    first_pr_badge: {
      title: 'First PR',
      description: 'Hit your first personal record.',
      icon: '🏆',
      xp: 0,
      metric: 'pr_count',
      target: 1,
      unit: 'PRs'
    },
    pr_machine: {
      title: 'PR Machine',
      description: 'Set 10 personal records.',
      icon: '🚀',
      xp: 0,
      metric: 'pr_count',
      target: 10,
      unit: 'PRs'
    },
    set_grinder: {
      title: 'Set Grinder',
      description: 'Complete 250 total sets.',
      icon: '🧱',
      xp: 0,
      metric: 'total_sets_completed',
      target: 250,
      unit: 'sets'
    },
    squat_specialist: {
      title: 'Squat Specialist',
      description: 'Log 10 squat sessions.',
      icon: '🦵',
      xp: 0,
      metric: 'exercise_specific_milestone',
      exerciseKey: 'squat',
      target: 10,
      unit: 'squat sessions'
    },
    bench_specialist: {
      title: 'Bench Specialist',
      description: 'Log 10 bench sessions.',
      icon: '💪',
      xp: 0,
      metric: 'exercise_specific_milestone',
      exerciseKey: 'bench',
      target: 10,
      unit: 'bench sessions'
    },
    deadlift_specialist: {
      title: 'Deadlift Specialist',
      description: 'Log 10 deadlift sessions.',
      icon: '🏋️',
      xp: 0,
      metric: 'exercise_specific_milestone',
      exerciseKey: 'deadlift',
      target: 10,
      unit: 'deadlift sessions'
    },
    streak_7: {
      title: '7-Day Streak',
      description: 'Reach a 7-day training streak.',
      icon: '🔥',
      xp: 0,
      metric: 'streak_length',
      target: 7,
      unit: 'days'
    },
    streak_30: {
      title: '30-Day Streak',
      description: 'Reach a 30-day training streak.',
      icon: '📅',
      xp: 0,
      metric: 'streak_length',
      target: 30,
      unit: 'days'
    }
  });

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

  function ensureArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getXpNeededForNextLevel(level) {
    const safeLevel = Math.max(1, Number(level) || 1);
    return Math.round(LEVEL_FORMULA.BASE * Math.pow(safeLevel, LEVEL_FORMULA.EXPONENT));
  }

  function getLevelForXp(totalXp) {
    const xp = Math.max(0, Number(totalXp) || 0);
    let level = 1;
    let requiredToNext = getXpNeededForNextLevel(level);
    let consumed = 0;

    while (xp >= consumed + requiredToNext) {
      consumed += requiredToNext;
      level += 1;
      requiredToNext = getXpNeededForNextLevel(level);
      if (level > 500) break;
    }

    return {
      level,
      currentLevelXp: Math.max(0, xp - consumed),
      nextLevelXp: requiredToNext
    };
  }

  function defaultState(userId) {
    const levelState = getLevelForXp(0);
    return {
      userId: userId || 'guest',
      totalXp: 0,
      level: levelState.level,
      currentLevelXp: levelState.currentLevelXp,
      nextLevelXp: levelState.nextLevelXp,
      streak: 0,
      longestStreak: 0,
      badges: [],
      unlockedAchievements: [],
      recentEvents: [],
      weeklyXp: { weekKey: getWeekKey(), amount: 0 },
      todayXp: { dayKey: getTodayIsoDate(), amount: 0 },
      lastWorkoutDate: null,
      completedWorkoutCount: 0,
      totalSetsCompleted: 0,
      totalExercisesCompleted: 0,
      totalPRs: 0,
      exerciseCounts: {},
      rewardedWorkoutIds: [],
      rewardedPREventIds: [],
      rewardedStreakMilestones: []
    };
  }

  function normalizeState(userId, rawState) {
    const seed = defaultState(userId);
    const merged = { ...seed, ...(rawState || {}) };
    merged.badges = ensureArray(merged.badges);
    merged.unlockedAchievements = ensureArray(merged.unlockedAchievements);
    merged.recentEvents = ensureArray(merged.recentEvents).slice(-MAX_RECENT_EVENTS);
    merged.rewardedWorkoutIds = ensureArray(merged.rewardedWorkoutIds).slice(-MAX_TRACKED_IDS);
    merged.rewardedPREventIds = ensureArray(merged.rewardedPREventIds).slice(-MAX_TRACKED_IDS);
    merged.rewardedStreakMilestones = ensureArray(merged.rewardedStreakMilestones);
    merged.exerciseCounts = typeof merged.exerciseCounts === 'object' && merged.exerciseCounts ? merged.exerciseCounts : {};

    if (!merged.weeklyXp || typeof merged.weeklyXp !== 'object') {
      merged.weeklyXp = { weekKey: getWeekKey(), amount: 0 };
    }
    if (!merged.todayXp || typeof merged.todayXp !== 'object') {
      merged.todayXp = { dayKey: getTodayIsoDate(), amount: 0 };
    }

    const levelState = getLevelForXp(merged.totalXp);
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
      console.warn('Failed to load gamification state; using defaults.', err);
      return defaultState(userId);
    }
  }

  function saveGamificationState(userId, state) {
    if (typeof localStorage === 'undefined') return normalizeState(userId, state);
    const normalized = normalizeState(userId, state);
    try {
      localStorage.setItem(getStorageKey(userId), JSON.stringify(normalized));
    } catch (err) {
      console.warn('Failed to persist gamification state.', err);
    }
    return normalized;
  }

  function pushRecentEvent(state, event) {
    const newEvent = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: event.type || 'xp',
      message: event.message || 'Progress updated',
      xp: Number(event.xp) || 0,
      createdAt: new Date().toISOString(),
      metadata: event.metadata || null
    };
    state.recentEvents = [...ensureArray(state.recentEvents), newEvent].slice(-MAX_RECENT_EVENTS);
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
    if (!message || typeof document === 'undefined') return;
    const root = ensureCelebrationContainer();
    if (!root) return;

    const card = document.createElement('div');
    card.className = 'gamification-celebration-item';
    const palette = {
      xp: '#1d4ed8',
      badge: '#7c3aed',
      level_up: '#16a34a'
    };

    card.textContent = message;
    card.style.background = palette[type] || '#334155';
    card.style.color = '#fff';
    card.style.padding = '10px 12px';
    card.style.borderRadius = '10px';
    card.style.fontSize = '0.88rem';
    card.style.boxShadow = '0 6px 18px rgba(15,23,42,0.3)';
    card.style.opacity = '0';
    card.style.transform = 'translateY(8px)';
    card.style.transition = 'all 150ms ease';
    root.appendChild(card);

    requestAnimationFrame(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(6px)';
      setTimeout(() => card.remove(), 180);
    }, 2200);
  }

  function normalizeXpBuckets(state, dateLike) {
    const dayKey = getTodayIsoDate(dateLike);
    const weekKey = getWeekKey(dateLike);

    if (!state.todayXp || state.todayXp.dayKey !== dayKey) {
      state.todayXp = { dayKey, amount: 0 };
    }
    if (!state.weeklyXp || state.weeklyXp.weekKey !== weekKey) {
      state.weeklyXp = { weekKey, amount: 0 };
    }
  }

  function addXp(state, amount, reason, metadata) {
    const safeAmount = Math.max(0, Number(amount) || 0);
    if (!safeAmount) return;

    normalizeXpBuckets(state, metadata?.date);
    state.totalXp += safeAmount;
    state.todayXp.amount += safeAmount;
    state.weeklyXp.amount += safeAmount;

    pushRecentEvent(state, {
      type: 'xp',
      message: `+${safeAmount} XP ${reason || 'Progress'}`,
      xp: safeAmount,
      metadata: metadata || null
    });

    showCelebration('xp', `+${safeAmount} XP • ${reason || 'Progress'}`);
  }

  function evaluateLevelUp(state) {
    const previousLevel = Number(state.level) || 1;
    const levelState = getLevelForXp(state.totalXp);
    state.level = levelState.level;
    state.currentLevelXp = levelState.currentLevelXp;
    state.nextLevelXp = levelState.nextLevelXp;

    if (state.level > previousLevel) {
      for (let next = previousLevel + 1; next <= state.level; next += 1) {
        pushRecentEvent(state, {
          type: 'level_up',
          message: `Level Up: Level ${next}`,
          xp: 0,
          metadata: { level: next }
        });
        showCelebration('level_up', `🎉 Level ${next} unlocked`);
      }
    }

    return state;
  }

  function awardXp(userId, amount, reason, metadata) {
    const state = getGamificationState(userId);
    addXp(state, amount, reason, metadata);
    evaluateLevelUp(state);
    const saved = saveGamificationState(userId, state);
    renderGamificationUI(userId, saved);
    return saved;
  }

  function unlockAchievement(state, key) {
    const badge = BADGE_REGISTRY[key];
    if (!badge) return false;
    if (state.unlockedAchievements.includes(key)) return false;

    state.unlockedAchievements.push(key);
    state.badges.push({
      key,
      title: badge.title,
      description: badge.description,
      icon: badge.icon,
      unlockedAt: new Date().toISOString()
    });

    pushRecentEvent(state, {
      type: 'badge',
      message: `Badge Unlocked: ${badge.title}`,
      xp: badge.xp,
      metadata: { badge: key }
    });

    showCelebration('badge', `${badge.icon} ${badge.title} unlocked`);
    if (badge.xp > 0) addXp(state, badge.xp, `${badge.title} badge`);
    return true;
  }

  function getWorkoutRewardId(workout) {
    const idPart = workout?.id || '';
    if (idPart) return `w:${idPart}`;

    const date = getTodayIsoDate(workout?.date);
    const title = workout?.title || workout?.name || 'workout';
    const exerciseSignature = ensureArray(workout?.exercises)
      .map(ex => `${ex?.name || 'Exercise'}:${ensureArray(ex?.repsArray).length}`)
      .join('|');
    return `w:${date}:${title}:${exerciseSignature}`;
  }

  function countWorkoutStats(workout) {
    const exercises = ensureArray(workout?.exercises);
    let exercisesCompleted = 0;
    let setsCompleted = 0;

    exercises.forEach(ex => {
      const reps = ensureArray(ex?.repsArray);
      const weights = ensureArray(ex?.weightsArray);
      const size = Math.max(reps.length, weights.length);
      let exerciseHasCompletedSet = false;

      for (let i = 0; i < size; i += 1) {
        const rep = Number(reps[i]);
        const weight = Number(weights[i]);
        if (!Number.isFinite(rep) || !Number.isFinite(weight) || rep <= 0 || weight <= 0) continue;
        setsCompleted += 1;
        exerciseHasCompletedSet = true;
      }

      if (exerciseHasCompletedSet) exercisesCompleted += 1;
    });

    return { exercisesCompleted, setsCompleted };
  }

  function evaluateTotalWorkoutsCompleted(state, badge) {
    const current = Number(state.completedWorkoutCount) || 0;
    const target = Number(badge?.target) || 0;
    return { current, target, remaining: Math.max(0, target - current), unit: badge?.unit || 'workouts' };
  }

  function evaluateStreakLength(state, badge) {
    const current = Number(state.streak) || 0;
    const target = Number(badge?.target) || 0;
    return { current, target, remaining: Math.max(0, target - current), unit: badge?.unit || 'days' };
  }

  function evaluatePRCount(state, badge) {
    const current = Number(state.totalPRs) || 0;
    const target = Number(badge?.target) || 0;
    return { current, target, remaining: Math.max(0, target - current), unit: badge?.unit || 'PRs' };
  }

  function evaluateTotalSetsCompleted(state, badge) {
    const current = Number(state.totalSetsCompleted) || 0;
    const target = Number(badge?.target) || 0;
    return { current, target, remaining: Math.max(0, target - current), unit: badge?.unit || 'sets' };
  }

  function evaluateExerciseSpecificMilestones(state, badge) {
    const key = String(badge?.exerciseKey || '').toLowerCase();
    const current = Number(state.exerciseCounts?.[key]) || 0;
    const target = Number(badge?.target) || 0;
    return { current, target, remaining: Math.max(0, target - current), unit: badge?.unit || 'sessions' };
  }

  const ACHIEVEMENT_EVALUATORS = Object.freeze({
    total_workouts_completed: evaluateTotalWorkoutsCompleted,
    streak_length: evaluateStreakLength,
    pr_count: evaluatePRCount,
    total_sets_completed: evaluateTotalSetsCompleted,
    exercise_specific_milestone: evaluateExerciseSpecificMilestones
  });

  function evaluateAchievementProgress(state, badge) {
    const evaluator = ACHIEVEMENT_EVALUATORS[badge?.metric];
    if (typeof evaluator !== 'function') {
      return { current: 0, target: Number(badge?.target) || 0, remaining: Number(badge?.target) || 0, unit: badge?.unit || 'items' };
    }
    return evaluator(state, badge);
  }

  function evaluateBadgeUnlocks(state) {
    Object.entries(BADGE_REGISTRY).forEach(([key, badge]) => {
      if (state.unlockedAchievements.includes(key)) return;
      const progress = evaluateAchievementProgress(state, badge);
      if (progress.current >= progress.target && progress.target > 0) {
        unlockAchievement(state, key);
      }
    });
  }

  function evaluateStreakBonuses(state, dayKey) {
    const streakBonuses = [
      { threshold: 3, xp: XP_RULES.STREAK_BONUS_3 },
      { threshold: 7, xp: XP_RULES.STREAK_BONUS_7 },
      { threshold: 30, xp: XP_RULES.STREAK_BONUS_30 }
    ];

    streakBonuses.forEach(({ threshold, xp }) => {
      const rewardKey = `${dayKey}:${threshold}`;
      if ((Number(state.streak) || 0) < threshold) return;
      if (state.rewardedStreakMilestones.includes(rewardKey)) return;
      state.rewardedStreakMilestones.push(rewardKey);
      addXp(state, xp, `${threshold}-day streak bonus`, { streak: state.streak, date: dayKey });
    });

    state.rewardedStreakMilestones = ensureArray(state.rewardedStreakMilestones).slice(-MAX_TRACKED_IDS);
  }

  function updateWorkoutStreak(userId, workoutDate, stateOverride) {
    const state = stateOverride || getGamificationState(userId);
    const currentDay = getTodayIsoDate(workoutDate);
    const previousDay = state.lastWorkoutDate ? getTodayIsoDate(state.lastWorkoutDate) : null;

    if (!previousDay) {
      state.streak = 1;
    } else {
      const diffDays = Math.round((new Date(currentDay).getTime() - new Date(previousDay).getTime()) / 86400000);
      if (diffDays <= 0) {
        // Same day/older updates do not alter streak.
      } else if (diffDays === 1) {
        state.streak += 1;
      } else {
        state.streak = 1;
      }
    }

    state.lastWorkoutDate = currentDay;
    state.longestStreak = Math.max(Number(state.longestStreak) || 0, state.streak);

    evaluateStreakBonuses(state, currentDay);
    evaluateBadgeUnlocks(state);
    evaluateLevelUp(state);

    if (!stateOverride) {
      const saved = saveGamificationState(userId, state);
      renderGamificationUI(userId, saved);
      return saved;
    }

    return state;
  }

  function evaluateWorkoutAchievements(userId, workout) {
    const state = getGamificationState(userId);
    const rewardId = getWorkoutRewardId(workout);
    if (state.rewardedWorkoutIds.includes(rewardId)) return state;

    const stats = countWorkoutStats(workout);
    if (!stats.setsCompleted || !stats.exercisesCompleted) return state;

    state.rewardedWorkoutIds.push(rewardId);
    state.rewardedWorkoutIds = state.rewardedWorkoutIds.slice(-MAX_TRACKED_IDS);

    state.completedWorkoutCount += 1;
    state.totalSetsCompleted += stats.setsCompleted;
    state.totalExercisesCompleted += stats.exercisesCompleted;

    addXp(state, XP_RULES.WORKOUT_COMPLETE, 'Workout Complete', { workoutId: workout?.id || null, date: workout?.date });
    addXp(state, stats.exercisesCompleted * XP_RULES.EXERCISE_COMPLETE, 'Exercises Complete', { date: workout?.date });
    addXp(state, stats.setsCompleted * XP_RULES.SET_COMPLETE, 'Sets Complete', { date: workout?.date });

    const names = ensureArray(workout?.exercises).map(ex => String(ex?.name || '').toLowerCase());
    names.forEach(name => {
      if (!name) return;
      if (name.includes('squat')) state.exerciseCounts.squat = (state.exerciseCounts.squat || 0) + 1;
      if (name.includes('bench')) state.exerciseCounts.bench = (state.exerciseCounts.bench || 0) + 1;
      if (name.includes('deadlift')) state.exerciseCounts.deadlift = (state.exerciseCounts.deadlift || 0) + 1;
    });

    updateWorkoutStreak(userId, workout?.date, state);
    evaluateBadgeUnlocks(state);
    evaluateLevelUp(state);

    const saved = saveGamificationState(userId, state);
    renderGamificationUI(userId, saved);
    return saved;
  }

  function evaluatePRAchievements(userId, workout) {
    const state = getGamificationState(userId);
    const prEvents = ensureArray(workout?.prEvents);
    if (!prEvents.length) return state;

    let newPrCount = 0;
    prEvents.forEach(event => {
      const rewardId = `pr:${workout?.id || getTodayIsoDate(workout?.date)}:${event}`;
      if (state.rewardedPREventIds.includes(rewardId)) return;
      state.rewardedPREventIds.push(rewardId);
      newPrCount += 1;

      pushRecentEvent(state, {
        type: 'pr',
        message: `New PR: ${event}`,
        xp: XP_RULES.PR_HIT,
        metadata: { workoutId: workout?.id || null, event }
      });
    });

    if (!newPrCount) return state;

    state.rewardedPREventIds = state.rewardedPREventIds.slice(-MAX_TRACKED_IDS);
    state.totalPRs += newPrCount;
    addXp(state, newPrCount * XP_RULES.PR_HIT, `PR x${newPrCount}`, { date: workout?.date });

    evaluateBadgeUnlocks(state);
    evaluateLevelUp(state);
    const saved = saveGamificationState(userId, state);
    renderGamificationUI(userId, saved);
    return saved;
  }

  function getNextRewardHint(state) {
    const candidates = Object.entries(BADGE_REGISTRY)
      .filter(([key]) => !state.unlockedAchievements.includes(key))
      .map(([key, badge]) => {
        const progress = evaluateAchievementProgress(state, badge);
        return {
          key,
          badge,
          ...progress,
          ratio: progress.target > 0 ? progress.current / progress.target : 0
        };
      })
      .filter(entry => entry.target > 0 && entry.remaining > 0)
      .sort((a, b) => {
        if (a.remaining !== b.remaining) return a.remaining - b.remaining;
        return b.ratio - a.ratio;
      });

    const next = candidates[0] || null;
    if (!next) {
      return {
        text: 'All defined badges unlocked. New content coming soon.',
        badge: null,
        remaining: 0
      };
    }

    return {
      badge: next.badge,
      remaining: next.remaining,
      text: `${next.badge.icon} ${next.badge.title} in ${next.remaining} ${next.unit}`
    };
  }

  function getGamificationSummary(userId, providedState) {
    const state = providedState || getGamificationState(userId);
    const latestBadge = ensureArray(state.badges).slice(-1)[0] || null;
    const progressPercent = state.nextLevelXp > 0
      ? Math.min(100, Math.round((state.currentLevelXp / state.nextLevelXp) * 100))
      : 0;

    return {
      level: state.level,
      totalXp: state.totalXp,
      currentLevelXp: state.currentLevelXp,
      nextLevelXp: state.nextLevelXp,
      progressPercent,
      streak: state.streak,
      longestStreak: state.longestStreak,
      latestBadge,
      badges: state.badges,
      recentEvents: state.recentEvents,
      weeklyXp: state.weeklyXp,
      todayXp: state.todayXp,
      completedWorkoutCount: state.completedWorkoutCount,
      totalPRs: state.totalPRs,
      totalSetsCompleted: state.totalSetsCompleted,
      unlockedAchievements: state.unlockedAchievements,
      nextRewardHint: getNextRewardHint(state)
    };
  }

  function renderGamificationCard(summary, options = {}) {
    const title = options.title || 'Player Progress';
    const compact = Boolean(options.compact);
    const latestBadge = summary.latestBadge
      ? `${summary.latestBadge.icon} ${summary.latestBadge.title}`
      : 'No badge yet';

    return `
      <div class="gamification-card">
        <h3 class="gamification-card-title">${title}</h3>
        <p class="gamification-level-row">Level <strong>${summary.level}</strong> · ${summary.totalXp} XP total</p>
        <div class="gamification-xp-track">
          <div class="gamification-xp-fill" style="width:${summary.progressPercent}%;"></div>
        </div>
        <div class="gamification-xp-label">${summary.currentLevelXp}/${summary.nextLevelXp} XP to next level</div>
        <div class="gamification-stat-grid">
          <div class="gamification-stat-chip"><span>🔥</span><strong>${summary.streak}</strong><small>Current streak</small></div>
          <div class="gamification-stat-chip"><span>🏅</span><strong>${ensureArray(summary.badges).length}</strong><small>Badges unlocked</small></div>
          <div class="gamification-stat-chip"><span>⚡</span><strong>${summary.todayXp?.amount || 0}</strong><small>XP today</small></div>
          <div class="gamification-stat-chip"><span>📅</span><strong>${summary.weeklyXp?.amount || 0}</strong><small>XP this week</small></div>
        </div>
        ${compact ? '' : `<p class="gamification-hint-row">Latest badge: <strong>${latestBadge}</strong></p>`}
      </div>
    `;
  }

  function renderBadgeGallery(state) {
    const badges = ensureArray(state.badges);
    if (!badges.length) {
      return '<p class="gamification-empty">No badges unlocked yet. Finish a workout to begin.</p>';
    }

    return badges
      .slice()
      .reverse()
      .map(badge => `<div class="gamification-badge-pill" title="${badge.description || ''}">${badge.icon || '🏅'} ${badge.title || 'Badge'}</div>`)
      .join('');
  }

  function renderGamificationEvents(summary) {
    const events = ensureArray(summary.recentEvents);
    if (!events.length) {
      return '<p class="gamification-empty">No recent events yet.</p>';
    }

    return events
      .slice()
      .reverse()
      .slice(0, 8)
      .map(evt => `<div class="gamification-event-item"><span>${evt?.message || 'Progress updated'}</span><small>${evt?.createdAt ? new Date(evt.createdAt).toLocaleDateString() : ''}</small></div>`)
      .join('');
  }

  function renderGamificationUI(userId, optionalState) {
    if (typeof document === 'undefined') return;
    const state = optionalState || getGamificationState(userId);
    const summary = getGamificationSummary(userId, state);

    const cardEl = document.getElementById('gamificationCard');
    if (cardEl) cardEl.innerHTML = renderGamificationCard(summary, { title: '🎮 Player Progress' });

    const progressCardEl = document.getElementById('progressGamificationCard');
    if (progressCardEl) progressCardEl.innerHTML = renderGamificationCard(summary, { title: 'Gamification Summary', compact: true });

    const galleryEl = document.getElementById('gamificationBadgeGallery');
    if (galleryEl) galleryEl.innerHTML = renderBadgeGallery(state);

    const eventsEl = document.getElementById('gamificationEventsFeed');
    if (eventsEl) eventsEl.innerHTML = renderGamificationEvents(summary);

    const miniSummaryEl = document.getElementById('gamificationLogMiniSummary');
    if (miniSummaryEl) {
      const latestEvent = ensureArray(summary.recentEvents).slice(-1)[0];
      miniSummaryEl.innerHTML = `
        <div class="gamification-mini-summary-row">
          <strong>Level ${summary.level}</strong>
          <span>${summary.currentLevelXp}/${summary.nextLevelXp} XP</span>
          <span>🔥 ${summary.streak} day streak</span>
          <span>🏅 ${ensureArray(summary.badges).length} badges</span>
        </div>
        <p class="gamification-mini-summary-note">${latestEvent?.message || 'Log a completed workout to earn XP and badges.'}</p>
      `;
    }
  }

  function loadGamification(userId) {
    return getGamificationState(userId);
  }

  function saveGamification(userId, data) {
    return saveGamificationState(userId, data);
  }

  function updateGamification(userId, workouts) {
    const list = ensureArray(workouts);
    let state = getGamificationState(userId);
    list.forEach(workout => {
      state = evaluateWorkoutAchievements(userId, workout);
    });
    return state;
  }

  const api = {
    BADGE_REGISTRY,
    ACHIEVEMENTS: BADGE_REGISTRY,
    XP_RULES,
    getXpNeededForNextLevel,
    getGamificationState,
    saveGamificationState,
    awardXp,
    evaluateLevelUp,
    evaluateWorkoutAchievements,
    evaluatePRAchievements,
    updateWorkoutStreak,
    getGamificationSummary,
    renderGamificationCard,
    renderBadgeGallery,
    renderGamificationEvents,
    renderGamificationUI,
    loadGamification,
    saveGamification,
    updateGamification,
    evaluateTotalWorkoutsCompleted,
    evaluateStreakLength,
    evaluatePRCount,
    evaluateTotalSetsCompleted,
    evaluateExerciseSpecificMilestones
  };

  if (typeof module !== 'undefined') {
    module.exports = api;
  }

  Object.assign(globalScope, api);
})(typeof window !== 'undefined' ? window : globalThis);
