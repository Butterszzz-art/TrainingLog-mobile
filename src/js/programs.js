(function (global, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory(global || globalThis);
  } else {
    const api = factory(global || globalThis);
    if (global) {
      global.ProgramModule = api;
    }
  }
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
    ? globalThis
    : this,
  function (global) {
    const STORAGE_KEY = "programs";
    const HISTORY_KEYS = ["workoutHistory", "resistanceLogs", "tl_workout_history_v1"];
    const FREQUENCY_DAYS = ["Mon", "Wed", "Fri"];
    const DEFAULT_VARIETY_SETTINGS = {
      autoInsertSuggestions: false,
    };
    const existingToast =
      global && typeof global.showToast === "function" ? global.showToast : null;
    const varietyEngine =
      (global && global.exerciseVarietyEngine) ||
      (typeof require === "function" ? require("../../exerciseVarietyEngine") : null);

    function isBrowser() {
      return Boolean(global && global.document);
    }

    function getElement(id) {
      if (!isBrowser()) return null;
      return global.document.getElementById(id);
    }

    function getInputValue(id) {
      const el = getElement(id);
      if (!el || typeof el.value !== "string") return "";
      return el.value.trim();
    }

    function setInputValue(id, value) {
      const el = getElement(id);
      if (!el) return;
      el.value = value;
    }

    function getSelectValue(id) {
      const el = getElement(id);
      if (!el || typeof el.value !== "string") return "";
      return el.value;
    }

    function getCheckboxState(id) {
      const el = getElement(id);
      if (!el) return false;
      return Boolean(el.checked);
    }

    function setCheckboxState(id, state) {
      const el = getElement(id);
      if (!el) return;
      el.checked = Boolean(state);
    }

    function showToast(message) {
      if (existingToast && existingToast !== showToast) {
        existingToast(message);
        return;
      }

      if (isBrowser() && typeof global.alert === "function") {
        global.alert(message);
      } else {
        console.log(message);
      }
    }

    function loadStoredPrograms() {
      if (!global || !global.localStorage) return [];
      try {
        const raw = global.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.error("Failed to load saved programs", error);
        return [];
      }
    }

    function persistPrograms(list) {
      if (!global || !global.localStorage) return;
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch (error) {
        console.error("Failed to save programs", error);
      }
    }

    function cloneProgram(program) {
      if (!program || typeof program !== "object") {
        return {
          name: "",
          startDate: "",
          frequency: [],
          progression: "",
          splitMode: "",
          varietySettings: { ...DEFAULT_VARIETY_SETTINGS },
          recommendations: null,
        };
      }
      return {
        name: program.name || "",
        startDate: program.startDate || "",
        frequency: Array.isArray(program.frequency)
          ? [...program.frequency]
          : [],
        progression: program.progression || "",
        splitMode: program.splitMode || "",
        varietySettings: {
          ...DEFAULT_VARIETY_SETTINGS,
          ...(program.varietySettings || {}),
        },
        recommendations: program.recommendations || null,
      };
    }

    function parseJsonArray(value) {
      if (!value) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    function loadWorkoutHistory() {
      if (!global || !global.localStorage) return [];
      const combined = [];

      HISTORY_KEYS.forEach((key) => {
        parseJsonArray(global.localStorage.getItem(key)).forEach((entry) => {
          combined.push(entry);
        });
      });

      return combined;
    }

    function createAutoInsertedExercisePlan(suggestedVarietyExercises, frequency) {
      const suggestions = Object.entries(suggestedVarietyExercises || {}).flatMap(
        ([muscle, exercises]) =>
          (Array.isArray(exercises) ? exercises : []).map((exercise) => ({
            muscle,
            name: exercise,
          }))
      );

      if (!suggestions.length || !Array.isArray(frequency) || !frequency.length) {
        return [];
      }

      return suggestions.map((suggestion, index) => ({
        day: frequency[index % frequency.length],
        muscle: suggestion.muscle,
        exercise: suggestion.name,
      }));
    }

    function buildVarietyRecommendations(program) {
      if (!varietyEngine || typeof varietyEngine.buildProgramVarietyRecommendations !== "function") {
        return null;
      }

      const recommendations = varietyEngine.buildProgramVarietyRecommendations(loadWorkoutHistory());
      const autoInsertSuggestions = Boolean(program?.varietySettings?.autoInsertSuggestions);

      return {
        ...recommendations,
        autoInsertedExercises: autoInsertSuggestions
          ? createAutoInsertedExercisePlan(recommendations.suggestedVarietyExercises, program.frequency)
          : [],
      };
    }

    function renderVarietyPreview() {
      const target = getElement("programVarietyPreview");
      if (!target || !varietyEngine || typeof varietyEngine.buildProgramVarietyRecommendations !== "function") {
        return;
      }

      const recommendations = varietyEngine.buildProgramVarietyRecommendations(loadWorkoutHistory());
      const totalVariety = Object.values(recommendations.suggestedVarietyExercises || {}).reduce(
        (count, list) => count + (Array.isArray(list) ? list.length : 0),
        0
      );
      const lowProgressCount = Array.isArray(recommendations.lowProgressExercises)
        ? recommendations.lowProgressExercises.length
        : 0;
      const deloadWeeks = recommendations?.deloadPlan?.recommendedDeloadWeeks || [];

      target.innerHTML = `
        <strong>History-informed recommendations ready:</strong>
        ${totalVariety} variety suggestions,
        ${lowProgressCount} low-progress exercises flagged,
        deload weeks ${deloadWeeks.length ? deloadWeeks.join(", ") : "none"}.
      `;
    }

    let programs = loadStoredPrograms().map(cloneProgram);

    function getPrograms() {
      return programs.map(cloneProgram);
    }

    function setPrograms(list) {
      programs = Array.isArray(list) ? list.map(cloneProgram) : [];
      persistPrograms(programs);
      renderProgramList();
      return getPrograms();
    }

    function collectProgramFromForm() {
      const name = getInputValue("programName");
      const startDate = getInputValue("programStartDate");
      const progression = getSelectValue("programProgression") || "";
      const splitMode = getSelectValue("programSplit") || "";
      const frequency = FREQUENCY_DAYS.filter((day) => getCheckboxState(`freq${day}`));
      const autoInsertSuggestions = getCheckboxState("programAutoInsertVariety");

      if (!name || !startDate || frequency.length === 0) {
        return {
          error: "Please fill in all required fields",
        };
      }

      return {
        program: {
          name,
          startDate,
          frequency,
          progression,
          splitMode,
          varietySettings: {
            autoInsertSuggestions,
          },
        },
      };
    }

    function resetProgramForm() {
      setInputValue("programName", "");
      setInputValue("programStartDate", "");
      FREQUENCY_DAYS.forEach((day) => setCheckboxState(`freq${day}`, false));
      setInputValue("programProgression", "linear");
      setInputValue("programSplit", "full-body");
      setCheckboxState(
        "programAutoInsertVariety",
        DEFAULT_VARIETY_SETTINGS.autoInsertSuggestions
      );
    }

    function openProgramModal() {
      const modal = getElement("programModal");
      if (!modal) return;
      if (typeof modal.showModal === "function") {
        modal.showModal();
      } else {
        modal.removeAttribute("hidden");
      }
    }

    function closeProgramModal() {
      const modal = getElement("programModal");
      if (!modal) return;
      if (typeof modal.close === "function") {
        modal.close();
      } else {
        modal.setAttribute("hidden", "hidden");
      }
    }

    function escapeHtml(value) {
      if (typeof value !== "string") return "";
      return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function renderProgramList() {
      const container = getElement("programList");
      if (!container) return getPrograms();

      if (!programs.length) {
        container.innerHTML = '<li class="empty-state">No programs saved yet.</li>';
        return getPrograms();
      }

      container.innerHTML = programs
        .map((program) => {
          const frequency = program.frequency && program.frequency.length
            ? program.frequency.join(", ")
            : "-";
          const deloadWeeks = program?.recommendations?.deloadPlan?.recommendedDeloadWeeks;
          const autoInserted = Array.isArray(program?.recommendations?.autoInsertedExercises)
            ? program.recommendations.autoInsertedExercises.length
            : 0;
          return `
            <li class="program-item">
              <h3>${escapeHtml(program.name)}</h3>
              <div class="program-meta">
                <span><strong>Start:</strong> ${escapeHtml(program.startDate)}</span>
                <span><strong>Frequency:</strong> ${escapeHtml(frequency)}</span>
                <span><strong>Progression:</strong> ${escapeHtml(program.progression)}</span>
                <span><strong>Split:</strong> ${escapeHtml(program.splitMode)}</span>
                <span><strong>Deload weeks:</strong> ${escapeHtml(
                  Array.isArray(deloadWeeks) && deloadWeeks.length ? deloadWeeks.join(", ") : "None"
                )}</span>
                <span><strong>Auto-inserted variety:</strong> ${escapeHtml(String(autoInserted))}</span>
              </div>
            </li>
          `;
        })
        .join("");

      return getPrograms();
    }

    function saveProgram() {
      const result = collectProgramFromForm();
      if (result.error) {
        showToast(result.error);
        return null;
      }

      const program = cloneProgram(result.program);
      program.recommendations = buildVarietyRecommendations(program);
      programs.push(program);
      persistPrograms(programs);
      renderProgramList();
      closeProgramModal();
      showToast("Program saved");
      resetProgramForm();
      return program;
    }

    function initialiseUI() {
      if (!isBrowser()) return;
      const openButton = getElement("openProgramButton");
      const cancelButton = getElement("cancelProgramButton");
      const form = getElement("programForm");

      if (openButton) {
        openButton.addEventListener("click", () => {
          resetProgramForm();
          renderVarietyPreview();
          openProgramModal();
        });
      }

      if (cancelButton) {
        cancelButton.addEventListener("click", () => {
          resetProgramForm();
          closeProgramModal();
        });
      }

      if (form) {
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          saveProgram();
        });
      }

      renderProgramList();
    }

    if (isBrowser()) {
      if (global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", initialiseUI);
      } else {
        initialiseUI();
      }
    }

    return {
      saveProgram,
      renderProgramList,
      openProgramModal,
      closeProgramModal,
      resetProgramForm,
      getPrograms,
      setPrograms,
      collectProgramFromForm,
    };
  }
);
