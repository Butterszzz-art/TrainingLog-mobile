(function (global) {
  const PROGRAM_STORAGE_KEY = "programs";
  const PROGRAM_DRAFT_STORAGE_KEY = "programBuilderV2Draft";
  const DRAFT_STORAGE_PREFIX = "programBuilderV2Draft:";
  const PROGRAM_SCHEMA_VERSION = 2;
  const DEFAULT_GOAL = "hypertrophy";

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
      name: "",
      goal: DEFAULT_GOAL,
      split: { type: "custom", daysPerWeek: 3 },
      days: [],
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

    return {
      ...base,
      ...source,
      schemaVersion: PROGRAM_SCHEMA_VERSION,
      goal: typeof source.goal === "string" && source.goal.trim() ? source.goal : DEFAULT_GOAL,
      split: {
        ...base.split,
        ...(source.split && typeof source.split === "object" ? source.split : {}),
        daysPerWeek: Number(source.split && source.split.daysPerWeek) > 0 ? Math.floor(Number(source.split.daysPerWeek)) : base.split.daysPerWeek,
      },
      days: Array.isArray(source.days) ? source.days : [],
      schedule: {
        ...base.schedule,
        ...(source.schedule && typeof source.schedule === "object" ? source.schedule : {}),
        weekdays: Array.isArray(source.schedule && source.schedule.weekdays)
          ? source.schedule.weekdays.filter(function (weekday) {
              return typeof weekday === "string" && weekday.trim();
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
      name: normalized.name || "Untitled Program",
      split: normalized.split && normalized.split.type ? normalized.split.type : "-",
      goal: normalized.goal || "-",
      dayCount: normalized.days.length,
      exerciseCount: exerciseCount,
      scheduledDays: normalized.schedule.weekdays.length,
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

  function loadProgramTemplates() {
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
    loadProgramTemplates();

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

  const api = {
    PROGRAM_STORAGE_KEY,
    PROGRAM_DRAFT_STORAGE_KEY,
    PROGRAM_SCHEMA_VERSION,
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
    loadProgramTemplates,
    initProgramBuilder,
  };

  global.programBuilderV2Core = api;

  // Required global assignments for legacy callers.
  global.toggleProgramBuilder = toggleProgramBuilder;
  global.loadProgramTemplates = loadProgramTemplates;
  global.initProgramBuilder = initProgramBuilder;

  if (typeof window !== "undefined") {
    window.toggleProgramBuilder = toggleProgramBuilder;
    window.loadProgramTemplates = loadProgramTemplates;
    window.initProgramBuilder = initProgramBuilder;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
