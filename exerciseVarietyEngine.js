const { getMuscleGroup, exerciseMuscleMap } = require('./exerciseMuscleMap');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EIGHT_WEEKS_DAYS = 56;
const FOUR_WEEKS_DAYS = 28;

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function listAllExercisesByMuscle() {
  return Object.entries(exerciseMuscleMap).reduce((acc, [exercise, muscle]) => {
    if (!acc[muscle]) {
      acc[muscle] = [];
    }
    acc[muscle].push(exercise);
    return acc;
  }, {});
}

function normaliseLogs(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((log) => {
      const date = toDate(log?.date || log?.performedAt || log?.createdAt);
      if (!date || !Array.isArray(log?.exercises)) {
        return null;
      }
      return {
        date,
        exercises: log.exercises
          .map((exercise) => {
            const name = String(exercise?.name || '').trim();
            if (!name) return null;
            const repsArray = Array.isArray(exercise?.repsArray)
              ? exercise.repsArray.map((n) => Number(n) || 0)
              : [];
            const weightsArray = Array.isArray(exercise?.weightsArray)
              ? exercise.weightsArray.map((n) => Number(n) || 0)
              : [];
            return { name, repsArray, weightsArray };
          })
          .filter(Boolean),
      };
    })
    .filter(Boolean);
}

function analyzeExerciseVariety(history, now = new Date()) {
  const referenceDate = startOfDay(toDate(now) || new Date());
  const eightWeekCutoff = new Date(referenceDate.getTime() - EIGHT_WEEKS_DAYS * MS_PER_DAY);
  const recentCutoff = new Date(referenceDate.getTime() - FOUR_WEEKS_DAYS * MS_PER_DAY);
  const priorCutoff = eightWeekCutoff;

  const logs = normaliseLogs(history);
  const byMuscle = {};
  const allExercisesByMuscle = listAllExercisesByMuscle();
  const progressBuckets = {};

  logs.forEach((log) => {
    if (log.date < eightWeekCutoff) return;

    log.exercises.forEach((exercise) => {
      const muscle = getMuscleGroup(exercise.name);
      if (!byMuscle[muscle]) {
        byMuscle[muscle] = {
          recentExercises: new Set(),
          lastPerformed: {},
          allPerformedLast8Weeks: new Set(),
        };
      }

      byMuscle[muscle].allPerformedLast8Weeks.add(exercise.name);
      if (!byMuscle[muscle].lastPerformed[exercise.name] || byMuscle[muscle].lastPerformed[exercise.name] < log.date) {
        byMuscle[muscle].lastPerformed[exercise.name] = log.date;
      }

      if (log.date >= recentCutoff) {
        byMuscle[muscle].recentExercises.add(exercise.name);
      }

      const topWeight = Math.max(0, ...exercise.weightsArray);
      if (!progressBuckets[exercise.name]) {
        progressBuckets[exercise.name] = {
          muscle,
          recentTopWeights: [],
          priorTopWeights: [],
          lastPerformed: log.date,
        };
      }
      if (progressBuckets[exercise.name].lastPerformed < log.date) {
        progressBuckets[exercise.name].lastPerformed = log.date;
      }
      if (log.date >= recentCutoff) {
        progressBuckets[exercise.name].recentTopWeights.push(topWeight);
      } else if (log.date >= priorCutoff) {
        progressBuckets[exercise.name].priorTopWeights.push(topWeight);
      }
    });
  });

  const muscleHistory = Object.entries(byMuscle).reduce((acc, [muscle, details]) => {
    const performedStale = [...details.allPerformedLast8Weeks]
      .filter((exercise) => !details.recentExercises.has(exercise));
    const fallbackStale = performedStale.length
      ? []
      : (allExercisesByMuscle[muscle] || []).filter((exercise) => !details.recentExercises.has(exercise));
    const staleExercises = [...performedStale, ...fallbackStale]
      .map((exercise) => ({
        name: exercise,
        daysSinceLastPerformed: details.lastPerformed[exercise]
          ? Math.floor((referenceDate - startOfDay(details.lastPerformed[exercise])) / MS_PER_DAY)
          : null,
      }))
      .sort((a, b) => {
        const scoreA = a.daysSinceLastPerformed == null ? -1 : a.daysSinceLastPerformed;
        const scoreB = b.daysSinceLastPerformed == null ? -1 : b.daysSinceLastPerformed;
        return scoreB - scoreA;
      });

    acc[muscle] = {
      exercisesPerformedLast8Weeks: [...details.allPerformedLast8Weeks].sort(),
      staleExercises,
    };
    return acc;
  }, {});

  const lowProgressExercises = Object.entries(progressBuckets)
    .map(([exerciseName, progress]) => {
      const recentAverage = progress.recentTopWeights.length
        ? progress.recentTopWeights.reduce((sum, n) => sum + n, 0) / progress.recentTopWeights.length
        : 0;
      const priorAverage = progress.priorTopWeights.length
        ? progress.priorTopWeights.reduce((sum, n) => sum + n, 0) / progress.priorTopWeights.length
        : 0;
      const percentChange = priorAverage > 0 ? ((recentAverage - priorAverage) / priorAverage) * 100 : null;
      const lowProgress = priorAverage > 0 && percentChange < 2;

      return {
        exercise: exerciseName,
        muscle: progress.muscle,
        recentAverageTopWeight: Number(recentAverage.toFixed(2)),
        priorAverageTopWeight: Number(priorAverage.toFixed(2)),
        percentChange: percentChange == null ? null : Number(percentChange.toFixed(2)),
        lowProgress,
      };
    })
    .filter((exercise) => exercise.lowProgress)
    .sort((a, b) => (a.percentChange ?? 0) - (b.percentChange ?? 0));

  const suggestedVarietyExercises = Object.entries(muscleHistory).reduce((acc, [muscle, details]) => {
    if (!details.staleExercises.length) return acc;
    acc[muscle] = details.staleExercises.slice(0, 3).map((item) => item.name);
    return acc;
  }, {});

  return {
    generatedAt: referenceDate.toISOString(),
    muscleHistory,
    suggestedVarietyExercises,
    lowProgressExercises,
  };
}

