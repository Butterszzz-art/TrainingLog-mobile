// Weekly per-muscle set volume + estimated fatigue for the Recovery Map.
// Requires exerciseMuscleMap.js to be loaded first (see getMuscleGroup).
const DEFAULT_WEEKLY_MUSCLE_TARGETS = {
  chest: 14, back: 16, shoulders: 12, traps: 8, biceps: 10, triceps: 10,
  forearms: 8, quads: 14, hamstrings: 10, glutes: 10, calves: 8,
  adductors: 6, abductors: 6, abs: 8
};

// Sane min/max for weekly set targets, roughly bracketing published MEV-MRV
// volume landmarks per muscle group. Larger muscle groups (back, quads) can
// sustain more weekly sets than small stabilizers (traps, forearms, abs).
const MUSCLE_TARGET_BOUNDS = {
  chest: { min: 0, max: 24 }, back: { min: 0, max: 28 }, shoulders: { min: 0, max: 24 },
  traps: { min: 0, max: 18 }, biceps: { min: 0, max: 22 }, triceps: { min: 0, max: 20 },
  forearms: { min: 0, max: 18 }, quads: { min: 0, max: 24 }, hamstrings: { min: 0, max: 20 },
  glutes: { min: 0, max: 20 }, calves: { min: 0, max: 22 },
  adductors: { min: 0, max: 14 }, abductors: { min: 0, max: 14 }, abs: { min: 0, max: 22 }
};

function clampMuscleTarget(muscle, value) {
  const bounds = MUSCLE_TARGET_BOUNDS[muscle] || { min: 0, max: 30 };
  const n = toNumber(value);
  return Math.min(bounds.max, Math.max(bounds.min, n));
}

// Rough recovery half-life in days: smaller muscles bounce back faster.
const RECOVERY_HALF_LIFE_DAYS = {
  chest: 2, back: 3, shoulders: 2, traps: 1.5, biceps: 1.5, triceps: 1.5,
  forearms: 1, quads: 3, hamstrings: 2.5, glutes: 2.5, calves: 1,
  adductors: 1.5, abductors: 1.5, abs: 1
};

const FATIGUE_COLOR_STOPS = [
  { score: 0, rgb: [242, 236, 224] },   // fresh — ivory
  { score: 33, rgb: [243, 211, 107] },  // moderate — yellow
  { score: 66, rgb: [232, 134, 63] },   // fatigued — orange
  { score: 100, rgb: [220, 53, 69] }    // overreached — red
];

// In the browser, exerciseMuscleMap.js (loaded first via <script>) puts
// getMuscleGroup on window, so the bare reference resolves at call time.
// Under Node/Jest, requiring a sibling module doesn't do that, so fall
// back to require() explicitly.
const resolvedGetMuscleGroup = (typeof getMuscleGroup === 'function')
  ? getMuscleGroup
  : (typeof require === 'function' ? require('./exerciseMuscleMap').getMuscleGroup : null);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function daysBetween(laterMs, earlierMs) {
  return Math.floor((laterMs - earlierMs) / 86400000);
}

function getEntrySetCount(entry) {
  const reps = Array.isArray(entry?.repsArray) ? entry.repsArray.length : 0;
  const weights = Array.isArray(entry?.weightsArray) ? entry.weightsArray.length : 0;
  return Math.max(reps, weights, toNumber(entry?.sets));
}

function fatigueToColor(score) {
  const s = Math.max(0, Math.min(100, toNumber(score)));
  for (let i = 0; i < FATIGUE_COLOR_STOPS.length - 1; i++) {
    const a = FATIGUE_COLOR_STOPS[i];
    const b = FATIGUE_COLOR_STOPS[i + 1];
    if (s >= a.score && s <= b.score) {
      const t = (s - a.score) / (b.score - a.score);
      const rgb = a.rgb.map((v, idx) => Math.round(v + (b.rgb[idx] - v) * t));
      return `rgb(${rgb.join(',')})`;
    }
  }
  const last = FATIGUE_COLOR_STOPS[FATIGUE_COLOR_STOPS.length - 1];
  return `rgb(${last.rgb.join(',')})`;
}

