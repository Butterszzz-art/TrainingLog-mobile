(function (globalScope) {
  const STORAGE_PREFIX = 'tl_gamification_v1_';
  const MAX_RECENT_EVENTS = 30;
  const MAX_TRACKED_IDS = 600;

  const XP_RULES = Object.freeze({
    WORKOUT_COMPLETE: 25,
    EXERCISE_COMPLETE: 8,
    SET_COMPLETE: 2,
    PR_HIT: 30,
    STREAK_DAY: 10,
    ACHIEVEMENT_BONUS: 40
  });

  const ACHIEVEMENTS = {
    first_workout: { title: 'First Workout', description: 'Finish your first resistance workout.', icon: '🎯', xp: 40 },
    seven_day_streak: { title: '7-Day Streak', description: 'Train 7 days in a row.', icon: '🔥', xp: 80 },
    ten_workouts: { title: 'Ten Workouts', description: 'Complete 10 resistance sessions.', icon: '🔟', xp: 120 },
    first_pr: { title: 'First PR', description: 'Set your first personal record.', icon: '🏆', xp: 70 },
    squat_specialist: { title: 'Squat Specialist', description: 'Log 10 squat sessions.', icon: '🦵', xp: 90 },
    bench_specialist: { title: 'Bench Specialist', description: 'Log 10 bench sessions.', icon: '💪', xp: 90 },
    deadlift_specialist: { title: 'Deadlift Specialist', description: 'Log 10 deadlift sessions.', icon: '🏋️', xp: 90 },
    consistency_30: { title: 'Consistency 30', description: 'Reach a 30-day training streak.', icon: '📅', xp: 200 },
    volume_beast: { title: 'Volume Beast', description: 'Accumulate 100,000 total session volume.', icon: '🐉', xp: 200 },
    template_builder: { title: 'Template Builder', description: 'Save your first workout template.', icon: '🧱', xp: 50 }
  };

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

  function getLevelForXp(totalXp) {
    const xp = Math.max(0, Number(totalXp) || 0);
    let level = 1;
    let requiredToNext = 100;
    let consumed = 0;

    while (xp >= consumed + requiredToNext) {
      consumed += requiredToNext;
      level += 1;
      requiredToNext = Math.floor(requiredToNext * 1.18 + 20);
      if (level > 250) break;
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
      lastWorkoutDate: null,
      completedWorkoutCount: 0,
      totalSetsCompleted: 0,
      totalExercisesCompleted: 0,
      totalPRs: 0,
      totalVolume: 0,
      exerciseCounts: {},
      rewardedWorkoutIds: [],
      rewardedPREventIds: [],
      streakGraceDays: 0
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
    merged.exerciseCounts = typeof merged.exerciseCounts === 'object' && merged.exerciseCounts ? merged.exerciseCounts : {};

    if (!merged.weeklyXp || typeof merged.weeklyXp !== 'object') {
      merged.weeklyXp = { weekKey: getWeekKey(), amount: 0 };
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

  function maybeToast(message) {
    if (!message) return;
    if (typeof globalScope.showToast === 'function') {
      globalScope.showToast(message);
      return;
    }
    if (typeof globalScope.alert === 'function') {
      globalScope.alert(message);
    }
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
      }
      maybeToast(`🎉 Level Up! You reached Level ${state.level}`);
    }

    return state;
  }

  function awardXp(userId, amount, reason, metadata) {
    const safeAmount = Math.max(0, Number(amount) || 0);
    if (!safeAmount) return getGamificationState(userId);

    const state = getGamificationState(userId);
    const nowWeek = getWeekKey(metadata?.date);
    if (state.weeklyXp.weekKey !== nowWeek) {
      state.weeklyXp = { weekKey: nowWeek, amount: 0 };
    }

    state.totalXp += safeAmount;
    state.weeklyXp.amount += safeAmount;

    pushRecentEvent(state, {
      type: 'xp',
      message: `+${safeAmount} XP ${reason || 'Progress'}`,
      xp: safeAmount,
      metadata: metadata || null
    });

    evaluateLevelUp(state);
    const saved = saveGamificationState(userId, state);
    renderGamificationUI(userId, saved);
    return saved;
  }

  function unlockAchievement(state, key) {
    if (!ACHIEVEMENTS[key]) return false;
    if (state.unlockedAchievements.includes(key)) return false;

    const achievement = ACHIEVEMENTS[key];
    state.unlockedAchievements.push(key);
    state.badges.push({
      key,
      title: achievement.title,
      description: achievement.description,
      icon: achievement.icon,
      unlockedAt: new Date().toISOString()
    });

    pushRecentEvent(state, {
      type: 'badge',
      message: `Badge Unlocked: ${achievement.title}`,
      xp: achievement.xp,
      metadata: { badge: key }
    });

    maybeToast(`${achievement.icon} Badge unlocked: ${achievement.title}`);
    state.totalXp += achievement.xp;
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
    let totalVolume = 0;

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
        totalVolume += rep * weight;
        exerciseHasCompletedSet = true;
      }

      if (exerciseHasCompletedSet) exercisesCompleted += 1;
    });

    return { exercisesCompleted, setsCompleted, totalVolume };
  }

  function maybeUnlockWorkoutMilestones(state) {
    const count = state.completedWorkoutCount;
    if (count >= 1) unlockAchievement(state, 'first_workout');
    if (count >= 10) unlockAchievement(state, 'ten_workouts');

    if (count === 5 || count === 10 || count === 50) {
      state.totalXp += XP_RULES.ACHIEVEMENT_BONUS;
      pushRecentEvent(state, {
        type: 'milestone',
        message: `Milestone: ${count} workouts completed`,
        xp: XP_RULES.ACHIEVEMENT_BONUS
      });
    }
  }

  function updateWorkoutStreak(userId, workoutDate) {
    const state = getGamificationState(userId);
    const currentDay = getTodayIsoDate(workoutDate);
    const previousDay = state.lastWorkoutDate ? getTodayIsoDate(state.lastWorkoutDate) : null;
    let gaveStreakBonus = false;

    if (!previousDay) {
      state.streak = 1;
      gaveStreakBonus = true;
    } else {
      const diffDays = Math.round((new Date(currentDay).getTime() - new Date(previousDay).getTime()) / 86400000);
      if (diffDays <= 0) {
        // same day or older save: no streak changes
      } else if (diffDays === 1) {
        state.streak += 1;
        gaveStreakBonus = true;
      } else if (state.streakGraceDays > 0 && diffDays <= state.streakGraceDays + 1) {
        state.streak += 1;
      } else {
        state.streak = 1;
        gaveStreakBonus = true;
      }
    }

    state.lastWorkoutDate = currentDay;
    state.longestStreak = Math.max(Number(state.longestStreak) || 0, state.streak);

    if (state.streak >= 7) unlockAchievement(state, 'seven_day_streak');
    if (state.streak >= 30) unlockAchievement(state, 'consistency_30');

    if (gaveStreakBonus) {
      state.totalXp += XP_RULES.STREAK_DAY;
      pushRecentEvent(state, {
        type: 'streak',
        message: `+${XP_RULES.STREAK_DAY} XP Streak day (${state.streak})`,
        xp: XP_RULES.STREAK_DAY,
        metadata: { streak: state.streak, date: currentDay }
      });
    }

    evaluateLevelUp(state);
    const saved = saveGamificationState(userId, state);
    renderGamificationUI(userId, saved);
    return saved;
  }

  function evaluateWorkoutAchievements(userId, workout) {
    const state = getGamificationState(userId);
    const rewardId = getWorkoutRewardId(workout);
    if (state.rewardedWorkoutIds.includes(rewardId)) {
      return state;
    }

    const stats = countWorkoutStats(workout);
    if (!stats.setsCompleted || !stats.exercisesCompleted) {
      return state;
    }

    state.rewardedWorkoutIds.push(rewardId);
    state.rewardedWorkoutIds = state.rewardedWorkoutIds.slice(-MAX_TRACKED_IDS);

    state.completedWorkoutCount += 1;
    state.totalSetsCompleted += stats.setsCompleted;
    state.totalExercisesCompleted += stats.exercisesCompleted;
    state.totalVolume += stats.totalVolume;

    state.totalXp += XP_RULES.WORKOUT_COMPLETE;
    pushRecentEvent(state, {
      type: 'xp',
      message: `+${XP_RULES.WORKOUT_COMPLETE} XP Workout Complete`,
      xp: XP_RULES.WORKOUT_COMPLETE,
      metadata: { workoutId: workout?.id || null }
    });

    const exerciseXp = stats.exercisesCompleted * XP_RULES.EXERCISE_COMPLETE;
    const setXp = stats.setsCompleted * XP_RULES.SET_COMPLETE;
    state.totalXp += exerciseXp + setXp;

    pushRecentEvent(state, {
      type: 'xp',
      message: `+${exerciseXp} XP Exercises Complete`,
      xp: exerciseXp
    });

    pushRecentEvent(state, {
      type: 'xp',
      message: `+${setXp} XP Sets Complete`,
      xp: setXp
    });

    const names = ensureArray(workout?.exercises).map(ex => String(ex?.name || '').toLowerCase());
    names.forEach(name => {
      if (!name) return;
      if (name.includes('squat')) state.exerciseCounts.squat = (state.exerciseCounts.squat || 0) + 1;
      if (name.includes('bench')) state.exerciseCounts.bench = (state.exerciseCounts.bench || 0) + 1;
      if (name.includes('deadlift')) state.exerciseCounts.deadlift = (state.exerciseCounts.deadlift || 0) + 1;
    });

    if ((state.exerciseCounts.squat || 0) >= 10) unlockAchievement(state, 'squat_specialist');
    if ((state.exerciseCounts.bench || 0) >= 10) unlockAchievement(state, 'bench_specialist');
    if ((state.exerciseCounts.deadlift || 0) >= 10) unlockAchievement(state, 'deadlift_specialist');

    if (state.totalVolume >= 100000) unlockAchievement(state, 'volume_beast');

    const savedTemplates = (() => {
      if (typeof localStorage === 'undefined') return [];
      try {
        const parsed = JSON.parse(localStorage.getItem('resistanceTemplates') || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
    if (savedTemplates.length > 0) unlockAchievement(state, 'template_builder');

    maybeUnlockWorkoutMilestones(state);
    state.lastWorkoutDate = getTodayIsoDate(workout?.date);
    state.longestStreak = Math.max(Number(state.longestStreak) || 0, Number(state.streak) || 0);

    evaluateLevelUp(state);
    const saved = saveGamificationState(userId, state);

    updateWorkoutStreak(userId, workout?.date);
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
    const awarded = newPrCount * XP_RULES.PR_HIT;
    state.totalXp += awarded;
    state.totalPRs += newPrCount;

    if (state.totalPRs >= 1) unlockAchievement(state, 'first_pr');

    evaluateLevelUp(state);
    const saved = saveGamificationState(userId, state);
    renderGamificationUI(userId, saved);
    return saved;
  }

  function getGamificationSummary(userId) {
    const state = getGamificationState(userId);
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
      completedWorkoutCount: state.completedWorkoutCount,
      unlockedAchievements: state.unlockedAchievements
    };
  }

  function renderGamificationUI(userId, optionalState) {
    if (typeof document === 'undefined') return;
    const state = optionalState || getGamificationState(userId);
    const summary = getGamificationSummary(userId);

    const cardEl = document.getElementById('gamificationCard');
    if (cardEl) {
      const latestBadge = summary.latestBadge
        ? `${summary.latestBadge.icon} ${summary.latestBadge.title}`
        : 'No badge yet';
      cardEl.innerHTML = `
        <h3 style="margin:0 0 8px;">🎮 Training XP</h3>
        <div style="font-size:0.95rem; margin-bottom:6px;">Level <strong>${summary.level}</strong> • ${summary.totalXp} XP total</div>
        <div style="height:10px; border-radius:99px; background:#ececec; overflow:hidden;">
          <div style="height:100%; width:${summary.progressPercent}%; background:linear-gradient(90deg,#6a5cff,#5fd0ff);"></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:0.85rem;">
          <span>${summary.currentLevelXp}/${summary.nextLevelXp} XP</span>
          <span>🔥 Streak ${summary.streak}</span>
        </div>
        <div style="margin-top:8px; font-size:0.88rem;">Latest badge: <strong>${latestBadge}</strong></div>
      `;
    }

    const galleryEl = document.getElementById('gamificationBadgeGallery');
    if (galleryEl) {
      if (!state.badges.length) {
        galleryEl.innerHTML = '<p style="margin:0; color:#666;">No badges unlocked yet. Finish a workout to begin.</p>';
      } else {
        galleryEl.innerHTML = state.badges
          .slice()
          .reverse()
          .map(badge => `<div class="gamification-badge-pill" title="${badge.description}">${badge.icon} ${badge.title}</div>`)
          .join('');
      }
    }

    const eventsEl = document.getElementById('gamificationEventsFeed');
    if (eventsEl) {
      if (!summary.recentEvents.length) {
        eventsEl.innerHTML = '<p style="margin:0; color:#666;">No recent events yet.</p>';
      } else {
        eventsEl.innerHTML = summary.recentEvents
          .slice()
          .reverse()
          .slice(0, 8)
          .map(evt => `<div class="gamification-event-item"><span>${evt.message}</span><small>${new Date(evt.createdAt).toLocaleDateString()}</small></div>`)
          .join('');
      }
    }
  }

  // Legacy wrappers kept for compatibility with existing calls.
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
    ACHIEVEMENTS,
    XP_RULES,
    getGamificationState,
    saveGamificationState,
    awardXp,
    evaluateLevelUp,
    evaluateWorkoutAchievements,
    evaluatePRAchievements,
    updateWorkoutStreak,
    getGamificationSummary,
    renderGamificationUI,
    loadGamification,
    saveGamification,
    updateGamification
  };

  if (typeof module !== 'undefined') {
    module.exports = api;
  }

  Object.assign(globalScope, api);
})(typeof window !== 'undefined' ? window : globalThis);