function analyzeMonotonyAndStrain(history, now = new Date()) {
  const referenceDate = startOfDay(toDate(now) || new Date());
  const eightWeekCutoff = new Date(referenceDate.getTime() - EIGHT_WEEKS_DAYS * MS_PER_DAY);
  const logs = normaliseLogs(history);

  const dailyLoad = new Map();
  logs.forEach((log) => {
    if (log.date < eightWeekCutoff) return;
    const key = startOfDay(log.date).toISOString().slice(0, 10);
    const load = log.exercises.reduce((sum, exercise) => {
      const setCount = Math.max(exercise.repsArray.length, exercise.weightsArray.length);
      let exerciseLoad = 0;
      for (let i = 0; i < setCount; i += 1) {
        const reps = Number(exercise.repsArray[i] || 0);
        const weight = Number(exercise.weightsArray[i] || 0);
        exerciseLoad += reps * weight;
      }
      return sum + exerciseLoad;
    }, 0);

    dailyLoad.set(key, (dailyLoad.get(key) || 0) + load);
  });

  const weeklyMetrics = [];
  for (let weekOffset = 0; weekOffset < 8; weekOffset += 1) {
    const weekStart = new Date(eightWeekCutoff.getTime() + weekOffset * 7 * MS_PER_DAY);
    const loads = [];
    for (let day = 0; day < 7; day += 1) {
      const dayDate = new Date(weekStart.getTime() + day * MS_PER_DAY);
      const key = dayDate.toISOString().slice(0, 10);
      loads.push(dailyLoad.get(key) || 0);
    }

    const weeklyLoad = loads.reduce((sum, n) => sum + n, 0);
    const mean = weeklyLoad / 7;
    const variance = loads.reduce((sum, n) => sum + (n - mean) ** 2, 0) / 7;
    const stdDev = Math.sqrt(variance);
    const monotony = stdDev > 0 ? mean / stdDev : mean > 0 ? 10 : 0;
    const strain = weeklyLoad * monotony;

    weeklyMetrics.push({
      weekStart: weekStart.toISOString().slice(0, 10),
      weeklyLoad: Number(weeklyLoad.toFixed(2)),
      monotony: Number(monotony.toFixed(2)),
      strain: Number(strain.toFixed(2)),
      shouldDeload: monotony >= 2 || strain >= 12000,
    });
  }

  const recommendedDeloadWeeks = weeklyMetrics
    .map((week, index) => ({ ...week, weekNumber: index + 1 }))
    .filter((week) => week.shouldDeload)
    .map((week) => week.weekNumber + 1);

  return {
    weeklyMetrics,
    recommendedDeloadWeeks: [...new Set(recommendedDeloadWeeks)].sort((a, b) => a - b),
  };
}

function buildProgramVarietyRecommendations(history, now = new Date()) {
  const variety = analyzeExerciseVariety(history, now);
  const load = analyzeMonotonyAndStrain(history, now);
  return {
    ...variety,
    deloadPlan: {
      recommendedDeloadWeeks: load.recommendedDeloadWeeks,
      weeklyLoadMetrics: load.weeklyMetrics,
    },
  };
}

module.exports = {
  analyzeExerciseVariety,
  analyzeMonotonyAndStrain,
  buildProgramVarietyRecommendations,
};

if (typeof window !== 'undefined') {
  window.exerciseVarietyEngine = module.exports;
}