function fatigueStatus(score) {
  if (score < 25) return 'Fresh';
  if (score < 55) return 'Moderate';
  if (score < 80) return 'Fatigued';
  return 'Overreached';
}

// options.now: reference date (defaults to current time; pass explicitly in tests)
// options.weeklyTargets: overrides for DEFAULT_WEEKLY_MUSCLE_TARGETS
// options.soreness: today's whole-body soreness rating, 1 (very sore) - 5 (none), or null if not logged
function computeMuscleRecoverySummary(workouts, options = {}) {
  const source = Array.isArray(workouts) ? workouts : [];
  const now = options.now instanceof Date ? options.now : new Date();
  const rawTargets = Object.assign({}, DEFAULT_WEEKLY_MUSCLE_TARGETS, options.weeklyTargets || {});
  const targets = Object.fromEntries(
    Object.entries(rawTargets).map(([muscle, value]) => [muscle, clampMuscleTarget(muscle, value)])
  );
  const soreness = Number.isFinite(options.soreness) ? options.soreness : null;
  const windowStartMs = now.getTime() - 7 * 86400000;

  const weekSets = {};
  const lastTrainedMs = {};

  source.forEach((workout) => {
    const date = new Date(workout?.date);
    if (Number.isNaN(date.getTime()) || !Array.isArray(workout?.log)) return;
    const dateMs = date.getTime();

    workout.log.forEach((entry) => {
      const muscle = typeof resolvedGetMuscleGroup === 'function' ? resolvedGetMuscleGroup(entry?.exercise) : 'other';
      if (!(muscle in targets)) return;

      const setCount = getEntrySetCount(entry);
      if (dateMs >= windowStartMs && dateMs <= now.getTime()) {
        weekSets[muscle] = (weekSets[muscle] || 0) + setCount;
      }
      if (!lastTrainedMs[muscle] || dateMs > lastTrainedMs[muscle]) {
        lastTrainedMs[muscle] = dateMs;
      }
    });
  });

  // Whole-body soreness is a coarse signal (not muscle-specific), so it only
  // ever contributes a small nudge — see globalSorenessAdj weight below.
  const globalSorenessAdj = soreness === null ? 50 : (5 - soreness) * 25;

  return Object.keys(targets).map((muscle) => {
    const sets = weekSets[muscle] || 0;
    const target = targets[muscle];
    const ratio = target > 0 ? sets / target : 0;
    const volumeScore = Math.min(100, ratio * 100);

    const lastMs = lastTrainedMs[muscle];
    const daysSinceTrained = lastMs === undefined ? null : daysBetween(now.getTime(), lastMs);
    const halfLife = RECOVERY_HALF_LIFE_DAYS[muscle] || 2;
    const recencyScore = daysSinceTrained === null ? 0 : 100 * Math.pow(0.5, daysSinceTrained / halfLife);

    const fatigueScore = Math.max(0, Math.min(100,
      volumeScore * 0.55 + recencyScore * 0.35 + globalSorenessAdj * 0.10
    ));

    return {
      muscle,
      sets,
      target,
      ratio,
      daysSinceTrained,
      fatigueScore,
      status: fatigueStatus(fatigueScore),
      color: fatigueToColor(fatigueScore)
    };
  }).sort((a, b) => b.fatigueScore - a.fatigueScore);
}

if (typeof module !== 'undefined') {
  module.exports = {
    DEFAULT_WEEKLY_MUSCLE_TARGETS,
    RECOVERY_HALF_LIFE_DAYS,
    MUSCLE_TARGET_BOUNDS,
    clampMuscleTarget,
    fatigueToColor,
    fatigueStatus,
    computeMuscleRecoverySummary
  };
}
if (typeof window !== 'undefined') {
  window.DEFAULT_WEEKLY_MUSCLE_TARGETS = DEFAULT_WEEKLY_MUSCLE_TARGETS;
  window.MUSCLE_TARGET_BOUNDS = MUSCLE_TARGET_BOUNDS;
  window.clampMuscleTarget = clampMuscleTarget;
  window.fatigueToColor = fatigueToColor;
  window.fatigueStatus = fatigueStatus;
  window.computeMuscleRecoverySummary = computeMuscleRecoverySummary;
}
