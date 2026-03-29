(function (global) {
  const PROGRAM_STORAGE_KEY = "programs";
  const PROGRAM_DRAFT_STORAGE_KEY = "programBuilderV2Draft";
  const DRAFT_STORAGE_PREFIX = "programBuilderV2Draft:";
  const PROGRAM_SCHEMA_VERSION = 2;
  const DEFAULT_GOAL = "hypertrophy";
  const PROGRAM_TEMPLATE_STORAGE_KEY = "programTemplates";
  const PROGRAM_ASSIGNMENT_STORAGE_KEY = "programAssignments";

  function createDefaultSet() {
    return {
      setType: "straight",
      reps: 8,
      weight: null,
      rpe: null,
      rir: null,
      restSec: 120,
    };
  }

  function createDefaultExercise(overrides) {
    const source = overrides && typeof overrides === "object" ? overrides : {};
    return {
      exerciseId: typeof source.exerciseId === "string" && source.exerciseId ? source.exerciseId : null,
      name: typeof source.name === "string" ? source.name : "",
      notes: typeof source.notes === "string" ? source.notes : "",
      rirNote: typeof source.rirNote === "string" ? source.rirNote : "",
      rpeNote: typeof source.rpeNote === "string" ? source.rpeNote : "",
      progressionNotes: typeof source.progressionNotes === "string" ? source.progressionNotes : "",
      archetypeTags: Array.isArray(source.archetypeTags) ? source.archetypeTags.slice() : [],
      sets: [createDefaultSet()],
    };
  }

  function defaultProgramDraft() {
    return {
      name: "",
      startDate: "",
      frequency: [],
      progressionType: "linear",
      splitMode: "full-body",
      varietySettings: { autoInsertSuggestions: false },
    };
  }

  function normalizeProgram(program) {
    const draft = defaultProgramDraft();
    if (!program || typeof program !== "object") return draft;

    const autoInsertSuggestions = Boolean(
      program.varietySettings && program.varietySettings.autoInsertSuggestions
    );

    return {
      ...draft,
      ...program,
      name: typeof program.name === "string" ? program.name : draft.name,
      startDate: typeof program.startDate === "string" ? program.startDate : draft.startDate,
      frequency: Array.isArray(program.frequency) ? program.frequency.slice() : [],
      progressionType:
        typeof program.progressionType === "string"
          ? program.progressionType
          : typeof program.progression === "string"
          ? program.progression
          : draft.progressionType,
      splitMode: typeof program.splitMode === "string" ? program.splitMode : draft.splitMode,
      varietySettings: {
        autoInsertSuggestions: Boolean(autoInsertSuggestions || program.autoInsertVariety),
      },
    };
  }

  function summarizeProgram(program) {
    const normalized = normalizeProgram(program);
    const deloadWeeks =
      normalized && normalized.recommendations && normalized.recommendations.deloadPlan
        ? normalized.recommendations.deloadPlan.recommendedDeloadWeeks
        : null;
    const autoInserted =
      normalized && normalized.recommendations && Array.isArray(normalized.recommendations.autoInsertedExercises)
        ? normalized.recommendations.autoInsertedExercises.length
        : 0;

    return {
      name: normalized.name,
      startDate: normalized.startDate,
      frequency: normalized.frequency.length ? normalized.frequency.join(", ") : "-",
      progressionType: normalized.progressionType,
      splitMode: normalized.splitMode,
      deloadWeeks: Array.isArray(deloadWeeks) && deloadWeeks.length ? deloadWeeks.join(", ") : "None",
      autoInserted,
    };
  }

  function parsePrograms(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(normalizeProgram) : [];
    } catch (_error) {
      return [];
    }
  }

  function loadPrograms(globalObj) {
    if (!globalObj || !globalObj.localStorage) return [];
    return parsePrograms(globalObj.localStorage.getItem(PROGRAM_STORAGE_KEY));
  }

  function savePrograms(globalObj, programs) {
    if (!globalObj || !globalObj.localStorage) return;
    globalObj.localStorage.setItem(
      PROGRAM_STORAGE_KEY,
      JSON.stringify(Array.isArray(programs) ? programs.map(normalizeProgram) : [])
    );
  }

  function upsertProgram(globalObj, program, index) {
    const existing = loadPrograms(globalObj);
    const normalized = normalizeProgram(program);
    const hasIndex = Number.isInteger(index) && index >= 0 && index < existing.length;
    const next = hasIndex
      ? existing.map(function (entry, entryIndex) {
          return entryIndex === index ? normalized : entry;
        })
      : existing.concat([normalized]);
    savePrograms(globalObj, next);
    return { programs: next, program: normalized };
  }

  function draftStorageKey(userId) {
    return "" + DRAFT_STORAGE_PREFIX + (userId || "anonymous");
  }

  function createEmptyDraft(userId) {
    const now = new Date().toISOString();
    return {
      schemaVersion: PROGRAM_SCHEMA_VERSION,
      programId: null,
      userId: userId || null,
      coachId: userId || null,
      clientId: null,
      name: "",
      title: "",
      goal: DEFAULT_GOAL,
      split: { type: "custom", name: "", daysPerWeek: 3 },
      archetype: "general",
      days: [],
      progressionNotes: "",
      schedule: { startDate: "", weekdays: [] },
      createdAt: now,
      updatedAt: now,
    };
  }

  function loadDraft(globalObjOrUserId, maybeUserId) {
    if (typeof globalObjOrUserId === "object" && globalObjOrUserId && globalObjOrUserId.localStorage) {
      const globalObj = globalObjOrUserId;
      try {
        return normalizeProgram(JSON.parse(globalObj.localStorage.getItem(PROGRAM_DRAFT_STORAGE_KEY) || "null"));
      } catch (_error) {
        return defaultProgramDraft();
      }
    }

    const userId = typeof globalObjOrUserId === "string" ? globalObjOrUserId : maybeUserId;
    if (!global.localStorage) return createEmptyDraft(userId);

    try {
      const raw = global.localStorage.getItem(draftStorageKey(userId));
      if (!raw) return createEmptyDraft(userId);
      const parsed = JSON.parse(raw);
      return normalizeDraft(parsed);
    } catch (_error) {
      return createEmptyDraft(userId);
    }
  }

  function saveDraft(globalObjOrUserId, maybeDraft) {
    if (typeof globalObjOrUserId === "object" && globalObjOrUserId && globalObjOrUserId.localStorage) {
      globalObjOrUserId.localStorage.setItem(
        PROGRAM_DRAFT_STORAGE_KEY,
        JSON.stringify(normalizeProgram(maybeDraft))
      );
      return normalizeProgram(maybeDraft);
    }

    const userId = typeof globalObjOrUserId === "string" ? globalObjOrUserId : null;
    const draft = userId ? maybeDraft : globalObjOrUserId;
    const normalized = normalizeDraft(draft);
    if (!global.localStorage) return normalized;
    global.localStorage.setItem(draftStorageKey(userId), JSON.stringify(normalized));
    return normalized;
  }

  function clearDraft(globalObjOrUserId) {
    if (typeof globalObjOrUserId === "object" && globalObjOrUserId && globalObjOrUserId.localStorage) {
      globalObjOrUserId.localStorage.removeItem(PROGRAM_DRAFT_STORAGE_KEY);
      return;
    }

    const userId = typeof globalObjOrUserId === "string" ? globalObjOrUserId : null;
    if (!global.localStorage) return;
    global.localStorage.removeItem(draftStorageKey(userId));
  }

  function normalizeDraft(draft) {
    const base = createEmptyDraft(draft && draft.userId);
    const source = draft && typeof draft === "object" ? draft : {};

    const normalizedDays = Array.isArray(source.days)
      ? source.days.map(function (day, dayIndex) {
          const fallbackName = "Day " + (dayIndex + 1);
          const safeDay = day && typeof day === "object" ? day : {};
          const safeExercises = Array.isArray(safeDay.exercises) ? safeDay.exercises : [];
          return {
            dayId:
              typeof safeDay.dayId === "string" && safeDay.dayId.trim()
                ? safeDay.dayId
                : "day-" + dayIndex + "-" + Date.now(),
            name: typeof safeDay.name === "string" && safeDay.name.trim() ? safeDay.name.trim() : fallbackName,
            notes: typeof safeDay.notes === "string" ? safeDay.notes : "",
            exercises: safeExercises.map(function (exercise, exerciseIndex) {
              const safeExercise = exercise && typeof exercise === "object" ? exercise : {};
              const safeSets = Array.isArray(safeExercise.sets) ? safeExercise.sets : [];
              return {
                exerciseId:
                  typeof safeExercise.exerciseId === "string" && safeExercise.exerciseId.trim()
                    ? safeExercise.exerciseId
                    : "ex-" + dayIndex + "-" + exerciseIndex + "-" + Date.now(),
                name:
                  typeof safeExercise.name === "string" && safeExercise.name.trim()
                    ? safeExercise.name.trim()
                    : "Exercise " + (exerciseIndex + 1),
                notes: typeof safeExercise.notes === "string" ? safeExercise.notes : "",
                rirNote: typeof safeExercise.rirNote === "string" ? safeExercise.rirNote : "",
                rpeNote: typeof safeExercise.rpeNote === "string" ? safeExercise.rpeNote : "",
                progressionNotes:
                  typeof safeExercise.progressionNotes === "string" ? safeExercise.progressionNotes : "",
                archetypeTags: Array.isArray(safeExercise.archetypeTags)
                  ? safeExercise.archetypeTags.filter(function (tag) {
                      return typeof tag === "string" && tag.trim();
                    })
                  : [],
                sets: safeSets.map(function (set) {
                  const safeSet = set && typeof set === "object" ? set : {};
                  return {
                    setType: typeof safeSet.setType === "string" && safeSet.setType ? safeSet.setType : "straight",
                    reps: Number.isFinite(Number(safeSet.reps)) ? Number(safeSet.reps) : null,
                    weight: Number.isFinite(Number(safeSet.weight)) ? Number(safeSet.weight) : null,
                    rpe: Number.isFinite(Number(safeSet.rpe)) ? Number(safeSet.rpe) : null,
                    rir: Number.isFinite(Number(safeSet.rir)) ? Number(safeSet.rir) : null,
                    restSec: Number.isFinite(Number(safeSet.restSec)) ? Number(safeSet.restSec) : 120,
                  };
                }),
              };
            }),
          };
        })
      : [];

    return {
      ...base,
      ...source,
      schemaVersion: PROGRAM_SCHEMA_VERSION,
      coachId:
        typeof source.coachId === "string" && source.coachId.trim()
          ? source.coachId
          : typeof source.userId === "string" && source.userId.trim()
          ? source.userId
          : base.coachId,
      clientId: typeof source.clientId === "string" && source.clientId.trim() ? source.clientId : null,
      name: typeof source.name === "string" ? source.name : base.name,
      title:
        typeof source.title === "string" && source.title.trim()
          ? source.title
          : typeof source.name === "string"
          ? source.name
          : base.title,
      goal: typeof source.goal === "string" && source.goal.trim() ? source.goal : DEFAULT_GOAL,
      archetype:
        typeof source.archetype === "string" && source.archetype.trim() ? source.archetype : base.archetype,
      split: {
        ...base.split,
        ...(source.split && typeof source.split === "object" ? source.split : {}),
        name:
          source.split && typeof source.split.name === "string" ? source.split.name : base.split.name,
        daysPerWeek:
          Number(source.split && source.split.daysPerWeek) > 0
            ? Math.floor(Number(source.split.daysPerWeek))
            : base.split.daysPerWeek,
      },
      days: normalizedDays,
      progressionNotes: typeof source.progressionNotes === "string" ? source.progressionNotes : "",
      schedule: {
        ...base.schedule,
        ...(source.schedule && typeof source.schedule === "object" ? source.schedule : {}),
        weekdays: Array.isArray(source.schedule && source.schedule.weekdays)
          ? source.schedule.weekdays.filter(function (weekday) {
              return Number.isInteger(weekday) && weekday >= 1 && weekday <= 7;
            })
          : [],
      },
      createdAt: typeof source.createdAt === "string" && source.createdAt ? source.createdAt : base.createdAt,
      updatedAt: new Date().toISOString(),
    };
  }

  function computeProgramSummary(draft) {
    const normalized = normalizeDraft(draft);
    let exerciseCount = 0;

    normalized.days.forEach(function (day) {
      if (Array.isArray(day.exercises)) {
        exerciseCount += day.exercises.length;
      }
    });

    return {
      name: normalized.name || normalized.title || "Untitled Program",
      split: normalized.split && normalized.split.type ? normalized.split.type : "-",
      splitName: normalized.split && normalized.split.name ? normalized.split.name : "-",
      goal: normalized.goal || "-",
      archetype: normalized.archetype || "general",
      dayCount: normalized.days.length,
      exerciseCount: exerciseCount,
      scheduledDays: normalized.schedule.weekdays.length,
      progressionNotes: normalized.progressionNotes || "",
    };
  }

  function validateStep(stepId, draft) {
    const normalized = normalizeDraft(draft);
    switch (stepId) {
      case "split":
        return Boolean(normalized.split && normalized.split.type);
      case "days":
        return Array.isArray(normalized.days) && normalized.days.length > 0;
      case "review":
        return true;
      case "schedule":
        return normalized.schedule.weekdays.length > 0;
      case "save":
        return Boolean((normalized.name || "").trim());
      default:
        return false;
    }
  }

  function toggleProgramBuilder(forceState) {
    const doc = global.document;
    const panel =
      doc &&
      (doc.getElementById("programBuilderModal") ||
        doc.getElementById("programBuilder") ||
        doc.getElementById("programBuilderV2") ||
        doc.getElementById("programModal") ||
        doc.getElementById("programBuilderContainer") ||
        doc.getElementById("programTabContent"));

    if (!panel) return false;

    if (typeof panel.showModal === "function" && typeof panel.close === "function") {
      const shouldOpen = typeof forceState === "boolean" ? forceState : !panel.open;
      if (shouldOpen && !panel.open) panel.showModal();
      if (!shouldOpen && panel.open) panel.close();
      return shouldOpen;
    }

    const isVisible = panel.style.display !== "none";
    const shouldShow = typeof forceState === "boolean" ? forceState : !isVisible;
    panel.style.display = shouldShow ? "" : "none";
    panel.classList.toggle("open", shouldShow);
    return shouldShow;
  }

  function populateProgramTemplateSelect() {
    const programs = loadPrograms(global);
    if (!global.document) return programs;

    const select = global.document.getElementById("programTemplateSelect") || global.document.getElementById("programDropdown");
    if (select) {
      select.innerHTML = "";
      const placeholder = global.document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select program";
      select.appendChild(placeholder);

      programs.forEach(function (program, index) {
        const option = global.document.createElement("option");
        option.value = String(index);
        option.textContent = program.name || "Unnamed program";
        select.appendChild(option);
      });
    }

    return programs;
  }

  function initProgramBuilder() {
    populateProgramTemplateSelect();

    const activeUser =
      typeof global.getActiveUsername === "function"
        ? global.getActiveUsername()
        : global.localStorage &&
            (global.localStorage.getItem("currentUser") ||
              global.localStorage.getItem("username") ||
              global.localStorage.getItem("Username"));
    global.__programDraft = loadDraft(activeUser || null);
    global.__programState = {
      userId: activeUser || null,
      initialized: true,
      initializedAt: new Date().toISOString(),
    };

    if (!global.document) return true;

    const container = global.document.getElementById("programBuilderContainer");
    if (container) {
      container.style.display = "";

      // ✅ Do NOT use hasChildNodes(); your HTML contains layout shells.
      // Mount once using a guard flag.
      if (!container.__programBuilderMounted) {
        container.__programBuilderMounted = true;

        // Use a dedicated mount root so background/layout shells can exist safely.
        let mount = container.querySelector("#programBuilderV2Mount");
        if (!mount) {
          mount = global.document.createElement("div");
          mount.id = "programBuilderV2Mount";
          container.appendChild(mount);
        }

        if (typeof global.initProgramTabV2 === "function") {
          global.initProgramTabV2(mount);
        } else if (typeof global.initProgramTab === "function") {
          global.initProgramTab(mount);
        } else {
          mount.innerHTML =
            "<div style='padding:12px;opacity:.8'>Program UI missing: init function not found.</div>";
        }
      }
    }

    const tabContent = global.document.getElementById("programTabContent");
    if (tabContent) tabContent.style.display = "";

    return true;
  }



  function parseCollection(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function loadCoachTemplates(globalObj) {
    if (!globalObj || !globalObj.localStorage) return [];
    return parseCollection(globalObj.localStorage.getItem(PROGRAM_TEMPLATE_STORAGE_KEY));
  }

  function saveProgramTemplate(globalObj, template) {
    if (!globalObj || !globalObj.localStorage) return null;
    const templates = loadCoachTemplates(globalObj);
    const normalized = normalizeDraft(template);
    const entry = {
      ...normalized,
      templateId: normalized.templateId || "tpl-" + Date.now(),
      sourceProgramId: normalized.programId || null,
      savedAt: new Date().toISOString(),
      kind: "coach_template",
    };
    templates.push(entry);
    globalObj.localStorage.setItem(PROGRAM_TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    return entry;
  }

  function duplicateProgramTemplate(globalObj, templateId) {
    const templates = loadCoachTemplates(globalObj);
    const source =
      templates.find(function (tpl) {
        return tpl.templateId === templateId;
      }) ||
      (templates.length ? templates[templates.length - 1] : null);
    if (!source) return null;
    return saveProgramTemplate(globalObj, {
      ...source,
      templateId: null,
      title: (source.title || source.name || "Template") + " (Copy)",
      name: source.name || source.title || "",
    });
  }

  function loadProgramAssignments(globalObj) {
    if (!globalObj || !globalObj.localStorage) return [];
    return parseCollection(globalObj.localStorage.getItem(PROGRAM_ASSIGNMENT_STORAGE_KEY));
  }

  function assignProgramToClient(globalObj, assignment) {
    if (!globalObj || !globalObj.localStorage) return null;
    const all = loadProgramAssignments(globalObj);
    const normalizedProgram = normalizeDraft(assignment && assignment.program);
    const record = {
      assignmentId: "asn-" + Date.now(),
      coachId: assignment && assignment.coachId ? assignment.coachId : normalizedProgram.coachId || null,
      clientId: assignment && assignment.clientId ? assignment.clientId : null,
      clientName: assignment && assignment.clientName ? assignment.clientName : "",
      archetype: assignment && assignment.archetype ? assignment.archetype : normalizedProgram.archetype || "general",
      assignedAt: new Date().toISOString(),
      status: "active",
      notes: assignment && assignment.notes ? assignment.notes : "",
      program: normalizedProgram,
    };
    all.push(record);
    globalObj.localStorage.setItem(PROGRAM_ASSIGNMENT_STORAGE_KEY, JSON.stringify(all));
    return record;
  }

  const api = {
    PROGRAM_STORAGE_KEY,
    PROGRAM_DRAFT_STORAGE_KEY,
    PROGRAM_SCHEMA_VERSION,
    PROGRAM_TEMPLATE_STORAGE_KEY,
    PROGRAM_ASSIGNMENT_STORAGE_KEY,
    createDefaultSet,
    createDefaultExercise,
    defaultProgramDraft,
    normalizeProgram,
    summarizeProgram,
    loadPrograms,
    savePrograms,
    upsertProgram,
    createEmptyDraft,
    normalizeDraft,
    loadDraft,
    saveDraft,
    clearDraft,
    computeProgramSummary,
    validateStep,
    toggleProgramBuilder,
    populateProgramTemplateSelect,
    initProgramBuilder,
    loadCoachTemplates,
    saveProgramTemplate,
    duplicateProgramTemplate,
    loadProgramAssignments,
    assignProgramToClient,
  };

  global.programBuilderV2Core = api;

  // Required global assignments for legacy callers.
  global.toggleProgramBuilder = toggleProgramBuilder;
  global.loadProgramTemplates = populateProgramTemplateSelect;
  global.initProgramBuilder = initProgramBuilder;

  if (typeof window !== "undefined") {
    window.toggleProgramBuilder = toggleProgramBuilder;
    window.loadProgramTemplates = populateProgramTemplateSelect;
    window.initProgramBuilder = initProgramBuilder;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
