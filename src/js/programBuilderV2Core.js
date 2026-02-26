(function (global, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    global.programBuilderV2Core = factory();
  }
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
    ? globalThis
    : this,
  function () {
    const PROGRAM_STORAGE_KEY = "programs";
    const PROGRAM_DRAFT_STORAGE_KEY = "programBuilderV2Draft";

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
        program?.varietySettings?.autoInsertSuggestions ?? program.autoInsertVariety
      );

      return {
        ...draft,
        ...program,
        name: typeof program.name === "string" ? program.name : draft.name,
        startDate: typeof program.startDate === "string" ? program.startDate : draft.startDate,
        frequency: Array.isArray(program.frequency) ? [...program.frequency] : [],
        progressionType:
          typeof program.progressionType === "string"
            ? program.progressionType
            : typeof program.progression === "string"
            ? program.progression
            : draft.progressionType,
        splitMode: typeof program.splitMode === "string" ? program.splitMode : draft.splitMode,
        varietySettings: {
          autoInsertSuggestions,
        },
      };
    }

    function summarizeProgram(program) {
      const normalized = normalizeProgram(program);
      const deloadWeeks = normalized?.recommendations?.deloadPlan?.recommendedDeloadWeeks;
      const autoInserted = Array.isArray(normalized?.recommendations?.autoInsertedExercises)
        ? normalized.recommendations.autoInsertedExercises.length
        : 0;

      return {
        name: normalized.name,
        startDate: normalized.startDate,
        frequency: normalized.frequency.length ? normalized.frequency.join(", ") : "-",
        progressionType: normalized.progressionType,
        splitMode: normalized.splitMode,
        deloadWeeks:
          Array.isArray(deloadWeeks) && deloadWeeks.length ? deloadWeeks.join(", ") : "None",
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
      if (!globalObj?.localStorage) return [];
      return parsePrograms(globalObj.localStorage.getItem(PROGRAM_STORAGE_KEY));
    }

    function savePrograms(globalObj, programs) {
      if (!globalObj?.localStorage) return;
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
        ? existing.map((entry, entryIndex) => (entryIndex === index ? normalized : entry))
        : [...existing, normalized];
      savePrograms(globalObj, next);
      return { programs: next, program: normalized };
    }

    function loadDraft(globalObj) {
      if (!globalObj?.localStorage) return defaultProgramDraft();
      try {
        return normalizeProgram(
          JSON.parse(globalObj.localStorage.getItem(PROGRAM_DRAFT_STORAGE_KEY) || "null")
        );
      } catch (_error) {
        return defaultProgramDraft();
      }
    }

    function saveDraft(globalObj, draft) {
      if (!globalObj?.localStorage) return;
      globalObj.localStorage.setItem(
        PROGRAM_DRAFT_STORAGE_KEY,
        JSON.stringify(normalizeProgram(draft))
      );
    }

    function clearDraft(globalObj) {
      if (!globalObj?.localStorage) return;
      globalObj.localStorage.removeItem(PROGRAM_DRAFT_STORAGE_KEY);
    }

    return {
      PROGRAM_STORAGE_KEY,
      PROGRAM_DRAFT_STORAGE_KEY,
      defaultProgramDraft,
      normalizeProgram,
      summarizeProgram,
      loadPrograms,
      savePrograms,
      upsertProgram,
      loadDraft,
      saveDraft,
      clearDraft,
    };
  }
);
