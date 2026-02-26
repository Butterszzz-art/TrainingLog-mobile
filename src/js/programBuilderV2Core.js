export const PROGRAM_SCHEMA_VERSION = 2;

const DRAFT_STORAGE_PREFIX = "programBuilderV2Draft:";
const DEFAULT_GOAL = "hypertrophy";

function getStorage() {
  if (typeof globalThis === "undefined" || !globalThis.localStorage) return null;
  return globalThis.localStorage;
}

function nowIso() {
  return new Date().toISOString();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeExercise(exercise) {
  const source = isObject(exercise) ? exercise : {};
  const directSets = toPositiveInt(source.sets, 0);
  const setList = toArray(source.setList).concat(toArray(source.loggedSets));
  const listSets = setList.reduce((count, setEntry) => {
    if (!isObject(setEntry)) return count;
    const reps = Number(setEntry.reps);
    return count + (Number.isFinite(reps) && reps >= 0 ? 1 : 1);
  }, 0);

  return {
    ...source,
    name: typeof source.name === "string" ? source.name : "",
    muscle:
      typeof source.muscle === "string"
        ? source.muscle.trim().toLowerCase()
        : typeof source.primaryMuscle === "string"
        ? source.primaryMuscle.trim().toLowerCase()
        : typeof source.muscleGroup === "string"
        ? source.muscleGroup.trim().toLowerCase()
        : "unknown",
    sets: directSets || listSets,
  };
}

function normalizeDay(day, index) {
  const source = isObject(day) ? day : {};
  const exercises = toArray(source.exercises).map(normalizeExercise);

  return {
    ...source,
    id: source.id || `day-${index + 1}`,
    name: typeof source.name === "string" ? source.name : `Day ${index + 1}`,
    exercises,
  };
}

function draftStorageKey(userId) {
  return `${DRAFT_STORAGE_PREFIX}${userId || "anonymous"}`;
}

export function createEmptyDraft(userId) {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROGRAM_SCHEMA_VERSION,
    programId: null,
    userId,
    name: "",
    goal: "hypertrophy",
    split: { type: "custom", daysPerWeek: 3 },
    days: [],
    schedule: { startDate: "", weekdays: [] },
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeDraft(draft) {
  const base = createEmptyDraft(draft && draft.userId);
  const source = isObject(draft) ? draft : {};

  const normalized = {
    ...base,
    ...source,
    schemaVersion: PROGRAM_SCHEMA_VERSION,
    goal: typeof source.goal === "string" && source.goal.trim() ? source.goal : DEFAULT_GOAL,
    split: {
      ...base.split,
      ...(isObject(source.split) ? source.split : {}),
      daysPerWeek: toPositiveInt(source?.split?.daysPerWeek, base.split.daysPerWeek),
    },
    days: toArray(source.days).map(normalizeDay),
    schedule: {
      ...base.schedule,
      ...(isObject(source.schedule) ? source.schedule : {}),
      weekdays: toArray(source?.schedule?.weekdays)
        .filter((weekday) => typeof weekday === "string")
        .map((weekday) => weekday.trim())
        .filter(Boolean),
    },
    createdAt: typeof source.createdAt === "string" && source.createdAt ? source.createdAt : nowIso(),
    updatedAt: nowIso(),
  };

  return normalized;
}

export function saveDraft(userId, draft) {
  const storage = getStorage();
  const normalized = normalizeDraft({ ...draft, userId: draft?.userId || userId });

  if (!storage) return normalized;

  storage.setItem(draftStorageKey(userId), JSON.stringify(normalized));
  return normalized;
}

export function loadDraft(userId) {
  const storage = getStorage();
  if (!storage) return createEmptyDraft(userId);

  try {
    const raw = storage.getItem(draftStorageKey(userId));
    if (!raw) return createEmptyDraft(userId);
    return normalizeDraft({ ...JSON.parse(raw), userId });
  } catch (_error) {
    return createEmptyDraft(userId);
  }
}

export function clearDraft(userId) {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(draftStorageKey(userId));
}

export function computeProgramSummary(draft) {
  const normalized = normalizeDraft(draft);
  const setsByMuscle = {};
  const muscleDayMap = {};

  let totalExercises = 0;
  let totalSets = 0;

  normalized.days.forEach((day) => {
    const seenToday = new Set();

    day.exercises.forEach((exercise) => {
      totalExercises += 1;
      totalSets += exercise.sets;
      setsByMuscle[exercise.muscle] = (setsByMuscle[exercise.muscle] || 0) + exercise.sets;
      seenToday.add(exercise.muscle);
    });

    seenToday.forEach((muscle) => {
      if (!muscleDayMap[muscle]) muscleDayMap[muscle] = new Set();
      muscleDayMap[muscle].add(day.id);
    });
  });

  const frequencyByMuscle = Object.fromEntries(
    Object.entries(muscleDayMap).map(([muscle, days]) => [muscle, days.size])
  );

  const warnings = [];
  if (!normalized.name.trim()) {
    warnings.push({ code: "MISSING_NAME", message: "Program name is empty." });
  }
  if (normalized.days.length === 0) {
    warnings.push({ code: "NO_DAYS", message: "No training days have been added." });
  }
  if (totalExercises === 0) {
    warnings.push({ code: "NO_EXERCISES", message: "No exercises were added to this program." });
  }
  if (totalSets === 0 && totalExercises > 0) {
    warnings.push({ code: "NO_SETS", message: "Exercises exist but no sets were configured." });
  }

  return {
    totalDays: normalized.days.length,
    totalExercises,
    totalSets,
    setsByMuscle,
    frequencyByMuscle,
    warnings,
  };
}

export function validateStep(draft, stepId) {
  const normalized = normalizeDraft(draft);
  const summary = computeProgramSummary(normalized);
  const errors = [];

  switch (stepId) {
    case "details":
    case "program-details":
      if (!normalized.name.trim()) errors.push("Program name is required.");
      if (!normalized.goal) errors.push("Program goal is required.");
      break;
    case "split":
      if (!normalized.split.type) errors.push("Split type is required.");
      if (normalized.split.daysPerWeek < 1) errors.push("Days per week must be at least 1.");
      break;
    case "days":
      if (summary.totalDays < 1) errors.push("Add at least one training day.");
      if (summary.totalExercises < 1) errors.push("Add at least one exercise.");
      break;
    case "schedule":
      if (!normalized.schedule.startDate) errors.push("Start date is required.");
      if (normalized.schedule.weekdays.length < 1) errors.push("Select at least one weekday.");
      break;
    case "review":
      if (summary.totalDays < 1 || summary.totalExercises < 1 || summary.totalSets < 1) {
        errors.push("Program must include days, exercises, and sets before review.");
      }
      break;
    default:
      if (summary.totalDays < 1) errors.push("Draft is incomplete.");
  }

  return {
    stepId,
    isValid: errors.length === 0,
    errors,
    warnings: summary.warnings,
  };
}
