const BODYBUILDING_MUSCLE_GROUPS = [
  'chest',
  'back width',
  'back thickness',
  'quads',
  'hamstrings',
  'glutes',
  'delts',
  'arms',
  'calves',
  'abs'
];

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIsoWeekStart(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

function fallbackPrimaryGroup(exerciseName) {
  if (typeof exerciseName !== 'string') return 'other';
  if (typeof getMuscleGroup === 'function') {
    return getMuscleGroup(exerciseName);
  }
  return 'other';
}

function mapExerciseToBodybuildingGroup(exerciseName, explicitGroup) {
  const name = String(exerciseName || '').toLowerCase();
  const provided = String(explicitGroup || '').toLowerCase();

  if (name.includes('bench') || name.includes('chest press') || name.includes('fly') || name.includes('push up')) {
    return 'chest';
  }
  if (name.includes('pulldown') || name.includes('pull up') || name.includes('chin up') || name.includes('pullover')) {
    return 'back width';
  }
  if (name.includes('row') || name.includes('deadlift') || name.includes('shrug') || name.includes('back extension')) {
    return 'back thickness';
  }
  if (name.includes('squat') || name.includes('leg press') || name.includes('leg extension') || name.includes('lunge') || name.includes('split squat')) {
    return 'quads';
  }
  if (name.includes('leg curl') || name.includes('rdl') || name.includes('romanian deadlift') || name.includes('glute-ham')) {
    return 'hamstrings';
  }
  if (name.includes('hip thrust') || name.includes('glute bridge') || name.includes('abduction')) {
    return 'glutes';
  }
  if (name.includes('lateral raise') || name.includes('rear delt') || name.includes('overhead press') || name.includes('shoulder press')) {
    return 'delts';
  }
  if (name.includes('curl') || name.includes('triceps') || name.includes('pushdown') || name.includes('skull crusher')) {
    return 'arms';
  }
  if (name.includes('calf')) return 'calves';
  if (name.includes('crunch') || name.includes('ab wheel') || name.includes('leg raise') || name.includes('plank')) return 'abs';

  const primary = provided || fallbackPrimaryGroup(exerciseName);
  if (primary === 'chest') return 'chest';
  if (primary === 'quads') return 'quads';
  if (primary === 'hamstrings') return 'hamstrings';
  if (primary === 'glutes') return 'glutes';
  if (primary === 'calves') return 'calves';
  if (primary === 'abs') return 'abs';
  if (primary === 'shoulders') return 'delts';
  if (primary === 'biceps' || primary === 'triceps' || primary === 'forearms') return 'arms';
  if (primary === 'back' || primary === 'traps') return 'back thickness';

  return 'other';
}

function getSetPairsFromEntry(entry, planned) {
  if (!entry || typeof entry !== 'object') return [];

  if (planned && Array.isArray(entry.setDefinitions) && entry.setDefinitions.length) {
    return entry.setDefinitions.map((setDef) => ({
      weight: toNumber(setDef?.targetWeight),
      reps: toNumber(setDef?.targetReps)
    }));
  }

  const repsArray = Array.isArray(entry.repsArray) ? entry.repsArray : [];
  const weightsArray = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
  const setCount = Math.max(repsArray.length, weightsArray.length, toNumber(entry.sets));
  return Array.from({ length: setCount }, (_, i) => ({
    weight: toNumber(weightsArray[i]),
    reps: toNumber(repsArray[i])
  }));
}

function getVolumeFromPairs(pairs) {
  return pairs.reduce((sum, pair) => sum + (toNumber(pair.weight) * toNumber(pair.reps)), 0);
}

function computeBodybuildingProgressSummary(workouts, options = {}) {
  const source = Array.isArray(workouts) ? workouts : [];
  const weeklyByMuscle = {};
  const exerciseStats = {};

  source.forEach((workout) => {
    const date = workout?.date;
    const weekStart = toIsoWeekStart(date);
    if (!weekStart || !Array.isArray(workout?.log)) return;

    workout.log.forEach((entry) => {
      const exerciseName = entry?.exercise || entry?.name || 'Exercise';
      const muscleGroup = mapExerciseToBodybuildingGroup(exerciseName, entry?.muscleGroup);
      if (!BODYBUILDING_MUSCLE_GROUPS.includes(muscleGroup)) return;

      const actualPairs = getSetPairsFromEntry(entry, false);
      const plannedPairs = getSetPairsFromEntry(entry, true);
      const actualVolume = getVolumeFromPairs(actualPairs);
      const plannedVolume = getVolumeFromPairs(plannedPairs);

      if (!weeklyByMuscle[weekStart]) weeklyByMuscle[weekStart] = {};
      if (!weeklyByMuscle[weekStart][muscleGroup]) {
        weeklyByMuscle[weekStart][muscleGroup] = { actual: 0, planned: 0 };
      }
      weeklyByMuscle[weekStart][muscleGroup].actual += actualVolume;
      weeklyByMuscle[weekStart][muscleGroup].planned += plannedVolume;

      if (!exerciseStats[exerciseName]) {
        exerciseStats[exerciseName] = {
          dates: new Set(),
          sessions: 0,
          topSetWeight: 0,
          topSetReps: 0,
          topSessionVolume: 0,
          muscleGroup
        };
      }
      const ex = exerciseStats[exerciseName];
      ex.dates.add(date);
      ex.sessions += 1;
      ex.topSessionVolume = Math.max(ex.topSessionVolume, actualVolume);
      actualPairs.forEach((pair) => {
        ex.topSetWeight = Math.max(ex.topSetWeight, pair.weight);
        ex.topSetReps = Math.max(ex.topSetReps, pair.reps);
      });
    });
  });

  const weeklyVolumeComparison = Object.entries(weeklyByMuscle)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, muscles]) => {
      const muscleGroups = BODYBUILDING_MUSCLE_GROUPS.map((group) => ({
        muscleGroup: group,
        actual: toNumber(muscles[group]?.actual),
        planned: toNumber(muscles[group]?.planned),
        ratio: toNumber(muscles[group]?.planned) > 0
          ? toNumber(muscles[group]?.actual) / toNumber(muscles[group]?.planned)
          : null
      }));
      return { weekStart, muscleGroups };
    });

  const exerciseConsistency = Object.entries(exerciseStats).map(([exercise, stat]) => {
    const sortedDates = [...stat.dates].sort((a, b) => a.localeCompare(b));
    const dayGaps = [];
    for (let i = 1; i < sortedDates.length; i += 1) {
      const prev = new Date(sortedDates[i - 1]);
      const next = new Date(sortedDates[i]);
      const gap = Math.round((next - prev) / (1000 * 60 * 60 * 24));
      if (Number.isFinite(gap)) dayGaps.push(gap);
    }

    const avgDaysBetween = dayGaps.length
      ? dayGaps.reduce((sum, value) => sum + value, 0) / dayGaps.length
      : null;

    return {
      exercise,
      muscleGroup: stat.muscleGroup,
      sessions: stat.sessions,
      avgDaysBetween
    };
  }).sort((a, b) => b.sessions - a.sessions);

  const topSetPRs = Object.entries(exerciseStats)
    .map(([exercise, stat]) => ({ exercise, value: stat.topSetWeight, muscleGroup: stat.muscleGroup }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const repPRs = Object.entries(exerciseStats)
    .map(([exercise, stat]) => ({ exercise, value: stat.topSetReps, muscleGroup: stat.muscleGroup }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const volumePRs = Object.entries(exerciseStats)
    .map(([exercise, stat]) => ({ exercise, value: stat.topSessionVolume, muscleGroup: stat.muscleGroup }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const latestWeek = weeklyVolumeComparison[weeklyVolumeComparison.length - 1];
  const weakPointFocus = latestWeek
    ? latestWeek.muscleGroups
      .filter((group) => {
        if (group.planned > 0) return group.actual < (group.planned * 0.85);
        const allActuals = latestWeek.muscleGroups.map((x) => x.actual).filter((x) => x > 0);
        if (!allActuals.length) return false;
        const median = allActuals.sort((a, b) => a - b)[Math.floor(allActuals.length / 2)] || 0;
        return group.actual > 0 && group.actual < (median * 0.6);
      })
      .map((group) => ({
        muscleGroup: group.muscleGroup,
        actual: group.actual,
        planned: group.planned,
        recommendation: group.planned > 0
          ? 'Below planned volume. Add 2-4 quality sets this week.'
          : 'Lower exposure than peers. Consider adding direct work this microcycle.'
      }))
    : [];

  return {
    muscleGroupVolume: latestWeek ? latestWeek.muscleGroups : [],
    weeklyVolumeComparison,
    exerciseConsistency,
    prSummaries: {
      topSetPRs,
      repPRs,
      volumePRs
    },
    weakPointFocus,
    assumptions: [
      'Back width prioritizes pull-up/pulldown/pullover patterns; other back compounds default to back thickness.',
      'Delts are mapped from shoulder-focused movements; biceps/triceps/forearms are grouped into arms.',
      'Planned weekly volume is only counted when setDefinitions contain target reps and target weight.'
    ]
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    BODYBUILDING_MUSCLE_GROUPS,
    mapExerciseToBodybuildingGroup,
    computeBodybuildingProgressSummary
  };
}

if (typeof window !== 'undefined') {
  window.BODYBUILDING_MUSCLE_GROUPS = BODYBUILDING_MUSCLE_GROUPS;
  window.mapExerciseToBodybuildingGroup = mapExerciseToBodybuildingGroup;
  window.computeBodybuildingProgressSummary = computeBodybuildingProgressSummary;
}
