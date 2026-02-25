function getGoalsStorageKey(user) {
  return `goals_${user}`;
}

function loadGoals(user) {
  if (typeof localStorage === 'undefined' || !user) return [];
  const raw = localStorage.getItem(getGoalsStorageKey(user));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([type, value]) => ({
        id: `${type}-legacy`,
        title: `${type} goal`,
        type,
        targetValue: Number(value?.target || 0),
        currentValue: Number(value?.progress || 0),
        createdAt: new Date().toISOString(),
        dueDate: null,
        status: 'on_track',
        syncToBackend: false,
        smart: {
          specific: `${type} progress`,
          measurable: `${value?.target || 0}`,
          achievable: '',
          relevant: '',
          timeBound: ''
        }
      }));
    }
    return [];
  } catch (error) {
    return [];
  }
}

function saveGoals(user, goals) {
  if (typeof localStorage === 'undefined' || !user) return;
  localStorage.setItem(getGoalsStorageKey(user), JSON.stringify(Array.isArray(goals) ? goals : []));
}

function createSmartGoal(user, goalInput) {
  const goals = loadGoals(user);
  const goal = {
    id: goalInput?.id || `goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: String(goalInput?.title || '').trim(),
    type: String(goalInput?.type || 'strength'),
    exercise: String(goalInput?.exercise || '').trim(),
    targetValue: Number(goalInput?.targetValue || 0),
    unit: String(goalInput?.unit || 'kg'),
    startValue: Number(goalInput?.startValue || 0),
    currentValue: Number(goalInput?.currentValue ?? goalInput?.startValue ?? 0),
    createdAt: goalInput?.createdAt || new Date().toISOString(),
    dueDate: goalInput?.dueDate || null,
    syncToBackend: Boolean(goalInput?.syncToBackend),
    status: 'on_track',
    smart: {
      specific: String(goalInput?.specific || '').trim(),
      measurable: String(goalInput?.measurable || '').trim(),
      achievable: String(goalInput?.achievable || '').trim(),
      relevant: String(goalInput?.relevant || '').trim(),
      timeBound: String(goalInput?.timeBound || '').trim()
    }
  };

  goals.push(goal);
  saveGoals(user, goals);
  return goal;
}

function setGoal(user, type, target) {
  return createSmartGoal(user, {
    title: `${type} goal`,
    type,
    targetValue: Number(target || 0),
    startValue: 0,
    specific: `${type} progress target`,
    measurable: `Reach ${target}`,
    achievable: 'Consistent training',
    relevant: `Improve ${type}`,
    timeBound: ''
  });
}

function deleteGoal(user, goalId) {
  const goals = loadGoals(user);
  const updatedGoals = goals.filter(goal => goal.id !== goalId);
  saveGoals(user, updatedGoals);
  return updatedGoals;
}

function updateGoalProgress(user, type, amount) {
  const goals = loadGoals(user);
  const matchingGoal = goals.find(goal => goal.type === type);
  if (!matchingGoal) return null;
  matchingGoal.currentValue = Number(matchingGoal.currentValue || 0) + Number(amount || 0);
  saveGoals(user, goals);
  return matchingGoal;
}

function getWorkoutMetric(workout, goal) {
  if (!workout || !Array.isArray(workout.log)) return 0;
  const entries = goal?.exercise
    ? workout.log.filter(entry => String(entry?.exercise || '').toLowerCase() === goal.exercise.toLowerCase())
    : workout.log;
  const values = entries.map(entry => {
    const weights = Array.isArray(entry?.weightsArray) ? entry.weightsArray : [];
    return Math.max(...weights.map(value => Number(value) || 0), 0);
  });
  return Math.max(...values, 0);
}

function calculateGoalProgress(goal, workouts) {
  const now = new Date();
  const createdAt = new Date(goal?.createdAt || now);
  const dueDate = goal?.dueDate ? new Date(goal.dueDate) : null;
  const target = Number(goal?.targetValue || 0);
  const start = Number(goal?.startValue || 0);
  const prepared = (Array.isArray(workouts) ? workouts : [])
    .map(workout => ({
      date: new Date(workout?.date),
      value: getWorkoutMetric(workout, goal)
    }))
    .filter(point => !Number.isNaN(point.date.getTime()) && Number.isFinite(point.value))
    .sort((a, b) => a.date - b.date);

  const points = prepared.filter(point => point.value > 0);
  const latestValue = points.length ? points[points.length - 1].value : Number(goal?.currentValue || start || 0);

  const trendPoints = points.slice(-8);
  let slopePerDay = 0;
  if (trendPoints.length >= 2) {
    const firstTime = trendPoints[0].date.getTime();
    const x = trendPoints.map(point => (point.date.getTime() - firstTime) / (1000 * 60 * 60 * 24));
    const y = trendPoints.map(point => point.value);
    const avgX = x.reduce((sum, value) => sum + value, 0) / x.length;
    const avgY = y.reduce((sum, value) => sum + value, 0) / y.length;
    const numerator = x.reduce((sum, value, index) => sum + ((value - avgX) * (y[index] - avgY)), 0);
    const denominator = x.reduce((sum, value) => sum + ((value - avgX) ** 2), 0);
    slopePerDay = denominator > 0 ? numerator / denominator : 0;
  }

  const durationDays = dueDate ? Math.max((dueDate - createdAt) / (1000 * 60 * 60 * 24), 1) : null;
  const elapsedDays = dueDate ? Math.max((now - createdAt) / (1000 * 60 * 60 * 24), 0) : 0;
  const daysRemaining = dueDate ? Math.max((dueDate - now) / (1000 * 60 * 60 * 24), 0) : 0;

  const progressPercent = target > 0
    ? Math.min(100, Math.max(0, (latestValue / target) * 100))
    : 0;

  const projectedValue = latestValue + (slopePerDay * daysRemaining);
  const expectedByToday = dueDate
    ? start + ((target - start) * Math.min(1, elapsedDays / durationDays))
    : latestValue;

  let status = 'on_track';
  if (latestValue >= target && target > 0) {
    status = 'ahead';
  } else if (dueDate) {
    if (projectedValue >= target && latestValue >= expectedByToday * 0.95) {
      status = 'on_track';
    } else if (projectedValue >= target * 0.9 || latestValue >= expectedByToday * 0.8) {
      status = 'behind';
    } else {
      status = 'at_risk';
    }
  }

  return {
    progressPercent,
    currentValue: latestValue,
    projectedValue,
    expectedByToday,
    slopePerDay,
    status,
    trendPoints: points
  };
}

async function syncGoalsToBackend(user, goals, options = {}) {
  if (!options?.enabled || typeof fetch !== 'function') {
    return { skipped: true };
  }
  try {
    const response = await fetch('/api/goals/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: options?.token ? `Bearer ${options.token}` : ''
      },
      body: JSON.stringify({ user, goals })
    });
    return { skipped: false, ok: response.ok };
  } catch (error) {
    return { skipped: false, ok: false, error: String(error?.message || error) };
  }
}

function checkMissedWorkouts(user, threshold, days) {
  const dates = JSON.parse(localStorage.getItem(`workoutDates_${user}`)) || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const recent = dates.filter(d => new Date(d) >= cutoff);
  return recent.length < threshold;
}

if (typeof module !== 'undefined') {
  module.exports = {
    loadGoals,
    saveGoals,
    setGoal,
    updateGoalProgress,
    checkMissedWorkouts,
    createSmartGoal,
    deleteGoal,
    calculateGoalProgress,
    syncGoalsToBackend
  };
}

if (typeof window !== 'undefined') {
  window.loadGoals = loadGoals;
  window.saveGoals = saveGoals;
  window.setGoal = setGoal;
  window.updateGoalProgress = updateGoalProgress;
  window.checkMissedWorkouts = checkMissedWorkouts;
  window.createSmartGoal = createSmartGoal;
  window.deleteGoal = deleteGoal;
  window.calculateGoalProgress = calculateGoalProgress;
  window.syncGoalsToBackend = syncGoalsToBackend;
}
