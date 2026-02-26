const STORAGE_KEY = "program_builder_v2_draft";

export function createEmptyDraft() {
  return {
    split: "upper-lower",
    days: [
      { id: "day-1", name: "Day 1", focus: "Upper", exercises: [] },
      { id: "day-2", name: "Day 2", focus: "Lower", exercises: [] }
    ],
    notes: "",
    schedule: {
      startDate: "",
      trainingDays: []
    },
    metadata: {
      name: "",
      goal: ""
    }
  };
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyDraft();
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : createEmptyDraft();
  } catch (_error) {
    return createEmptyDraft();
  }
}

export function saveDraft(draft) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
}

export function computeProgramSummary(draft) {
  const dayCount = Array.isArray(draft?.days) ? draft.days.length : 0;
  const exerciseCount = (draft?.days || []).reduce(
    (count, day) => count + (Array.isArray(day.exercises) ? day.exercises.length : 0),
    0
  );
  const scheduledDays = Array.isArray(draft?.schedule?.trainingDays) ? draft.schedule.trainingDays.length : 0;

  return {
    name: draft?.metadata?.name || "Untitled Program",
    split: draft?.split || "-",
    goal: draft?.metadata?.goal || "-",
    dayCount,
    exerciseCount,
    scheduledDays
  };
}

export function validateStep(stepId, draft) {
  switch (stepId) {
    case "split":
      return Boolean(draft?.split);
    case "days":
      return Array.isArray(draft?.days) && draft.days.length > 0;
    case "review":
      return true;
    case "schedule":
      return Array.isArray(draft?.schedule?.trainingDays) && draft.schedule.trainingDays.length > 0;
    case "save":
      return Boolean(draft?.metadata?.name);
    default:
      return false;
  }
}
